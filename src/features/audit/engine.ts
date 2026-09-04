import { AuditCategory } from '@prisma/client';

import { computeOverallScore } from '@/config/scoring';
import { logger } from '@/lib/logger';

import { runAiAnalysis, summarizeAiFindings } from '../ai/analysis';
import { generateReport, type GeneratedReport } from '../ai/report';

import { analyzeAccessibility } from './analyzers/accessibility';
import { analyzeContent } from './analyzers/content';
import { analyzePerformance } from './analyzers/performance';
import { analyzeSecurity } from './analyzers/security';
import { analyzeSeo } from './analyzers/seo';
import { analyzeTechnical } from './analyzers/technical';
import { browserAvailable, captureWithBrowser } from './browser';
import { buildPageContext } from './fetch-page';
import type {
  AccessibilityDetail,
  AnalyzerIssue,
  AnalyzerRecommendation,
  CapturedScreenshot,
  CategoryResult,
  ContentDetail,
  PageContext,
  PerformanceDetail,
  SeoDetail,
  TechnicalDetail,
} from './types';

/**
 * Audit orchestration.
 *
 * Concurrency strategy, and why:
 *
 *  - The page fetch is serial and first; nothing can run without it.
 *  - The headless browser runs in parallel with the network-bound analyzers
 *    (PageSpeed, link checking), because those spend their time waiting.
 *  - Accessibility waits for the browser, since axe results change its output.
 *  - The AI analysis needs every deterministic result as evidence, so it runs
 *    after them, and the report runs after that.
 *
 * Failure strategy: every stage after the initial fetch is individually
 * recoverable. A PageSpeed outage, a Chromium crash or an OpenAI rate limit
 * each degrade the report rather than failing the audit. Only an unreachable
 * page is fatal, because then there is nothing to report on.
 */

const log = logger.child({ module: 'audit/engine' });

export interface RunAuditOptions {
  url: string;
  device?: 'MOBILE' | 'DESKTOP';
  /** Skip screenshots and link probing for the fast anonymous preview. */
  fast?: boolean;
  /** Skip the AI pass (e.g. the caller's plan doesn't include it). */
  skipAi?: boolean;
  /** Plan-specific report mode for free-tier users. */
  plan?: 'FREE' | 'PRO' | 'AGENCY';
  signal?: AbortSignal;
}

export interface AuditRunResult {
  url: string;
  finalUrl: string;
  device: 'MOBILE' | 'DESKTOP';
  overallScore: number;
  durationMs: number;

  categories: CategoryResult<unknown>[];
  seo: CategoryResult<SeoDetail>;
  performance: CategoryResult<PerformanceDetail>;
  accessibility: CategoryResult<AccessibilityDetail>;
  technical: CategoryResult<TechnicalDetail>;
  content: CategoryResult<ContentDetail>;
  security: CategoryResult<null>;

  ai: {
    ux: CategoryResult<unknown>;
    design: CategoryResult<unknown>;
    content: CategoryResult<unknown>;
    usage: { model: string; promptTokens: number; outputTokens: number; costCents: number };
  } | null;

  report: GeneratedReport;

  issues: AnalyzerIssue[];
  recommendations: AnalyzerRecommendation[];
  screenshots: CapturedScreenshot[];

  pageMeta: {
    statusCode: number;
    redirectChain: string[];
    contentType: string | null;
    server: string | null;
    bytes: number;
    renderedWithBrowser: boolean;
    detectedTech: string[];
  };

  /** Non-fatal degradations, surfaced in the UI so results aren't misread. */
  warnings: string[];
}

export async function runAudit(options: RunAuditOptions): Promise<AuditRunResult> {
  const { url, device = 'MOBILE', fast = false, skipAi = false, plan = 'PRO', signal } = options;
  const started = Date.now();
  const warnings: string[] = [];
  const runLog = log.child({ url, device });

  runLog.info('audit started', { fast, skipAi });

  // -- 1. Fetch. Fatal on failure: nothing else can proceed. -----------------
  const context: PageContext = await buildPageContext(url, { device, signal });

  // -- 2. Browser capture in parallel with the network-bound analyzers -------
  const browserPromise: Promise<PageContext['browser']> =
    !fast && browserAvailable()
      ? captureWithBrowser(context.page.finalUrl, {
          device,
          captureScreenshots: true,
          runAxe: true,
        }).catch((error) => {
          runLog.warn('browser capture threw', { error });
          return null;
        })
      : Promise.resolve(null);

  const performancePromise = analyzePerformance(context).catch((error) => {
    runLog.warn('performance analysis failed', { error });
    return null;
  });

  const technicalPromise = analyzeTechnical(context, { checkLinks: !fast }).catch((error) => {
    runLog.warn('technical analysis failed', { error });
    return null;
  });

  const [browser, performanceResult, technicalResult] = await Promise.all([
    browserPromise,
    performancePromise,
    technicalPromise,
  ]);

  if (!fast && browserAvailable() && !browser) {
    warnings.push(
      'The page could not be rendered in a browser, so colour-contrast checks and screenshots were skipped.',
    );
  }
  if (!browserAvailable()) {
    warnings.push('Browser rendering is not configured, so this audit used static analysis only.');
  }

  // Attach the browser snapshot so downstream analyzers can see axe results.
  context.browser = browser;

  // -- 3. Synchronous analyzers ---------------------------------------------
  const seo = analyzeSeo(context);
  const security = analyzeSecurity(context);
  const contentResult = analyzeContent(context);
  const accessibility = analyzeAccessibility(context);

  const performance = performanceResult ?? degradedPerformance();
  if (!performanceResult) warnings.push('Performance measurement was unavailable for this run.');

  const technical = technicalResult ?? degradedTechnical(context);
  if (!technicalResult) warnings.push('Technical analysis was incomplete for this run.');

  // The security score lives on the technical row for reporting convenience.
  technical.detail.securityScore = security.score;

  if (performance.detail.source === 'synthetic') {
    warnings.push(
      'Performance figures are estimates measured from our servers — connect a PageSpeed Insights API key for full Lighthouse metrics.',
    );
  }

  // -- 4. AI analysis --------------------------------------------------------
  let ai: AuditRunResult['ai'] = null;
  let aiFindings: string | null = null;

  if (!skipAi) {
    try {
      const analysis = await runAiAnalysis({
        context,
        seo,
        performance,
        accessibility,
        technical,
        content: contentResult,
      });

      if (analysis) {
        ai = {
          ux: analysis.ux,
          design: analysis.design,
          content: analysis.content,
          usage: analysis.usage,
        };
        aiFindings = summarizeAiFindings(analysis.raw);
      } else {
        warnings.push('AI analysis is not configured, so UX, design and content scores were not generated.');
      }
    } catch (error) {
      runLog.error('AI analysis failed', { error });
      warnings.push('The AI analysis could not be completed for this run. Technical results are unaffected.');
    }
  }

  // -- 5. Assemble scores ----------------------------------------------------
  // The deterministic content analyzer and the AI content judgement both score
  // CONTENT. Blend them 40/60 in the AI's favour: the AI reads the actual copy,
  // while the analyzer only measures its shape.
  const blendedContent: CategoryResult<ContentDetail> = ai
    ? {
        ...contentResult,
        score: Math.round(contentResult.score * 0.4 + ai.content.score * 0.6),
        summary: ai.content.summary,
        recommendations: [...contentResult.recommendations, ...ai.content.recommendations],
      }
    : contentResult;

  const categories: CategoryResult<unknown>[] = [
    seo,
    performance,
    accessibility,
    technical,
    security,
    blendedContent,
    ...(ai ? [ai.ux, ai.design] : []),
  ];

  const overallScore = computeOverallScore(
    categories.map((category) => ({ category: category.category, score: category.score })),
  );

  const issues = categories.flatMap((category) => category.issues);
  const recommendations = categories.flatMap((category) => category.recommendations);

  // -- 6. Report -------------------------------------------------------------
  const report = await generateReport(
    {
      url: context.page.finalUrl,
      overallScore,
      previousScore: null, // filled by the caller, which knows the history
      categories,
      issues,
      recommendations,
      aiFindings,
    },
    plan,
  );

  const durationMs = Date.now() - started;
  runLog.info('audit finished', { overallScore, durationMs, warnings: warnings.length });

  return {
    url,
    finalUrl: context.page.finalUrl,
    device,
    overallScore,
    durationMs,
    categories,
    seo,
    performance,
    accessibility,
    technical,
    content: blendedContent,
    security,
    ai,
    report,
    issues,
    recommendations: report.recommendations,
    screenshots: browser?.screenshots ?? [],
    pageMeta: {
      statusCode: context.page.status,
      redirectChain: context.page.redirectChain,
      contentType: context.page.headers.get('content-type'),
      server: context.page.headers.get('server'),
      bytes: context.page.bytes,
      renderedWithBrowser: Boolean(browser),
      detectedTech: technical.detail.detectedTech,
    },
    warnings,
  };
}

/**
 * Placeholder results used when an analyzer fails outright. Scored at 50 — a
 * neutral value that neither rewards nor punishes the site for our outage, and
 * paired with a warning so the user knows the number is not a measurement.
 */
function degradedPerformance(): CategoryResult<PerformanceDetail> {
  return {
    category: AuditCategory.PERFORMANCE,
    score: 50,
    summary: 'Performance could not be measured on this run.',
    issues: [],
    recommendations: [],
    detail: {
      source: 'synthetic',
      firstContentfulPaint: null,
      largestContentfulPaint: null,
      cumulativeLayoutShift: null,
      totalBlockingTime: null,
      speedIndex: null,
      timeToInteractive: null,
      serverResponseTime: null,
      totalBytes: null,
      imageBytes: null,
      scriptBytes: null,
      styleBytes: null,
      fontBytes: null,
      documentBytes: null,
      requestCount: null,
      usesCompression: null,
      usesHttp2: null,
      usesTextCaching: null,
      usesModernImages: null,
      opportunities: [],
    },
  };
}

function degradedTechnical(context: PageContext): CategoryResult<TechnicalDetail> {
  const { page } = context;
  return {
    category: AuditCategory.TECHNICAL,
    score: 50,
    summary: 'Technical analysis could not be completed on this run.',
    issues: [],
    recommendations: [],
    detail: {
      httpsEnabled: new URL(page.finalUrl).protocol === 'https:',
      sslValid: null,
      sslIssuer: null,
      sslExpiresAt: null,
      hstsEnabled: page.headers.has('strict-transport-security'),
      cspEnabled: page.headers.has('content-security-policy'),
      xFrameOptions: page.headers.has('x-frame-options'),
      xContentTypeOptions: page.headers.has('x-content-type-options'),
      referrerPolicy: page.headers.has('referrer-policy'),
      permissionsPolicy: page.headers.has('permissions-policy'),
      securityScore: 0,
      statusCode: page.status,
      redirectCount: page.redirectChain.length,
      redirectChain: page.redirectChain,
      hasCanonical: false,
      canonicalSelfReferencing: null,
      totalLinks: 0,
      brokenLinks: 0,
      internalLinks: 0,
      externalLinks: 0,
      nofollowLinks: 0,
      scriptCount: 0,
      stylesheetCount: 0,
      inlineScriptCount: 0,
      renderBlockingCount: 0,
      detectedTech: [],
      links: [],
    },
  };
}
