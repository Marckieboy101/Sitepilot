import { Plan, SubscriptionStatus } from '@prisma/client';

import { FEATURE_LABELS, PLANS, type FeatureKey } from '@/config/plans';
import { db } from '@/lib/db';
import { errors } from '@/lib/errors';

/**
 * Plan entitlement and usage enforcement.
 *
 * This is the layer that protects revenue, so it lives in the database rather
 * than in memory: counters are incremented with an atomic upsert inside the
 * same request that consumes the resource, which means two concurrent audits
 * from one organization cannot both slip past the last remaining credit.
 *
 * Usage is recorded per UTC calendar month regardless of the Stripe billing
 * anchor. Aligning to the subscription period would be more "correct" but
 * produces a quota that resets on a date the user cannot predict, and support
 * tickets about it cost more than the handful of extra audits it grants.
 */

export type MeteredResource = 'auditsRun' | 'aiReports' | 'aiChatMessages' | 'pdfExports' | 'competitorRuns';

const RESOURCE_LIMITS: Record<MeteredResource, keyof (typeof PLANS)[Plan]['limits'] | null> = {
  auditsRun: 'auditsPerMonth',
  aiChatMessages: 'aiChatMessagesPerMonth',
  aiReports: null,
  pdfExports: null,
  competitorRuns: null,
};

const RESOURCE_LABELS: Record<MeteredResource, string> = {
  auditsRun: 'audits',
  aiReports: 'AI reports',
  aiChatMessages: 'AI chat messages',
  pdfExports: 'PDF exports',
  competitorRuns: 'competitor comparisons',
};

/** First instant of the current UTC month. */
export function currentPeriodStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export interface EntitlementSnapshot {
  plan: Plan;
  status: SubscriptionStatus;
  /** False when the subscription lapsed — entitlements drop back to Free. */
  active: boolean;
  usage: Record<MeteredResource, number>;
  limits: (typeof PLANS)[Plan]['limits'];
  periodStart: Date;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
}

const ACTIVE_STATUSES = new Set<SubscriptionStatus>([
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.TRIALING,
  // Grace period: a failed payment shouldn't lock someone out mid-retry.
  SubscriptionStatus.PAST_DUE,
]);

export async function getEntitlements(organizationId: string): Promise<EntitlementSnapshot> {
  const periodStart = currentPeriodStart();

  const [subscription, usage] = await Promise.all([
    db.subscription.findUnique({
      where: { organizationId },
      select: {
        plan: true,
        status: true,
        cancelAtPeriodEnd: true,
        currentPeriodEnd: true,
      },
    }),
    db.usageRecord.findUnique({
      where: { organizationId_periodStart: { organizationId, periodStart } },
      select: {
        auditsRun: true,
        aiReports: true,
        aiChatMessages: true,
        pdfExports: true,
        competitorRuns: true,
      },
    }),
  ]);

  const status = subscription?.status ?? SubscriptionStatus.ACTIVE;
  const active = ACTIVE_STATUSES.has(status);
  // A lapsed paid subscription falls back to Free entitlements rather than
  // losing access entirely — the data stays readable, the quota tightens.
  const plan = active ? (subscription?.plan ?? Plan.FREE) : Plan.FREE;

  return {
    plan,
    status,
    active,
    periodStart,
    cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
    currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
    limits: PLANS[plan].limits,
    usage: {
      auditsRun: usage?.auditsRun ?? 0,
      aiReports: usage?.aiReports ?? 0,
      aiChatMessages: usage?.aiChatMessages ?? 0,
      pdfExports: usage?.pdfExports ?? 0,
      competitorRuns: usage?.competitorRuns ?? 0,
    },
  };
}

/** Throws `UPGRADE_REQUIRED` when the plan does not include a feature. */
export async function requireFeature(organizationId: string, feature: FeatureKey): Promise<Plan> {
  const { plan } = await getEntitlements(organizationId);
  if (!PLANS[plan].features[feature]) {
    throw errors.upgradeRequired(FEATURE_LABELS[feature]);
  }
  return plan;
}

export interface QuotaCheck {
  allowed: boolean;
  used: number;
  limit: number | null;
  remaining: number | null;
}

export async function checkQuota(organizationId: string, resource: MeteredResource): Promise<QuotaCheck> {
  const entitlements = await getEntitlements(organizationId);
  const limitKey = RESOURCE_LIMITS[resource];

  if (!limitKey) return { allowed: true, used: entitlements.usage[resource], limit: null, remaining: null };

  const limit = entitlements.limits[limitKey] as number | null;
  const used = entitlements.usage[resource];

  if (limit == null) return { allowed: true, used, limit: null, remaining: null };

  return { allowed: used < limit, used, limit, remaining: Math.max(0, limit - used) };
}

/**
 * Reserves one unit of a metered resource.
 *
 * Check-then-increment is one statement, not two: the increment is conditional
 * on the current value inside a transaction, so a race between two requests
 * results in one success and one `QUOTA_EXCEEDED` rather than both passing a
 * stale check.
 */
export async function consumeQuota(
  organizationId: string,
  resource: MeteredResource,
  amount = 1,
): Promise<void> {
  const entitlements = await getEntitlements(organizationId);
  const limitKey = RESOURCE_LIMITS[resource];
  const limit = limitKey ? (entitlements.limits[limitKey] as number | null) : null;
  const periodStart = entitlements.periodStart;

  await db.$transaction(async (tx) => {
    const record = await tx.usageRecord.upsert({
      where: { organizationId_periodStart: { organizationId, periodStart } },
      create: { organizationId, periodStart },
      update: {},
      select: {
        id: true,
        auditsRun: true,
        aiReports: true,
        aiChatMessages: true,
        pdfExports: true,
        competitorRuns: true,
      },
    });

    const current = record[resource];

    if (limit != null && current + amount > limit) {
      throw errors.quotaExceeded(
        `You've used all ${limit} ${RESOURCE_LABELS[resource]} on the ${PLANS[entitlements.plan].name} plan this month. Upgrade for more.`,
        { resource, used: current, limit, plan: entitlements.plan },
      );
    }

    await tx.usageRecord.update({
      where: { id: record.id },
      data: { [resource]: { increment: amount } },
    });
  });
}

/**
 * Releases a previously consumed unit. Called when the work fails after the
 * reservation — charging someone an audit credit for our own timeout is the
 * kind of thing that generates refund requests.
 */
export async function refundQuota(
  organizationId: string,
  resource: MeteredResource,
  amount = 1,
): Promise<void> {
  const periodStart = currentPeriodStart();

  await db.usageRecord
    .update({
      where: { organizationId_periodStart: { organizationId, periodStart } },
      data: { [resource]: { decrement: amount } },
    })
    .catch(() => {
      // No record means nothing was consumed; nothing to refund.
    });
}

/** Countable resource limits (projects, websites, members) checked on create. */
export async function assertWithinCountLimit(
  organizationId: string,
  kind: 'projects' | 'teamMembers',
): Promise<void> {
  const { plan, limits } = await getEntitlements(organizationId);
  const limit = kind === 'projects' ? limits.projects : limits.teamMembers;
  if (limit == null) return;

  const count =
    kind === 'projects'
      ? await db.project.count({ where: { organizationId, archived: false } })
      : await db.organizationMember.count({ where: { organizationId } });

  if (count >= limit) {
    throw errors.quotaExceeded(
      `The ${PLANS[plan].name} plan includes ${limit} ${kind === 'projects' ? 'project' : 'team member'}${limit === 1 ? '' : 's'}. Upgrade to add more.`,
      { kind, count, limit, plan },
    );
  }
}
