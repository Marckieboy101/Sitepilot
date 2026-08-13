import type { Plan } from '@prisma/client';

/**
 * Plan catalogue — the single source of truth for entitlements.
 *
 * Both the marketing pricing table and the server-side quota gate read from
 * here, so what the site promises and what the server enforces cannot drift.
 * `null` means unlimited.
 */

export type FeatureKey =
  | 'aiChat'
  | 'pdfExport'
  | 'history'
  | 'competitorAnalysis'
  | 'priorityRecommendations'
  | 'whiteLabel'
  | 'apiAccess'
  | 'scheduledAudits'
  | 'emailReports';

export interface PlanLimits {
  auditsPerMonth: number | null;
  projects: number | null;
  websitesPerProject: number | null;
  teamMembers: number | null;
  competitorsPerWebsite: number | null;
  aiChatMessagesPerMonth: number | null;
  historyRetentionDays: number | null;
}

export interface PlanDefinition {
  id: Plan;
  name: string;
  tagline: string;
  monthlyPriceCents: number;
  yearlyPriceCents: number;
  /** Env var holding the Stripe price id; absent for the free plan. */
  stripeMonthlyPriceEnv?: string;
  stripeYearlyPriceEnv?: string;
  highlighted?: boolean;
  limits: PlanLimits;
  features: Record<FeatureKey, boolean>;
  /** Marketing bullets, in display order. */
  bullets: string[];
}

const NO_FEATURES: Record<FeatureKey, boolean> = {
  aiChat: false,
  pdfExport: false,
  history: false,
  competitorAnalysis: false,
  priorityRecommendations: false,
  whiteLabel: false,
  apiAccess: false,
  scheduledAudits: false,
  emailReports: false,
};

export const PLANS: Record<Plan, PlanDefinition> = {
  FREE: {
    id: 'FREE',
    name: 'Free',
    tagline: 'Audit your site and see what AI finds.',
    monthlyPriceCents: 0,
    yearlyPriceCents: 0,
    limits: {
      auditsPerMonth: 3,
      projects: 1,
      websitesPerProject: 3,
      teamMembers: 1,
      competitorsPerWebsite: 0,
      aiChatMessagesPerMonth: 0,
      historyRetentionDays: 30,
    },
    features: { ...NO_FEATURES },
    bullets: [
      '3 audits per month',
      'Basic AI report',
      'SEO, performance & accessibility scores',
      '1 project, up to 3 websites',
      '30 days of history',
    ],
  },

  PRO: {
    id: 'PRO',
    name: 'Pro',
    tagline: 'Everything you need to ship a better website.',
    monthlyPriceCents: 2900,
    yearlyPriceCents: 27_900,
    stripeMonthlyPriceEnv: 'STRIPE_PRICE_PRO_MONTHLY',
    stripeYearlyPriceEnv: 'STRIPE_PRICE_PRO_YEARLY',
    highlighted: true,
    limits: {
      auditsPerMonth: null,
      projects: 10,
      websitesPerProject: 25,
      teamMembers: 3,
      competitorsPerWebsite: 5,
      aiChatMessagesPerMonth: 1000,
      historyRetentionDays: 365,
    },
    features: {
      ...NO_FEATURES,
      aiChat: true,
      pdfExport: true,
      history: true,
      competitorAnalysis: true,
      priorityRecommendations: true,
      scheduledAudits: true,
      emailReports: true,
    },
    bullets: [
      'Unlimited audits',
      'AI chat assistant trained on your audits',
      'Branded PDF export',
      'Full audit history & trends',
      'Competitor analysis (up to 5 per site)',
      'Prioritised recommendations',
      'Weekly scheduled audits & email reports',
    ],
  },

  AGENCY: {
    id: 'AGENCY',
    name: 'Agency',
    tagline: 'Run audits for every client, under your own brand.',
    monthlyPriceCents: 9900,
    yearlyPriceCents: 95_000,
    stripeMonthlyPriceEnv: 'STRIPE_PRICE_AGENCY_MONTHLY',
    stripeYearlyPriceEnv: 'STRIPE_PRICE_AGENCY_YEARLY',
    limits: {
      auditsPerMonth: null,
      projects: null,
      websitesPerProject: null,
      teamMembers: null,
      competitorsPerWebsite: null,
      aiChatMessagesPerMonth: null,
      historyRetentionDays: null,
    },
    features: {
      aiChat: true,
      pdfExport: true,
      history: true,
      competitorAnalysis: true,
      priorityRecommendations: true,
      whiteLabel: true,
      apiAccess: true,
      scheduledAudits: true,
      emailReports: true,
    },
    bullets: [
      'Everything in Pro',
      'Unlimited projects & websites',
      'Unlimited team members',
      'White-label reports with your logo',
      'Public API access',
      'Priority support',
    ],
  },
};

export const PLAN_ORDER: Plan[] = ['FREE', 'PRO', 'AGENCY'];

export function planDefinition(plan: Plan): PlanDefinition {
  return PLANS[plan];
}

export function planHasFeature(plan: Plan, feature: FeatureKey): boolean {
  return PLANS[plan].features[feature];
}

export function planLimit<K extends keyof PlanLimits>(plan: Plan, key: K): PlanLimits[K] {
  return PLANS[plan].limits[key];
}

/** Human label for a feature, used in upgrade prompts. */
export const FEATURE_LABELS: Record<FeatureKey, string> = {
  aiChat: 'The AI chat assistant',
  pdfExport: 'PDF export',
  history: 'Full audit history',
  competitorAnalysis: 'Competitor analysis',
  priorityRecommendations: 'Prioritised recommendations',
  whiteLabel: 'White-label reports',
  apiAccess: 'API access',
  scheduledAudits: 'Scheduled audits',
  emailReports: 'Email reports',
};

/** Yearly saving shown on the pricing toggle. */
export function yearlySavingPercent(plan: Plan): number {
  const def = PLANS[plan];
  if (def.monthlyPriceCents === 0) return 0;
  const fullYear = def.monthlyPriceCents * 12;
  return Math.round(((fullYear - def.yearlyPriceCents) / fullYear) * 100);
}
