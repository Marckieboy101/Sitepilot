import { AuditCategory, Difficulty, Priority, Severity } from '@prisma/client';

/**
 * Scoring model.
 *
 * Every analyzer emits a 0-100 category score; the overall score is their
 * weighted mean. Weights encode what actually moves the needle for a business
 * website — SEO and performance are what lose traffic, so they carry the most.
 * Categories that fail to run are dropped from the mean rather than counted as
 * zero, otherwise a PageSpeed outage would look like a broken website.
 */

export const CATEGORY_WEIGHTS: Record<AuditCategory, number> = {
  [AuditCategory.SEO]: 1.25,
  [AuditCategory.PERFORMANCE]: 1.25,
  [AuditCategory.ACCESSIBILITY]: 1.0,
  [AuditCategory.UX]: 1.0,
  [AuditCategory.DESIGN]: 0.75,
  [AuditCategory.CONTENT]: 0.75,
  [AuditCategory.SECURITY]: 1.0,
  [AuditCategory.TECHNICAL]: 1.0,
};

export const CATEGORY_LABELS: Record<AuditCategory, string> = {
  [AuditCategory.SEO]: 'SEO',
  [AuditCategory.PERFORMANCE]: 'Performance',
  [AuditCategory.ACCESSIBILITY]: 'Accessibility',
  [AuditCategory.UX]: 'UX',
  [AuditCategory.DESIGN]: 'Design',
  [AuditCategory.CONTENT]: 'Content',
  [AuditCategory.SECURITY]: 'Security',
  [AuditCategory.TECHNICAL]: 'Technical',
};

export const CATEGORY_DESCRIPTIONS: Record<AuditCategory, string> = {
  [AuditCategory.SEO]: 'How well search engines can find, read and rank this page.',
  [AuditCategory.PERFORMANCE]: 'How fast the page loads and becomes usable on real devices.',
  [AuditCategory.ACCESSIBILITY]: 'Whether people using assistive technology can use the page.',
  [AuditCategory.UX]: 'How easily a visitor can understand and act on the page.',
  [AuditCategory.DESIGN]: 'Visual craft, consistency and how modern the page feels.',
  [AuditCategory.CONTENT]: 'Clarity, depth and persuasiveness of the writing.',
  [AuditCategory.SECURITY]: 'Transport security and protective HTTP headers.',
  [AuditCategory.TECHNICAL]: 'Crawlability, redirects, link health and markup hygiene.',
};

export interface ScoredCategory {
  category: AuditCategory;
  score: number;
}

/** Weighted mean of the categories that produced a score. */
export function computeOverallScore(categories: readonly ScoredCategory[]): number {
  const scored = categories.filter((entry) => Number.isFinite(entry.score));
  if (scored.length === 0) return 0;

  let weightedTotal = 0;
  let weightTotal = 0;

  for (const entry of scored) {
    const weight = CATEGORY_WEIGHTS[entry.category] ?? 1;
    weightedTotal += entry.score * weight;
    weightTotal += weight;
  }

  return Math.round(weightedTotal / weightTotal);
}

export type ScoreBand = 'excellent' | 'good' | 'fair' | 'poor';

export function scoreBand(score: number): ScoreBand {
  if (score >= 90) return 'excellent';
  if (score >= 75) return 'good';
  if (score >= 50) return 'fair';
  return 'poor';
}

export const BAND_LABELS: Record<ScoreBand, string> = {
  excellent: 'Excellent',
  good: 'Good',
  fair: 'Needs work',
  poor: 'Critical',
};

/** Tailwind token per band. Kept here so charts and badges never disagree. */
export const BAND_COLORS: Record<ScoreBand, { text: string; bg: string; ring: string; hex: string }> = {
  excellent: {
    text: 'text-emerald-600 dark:text-emerald-400',
    bg: 'bg-emerald-500/10',
    ring: 'ring-emerald-500/20',
    hex: '#10b981',
  },
  good: {
    text: 'text-sky-600 dark:text-sky-400',
    bg: 'bg-sky-500/10',
    ring: 'ring-sky-500/20',
    hex: '#0ea5e9',
  },
  fair: {
    text: 'text-amber-600 dark:text-amber-400',
    bg: 'bg-amber-500/10',
    ring: 'ring-amber-500/20',
    hex: '#f59e0b',
  },
  poor: {
    text: 'text-rose-600 dark:text-rose-400',
    bg: 'bg-rose-500/10',
    ring: 'ring-rose-500/20',
    hex: '#f43f5e',
  },
};

export function scoreColor(score: number): string {
  return BAND_COLORS[scoreBand(score)].hex;
}

// ---------------------------------------------------------------------------
// Core Web Vitals thresholds (Google's official good/needs-improvement cuts)
// ---------------------------------------------------------------------------

export interface MetricThreshold {
  good: number;
  poor: number;
  unit: 'ms' | 'score';
  label: string;
  description: string;
}

export const METRIC_THRESHOLDS = {
  firstContentfulPaint: {
    good: 1800,
    poor: 3000,
    unit: 'ms',
    label: 'First Contentful Paint',
    description: 'When the first text or image appears.',
  },
  largestContentfulPaint: {
    good: 2500,
    poor: 4000,
    unit: 'ms',
    label: 'Largest Contentful Paint',
    description: 'When the main content has finished rendering.',
  },
  cumulativeLayoutShift: {
    good: 0.1,
    poor: 0.25,
    unit: 'score',
    label: 'Cumulative Layout Shift',
    description: 'How much the layout jumps around while loading.',
  },
  totalBlockingTime: {
    good: 200,
    poor: 600,
    unit: 'ms',
    label: 'Total Blocking Time',
    description: 'How long the page ignores taps and clicks.',
  },
  speedIndex: {
    good: 3400,
    poor: 5800,
    unit: 'ms',
    label: 'Speed Index',
    description: 'How quickly the page visually fills in.',
  },
  timeToInteractive: {
    good: 3800,
    poor: 7300,
    unit: 'ms',
    label: 'Time to Interactive',
    description: 'When the page reliably responds to input.',
  },
} as const satisfies Record<string, MetricThreshold>;

export type MetricKey = keyof typeof METRIC_THRESHOLDS;

export type MetricVerdict = 'good' | 'needs-improvement' | 'poor';

export function metricVerdict(key: MetricKey, value: number | null | undefined): MetricVerdict | null {
  if (value == null || !Number.isFinite(value)) return null;
  const threshold = METRIC_THRESHOLDS[key];
  if (value <= threshold.good) return 'good';
  if (value <= threshold.poor) return 'needs-improvement';
  return 'poor';
}

/**
 * Log-normal curve used by Lighthouse to turn a raw metric into 0-100.
 * Reimplemented so synthetic runs (no PSI key) score on the same curve as PSI
 * results — otherwise the two sources would produce incomparable history.
 */
export function metricToScore(value: number, median: number, podium: number): number {
  if (!Number.isFinite(value) || value <= 0) return 100;
  const shape = Math.log(podium / median) / Math.log(0.5) || 1;
  const score = Math.exp(-Math.pow(value / median, shape) * Math.LN2);
  return Math.round(Math.min(100, Math.max(0, score * 100)));
}

// ---------------------------------------------------------------------------
// Severity / priority mapping
// ---------------------------------------------------------------------------

/** Points deducted from a category score per issue of each severity. */
export const SEVERITY_PENALTY: Record<Severity, number> = {
  [Severity.CRITICAL]: 20,
  [Severity.HIGH]: 12,
  [Severity.MEDIUM]: 6,
  [Severity.LOW]: 2,
  [Severity.INFO]: 0,
};

export const SEVERITY_LABELS: Record<Severity, string> = {
  [Severity.CRITICAL]: 'Critical',
  [Severity.HIGH]: 'High',
  [Severity.MEDIUM]: 'Medium',
  [Severity.LOW]: 'Low',
  [Severity.INFO]: 'Info',
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  [Priority.HIGH]: 'High priority',
  [Priority.MEDIUM]: 'Medium priority',
  [Priority.LOW]: 'Low priority',
};

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  [Difficulty.EASY]: 'Easy',
  [Difficulty.MEDIUM]: 'Moderate',
  [Difficulty.HARD]: 'Involved',
};

/**
 * Turns a list of issues into a category score by subtracting severity
 * penalties from 100, with diminishing returns: the 5th medium-severity issue
 * of the same kind shouldn't cost as much as the first, or every imperfect page
 * would bottom out at zero and the score would stop discriminating.
 */
export function scoreFromIssues(issues: readonly { severity: Severity }[], floor = 0): number {
  const counts = new Map<Severity, number>();
  for (const issue of issues) {
    counts.set(issue.severity, (counts.get(issue.severity) ?? 0) + 1);
  }

  let deduction = 0;
  for (const [severity, count] of counts) {
    const penalty = SEVERITY_PENALTY[severity];
    // First occurrence full price, each subsequent one worth ~70% of the last.
    for (let i = 0; i < count; i += 1) {
      deduction += penalty * Math.pow(0.7, i);
    }
  }

  return Math.round(Math.max(floor, 100 - deduction));
}

/**
 * Ranks a recommendation 0-100 on impact-per-unit-effort. This is what orders
 * the priority list and decides what counts as a "quick win".
 */
export function impactScore(input: {
  severity: Severity;
  difficulty: Difficulty;
  categoryWeight?: number;
}): number {
  const severityValue: Record<Severity, number> = {
    [Severity.CRITICAL]: 100,
    [Severity.HIGH]: 78,
    [Severity.MEDIUM]: 52,
    [Severity.LOW]: 28,
    [Severity.INFO]: 10,
  };
  const effortDivisor: Record<Difficulty, number> = {
    [Difficulty.EASY]: 1,
    [Difficulty.MEDIUM]: 1.35,
    [Difficulty.HARD]: 1.9,
  };

  const base = severityValue[input.severity] * (input.categoryWeight ?? 1);
  return Math.round(Math.min(100, base / effortDivisor[input.difficulty]));
}

export function priorityFromSeverity(severity: Severity): Priority {
  if (severity === Severity.CRITICAL || severity === Severity.HIGH) return Priority.HIGH;
  if (severity === Severity.MEDIUM) return Priority.MEDIUM;
  return Priority.LOW;
}

/** A quick win is high-impact and cheap to do. */
export function isQuickWin(difficulty: Difficulty, estimatedMinutes: number): boolean {
  return difficulty === Difficulty.EASY && estimatedMinutes <= 120;
}
