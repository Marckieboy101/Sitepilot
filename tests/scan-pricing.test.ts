import { describe, expect, it } from 'vitest';

import {
  FIRST_PAID_SCAN_PRICE_CENTS,
  oneTimeScanPriceCents,
  STANDARD_SCAN_PRICE_CENTS,
} from '@/features/billing/scan-pricing';

describe('one-time scan pricing', () => {
  it('discounts the first paid scan to $5', () => {
    expect(oneTimeScanPriceCents(0)).toBe(FIRST_PAID_SCAN_PRICE_CENTS);
    expect(FIRST_PAID_SCAN_PRICE_CENTS).toBe(500);
  });

  it('charges $8 for later scans', () => {
    expect(oneTimeScanPriceCents(1)).toBe(STANDARD_SCAN_PRICE_CENTS);
    expect(oneTimeScanPriceCents(10)).toBe(STANDARD_SCAN_PRICE_CENTS);
    expect(STANDARD_SCAN_PRICE_CENTS).toBe(800);
  });
});
