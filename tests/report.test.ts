import { AuditCategory, Difficulty, Priority, Severity } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { buildFallbackReport } from '@/features/ai/report';
import { renderReportHtml, type ReportData } from '@/features/reports/report-html';
import type { AnalyzerRecommendation, CategoryResult } from '@/features/audit/types';

function category(cat: AuditCategory, score: number): CategoryResult<null> {
  return {
    category: cat,
    score,
    summary: `${cat} summary text.`,
    issues: [],
    recommendations: [],
    detail: null,
  };
}

function recommendation(overrides: Partial<AnalyzerRecommendation> = {}): AnalyzerRecommendation {
  return {
    category: AuditCategory.SEO,
    title: 'Add a meta description',
    explanation: 'Write a 70-160 character summary.',
    expectedImpact: 'Higher click-through from search results.',
    difficulty: Difficulty.EASY,
    estimatedMinutes: 15,
    priority: Priority.HIGH,
    impactScore: 80,
    kind: 'QUICK_WIN',
    ...overrides,
  };
}

describe('buildFallbackReport', () => {
  const base = {
    url: 'https://example.com',
    overallScore: 64,
    previousScore: null,
    categories: [
      category(AuditCategory.SEO, 40),
      category(AuditCategory.PERFORMANCE, 55),
      category(AuditCategory.ACCESSIBILITY, 90),
      category(AuditCategory.SECURITY, 95),
    ],
    issues: [
      { code: 'a', category: AuditCategory.SEO, severity: Severity.CRITICAL, title: 'No title', description: 'x' },
      { code: 'b', category: AuditCategory.SEO, severity: Severity.HIGH, title: 'No H1', description: 'y' },
    ],
    recommendations: [recommendation()],
    aiFindings: null,
  };

  it('produces a usable report with no AI available', () => {
    const report = buildFallbackReport(base);

    expect(report.executiveSummary).toContain('64');
    expect(report.executiveSummary).toContain('example.com');
    expect(report.recommendations).toHaveLength(1);
    expect(report.usage).toBeNull();
  });

  it('names the weakest categories as weaknesses and the strongest as strengths', () => {
    const report = buildFallbackReport(base);

    expect(report.weaknesses.join(' ')).toContain('SEO');
    expect(report.strengths.join(' ')).toContain('Security');
  });

  it('counts high-severity issues in the summary', () => {
    const report = buildFallbackReport(base);
    expect(report.executiveSummary).toContain('2 high-severity');
  });

  it('says so plainly when nothing severe was found', () => {
    const report = buildFallbackReport({ ...base, issues: [] });
    expect(report.executiveSummary).toContain('No high-severity issues');
  });

  it('reports the trend against a previous audit', () => {
    const up = buildFallbackReport({ ...base, previousScore: 50 });
    expect(up.executiveSummary).toContain('14 points better');

    const down = buildFallbackReport({ ...base, previousScore: 80 });
    expect(down.executiveSummary).toContain('16 points worse');

    const flat = buildFallbackReport({ ...base, previousScore: 64 });
    expect(flat.executiveSummary).toContain('unchanged');
  });

  it('orders recommendations by priority, then by impact', () => {
    const report = buildFallbackReport({
      ...base,
      recommendations: [
        recommendation({ title: 'Low priority', priority: Priority.LOW, impactScore: 90 }),
        recommendation({ title: 'High, weaker impact', priority: Priority.HIGH, impactScore: 40 }),
        recommendation({ title: 'High, stronger impact', priority: Priority.HIGH, impactScore: 95 }),
        recommendation({ title: 'Medium priority', priority: Priority.MEDIUM, impactScore: 99 }),
      ],
    });

    expect(report.recommendations.map((item) => item.title)).toEqual([
      'High, stronger impact',
      'High, weaker impact',
      'Medium priority',
      'Low priority',
    ]);
  });
});

describe('renderReportHtml', () => {
  const data: ReportData = {
    url: 'https://example.com/pricing',
    auditedAt: new Date('2026-03-15T10:00:00Z'),
    device: 'MOBILE',
    overallScore: 72,
    previousScore: 65,
    categories: [
      { category: AuditCategory.SEO, score: 80, summary: 'Good' },
      { category: AuditCategory.PERFORMANCE, score: 55, summary: 'Slow' },
    ],
    executiveSummary: 'First paragraph.\n\nSecond paragraph.',
    strengths: ['Strong metadata'],
    weaknesses: ['Slow hero image'],
    longTermOutlook: null,
    recommendations: [
      {
        title: 'Compress the hero image',
        category: AuditCategory.PERFORMANCE,
        priority: Priority.HIGH,
        difficulty: Difficulty.EASY,
        estimatedMinutes: 30,
        explanation: 'Convert to WebP.',
        expectedImpact: 'Faster LCP.',
        kind: 'QUICK_WIN',
      },
    ],
    issues: [
      {
        category: AuditCategory.PERFORMANCE,
        severity: Severity.HIGH,
        title: 'Hero image is 2.4 MB',
        description: 'Compress it.',
      },
    ],
    metrics: {
      firstContentfulPaint: 1200,
      largestContentfulPaint: 3400,
      cumulativeLayoutShift: 0.08,
      totalBlockingTime: 240,
      speedIndex: 2900,
    },
    screenshots: [],
  };

  const branding = {
    organizationName: 'Acme Agency',
    logoUrl: null,
    brandColor: null,
    footerText: null,
    whiteLabel: false,
  };

  it('renders a complete standalone document', () => {
    const html = renderReportHtml(data, branding);

    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('Executive summary');
    expect(html).toContain('Compress the hero image');
    expect(html).toContain('Core Web Vitals');
    // Self-contained: nothing to fetch when Chromium renders it.
    expect(html).not.toMatch(/<link[^>]+rel="stylesheet"/);
    expect(html).not.toMatch(/<script\s+src=/);
  });

  it('shows SitePilot branding by default and the org brand under white-label', () => {
    expect(renderReportHtml(data, branding)).toContain('SitePilot AI');

    const whiteLabelled = renderReportHtml(data, {
      ...branding,
      whiteLabel: true,
      brandColor: '#ff0066',
      footerText: 'Prepared by Acme',
    });

    expect(whiteLabelled).toContain('Acme Agency');
    expect(whiteLabelled).toContain('#ff0066');
    expect(whiteLabelled).toContain('Prepared by Acme');
  });

  it('escapes audit-derived content so a hostile page cannot inject markup', () => {
    // Titles and headings come from the audited site, which is untrusted.
    const hostile = renderReportHtml(
      {
        ...data,
        issues: [
          {
            category: AuditCategory.SEO,
            severity: Severity.HIGH,
            title: '<script>alert("xss")</script>',
            description: '<img src=x onerror="alert(1)">',
          },
        ],
      },
      branding,
    );

    expect(hostile).not.toContain('<script>alert');
    expect(hostile).not.toContain('onerror="alert(1)"');
    expect(hostile).toContain('&lt;script&gt;');
  });

  it('shows the delta against the previous audit', () => {
    expect(renderReportHtml(data, branding)).toContain('7 vs. last audit');
  });

  it('omits sections that have no data', () => {
    const minimal = renderReportHtml(
      {
        ...data,
        executiveSummary: null,
        strengths: [],
        weaknesses: [],
        metrics: null,
        issues: [],
      },
      branding,
    );

    expect(minimal).not.toContain('Executive summary');
    expect(minimal).not.toContain('Core Web Vitals');
    expect(minimal).not.toContain('All issues found');
    // The recommendation section still renders.
    expect(minimal).toContain('Compress the hero image');
  });
});
