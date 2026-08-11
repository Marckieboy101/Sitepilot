'use server';

import { revalidatePath } from 'next/cache';
import { AuditCategory, AuditStatus } from '@prisma/client';
import { z } from 'zod';

import { db } from '@/lib/db';
import { errors, fail, ok, type ActionResult } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';
import { assertPublicUrl, domainOf, normalizeUrl } from '@/lib/url';

import { requireSession } from '../auth/session';
import { consumeQuota, getEntitlements, requireFeature } from '../billing/quota';
import { aiAvailable, completeJson, defaultModel } from '../ai/client';
import { ANALYSIS_SYSTEM_PROMPT, buildComparisonPrompt } from '../ai/prompts';
import { comparisonSummarySchema } from '../ai/schemas';
import { runAudit } from '../audit/engine';

/**
 * Competitor comparison.
 *
 * Competitor sites are audited with the same engine but never persisted as
 * full audits — we hold the category scores for the comparison and discard the
 * rest. Storing a complete audit of someone else's website would inflate the
 * customer's own history with pages they do not own, and keep third-party page
 * content we have no reason to retain.
 */

const log = logger.child({ module: 'competitors/actions' });

const addCompetitorSchema = z.object({
  websiteId: z.string().cuid(),
  url: z.string().min(1, 'Enter a competitor URL').max(2048),
  label: z.string().max(80).trim().optional(),
});

const runComparisonSchema = z.object({
  websiteId: z.string().cuid(),
  competitorIds: z.array(z.string().cuid()).min(1, 'Pick at least one competitor').max(5),
});

export type AddCompetitorInput = z.infer<typeof addCompetitorSchema>;
export type RunComparisonInput = z.infer<typeof runComparisonSchema>;

export async function addCompetitorAction(input: AddCompetitorInput): Promise<ActionResult<{ id: string }>> {
  try {
    const session = await requireSession();
    enforceRateLimit(`mutate:${session.userId}`, RATE_LIMITS.mutation);

    await requireFeature(session.organizationId, 'competitorAnalysis');

    const parsed = addCompetitorSchema.safeParse(input);
    if (!parsed.success) throw errors.validation(parsed.error.issues[0]?.message ?? 'Check the form.');

    const website = await db.website.findFirst({
      where: { id: parsed.data.websiteId, project: { organizationId: session.organizationId } },
      select: { id: true, _count: { select: { competitors: true } } },
    });
    if (!website) throw errors.notFound('Website');

    const { limits } = await getEntitlements(session.organizationId);
    if (
      limits.competitorsPerWebsite != null &&
      website._count.competitors >= limits.competitorsPerWebsite
    ) {
      throw errors.quotaExceeded(
        `Your plan allows ${limits.competitorsPerWebsite} competitors per website. Upgrade to track more.`,
      );
    }

    const safe = assertPublicUrl(parsed.data.url);
    const normalized = normalizeUrl(parsed.data.url);

    const competitor = await db.competitor.upsert({
      where: { websiteId_url: { websiteId: parsed.data.websiteId, url: normalized } },
      create: {
        websiteId: parsed.data.websiteId,
        url: normalized,
        domain: safe.domain,
        label: parsed.data.label || safe.domain,
      },
      update: { label: parsed.data.label || undefined },
      select: { id: true },
    });

    revalidatePath('/dashboard/competitors');
    return ok(competitor);
  } catch (error) {
    return fail(error);
  }
}

export async function removeCompetitorAction(competitorId: string): Promise<ActionResult<null>> {
  try {
    const session = await requireSession();

    const competitor = await db.competitor.findFirst({
      where: {
        id: competitorId,
        website: { project: { organizationId: session.organizationId } },
      },
      select: { id: true },
    });
    if (!competitor) throw errors.notFound('Competitor');

    await db.competitor.delete({ where: { id: competitorId } });

    revalidatePath('/dashboard/competitors');
    return ok(null);
  } catch (error) {
    return fail(error);
  }
}

function scoresOf(categories: Array<{ category: AuditCategory; score: number }>) {
  const map = Object.fromEntries(categories.map((entry) => [entry.category, entry.score]));
  return {
    seoScore: map[AuditCategory.SEO] ?? 0,
    performanceScore: map[AuditCategory.PERFORMANCE] ?? 0,
    accessibilityScore: map[AuditCategory.ACCESSIBILITY] ?? 0,
    uxScore: map[AuditCategory.UX] ?? 0,
    designScore: map[AuditCategory.DESIGN] ?? 0,
    contentScore: map[AuditCategory.CONTENT] ?? 0,
    securityScore: map[AuditCategory.SECURITY] ?? 0,
  };
}

export async function runComparisonAction(
  input: RunComparisonInput,
): Promise<ActionResult<{ comparisonId: string }>> {
  const session = await requireSession().catch(() => null);
  if (!session) return fail(errors.unauthorized());

  let quotaConsumed = false;

  try {
    enforceRateLimit(`comparison:${session.organizationId}`, RATE_LIMITS.audit);
    await requireFeature(session.organizationId, 'competitorAnalysis');

    const parsed = runComparisonSchema.safeParse(input);
    if (!parsed.success) throw errors.validation(parsed.error.issues[0]?.message ?? 'Check your selection.');

    const website = await db.website.findFirst({
      where: { id: parsed.data.websiteId, project: { organizationId: session.organizationId } },
      select: {
        id: true,
        url: true,
        label: true,
        domain: true,
        competitors: {
          where: { id: { in: parsed.data.competitorIds } },
          select: { id: true, url: true, label: true, domain: true },
        },
        audits: {
          where: { status: AuditStatus.COMPLETED },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            overallScore: true,
            categoryScores: { select: { category: true, score: true } },
          },
        },
      },
    });

    if (!website) throw errors.notFound('Website');
    if (website.competitors.length === 0) throw errors.validation('Pick at least one competitor to compare.');

    const ownAudit = website.audits[0];
    if (!ownAudit) {
      throw errors.validation('Audit your own site first — there is nothing to compare against yet.');
    }

    await consumeQuota(session.organizationId, 'competitorRuns');
    quotaConsumed = true;

    // Competitor audits run sequentially. Firing them in parallel would be
    // faster but multiplies our outbound load on third-party sites and risks
    // looking like an attack from their side.
    const competitorResults: Array<{
      competitorId: string;
      label: string;
      url: string;
      overallScore: number;
      scores: ReturnType<typeof scoresOf>;
    }> = [];

    for (const competitor of website.competitors) {
      try {
        const result = await runAudit({ url: competitor.url, device: 'MOBILE', fast: true, skipAi: true });
        competitorResults.push({
          competitorId: competitor.id,
          label: competitor.label ?? competitor.domain,
          url: competitor.url,
          overallScore: result.overallScore,
          scores: scoresOf(
            result.categories.map((category) => ({ category: category.category, score: category.score })),
          ),
        });
      } catch (error) {
        log.warn('competitor audit failed; excluding from comparison', { url: competitor.url, error });
      }
    }

    if (competitorResults.length === 0) {
      throw errors.upstream('Competitor analysis', 'None of the competitor sites could be reached.');
    }

    const selfScores = scoresOf(ownAudit.categoryScores);
    const selfLabel = website.label ?? website.domain;

    // AI narrative is a bonus, not a requirement — a comparison with charts
    // and no summary is still useful.
    let aiSummary: string | null = null;
    let model: string | null = null;

    if (aiAvailable()) {
      try {
        const { data, usage } = await completeJson({
          schema: comparisonSummarySchema,
          system: ANALYSIS_SYSTEM_PROMPT,
          user: buildComparisonPrompt({
            self: { label: selfLabel, url: website.url, scores: { overall: ownAudit.overallScore ?? 0, ...selfScores } },
            competitors: competitorResults.map((entry) => ({
              label: entry.label,
              url: entry.url,
              scores: { overall: entry.overallScore, ...entry.scores },
            })),
          }),
          temperature: 0.45,
          maxTokens: 2000,
          model: defaultModel(),
        });

        aiSummary = [
          data.summary,
          data.yourAdvantages.length > 0 ? `\n\nWhere you lead:\n${data.yourAdvantages.map((item) => `• ${item}`).join('\n')}` : '',
          data.theirAdvantages.length > 0 ? `\n\nWhere they lead:\n${data.theirAdvantages.map((item) => `• ${item}`).join('\n')}` : '',
          data.priorityActions.length > 0 ? `\n\nWhat to do about it:\n${data.priorityActions.map((item, index) => `${index + 1}. ${item}`).join('\n')}` : '',
        ].join('');
        model = usage.model;
      } catch (error) {
        log.warn('comparison summary failed', { error });
      }
    }

    const comparison = await db.comparison.create({
      data: {
        organizationId: session.organizationId,
        websiteId: website.id,
        title: `${selfLabel} vs. ${competitorResults.map((entry) => entry.label).join(', ')}`,
        aiSummary,
        model,
        entries: {
          create: [
            {
              auditId: ownAudit.id,
              label: selfLabel,
              url: website.url,
              isSelf: true,
              overallScore: ownAudit.overallScore ?? 0,
              ...selfScores,
            },
            ...competitorResults.map((entry) => ({
              competitorId: entry.competitorId,
              label: entry.label,
              url: entry.url,
              isSelf: false,
              overallScore: entry.overallScore,
              ...entry.scores,
            })),
          ],
        },
      },
      select: { id: true },
    });

    revalidatePath('/dashboard/competitors');
    return ok({ comparisonId: comparison.id });
  } catch (error) {
    if (quotaConsumed) {
      const { refundQuota } = await import('../billing/quota');
      await refundQuota(session.organizationId, 'competitorRuns');
    }
    return fail(error);
  }
}
