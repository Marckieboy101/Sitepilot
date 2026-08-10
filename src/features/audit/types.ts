import type { AuditCategory, Difficulty, Priority, Severity } from '@prisma/client';
import type { CheerioAPI } from 'cheerio';

/**
 * Contracts shared by every analyzer.
 *
 * Analyzers are pure functions of a `PageContext`: they never touch the
 * database, never call each other, and return a `CategoryResult`. That keeps
 * them independently testable against a fixture of HTML, and lets the engine
 * run them concurrently and tolerate individual failures.
 */

export interface FetchedPage {
  /** URL actually served, after redirects. */
  finalUrl: string;
  requestedUrl: string;
  status: number;
  headers: Headers;
  html: string;
  bytes: number;
  redirectChain: string[];
  /** Wall-clock time to first byte + download, our floor for "server speed". */
  timingMs: number;
  truncated: boolean;
}

/** Everything an analyzer is allowed to read. */
export interface PageContext {
  page: FetchedPage;
  /** Parsed DOM. Cheerio, so no scripts run and no layout is computed. */
  $: CheerioAPI;
  /** Text content with script/style/nav chrome removed. */
  text: string;
  robotsTxt: RobotsTxt | null;
  sitemap: SitemapInfo | null;
  /** Populated only when a headless browser was available. */
  browser: BrowserSnapshot | null;
  device: 'MOBILE' | 'DESKTOP';
}

export interface RobotsTxt {
  found: boolean;
  url: string;
  content: string;
  sitemaps: string[];
  /** True when a `Disallow: /` applies to our user-agent or `*`. */
  blocksEverything: boolean;
}

export interface SitemapInfo {
  found: boolean;
  url: string;
  urlCount: number;
  isIndex: boolean;
}

/** Data only obtainable by actually rendering the page. */
export interface BrowserSnapshot {
  /** axe-core results, already trimmed. */
  axe: AxeResults | null;
  screenshots: CapturedScreenshot[];
  /** Post-JavaScript DOM, which differs from the raw HTML on SPA sites. */
  renderedHtml: string | null;
  metrics: {
    domContentLoadedMs?: number;
    loadMs?: number;
    firstContentfulPaintMs?: number;
    largestContentfulPaintMs?: number;
    cumulativeLayoutShift?: number;
    transferredBytes?: number;
    requestCount?: number;
  };
  /** Palette and type sampled from computed styles, for the design analysis. */
  visual: VisualProfile | null;
}

export interface VisualProfile {
  /** Most-used colours, most frequent first, as `rgb()` strings. */
  colors: string[];
  backgroundColors: string[];
  fontFamilies: string[];
  fontSizes: number[];
  /** Distinct border-radius values — a proxy for visual consistency. */
  borderRadii: string[];
  buttonCount: number;
  formCount: number;
  imageCount: number;
  headingCount: number;
  viewportWidth: number;
  documentHeight: number;
}

export interface CapturedScreenshot {
  kind: 'DESKTOP_VIEWPORT' | 'DESKTOP_FULL' | 'MOBILE_VIEWPORT' | 'MOBILE_FULL';
  /** Data URL or storage URL depending on where it was persisted. */
  url: string;
  width: number;
  height: number;
  bytes: number;
}

export interface AxeViolationNode {
  target: string[];
  html: string;
  failureSummary?: string;
}

export interface AxeViolation {
  id: string;
  impact: 'critical' | 'serious' | 'moderate' | 'minor' | null;
  help: string;
  description: string;
  helpUrl: string;
  tags: string[];
  nodes: AxeViolationNode[];
}

export interface AxeResults {
  violations: AxeViolation[];
  passes: number;
  incomplete: number;
}

// ---------------------------------------------------------------------------
// Analyzer output
// ---------------------------------------------------------------------------

export interface AnalyzerIssue {
  /** Stable rule id, e.g. `seo.title.missing`. Used for dedupe and telemetry. */
  code: string;
  category: AuditCategory;
  severity: Severity;
  title: string;
  description: string;
  evidence?: string;
  helpUrl?: string;
}

export interface AnalyzerRecommendation {
  category: AuditCategory;
  title: string;
  explanation: string;
  expectedImpact: string;
  difficulty: Difficulty;
  estimatedMinutes: number;
  priority: Priority;
  impactScore: number;
  kind: 'QUICK_WIN' | 'LONG_TERM';
}

export interface CategoryResult<TDetail = unknown> {
  category: AuditCategory;
  score: number;
  summary: string;
  issues: AnalyzerIssue[];
  recommendations: AnalyzerRecommendation[];
  /** Typed payload persisted to the category's result table. */
  detail: TDetail;
}

export interface AnalyzerFailure {
  category: AuditCategory;
  message: string;
}

/** An analyzer either produces a result or reports why it couldn't. */
export type AnalyzerOutcome<TDetail = unknown> =
  | { ok: true; result: CategoryResult<TDetail> }
  | { ok: false; failure: AnalyzerFailure };

// ---------------------------------------------------------------------------
// Detail payloads (mirror the Prisma result tables)
// ---------------------------------------------------------------------------

export interface HeadingEntry {
  level: number;
  text: string;
}

export interface KeywordEntry {
  term: string;
  count: number;
  density: number;
}

export interface SeoDetail {
  title: string | null;
  titleLength: number | null;
  metaDescription: string | null;
  descriptionLength: number | null;
  canonicalUrl: string | null;
  robotsDirectives: string | null;
  indexable: boolean;
  lang: string | null;
  h1Count: number;
  h2Count: number;
  h3Count: number;
  headingOutline: HeadingEntry[];
  wordCount: number;
  readingTimeSec: number;
  keywordDensity: KeywordEntry[];
  duplicateContentRatio: number | null;
  imageCount: number;
  imagesMissingAlt: number;
  hasOpenGraph: boolean;
  hasTwitterCard: boolean;
  hasStructuredData: boolean;
  structuredDataTypes: string[];
  hasSitemap: boolean;
  sitemapUrl: string | null;
  hasRobotsTxt: boolean;
  urlDepth: number;
  urlIsReadable: boolean;
  internalLinkCount: number;
  externalLinkCount: number;
}

export interface PerformanceOpportunity {
  id: string;
  title: string;
  description: string;
  savingsMs?: number;
  savingsBytes?: number;
}

export interface PerformanceDetail {
  source: 'psi' | 'lighthouse' | 'synthetic';
  firstContentfulPaint: number | null;
  largestContentfulPaint: number | null;
  cumulativeLayoutShift: number | null;
  totalBlockingTime: number | null;
  speedIndex: number | null;
  timeToInteractive: number | null;
  serverResponseTime: number | null;
  totalBytes: number | null;
  imageBytes: number | null;
  scriptBytes: number | null;
  styleBytes: number | null;
  fontBytes: number | null;
  documentBytes: number | null;
  requestCount: number | null;
  usesCompression: boolean | null;
  usesHttp2: boolean | null;
  usesTextCaching: boolean | null;
  usesModernImages: boolean | null;
  opportunities: PerformanceOpportunity[];
}

export interface AccessibilityDetail {
  violationCount: number;
  passCount: number;
  incompleteCount: number;
  criticalCount: number;
  seriousCount: number;
  moderateCount: number;
  minorCount: number;
  contrastIssues: number;
  missingAltText: number;
  missingFormLabels: number;
  missingAriaLabels: number;
  headingOrderIssues: number;
  focusIssues: number;
  keyboardIssues: number;
  wcagTags: string[];
  rawViolations: AxeViolation[];
}

export interface DiscoveredLink {
  href: string;
  anchorText: string | null;
  isInternal: boolean;
  isNofollow: boolean;
  statusCode: number | null;
  isBroken: boolean;
}

export interface TechnicalDetail {
  httpsEnabled: boolean;
  sslValid: boolean | null;
  sslIssuer: string | null;
  sslExpiresAt: Date | null;
  hstsEnabled: boolean;
  cspEnabled: boolean;
  xFrameOptions: boolean;
  xContentTypeOptions: boolean;
  referrerPolicy: boolean;
  permissionsPolicy: boolean;
  securityScore: number;
  statusCode: number | null;
  redirectCount: number;
  redirectChain: string[];
  hasCanonical: boolean;
  canonicalSelfReferencing: boolean | null;
  totalLinks: number;
  brokenLinks: number;
  internalLinks: number;
  externalLinks: number;
  nofollowLinks: number;
  scriptCount: number;
  stylesheetCount: number;
  inlineScriptCount: number;
  renderBlockingCount: number;
  detectedTech: string[];
  links: DiscoveredLink[];
}

export interface ContentDetail {
  wordCount: number;
  readingTimeSec: number;
  /** Flesch reading-ease, 0-100. Higher is easier. */
  readability: number | null;
  averageSentenceLength: number;
  paragraphCount: number;
  hasCallToAction: boolean;
  ctaLabels: string[];
  /** Trust markers found: testimonials, contact details, policy links. */
  trustSignals: string[];
}
