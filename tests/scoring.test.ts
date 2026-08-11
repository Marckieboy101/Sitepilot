import { AuditCategory, Difficulty, Severity } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import {
  CATEGORY_WEIGHTS,
  computeOverallScore,
  impactScore,
  isQuickWin,
  metricToScore,
  metricVerdict,
  priorityFromSeverity,
  scoreBand,
  scoreFromIssues,
} from '@/config/scoring';

describe('computeOverallScore', () => {
  it('returns 0 for no categories', () => {
    expect(computeOverallScore([])).toBe(0);
  });

  it('averages a uniform set to that value', () => {
    const categories = Object.values(AuditCategory).map((category) => ({ category, score: 80 }));
    expect(computeOverallScore(categories)).toBe(80);
  });

  it('weights SEO and performance above design', () => {
    // Same two scores, swapped between a heavy and a light category. The
    // arrangement that puts the high score on the heavier weight must win.
    const seoStrong = computeOverallScore([
      { category: AuditCategory.SEO, score: 100 },
      { category: AuditCategory.DESIGN, score: 0 },
    ]);
    const designStrong = computeOverallScore([
      { category: AuditCategory.SEO, score: 0 },
      { category: AuditCategory.DESIGN, score: 100 },
    ]);

    expect(seoStrong).toBeGreaterThan(designStrong);
    expect(CATEGORY_WEIGHTS.SEO).toBeGreaterThan(CATEGORY_WEIGHTS.DESIGN);
  });

  it('ignores categories that failed to produce a score', () => {
    // A PageSpeed outage must not read as a broken website.
    const withNaN = computeOverallScore([
      { category: AuditCategory.SEO, score: 90 },
      { category: AuditCategory.PERFORMANCE, score: Number.NaN },
    ]);
    expect(withNaN).toBe(90);
  });
});

describe('scoreBand', () => {
  it.each([
    [100, 'excellent'],
    [90, 'excellent'],
    [89, 'good'],
    [75, 'good'],
    [74, 'fair'],
    [50, 'fair'],
    [49, 'poor'],
    [0, 'poor'],
  ])('maps %i to %s', (score, band) => {
    expect(scoreBand(score)).toBe(band);
  });
});

describe('scoreFromIssues', () => {
  it('returns 100 when nothing is wrong', () => {
    expect(scoreFromIssues([])).toBe(100);
  });

  it('penalises a critical issue more than a low one', () => {
    const critical = scoreFromIssues([{ severity: Severity.CRITICAL }]);
    const low = scoreFromIssues([{ severity: Severity.LOW }]);
    expect(critical).toBeLessThan(low);
  });

  it('applies diminishing returns to repeated issues', () => {
    // The second issue of a severity should cost less than the first, or a
    // page with many small problems bottoms out and the score stops
    // discriminating between "imperfect" and "catastrophic".
    const one = 100 - scoreFromIssues([{ severity: Severity.MEDIUM }]);
    const two = 100 - scoreFromIssues([{ severity: Severity.MEDIUM }, { severity: Severity.MEDIUM }]);

    expect(two).toBeGreaterThan(one);
    expect(two).toBeLessThan(one * 2);
  });

  it('never returns a negative score', () => {
    const many = Array.from({ length: 40 }, () => ({ severity: Severity.CRITICAL }));
    expect(scoreFromIssues(many)).toBeGreaterThanOrEqual(0);
  });

  it('respects an explicit floor', () => {
    const many = Array.from({ length: 40 }, () => ({ severity: Severity.CRITICAL }));
    expect(scoreFromIssues(many, 20)).toBe(20);
  });
});

describe('metricToScore', () => {
  it('scores a value at the median around 50', () => {
    const score = metricToScore(2400, 2400, 1200);
    expect(score).toBeGreaterThan(40);
    expect(score).toBeLessThan(60);
  });

  it('scores fast values high and slow values low', () => {
    expect(metricToScore(500, 2400, 1200)).toBeGreaterThan(90);
    expect(metricToScore(12_000, 2400, 1200)).toBeLessThan(10);
  });

  it('is monotonic — slower never scores better', () => {
    const values = [500, 1000, 2000, 4000, 8000];
    const scores = values.map((value) => metricToScore(value, 2400, 1200));
    for (let i = 1; i < scores.length; i += 1) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
    }
  });

  it('clamps to the 0-100 range', () => {
    expect(metricToScore(0, 2400, 1200)).toBe(100);
    expect(metricToScore(1_000_000, 2400, 1200)).toBeGreaterThanOrEqual(0);
  });
});

describe('metricVerdict', () => {
  it("uses Google's Core Web Vitals thresholds", () => {
    expect(metricVerdict('largestContentfulPaint', 2000)).toBe('good');
    expect(metricVerdict('largestContentfulPaint', 3000)).toBe('needs-improvement');
    expect(metricVerdict('largestContentfulPaint', 5000)).toBe('poor');

    expect(metricVerdict('cumulativeLayoutShift', 0.05)).toBe('good');
    expect(metricVerdict('cumulativeLayoutShift', 0.2)).toBe('needs-improvement');
    expect(metricVerdict('cumulativeLayoutShift', 0.4)).toBe('poor');
  });

  it('returns null when the metric was not measured', () => {
    expect(metricVerdict('largestContentfulPaint', null)).toBeNull();
    expect(metricVerdict('largestContentfulPaint', undefined)).toBeNull();
  });
});

describe('impactScore', () => {
  it('ranks an easy critical fix above a hard one', () => {
    const easy = impactScore({ severity: Severity.CRITICAL, difficulty: Difficulty.EASY });
    const hard = impactScore({ severity: Severity.CRITICAL, difficulty: Difficulty.HARD });
    expect(easy).toBeGreaterThan(hard);
  });

  it('ranks a critical fix above a low-severity one at equal effort', () => {
    const critical = impactScore({ severity: Severity.CRITICAL, difficulty: Difficulty.MEDIUM });
    const low = impactScore({ severity: Severity.LOW, difficulty: Difficulty.MEDIUM });
    expect(critical).toBeGreaterThan(low);
  });

  it('stays within 0-100', () => {
    const highest = impactScore({
      severity: Severity.CRITICAL,
      difficulty: Difficulty.EASY,
      categoryWeight: 2,
    });
    expect(highest).toBeLessThanOrEqual(100);
    expect(highest).toBeGreaterThanOrEqual(0);
  });
});

describe('priorityFromSeverity', () => {
  it('maps critical and high to HIGH priority', () => {
    expect(priorityFromSeverity(Severity.CRITICAL)).toBe('HIGH');
    expect(priorityFromSeverity(Severity.HIGH)).toBe('HIGH');
    expect(priorityFromSeverity(Severity.MEDIUM)).toBe('MEDIUM');
    expect(priorityFromSeverity(Severity.LOW)).toBe('LOW');
  });
});

describe('isQuickWin', () => {
  it('requires both low difficulty and low time', () => {
    expect(isQuickWin(Difficulty.EASY, 30)).toBe(true);
    expect(isQuickWin(Difficulty.EASY, 120)).toBe(true);
    expect(isQuickWin(Difficulty.EASY, 121)).toBe(false);
    expect(isQuickWin(Difficulty.MEDIUM, 30)).toBe(false);
  });
});
