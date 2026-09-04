import { Plan } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import {
  FEATURE_LABELS,
  PLANS,
  PLAN_ORDER,
  planHasFeature,
  planLimit,
  yearlySavingPercent,
  type FeatureKey,
} from '@/config/plans';

/**
 * The plan catalogue is the contract between the marketing page and the
 * server-side quota gate. These tests exist to catch drift between what the
 * pricing table promises and what the enforcement layer allows.
 */

const ALL_FEATURES = Object.keys(FEATURE_LABELS) as FeatureKey[];

describe('plan catalogue', () => {
  it('covers every plan in the database enum', () => {
    for (const plan of Object.values(Plan)) {
      expect(PLANS[plan], `missing definition for ${plan}`).toBeDefined();
    }
    expect(PLAN_ORDER).toHaveLength(Object.values(Plan).length);
  });

  it('defines every feature flag on every plan', () => {
    for (const plan of PLAN_ORDER) {
      for (const feature of ALL_FEATURES) {
        expect(typeof PLANS[plan].features[feature], `${plan}.${feature}`).toBe('boolean');
      }
    }
  });

  it('never removes a feature as you move up a tier', () => {
    // A paying customer upgrading must never lose something they had.
    for (let index = 1; index < PLAN_ORDER.length; index += 1) {
      const lower = PLANS[PLAN_ORDER[index - 1]];
      const higher = PLANS[PLAN_ORDER[index]];

      for (const feature of ALL_FEATURES) {
        if (lower.features[feature]) {
          expect(higher.features[feature], `${higher.name} lost ${feature}`).toBe(true);
        }
      }
    }
  });

  it('never tightens a limit as you move up a tier', () => {
    const limitKeys = Object.keys(PLANS.FREE.limits) as Array<keyof typeof PLANS.FREE.limits>;

    for (let index = 1; index < PLAN_ORDER.length; index += 1) {
      const lower = PLANS[PLAN_ORDER[index - 1]].limits;
      const higher = PLANS[PLAN_ORDER[index]].limits;

      for (const key of limitKeys) {
        const lowerValue = lower[key];
        const higherValue = higher[key];

        // null means unlimited, which is always at least as generous.
        if (higherValue == null) continue;
        expect(lowerValue, `${key} went down on ${PLAN_ORDER[index]}`).not.toBeNull();
        expect(higherValue).toBeGreaterThanOrEqual(lowerValue as number);
      }
    }
  });

  it('prices each tier above the one below it', () => {
    for (let index = 1; index < PLAN_ORDER.length; index += 1) {
      expect(PLANS[PLAN_ORDER[index]].monthlyPriceCents).toBeGreaterThan(
        PLANS[PLAN_ORDER[index - 1]].monthlyPriceCents,
      );
    }
  });

  it('gives the free plan no paid features and a single monthly audit allowance', () => {
    for (const feature of ALL_FEATURES) {
      expect(PLANS.FREE.features[feature], `free plan should not include ${feature}`).toBe(false);
    }
    expect(PLANS.FREE.limits.auditsPerMonth).toBe(1);
  });

  it('makes yearly cheaper than twelve monthly payments on every paid plan', () => {
    for (const plan of PLAN_ORDER) {
      const definition = PLANS[plan];
      if (definition.monthlyPriceCents === 0) continue;

      expect(definition.yearlyPriceCents).toBeLessThan(definition.monthlyPriceCents * 12);
      expect(yearlySavingPercent(plan)).toBeGreaterThan(0);
    }
  });

  it('gives every paid plan a Stripe price env binding', () => {
    for (const plan of PLAN_ORDER) {
      const definition = PLANS[plan];
      if (definition.monthlyPriceCents === 0) continue;

      expect(definition.stripeMonthlyPriceEnv, `${plan} monthly`).toBeTruthy();
      expect(definition.stripeYearlyPriceEnv, `${plan} yearly`).toBeTruthy();
    }
  });

  it('marks exactly one plan as highlighted', () => {
    const highlighted = PLAN_ORDER.filter((plan) => PLANS[plan].highlighted);
    expect(highlighted).toHaveLength(1);
  });

  it('lists marketing bullets for every plan', () => {
    for (const plan of PLAN_ORDER) {
      expect(PLANS[plan].bullets.length).toBeGreaterThan(2);
    }
  });
});

describe('accessors', () => {
  it('planHasFeature agrees with the catalogue', () => {
    expect(planHasFeature(Plan.FREE, 'aiChat')).toBe(false);
    expect(planHasFeature(Plan.PRO, 'aiChat')).toBe(true);
    expect(planHasFeature(Plan.PRO, 'whiteLabel')).toBe(false);
    expect(planHasFeature(Plan.AGENCY, 'whiteLabel')).toBe(true);
    expect(planHasFeature(Plan.AGENCY, 'apiAccess')).toBe(true);
  });

  it('planLimit returns null for unlimited', () => {
    expect(planLimit(Plan.FREE, 'auditsPerMonth')).toBe(1);
    expect(planLimit(Plan.PRO, 'auditsPerMonth')).toBeNull();
    expect(planLimit(Plan.AGENCY, 'projects')).toBeNull();
  });
});
