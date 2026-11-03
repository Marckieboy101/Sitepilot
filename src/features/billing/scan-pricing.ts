export const FIRST_PAID_SCAN_PRICE_CENTS = 500;
export const STANDARD_SCAN_PRICE_CENTS = 800;

export function oneTimeScanPriceCents(paidScanPurchases: number): number {
  return paidScanPurchases === 0 ? FIRST_PAID_SCAN_PRICE_CENTS : STANDARD_SCAN_PRICE_CENTS;
}
