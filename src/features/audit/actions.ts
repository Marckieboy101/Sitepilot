'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';

import { AuditStatus } from '@prisma/client';

import { db } from '@/lib/db';
import { errors, fail, ok, type ActionResult } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';

import { requireSession } from '../auth/session';
import { consumeQuota, refundQuota } from '../billing/quota';

import { runAudit } from './engine';
import {
  createPendingAudit,
  markAuditFailed,
  notifyAuditComplete,
  persistAudit,
  previousScoreFor,
  resolveWebsite,
} from './persist';
import {
  publicAuditSchema,
  startAuditSchema,
  updateRecommendationSchema,
  type PublicAuditInput,
  type StartAuditInput,
  type UpdateRecommendationInput,
} from './schemas';

const log = logger.child({ module: 'audit/actions' });

/**
 * Audits run inline in the server action rather than through a job queue.
 *
 * A full run is 30-90 seconds, which fits inside a Vercel function with an
 * extended `maxDuration` and keeps the whole product deployable without extra
 * infrastructure. The audit row is created up front in RUNNING state so the UI
 * has something to show and a crashed run leaves a visible FAILED record
 * rather than vanishing.
 *
 * The seam for moving to a queue is deliberately narrow: `startAuditAction`
 * would enqueue instead of awaiting `executeAudit`, and nothing else changes.
 */

async function clientIp(): Promise<string> {
  try {
    const headerList = await headers();
    return (
      headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      headerList.get('x-real-ip') ??
      'unknown'
    );
  } catch {
    return 'unknown';
  }
}

export interface StartedAudit {
  auditId: string;
  overallScore: number;
  url: string;
}

export async function startAuditAction(input: StartAuditInput): Promise<ActionResult<StartedAudit>> {
  const session = await requireSession().catch(() => null);
  if (!session) return fail(errors.unauthorized());

  let auditId: string | null = null;
  let quotaConsumed = false;

  try {
    enforceRateLimit(`audit:${session.organizationId}`, RATE_LIMITS.audit);

    const parsed = startAuditSchema.safeParse(input);
    if (!parsed.success) {
      throw errors.validation(parsed.error.issues[0]?.message ?? 'Enter a valid website URL.');
    }

    // Reserve the credit before doing any expensive work, and refund it below
    // if the run fails — the user should not pay for our failures.
    await consumeQuota(session.organizationId, 'auditsRun');
    quotaConsumed = true;

    const projectId = parsed.data.projectId ?? (await defaultProjectId(session.organizationId));

    const website = parsed.data.websiteId
      ? await assertWebsiteAccess(parsed.data.websiteId, session.organizationId)
      : await resolveWebsite({ projectId, url: parsed.data.url });

    auditId = await createPendingAudit({
      websiteId: website.id,
      userId: session.userId,
      url: parsed.data.url,
      device: parsed.data.device,
    });

    const result = await runAudit({
      url: parsed.data.url,
      device: parsed.data.device,
    });

    const previousScore = await previousScoreFor(website.id, auditId);

    await persistAudit({ auditId, websiteId: website.id, result });

    await notifyAuditComplete({
      userId: session.userId,
      auditId,
      url: result.finalUrl,
      score: result.overallScore,
      previousScore,
    });

    revalidatePath('/dashboard');
    revalidatePath('/dashboard/audits');
    revalidatePath('/dashboard/history');

    return ok({ auditId, overallScore: result.overallScore, url: result.finalUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The audit could not be completed.';
    log.error('audit failed', { organizationId: session.organizationId, error });

    if (auditId) await markAuditFailed(auditId, message);
    if (quotaConsumed) await refundQuota(session.organizationId, 'auditsRun');

    return fail(error);
  }
}

/**
 * Anonymous audit for the landing page.
 *
 * Deliberately reduced: no browser, no link probing, no persistence. It exists
 * to prove the product works in under 20 seconds, and the full run is what
 * signing up buys.
 */
export interface PublicAuditResult {
  url: string;
  overallScore: number;
  categories: Array<{ category: string; score: number; summary: string }>;
  topIssues: Array<{ severity: string; title: string; category: string }>;
  quickWins: Array<{ title: string; expectedImpact: string }>;
  executiveSummary: string;
}

export async function publicAuditAction(input: PublicAuditInput): Promise<ActionResult<PublicAuditResult>> {
  try {
    enforceRateLimit(`public-audit:${await clientIp()}`, RATE_LIMITS.publicAudit);

    const parsed = publicAuditSchema.safeParse(input);
    if (!parsed.success) {
      throw errors.validation(parsed.error.issues[0]?.message ?? 'Enter a valid website URL.');
    }

    const result = await runAudit({ url: parsed.data.url, device: 'MOBILE', fast: true, skipAi: true });

    return ok({
      url: result.finalUrl,
      overallScore: result.overallScore,
      categories: result.categories.map((category) => ({
        category: category.category,
        score: category.score,
        summary: category.summary,
      })),
      topIssues: result.issues
        .filter((issue) => issue.severity === 'CRITICAL' || issue.severity === 'HIGH')
        .slice(0, 5)
        .map((issue) => ({ severity: issue.severity, title: issue.title, category: issue.category })),
      quickWins: result.recommendations
        .filter((recommendation) => recommendation.kind === 'QUICK_WIN')
        .slice(0, 3)
        .map((recommendation) => ({
          title: recommendation.title,
          expectedImpact: recommendation.expectedImpact,
        })),
      executiveSummary: result.report.executiveSummary,
    });
  } catch (error) {
    return fail(error);
  }
}

export async function deleteAuditAction(auditId: string): Promise<ActionResult<null>> {
  try {
    const session = await requireSession();
    enforceRateLimit(`mutate:${session.userId}`, RATE_LIMITS.mutation);

    const audit = await db.audit.findFirst({
      where: { id: auditId, website: { project: { organizationId: session.organizationId } } },
      select: { id: true },
    });
    if (!audit) throw errors.notFound('Audit');

    await db.audit.delete({ where: { id: auditId } });

    revalidatePath('/dashboard/audits');
    revalidatePath('/dashboard/history');
    return ok(null);
  } catch (error) {
    return fail(error);
  }
}

export async function updateRecommendationStatusAction(
  input: UpdateRecommendationInput,
): Promise<ActionResult<null>> {
  try {
    const session = await requireSession();
    enforceRateLimit(`mutate:${session.userId}`, RATE_LIMITS.mutation);

    const parsed = updateRecommendationSchema.safeParse(input);
    if (!parsed.success) throw errors.validation('That status is not valid.');

    // Ownership is checked as part of the update filter, so a forged id
    // updates zero rows instead of someone else's data.
    const updated = await db.recommendation.updateMany({
      where: {
        id: parsed.data.recommendationId,
        audit: { website: { project: { organizationId: session.organizationId } } },
      },
      data: { status: parsed.data.status },
    });

    if (updated.count === 0) throw errors.notFound('Recommendation');

    revalidatePath('/dashboard/audits');
    return ok(null);
  } catch (error) {
    return fail(error);
  }
}

export async function cancelAuditAction(auditId: string): Promise<ActionResult<null>> {
  try {
    const session = await requireSession();

    const updated = await db.audit.updateMany({
      where: {
        id: auditId,
        status: { in: [AuditStatus.QUEUED, AuditStatus.RUNNING] },
        website: { project: { organizationId: session.organizationId } },
      },
      data: { status: AuditStatus.CANCELED, completedAt: new Date() },
    });

    if (updated.count === 0) throw errors.notFound('Running audit');

    revalidatePath('/dashboard/audits');
    return ok(null);
  } catch (error) {
    return fail(error);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function defaultProjectId(organizationId: string): Promise<string> {
  const existing = await db.project.findFirst({
    where: { organizationId, archived: false },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });

  if (existing) return existing.id;

  const created = await db.project.create({
    data: { organizationId, name: 'My Websites' },
    select: { id: true },
  });
  return created.id;
}

async function assertWebsiteAccess(websiteId: string, organizationId: string) {
  const website = await db.website.findFirst({
    where: { id: websiteId, project: { organizationId } },
    select: { id: true, url: true },
  });
  if (!website) throw errors.notFound('Website');
  return website;
}
