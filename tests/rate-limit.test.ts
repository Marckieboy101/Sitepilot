import { beforeEach, describe, expect, it } from 'vitest';

import { AppError } from '@/lib/errors';
import { RATE_LIMITS, __resetRateLimits, consume, enforceRateLimit } from '@/lib/rate-limit';

describe('consume', () => {
  beforeEach(() => __resetRateLimits());

  const rule = { limit: 3, windowSeconds: 60 };

  it('allows up to the limit then blocks', () => {
    expect(consume('key', rule).allowed).toBe(true);
    expect(consume('key', rule).allowed).toBe(true);
    expect(consume('key', rule).allowed).toBe(true);

    const blocked = consume('key', rule);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('counts down the remaining allowance', () => {
    expect(consume('key', rule).remaining).toBe(2);
    expect(consume('key', rule).remaining).toBe(1);
    expect(consume('key', rule).remaining).toBe(0);
  });

  it('keeps separate buckets per key', () => {
    // Otherwise one noisy tenant would rate-limit everyone else.
    for (let i = 0; i < 3; i += 1) consume('tenant-a', rule);

    expect(consume('tenant-a', rule).allowed).toBe(false);
    expect(consume('tenant-b', rule).allowed).toBe(true);
  });

  it('opens a fresh window once the old one expires', () => {
    const shortRule = { limit: 1, windowSeconds: 0 };

    expect(consume('expiring', shortRule).allowed).toBe(true);
    // A zero-second window has already elapsed by the next call.
    expect(consume('expiring', shortRule).allowed).toBe(true);
  });
});

describe('enforceRateLimit', () => {
  beforeEach(() => __resetRateLimits());

  it('throws a RATE_LIMITED AppError when over the limit', () => {
    const rule = { limit: 1, windowSeconds: 60 };
    enforceRateLimit('throwing', rule);

    try {
      enforceRateLimit('throwing', rule);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('RATE_LIMITED');
      expect((error as AppError).status).toBe(429);
      expect((error as AppError).details?.retryAfterSeconds).toBeGreaterThan(0);
    }
  });
});

describe('RATE_LIMITS', () => {
  it('limits anonymous audits more tightly than authenticated ones', () => {
    // The public endpoint is unauthenticated and costs real compute, so its
    // per-window allowance must be the stricter of the two.
    const publicPerHour =
      (RATE_LIMITS.publicAudit.limit / RATE_LIMITS.publicAudit.windowSeconds) * 3600;
    const authedPerHour = (RATE_LIMITS.audit.limit / RATE_LIMITS.audit.windowSeconds) * 3600;

    expect(publicPerHour).toBeLessThan(authedPerHour);
  });

  it('defines a positive limit and window for every rule', () => {
    for (const [name, rule] of Object.entries(RATE_LIMITS)) {
      expect(rule.limit, name).toBeGreaterThan(0);
      expect(rule.windowSeconds, name).toBeGreaterThan(0);
    }
  });
});
