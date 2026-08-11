import { errors } from './errors';

/**
 * Fixed-window rate limiter backed by an in-process map.
 *
 * This is deliberately simple: it protects a single instance from runaway
 * clients and is the right shape for the abuse we actually see (one user
 * hammering the analyze button). It does NOT coordinate across serverless
 * instances — the durable quota that protects revenue is the per-organization
 * usage counter in Postgres (`features/billing/quota.ts`), which this sits in
 * front of purely to shed load cheaply.
 *
 * Swapping in Upstash Redis later means reimplementing `consume` only; every
 * caller goes through `enforceRateLimit`.
 */

interface Window {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Window>();

// Bounded sweep so a long-lived instance cannot leak keys indefinitely.
const MAX_TRACKED_KEYS = 10_000;

function sweep(now: number) {
  if (buckets.size < MAX_TRACKED_KEYS) return;
  for (const [key, window] of buckets) {
    if (window.resetAt <= now) buckets.delete(key);
  }
}

export interface RateLimitRule {
  /** Requests allowed per window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function consume(key: string, rule: RateLimitRule): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + rule.windowSeconds * 1000 });
    return { allowed: true, remaining: rule.limit - 1, retryAfterSeconds: 0 };
  }

  if (existing.count >= rule.limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  return { allowed: true, remaining: rule.limit - existing.count, retryAfterSeconds: 0 };
}

/** Throws `AppError('RATE_LIMITED')` when the caller is over the limit. */
export function enforceRateLimit(key: string, rule: RateLimitRule): void {
  const result = consume(key, rule);
  if (!result.allowed) throw errors.rateLimited(result.retryAfterSeconds);
}

/** Named rules, kept together so limits are reviewable in one place. */
export const RATE_LIMITS = {
  /** Full audits are expensive (browser + PSI + AI). */
  audit: { limit: 10, windowSeconds: 60 * 10 },
  /** Anonymous landing-page trials, keyed by IP. */
  publicAudit: { limit: 3, windowSeconds: 60 * 60 },
  aiChat: { limit: 30, windowSeconds: 60 * 5 },
  aiReport: { limit: 10, windowSeconds: 60 * 10 },
  pdfExport: { limit: 20, windowSeconds: 60 * 10 },
  auth: { limit: 10, windowSeconds: 60 * 5 },
  mutation: { limit: 60, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitRule>;

/** Test seam — the in-process map survives module reuse between test files. */
export function __resetRateLimits() {
  buckets.clear();
}
