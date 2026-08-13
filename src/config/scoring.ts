import type { AuditCategory, Difficulty, Priority, Severity } from '@prisma/client';

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
  SEO: 1.25,
  PERFORMANCE: 1.25,
  ACCESSIBILITY: 1.0,
  UX: 1.0,
  DESIGN: 0.75,
  CONTENT: 0.75,
  SECURITY: 1.0,
  TECHNICAL: 1.0,
};

export const CATEGORY_LABELS: Record<AuditCategory, string> = {
  SEO: 'SEO',
  PERFORMANCE: 'Performance',
  ACCESSIBILITY: 'Accessibility',
  UX: 'UX',
  DESIGN: 'Design',
  CONTENT: 'Content',
  SECURITY: 'Security',
  TECHNICAL: 'Technical',
};

export const CATEGORY_DESCRIPTIONS: Record<AuditCategory, string> = {
  SEO: 'How well search engines can find, read and rank this page.',
  PERFORMANCE: 'How fast the page loads and becomes usable on real devices.',
  ACCESSIBILITY: 'Whether people using assistive technology can use the page.',
  UX: 'How easily a visitor can understand and act on the page.',
  DESIGN: 'Visual craft, consistency and how modern the page feels.',
  CONTENT: 'Clarity, depth and persuasiveness of the writing.',
  SECURITY: 'Transport security and protective HTTP headers.',
  TECHNICAL: 'Crawlability, redirects, link health and markup hygiene.',
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
 * Complementary error function.
 *
 * Numerical Recipes' `erfcc` rational approximation, accurate to ~1.2e-7 —
 * far tighter than the precision of the metrics feeding it. Needed because the
 * log-normal scoring curve below has no closed form without it.
 */
function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + z / 2);

  const r =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t *
                      (-0.18628806 +
                        t *
                          (0.27886807 +
                            t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );

  return x >= 0 ? r : 2 - r;
}

/**
 * Lighthouse's log-normal scoring curve, turning a raw metric into 0-100.
 *
 * Reimplemented so a synthetic run (no PageSpeed key) lands on the same curve
 * as a real PSI result — otherwise the two sources would produce incomparable
 * numbers and the trend chart would step every time the source changed.
 *
 * The two control points are the ones Lighthouse publishes: `median` is the
 * value that scores 50, and `p10` is the value that scores 90 (the tenth
 * percentile of real-world sites). Both are required for the curve to have the
 * right shape — an exponential approximation through the median alone scores
 * the p10 point in the low 70s, which would make every synthetic result look
 * markedly worse than the same page measured by PSI.
 */
export function metricToScore(value: number, median: number, p10: number): number {
  if (!Number.isFinite(value) || value <= 0) return 100;
  if (median <= 0 || p10 <= 0 || p10 >= median) return 50;

  // erfc(INVERSE_ERFC_ONE_FIFTH) === 0.2, which is what places p10 at 90.
  const INVERSE_ERFC_ONE_FIFTH = 0.9061938024368232;

  const shape = (Math.log(median) - Math.log(p10)) / (Math.SQRT2 * INVERSE_ERFC_ONE_FIFTH);
  const standardized = (Math.log(value) - Math.log(median)) / (Math.SQRT2 * shape);

  return Math.round(Math.min(100, Math.max(0, (erfc(standardized) / 2) * 100)));
}

// ---------------------------------------------------------------------------
// Severity / priority mapping
// ---------------------------------------------------------------------------

/** Points deducted from a category score per issue of each severity. */
export const SEVERITY_PENALTY: Record<Severity, number> = {
  CRITICAL: 20,
  HIGH: 12,
  MEDIUM: 6,
  LOW: 2,
  INFO: 0,
};

export const SEVERITY_LABELS: Record<Severity, string> = {
  CRITICAL: 'Critical',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
  INFO: 'Info',
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  HIGH: 'High priority',
  MEDIUM: 'Medium priority',
  LOW: 'Low priority',
};

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  EASY: 'Easy',
  MEDIUM: 'Moderate',
  HARD: 'Involved',
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
    // First occurrence at full price, each subsequent one worth 85% of the
    // last. The ratio matters: the geometric series converges to
    // penalty / (1 - ratio), so at 0.7 a page with nothing but critical issues
    // could never score below 33 no matter how broken it was. At 0.85 the
    // ceiling is high enough for a genuinely broken page to reach zero, while
    // still stopping the tenth minor issue from counting as much as the first.
    for (let i = 0; i < count; i += 1) {
      deduction += penalty * Math.pow(0.85, i);
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
    CRITICAL: 100,
    HIGH: 78,
    MEDIUM: 52,
    LOW: 28,
    INFO: 10,
  };
  const effortDivisor: Record<Difficulty, number> = {
    EASY: 1,
    MEDIUM: 1.35,
    HARD: 1.9,
  };

  const base = severityValue[input.severity] * (input.categoryWeight ?? 1);
  return Math.round(Math.min(100, base / effortDivisor[input.difficulty]));
}

export function priorityFromSeverity(severity: Severity): Priority {
  if (severity === 'CRITICAL' || severity === 'HIGH') return 'HIGH' as Priority;
  if (severity === 'MEDIUM') return 'MEDIUM' as Priority;
  return 'LOW' as Priority;
}

/** A quick win is high-impact and cheap to do. */
export function isQuickWin(difficulty: Difficulty, estimatedMinutes: number): boolean {
  return difficulty === 'EASY' && estimatedMinutes <= 120;
}
