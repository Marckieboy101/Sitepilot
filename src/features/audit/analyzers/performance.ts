import { AuditCategory, Difficulty, Priority, Severity } from '@prisma/client';

import {
  CATEGORY_WEIGHTS,
  METRIC_THRESHOLDS,
  impactScore,
  metricToScore,
  metricVerdict,
} from '@/config/scoring';
import { serverEnv } from '@/lib/env';
import { fetchJson } from '@/lib/http';
import { logger } from '@/lib/logger';
import { formatBytes, formatMs, toScore } from '@/lib/utils';

import type {
  AnalyzerIssue,
  AnalyzerRecommendation,
  CategoryResult,
  PageContext,
  PerformanceDetail,
  PerformanceOpportunity,
} from '../types';

/**
 * Performance analysis.
 *
 * Primary source is Google PageSpeed Insights, which runs real Lighthouse on
 * Google's infrastructure — far more trustworthy than anything we could
 * measure from a serverless function with variable CPU. When PSI is
 * unavailable (no key, quota exhausted, upstream timeout) we fall back to a
 * synthetic estimate scored on the same Lighthouse curve, so history stays
 * comparable across sources.
 */

const log = logger.child({ module: 'audit/performance' });
const PSI_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const PSI_TIMEOUT_MS = 75_000;

// ---------------------------------------------------------------------------
// PageSpeed Insights response shape (only the parts we read)
// ---------------------------------------------------------------------------

interface PsiAuditRef {
  id: string;
  title?: string;
  description?: string;
  score?: number | null;
  numericValue?: number;
  details?: {
    overallSavingsMs?: number;
    overallSavingsBytes?: number;
    items?: unknown[];
    type?: string;
  };
}

interface PsiResponse {
  lighthouseResult?: {
    categories?: { performance?: { score?: number | null } };
    audits?: Record<string, PsiAuditRef>;
  };
}

const OPPORTUNITY_IDS = [
  'render-blocking-resources',
  'unused-javascript',
  'unused-css-rules',
  'unminified-javascript',
  'unminified-css',
  'modern-image-formats',
  'uses-optimized-images',
  'uses-responsive-images',
  'offscreen-images',
  'uses-text-compression',
  'server-response-time',
  'redirects',
  'efficient-animated-content',
  'duplicated-javascript',
  'legacy-javascript',
  'font-display',
];

async function runPageSpeed(url: string, device: 'MOBILE' | 'DESKTOP'): Promise<PerformanceDetail | null> {
  const apiKey = serverEnv().GOOGLE_PAGESPEED_API_KEY;
  if (!apiKey) return null;

  const params = new URLSearchParams({
    url,
    key: apiKey,
    strategy: device.toLowerCase(),
  });
  // `category` repeats rather than joining with commas.
  params.append('category', 'performance');

  try {
    const response = await fetchJson<PsiResponse>(`${PSI_ENDPOINT}?${params.toString()}`, {
      timeoutMs: PSI_TIMEOUT_MS,
    });

    const audits = response.lighthouseResult?.audits;
    if (!audits) return null;

    const numeric = (id: string): number | null => {
      const value = audits[id]?.numericValue;
      return typeof value === 'number' && Number.isFinite(value) ? value : null;
    };

    const opportunities: PerformanceOpportunity[] = OPPORTUNITY_IDS.flatMap((id) => {
      const audit = audits[id];
      if (!audit || audit.score === 1 || audit.score == null) return [];
      const savingsMs = audit.details?.overallSavingsMs;
      const savingsBytes = audit.details?.overallSavingsBytes;
      if (!savingsMs && !savingsBytes) return [];
      return [
        {
          id,
          title: audit.title ?? id,
          description: (audit.description ?? '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'),
          savingsMs: savingsMs ? Math.round(savingsMs) : undefined,
          savingsBytes: savingsBytes ? Math.round(savingsBytes) : undefined,
        },
      ];
    }).sort((a, b) => (b.savingsMs ?? 0) - (a.savingsMs ?? 0));

    const byteBreakdown = readByteBreakdown(audits['resource-summary']);

    return {
      source: 'psi',
      firstContentfulPaint: numeric('first-contentful-paint'),
      largestContentfulPaint: numeric('largest-contentful-paint'),
      cumulativeLayoutShift: numeric('cumulative-layout-shift'),
      totalBlockingTime: numeric('total-blocking-time'),
      speedIndex: numeric('speed-index'),
      timeToInteractive: numeric('interactive'),
      serverResponseTime: numeric('server-response-time'),
      totalBytes: byteBreakdown.total,
      imageBytes: byteBreakdown.image,
      scriptBytes: byteBreakdown.script,
      styleBytes: byteBreakdown.stylesheet,
      fontBytes: byteBreakdown.font,
      documentBytes: byteBreakdown.document,
      requestCount: byteBreakdown.requests,
      usesCompression: audits['uses-text-compression']?.score === 1,
      usesHttp2: null,
      usesTextCaching: audits['uses-long-cache-ttl']?.score === 1,
      usesModernImages: audits['modern-image-formats']?.score === 1,
      opportunities: opportunities.slice(0, 10),
    };
  } catch (error) {
    log.warn('PageSpeed Insights unavailable, falling back to synthetic', { url, error });
    return null;
  }
}

interface ResourceSummaryItem {
  resourceType?: string;
  transferSize?: number;
  requestCount?: number;
}

function readByteBreakdown(audit: PsiAuditRef | undefined) {
  const empty = {
    total: null as number | null,
    image: null as number | null,
    script: null as number | null,
    stylesheet: null as number | null,
    font: null as number | null,
    document: null as number | null,
    requests: null as number | null,
  };

  const items = audit?.details?.items as ResourceSummaryItem[] | undefined;
  if (!items) return empty;

  const find = (type: string) => items.find((item) => item.resourceType === type);
  const size = (type: string) => find(type)?.transferSize ?? null;

  return {
    total: size('total'),
    image: size('image'),
    script: size('script'),
    stylesheet: size('stylesheet'),
    font: size('font'),
    document: size('document'),
    requests: find('total')?.requestCount ?? null,
  };
}

/**
 * Fallback measurement from what we can observe without Lighthouse: real
 * server response time, real document size, and asset counts from the HTML.
 *
 * This is explicitly an estimate. It is labelled `synthetic` in the UI so
 * nobody mistakes it for a lab measurement, but scoring it on the Lighthouse
 * curve keeps it in the same range as a PSI result for trend purposes.
 */
function syntheticPerformance(context: PageContext): PerformanceDetail {
  const { $, page, browser } = context;

  const serverResponseTime = page.timingMs;
  const documentBytes = page.bytes;

  const scriptCount = $('script[src]').length;
  const styleCount = $('link[rel="stylesheet"]').length;
  const imageCount = $('img').length;
  const fontLinks = $('link[href*=".woff"], link[href*=".ttf"], link[as="font"]').length;

  // Rough transfer estimate: each external asset costs a request plus a
  // typical payload for its type. Deliberately conservative.
  const estimatedBytes =
    documentBytes + scriptCount * 90_000 + styleCount * 35_000 + imageCount * 120_000 + fontLinks * 40_000;

  const renderBlocking =
    $('head script[src]:not([defer]):not([async])').length + styleCount;

  // Model FCP as: server time + a fixed parse cost + blocking asset round trips.
  const estimatedFcp =
    browser?.metrics.firstContentfulPaintMs ?? serverResponseTime + 250 + renderBlocking * 180;

  const estimatedLcp =
    browser?.metrics.largestContentfulPaintMs ?? estimatedFcp + Math.min(3_000, imageCount * 90 + 400);

  const estimatedTbt = Math.min(2_000, scriptCount * 55);

  return {
    source: 'synthetic',
    firstContentfulPaint: Math.round(estimatedFcp),
    largestContentfulPaint: Math.round(estimatedLcp),
    cumulativeLayoutShift: browser?.metrics.cumulativeLayoutShift ?? null,
    totalBlockingTime: Math.round(estimatedTbt),
    speedIndex: Math.round(estimatedFcp * 1.4),
    timeToInteractive: Math.round(estimatedLcp + estimatedTbt),
    serverResponseTime,
    totalBytes: browser?.metrics.transferredBytes ?? Math.round(estimatedBytes),
    imageBytes: null,
    scriptBytes: null,
    styleBytes: null,
    fontBytes: null,
    documentBytes,
    requestCount:
      browser?.metrics.requestCount ?? 1 + scriptCount + styleCount + imageCount + fontLinks,
    usesCompression: /gzip|br|deflate|zstd/i.test(page.headers.get('content-encoding') ?? ''),
    usesHttp2: null,
    usesTextCaching: /max-age=\d{4,}/.test(page.headers.get('cache-control') ?? ''),
    usesModernImages: $('img[src$=".webp"], img[src$=".avif"], source[type="image/webp"], source[type="image/avif"]').length > 0,
    opportunities: [],
  };
}

/** Lighthouse's own weighting of the five scored metrics (v10). */
function scoreFromMetrics(detail: PerformanceDetail): number {
  const parts: Array<{ weight: number; score: number }> = [];

  const add = (weight: number, value: number | null, median: number, podium: number) => {
    if (value == null) return;
    parts.push({ weight, score: metricToScore(value, median, podium) });
  };

  add(0.1, detail.firstContentfulPaint, 1600, 934);
  add(0.25, detail.largestContentfulPaint, 2400, 1200);
  add(0.1, detail.speedIndex, 2300, 1311);
  add(0.3, detail.totalBlockingTime, 350, 150);

  if (detail.cumulativeLayoutShift != null) {
    parts.push({ weight: 0.25, score: metricToScore(detail.cumulativeLayoutShift, 0.1, 0.05) });
  }

  if (parts.length === 0) return 50;

  const weightTotal = parts.reduce((sum, part) => sum + part.weight, 0);
  return toScore(parts.reduce((sum, part) => sum + part.score * part.weight, 0) / weightTotal);
}

export async function analyzePerformance(context: PageContext): Promise<CategoryResult<PerformanceDetail>> {
  const issues: AnalyzerIssue[] = [];
  const recommendations: AnalyzerRecommendation[] = [];

  const detail =
    (await runPageSpeed(context.page.finalUrl, context.device)) ?? syntheticPerformance(context);

  const score = scoreFromMetrics(detail);

  // -------------------------------------------------------------------------
  // Metric-level findings
  // -------------------------------------------------------------------------
  const metricIssue = (
    key: keyof typeof METRIC_THRESHOLDS,
    value: number | null,
    severityWhenPoor: Severity,
  ) => {
    const verdict = metricVerdict(key, value);
    if (!verdict || verdict === 'good' || value == null) return;

    const threshold = METRIC_THRESHOLDS[key];
    const formatted = threshold.unit === 'ms' ? formatMs(value) : value.toFixed(3);
    const target = threshold.unit === 'ms' ? formatMs(threshold.good) : threshold.good.toFixed(2);

    issues.push({
      code: `performance.${key}`,
      category: AuditCategory.PERFORMANCE,
      severity: verdict === 'poor' ? severityWhenPoor : Severity.MEDIUM,
      title: `${threshold.label} is ${formatted}`,
      description: `${threshold.description} Google considers anything above ${target} to need improvement.`,
    });
  };

  metricIssue('largestContentfulPaint', detail.largestContentfulPaint, Severity.HIGH);
  metricIssue('firstContentfulPaint', detail.firstContentfulPaint, Severity.MEDIUM);
  metricIssue('cumulativeLayoutShift', detail.cumulativeLayoutShift, Severity.HIGH);
  metricIssue('totalBlockingTime', detail.totalBlockingTime, Severity.HIGH);
  metricIssue('speedIndex', detail.speedIndex, Severity.MEDIUM);

  if (detail.serverResponseTime != null && detail.serverResponseTime > 600) {
    issues.push({
      code: 'performance.server-response',
      category: AuditCategory.PERFORMANCE,
      severity: detail.serverResponseTime > 1500 ? Severity.HIGH : Severity.MEDIUM,
      title: `Server responded in ${formatMs(detail.serverResponseTime)}`,
      description:
        'Everything else on the page is blocked until the server sends the first byte. Slow server time is a ceiling on every other performance improvement you make.',
    });
    recommendations.push({
      category: AuditCategory.PERFORMANCE,
      title: 'Reduce server response time',
      explanation:
        'Cache rendered pages or API responses, add database indexes for the queries this page runs, and serve from a CDN edge close to your visitors.',
      expectedImpact: `Cutting time-to-first-byte from ${formatMs(detail.serverResponseTime)} to under 400 ms improves every single load, and lifts LCP by roughly the same amount.`,
      difficulty: Difficulty.MEDIUM,
      estimatedMinutes: 240,
      priority: Priority.HIGH,
      impactScore: impactScore({ severity: Severity.HIGH, difficulty: Difficulty.MEDIUM, categoryWeight: CATEGORY_WEIGHTS.PERFORMANCE }),
      kind: 'LONG_TERM',
    });
  }

  if (detail.totalBytes != null && detail.totalBytes > 3 * 1024 * 1024) {
    issues.push({
      code: 'performance.page-weight',
      category: AuditCategory.PERFORMANCE,
      severity: Severity.MEDIUM,
      title: `Page weighs ${formatBytes(detail.totalBytes)}`,
      description:
        'Heavy pages punish anyone on mobile data or a slow connection, and page weight correlates directly with bounce rate.',
    });
  }

  if (detail.usesCompression === false) {
    issues.push({
      code: 'performance.compression',
      category: AuditCategory.PERFORMANCE,
      severity: Severity.HIGH,
      title: 'Text resources are not compressed',
      description:
        'HTML, CSS and JavaScript are being sent uncompressed. Gzip or Brotli typically cuts these by 70-80% for the cost of one configuration line.',
    });
    recommendations.push({
      category: AuditCategory.PERFORMANCE,
      title: 'Enable Brotli or gzip compression',
      explanation:
        'Turn on text compression at your server or CDN. Most hosts expose this as a single toggle; Nginx needs `gzip on` plus `gzip_types`.',
      expectedImpact:
        'Roughly a 70% reduction in transferred bytes for HTML, CSS and JS — usually the single cheapest performance win available.',
      difficulty: Difficulty.EASY,
      estimatedMinutes: 30,
      priority: Priority.HIGH,
      impactScore: 94,
      kind: 'QUICK_WIN',
    });
  }

  if (detail.usesModernImages === false) {
    recommendations.push({
      category: AuditCategory.PERFORMANCE,
      title: 'Serve images in WebP or AVIF',
      explanation:
        'Convert JPEG and PNG images to WebP or AVIF and serve them through a <picture> element with the original as fallback.',
      expectedImpact: 'Typically 30-50% smaller images at the same visual quality, which directly improves LCP.',
      difficulty: Difficulty.MEDIUM,
      estimatedMinutes: 120,
      priority: Priority.MEDIUM,
      impactScore: impactScore({ severity: Severity.MEDIUM, difficulty: Difficulty.MEDIUM, categoryWeight: CATEGORY_WEIGHTS.PERFORMANCE }),
      kind: 'LONG_TERM',
    });
  }

  if (detail.usesTextCaching === false) {
    recommendations.push({
      category: AuditCategory.PERFORMANCE,
      title: 'Set long cache lifetimes on static assets',
      explanation:
        'Serve fingerprinted CSS, JS, images and fonts with Cache-Control: public, max-age=31536000, immutable so repeat visits load them from disk.',
      expectedImpact: 'Repeat visits become near-instant because the browser stops re-downloading unchanged assets.',
      difficulty: Difficulty.EASY,
      estimatedMinutes: 60,
      priority: Priority.MEDIUM,
      impactScore: impactScore({ severity: Severity.MEDIUM, difficulty: Difficulty.EASY, categoryWeight: CATEGORY_WEIGHTS.PERFORMANCE }),
      kind: 'QUICK_WIN',
    });
  }

  // -------------------------------------------------------------------------
  // Lighthouse opportunities → recommendations
  // -------------------------------------------------------------------------
  for (const opportunity of detail.opportunities.slice(0, 5)) {
    const savings = [
      opportunity.savingsMs ? formatMs(opportunity.savingsMs) : null,
      opportunity.savingsBytes ? formatBytes(opportunity.savingsBytes) : null,
    ]
      .filter(Boolean)
      .join(' and ');

    recommendations.push({
      category: AuditCategory.PERFORMANCE,
      title: opportunity.title,
      explanation: opportunity.description || 'Lighthouse flagged this as an opportunity on this page.',
      expectedImpact: savings ? `Lighthouse estimates a saving of ${savings} on this page.` : 'Measurable load-time improvement.',
      difficulty: Difficulty.MEDIUM,
      estimatedMinutes: 90,
      priority: (opportunity.savingsMs ?? 0) > 1000 ? Priority.HIGH : Priority.MEDIUM,
      impactScore: Math.min(95, 40 + Math.round((opportunity.savingsMs ?? 0) / 40)),
      kind: 'LONG_TERM',
    });
  }

  return {
    category: AuditCategory.PERFORMANCE,
    score,
    summary: buildSummary(score, detail),
    issues,
    recommendations,
    detail,
  };
}

function buildSummary(score: number, detail: PerformanceDetail): string {
  const lcp = detail.largestContentfulPaint ? formatMs(detail.largestContentfulPaint) : 'unknown';
  const caveat =
    detail.source === 'synthetic'
      ? ' These are estimates measured from our servers rather than a full Lighthouse run.'
      : '';

  if (score >= 90) return `Fast. Largest Contentful Paint lands at ${lcp}, comfortably inside Google's threshold.${caveat}`;
  if (score >= 70) return `Reasonable speed with room to improve — LCP is ${lcp}.${caveat}`;
  if (score >= 50) return `Noticeably slow. LCP of ${lcp} means visitors wait before the main content appears.${caveat}`;
  return `Serious performance problems. With an LCP of ${lcp}, a significant share of mobile visitors will leave before the page renders.${caveat}`;
}
