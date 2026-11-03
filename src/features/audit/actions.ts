'use server';

import { revalidatePath } from 'next/cache';

import { AuditStatus } from '@prisma/client';

import { db } from '@/lib/db';
import { errors, fail, ok, type ActionResult } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';

import { requireSession } from '../auth/session';
import {
  consumeQuota,
  consumeScanCredit,
  getEntitlements,
  refundQuota,
  refundScanCredit,
  releaseFreePreview,
  reserveFreePreview,
} from '../billing/quota';

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
  startAuditSchema,
  updateRecommendationSchema,
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
  let previewReserved = false;
  let scanCreditConsumed = false;
  let previewOnly = false;

  try {
    enforceRateLimit(`audit:${session.organizationId}`, RATE_LIMITS.audit);

    const parsed = startAuditSchema.safeParse(input);
    if (!parsed.success) {
      throw errors.validation(parsed.error.issues[0]?.message ?? 'Enter a valid website URL.');
    }

    const entitlements = await getEntitlements(session.organizationId);
    const projectId = parsed.data.projectId ?? (await defaultProjectId(session.organizationId));

    const website = parsed.data.websiteId
      ? await assertWebsiteAccess(parsed.data.websiteId, session.organizationId)
      : await resolveWebsite({ projectId, url: parsed.data.url });

    if (entitlements.plan === 'FREE') {
      const organization = await db.organization.findUnique({
        where: { id: session.organizationId },
        select: { freePreviewUsed: true },
      });
      if (!organization) throw errors.notFound('Workspace');

      if (!organization.freePreviewUsed) {
        previewReserved = await reserveFreePreview(session.organizationId);
        if (!previewReserved) {
          throw errors.quotaExceeded('Your free preview is already being used. Full audits start at $5.', {
            resource: 'freePreview',
          });
        }
        previewOnly = true;
      } else {
        scanCreditConsumed = await consumeScanCredit(session.organizationId);
        if (!scanCreditConsumed) {
          throw errors.quotaExceeded(
            'Your free preview has been used. Buy a full audit for $5, then $8 per audit, or choose a plan.',
            { resource: 'auditsRun', plan: entitlements.plan },
          );
        }
      }
    } else {
      await consumeQuota(session.organizationId, 'auditsRun');
      quotaConsumed = true;
    }

    auditId = await createPendingAudit({
      websiteId: website.id,
      userId: session.userId,
      url: parsed.data.url,
      device: parsed.data.device,
    });

    const result = await runAudit({
      url: parsed.data.url,
      device: parsed.data.device,
      plan: previewOnly ? 'FREE' : entitlements.plan === 'FREE' ? 'PRO' : entitlements.plan,
      fast: previewOnly,
      skipAi: previewOnly,
    });

    const previousScore = await previousScoreFor(website.id, auditId);

    await persistAudit({ auditId, websiteId: website.id, result, previewOnly });

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
    if (previewReserved) await releaseFreePreview(session.organizationId);
    if (scanCreditConsumed) await refundScanCredit(session.organizationId);

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
