import { describe, expect, it } from 'vitest';

import { mollieCurrencySchema } from '@/lib/env';

describe('Mollie currency configuration', () => {
  it('accepts EUR and normalizes its casing', () => {
    expect(mollieCurrencySchema.parse('EUR')).toBe('EUR');
    expect(mollieCurrencySchema.parse('eur')).toBe('EUR');
  });

  it('defaults to USD and rejects malformed currency codes', () => {
    expect(mollieCurrencySchema.parse(undefined)).toBe('USD');
    expect(mollieCurrencySchema.safeParse('EURO').success).toBe(false);
  });
});
