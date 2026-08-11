import Stripe from 'stripe';
import { SubscriptionStatus, type Plan } from '@prisma/client';

import { PLANS, PLAN_ORDER } from '@/config/plans';
import { serverEnv } from '@/lib/env';
import { errors } from '@/lib/errors';

/**
 * Stripe integration.
 *
 * The client is created lazily so the app boots without Stripe configured —
 * a deployment used purely for auditing does not need billing wired up, and
 * failing at import time would take down the whole server.
 */

let cached: Stripe | null = null;

export function stripe(): Stripe {
  if (cached) return cached;

  const key = serverEnv().STRIPE_SECRET_KEY;
  if (!key) throw errors.configuration('Billing is not configured on this deployment.');

  cached = new Stripe(key, {
    // Pinned: an unpinned version means Stripe can change response shapes
    // under a running deployment.
    apiVersion: '2025-02-24.acacia',
    typescript: true,
    maxNetworkRetries: 2,
  });

  return cached;
}

export function stripeConfigured(): boolean {
  return Boolean(serverEnv().STRIPE_SECRET_KEY);
}

export type BillingInterval = 'monthly' | 'yearly';

/** Resolves the configured Stripe price id for a plan and interval. */
export function priceIdFor(plan: Plan, interval: BillingInterval): string {
  const definition = PLANS[plan];
  const envKey = interval === 'yearly' ? definition.stripeYearlyPriceEnv : definition.stripeMonthlyPriceEnv;

  if (!envKey) throw errors.validation('That plan cannot be purchased.');

  const value = serverEnv()[envKey as keyof ReturnType<typeof serverEnv>] as string | undefined;
  if (!value) {
    throw errors.configuration(`No Stripe price configured for ${definition.name} (${interval}).`);
  }

  return value;
}

/** Maps a Stripe price id back to a plan. Used by the webhook. */
export function planForPriceId(priceId: string): Plan | null {
  const env = serverEnv();

  for (const plan of PLAN_ORDER) {
    const definition = PLANS[plan];
    for (const key of [definition.stripeMonthlyPriceEnv, definition.stripeYearlyPriceEnv]) {
      if (!key) continue;
      if (env[key as keyof typeof env] === priceId) return plan;
    }
  }

  return null;
}

const STATUS_MAP: Record<Stripe.Subscription.Status, SubscriptionStatus> = {
  active: SubscriptionStatus.ACTIVE,
  trialing: SubscriptionStatus.TRIALING,
  past_due: SubscriptionStatus.PAST_DUE,
  canceled: SubscriptionStatus.CANCELED,
  incomplete: SubscriptionStatus.INCOMPLETE,
  incomplete_expired: SubscriptionStatus.INCOMPLETE_EXPIRED,
  unpaid: SubscriptionStatus.UNPAID,
  paused: SubscriptionStatus.PAUSED,
};

export function mapSubscriptionStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  return STATUS_MAP[status] ?? SubscriptionStatus.INCOMPLETE;
}

export function toDate(seconds: number | null | undefined): Date | null {
  return seconds ? new Date(seconds * 1000) : null;
}
