import { AuditCategory, Difficulty, Priority, Severity } from '@prisma/client';

import { CATEGORY_WEIGHTS, impactScore, isQuickWin, scoreFromIssues } from '@/config/scoring';
import { resolveHref, isSameSite } from '@/lib/url';

import type {
  AnalyzerIssue,
  AnalyzerRecommendation,
  CategoryResult,
  HeadingEntry,
  KeywordEntry,
  PageContext,
  SeoDetail,
} from '../types';

/**
 * On-page SEO analysis.
 *
 * Deliberately opinionated about what counts as a problem. Google does not
 * publish hard limits for title/description length, so the thresholds here are
 * the pixel-width-derived truncation points that actually change what a user
 * sees in the SERP — that is the thing worth flagging, not an arbitrary
 * character count.
 */

const TITLE_MIN = 30;
const TITLE_MAX = 60;
const DESCRIPTION_MIN = 70;
const DESCRIPTION_MAX = 160;
const THIN_CONTENT_WORDS = 300;

/** Terms too common to be meaningful in a density report. */
const STOP_WORDS = new Set(
  `a about above after again against all am an and any are aren't as at be because been before being below
   between both but by can cannot could couldn't did didn't do does doesn't doing don't down during each few for
   from further had hadn't has hasn't have haven't having he her here hers herself him himself his how i if in
   into is isn't it its itself let's me more most mustn't my myself no nor not of off on once only or other ought
   our ours ourselves out over own same shan't she should shouldn't so some such than that the their theirs them
   themselves then there these they this those through to too under until up very was wasn't we were weren't what
   when where which while who whom why with won't would wouldn't you your yours yourself yourselves us via`
    .split(/\s+/)
    .filter(Boolean),
);

const WORDS_PER_MINUTE = 225;

function headingOutline($: PageContext['$']): HeadingEntry[] {
  const entries: HeadingEntry[] = [];
  $('h1, h2, h3, h4, h5, h6').each((_, element) => {
    const tag = (element as { tagName?: string }).tagName ?? 'h6';
    const text = $(element).text().replace(/\s+/g, ' ').trim();
    if (text) entries.push({ level: Number(tag.slice(1)), text: text.slice(0, 200) });
  });
  return entries.slice(0, 100);
}

export function keywordDensity(text: string, limit = 12): KeywordEntry[] {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word) && !/^\d+$/.test(word));

  if (words.length === 0) return [];

  const counts = new Map<string, number>();
  for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);

  return Array.from(counts.entries())
    .map(([term, count]) => ({ term, count, density: (count / words.length) * 100 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/**
 * Cheap internal-duplication signal: how much of the page's text is repeated
 * sentences. High values usually mean boilerplate padding rather than real
 * content. This is intentionally not a cross-page duplicate-content check —
 * that needs a crawl, which is a different (paid) product surface.
 */
function duplicateRatio(text: string): number | null {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim().toLowerCase())
    .filter((sentence) => sentence.length > 40);

  if (sentences.length < 6) return null;

  const seen = new Set<string>();
  let duplicates = 0;
  for (const sentence of sentences) {
    if (seen.has(sentence)) duplicates += 1;
    else seen.add(sentence);
  }

  return Number((duplicates / sentences.length).toFixed(3));
}

function structuredDataTypes($: PageContext['$']): string[] {
  const types = new Set<string>();

  $('script[type="application/ld+json"]').each((_, element) => {
    const raw = $(element).contents().text();
    if (!raw.trim()) return;
    try {
      const parsed: unknown = JSON.parse(raw);
      collectTypes(parsed, types);
    } catch {
      // Malformed JSON-LD is reported as its own issue below.
    }
  });

  // Microdata fallback.
  $('[itemtype]').each((_, element) => {
    const itemType = $(element).attr('itemtype');
    if (itemType) types.add(itemType.split('/').pop() ?? itemType);
  });

  return Array.from(types).slice(0, 20);
}

function collectTypes(node: unknown, into: Set<string>, depth = 0): void {
  if (depth > 6 || !node) return;
  if (Array.isArray(node)) {
    for (const entry of node) collectTypes(entry, into, depth + 1);
    return;
  }
  if (typeof node !== 'object') return;

  const record = node as Record<string, unknown>;
  const type = record['@type'];
  if (typeof type === 'string') into.add(type);
  else if (Array.isArray(type)) for (const entry of type) if (typeof entry === 'string') into.add(entry);

  if (Array.isArray(record['@graph'])) collectTypes(record['@graph'], into, depth + 1);
}

function hasMalformedJsonLd($: PageContext['$']): boolean {
  let malformed = false;
  $('script[type="application/ld+json"]').each((_, element) => {
    const raw = $(element).contents().text().trim();
    if (!raw) return;
    try {
      JSON.parse(raw);
    } catch {
      malformed = true;
    }
  });
  return malformed;
}

/** A URL is "readable" when its path reads as words rather than ids or query soup. */
function urlIsReadable(url: URL): boolean {
  const path = url.pathname;
  if (path === '/' || path === '') return true;
  if (/\.(php|aspx?|jsp|cgi)$/i.test(path)) return false;
  if (/\b\d{6,}\b/.test(path)) return false;
  if (url.searchParams.size > 2) return false;
  if (/[A-Z]/.test(path)) return false;
  if (/[_%]/.test(path)) return false;
  return true;
}

export function analyzeSeo(context: PageContext): CategoryResult<SeoDetail> {
  const { $, page, text, robotsTxt, sitemap } = context;
  const issues: AnalyzerIssue[] = [];
  const recommendations: AnalyzerRecommendation[] = [];

  const pageUrl = new URL(page.finalUrl);

  const title = $('head title').first().text().trim() || null;
  const metaDescription = $('meta[name="description"]').attr('content')?.trim() || null;
  const canonicalUrl = $('link[rel="canonical"]').attr('href')?.trim() || null;
  const robotsMeta = $('meta[name="robots"]').attr('content')?.trim() || null;
  const lang = $('html').attr('lang')?.trim() || null;

  const headings = headingOutline($);
  const h1s = headings.filter((entry) => entry.level === 1);
  const h2Count = headings.filter((entry) => entry.level === 2).length;
  const h3Count = headings.filter((entry) => entry.level === 3).length;

  const wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0;
  const readingTimeSec = Math.round((wordCount / WORDS_PER_MINUTE) * 60);

  const images = $('img').toArray();
  const imagesMissingAlt = images.filter((element) => {
    const $img = $(element);
    // A decorative image with alt="" is correct, not a defect.
    const alt = $img.attr('alt');
    const isDecorative = alt === '' || $img.attr('role') === 'presentation' || $img.attr('aria-hidden') === 'true';
    return alt === undefined && !isDecorative;
  }).length;

  const sdTypes = structuredDataTypes($);
  const hasOpenGraph = $('meta[property^="og:"]').length > 0;
  const hasTwitterCard = $('meta[name^="twitter:"]').length > 0;

  let internalLinkCount = 0;
  let externalLinkCount = 0;
  $('a[href]').each((_, element) => {
    const resolved = resolveHref($(element).attr('href') ?? '', page.finalUrl);
    if (!resolved) return;
    if (isSameSite(resolved, page.finalUrl)) internalLinkCount += 1;
    else externalLinkCount += 1;
  });

  const noindex = /noindex/i.test(robotsMeta ?? '') || /noindex/i.test(page.headers.get('x-robots-tag') ?? '');
  const indexable = !noindex && !(robotsTxt?.blocksEverything ?? false);

  // -------------------------------------------------------------------------
  // Title
  // -------------------------------------------------------------------------
  if (!title) {
    issues.push({
      code: 'seo.title.missing',
      category: AuditCategory.SEO,
      severity: Severity.CRITICAL,
      title: 'The page has no title tag',
      description:
        'The title is the single strongest on-page ranking signal and the clickable headline in search results. Without one, Google invents a title from your page content — usually badly.',
      helpUrl: 'https://developers.google.com/search/docs/appearance/title-link',
    });
    recommendations.push({
      category: AuditCategory.SEO,
      title: 'Add a descriptive page title',
      explanation:
        'Write a 50-60 character title that leads with what the page is about and ends with your brand name, for example "Handmade Leather Wallets — Northgate Goods".',
      expectedImpact:
        'Search engines get an unambiguous topic signal, and your search snippet becomes far more clickable. This is typically the highest-return SEO change on any page missing it.',
      difficulty: Difficulty.EASY,
      estimatedMinutes: 10,
      priority: Priority.HIGH,
      impactScore: impactScore({ severity: Severity.CRITICAL, difficulty: Difficulty.EASY, categoryWeight: CATEGORY_WEIGHTS.SEO }),
      kind: 'QUICK_WIN',
    });
  } else if (title.length < TITLE_MIN) {
    issues.push({
      code: 'seo.title.too-short',
      category: AuditCategory.SEO,
      severity: Severity.MEDIUM,
      title: `Title is only ${title.length} characters`,
      description: `Short titles waste available space in search results. Aim for ${TITLE_MIN}-${TITLE_MAX} characters so you can include both the topic and a reason to click.`,
      evidence: title,
    });
    recommendations.push({
      category: AuditCategory.SEO,
      title: 'Expand the page title',
      explanation: `Your title is "${title}". Add the specific benefit or category this page covers so it uses the full ${TITLE_MAX}-character allowance.`,
      expectedImpact: 'A richer title matches more search queries and gives searchers a clearer reason to click.',
      difficulty: Difficulty.EASY,
      estimatedMinutes: 10,
      priority: Priority.MEDIUM,
      impactScore: impactScore({ severity: Severity.MEDIUM, difficulty: Difficulty.EASY, categoryWeight: CATEGORY_WEIGHTS.SEO }),
      kind: 'QUICK_WIN',
    });
  } else if (title.length > TITLE_MAX) {
    issues.push({
      code: 'seo.title.too-long',
      category: AuditCategory.SEO,
      severity: Severity.LOW,
      title: `Title is ${title.length} characters and will be truncated`,
      description: `Google cuts titles at roughly ${TITLE_MAX} characters. Everything after that is invisible to searchers.`,
      evidence: title,
    });
    recommendations.push({
      category: AuditCategory.SEO,
      title: 'Shorten the page title',
      explanation: `Trim the title to about ${TITLE_MAX} characters, keeping the most distinctive words at the front where they survive truncation.`,
      expectedImpact: 'Your full message appears in search results instead of trailing off mid-sentence.',
      difficulty: Difficulty.EASY,
      estimatedMinutes: 10,
      priority: Priority.LOW,
      impactScore: impactScore({ severity: Severity.LOW, difficulty: Difficulty.EASY, categoryWeight: CATEGORY_WEIGHTS.SEO }),
      kind: 'QUICK_WIN',
    });
  }

  // -------------------------------------------------------------------------
  // Meta description
  // -------------------------------------------------------------------------
  if (!metaDescription) {
    issues.push({
      code: 'seo.description.missing',
      category: AuditCategory.SEO,
      severity: Severity.HIGH,
      title: 'No meta description',
      description:
        "Without a meta description Google pulls an arbitrary sentence from the page. You lose control of the pitch that decides whether someone clicks your result or a competitor's.",
      helpUrl: 'https://developers.google.com/search/docs/appearance/snippet',
    });
    recommendations.push({
      category: AuditCategory.SEO,
      title: 'Write a meta description',
      explanation: `Add a ${DESCRIPTION_MIN}-${DESCRIPTION_MAX} character summary that states what the visitor gets and includes a light call to action.`,
      expectedImpact:
        'Descriptions do not affect ranking directly, but a well-written one measurably lifts click-through rate from the results page.',
      difficulty: Difficulty.EASY,
      estimatedMinutes: 15,
      priority: Priority.HIGH,
      impactScore: impactScore({ severity: Severity.HIGH, difficulty: Difficulty.EASY, categoryWeight: CATEGORY_WEIGHTS.SEO }),
      kind: 'QUICK_WIN',
    });
  } else if (metaDescription.length < DESCRIPTION_MIN || metaDescription.length > DESCRIPTION_MAX) {
    const tooLong = metaDescription.length > DESCRIPTION_MAX;
    issues.push({
      code: tooLong ? 'seo.description.too-long' : 'seo.description.too-short',
      category: AuditCategory.SEO,
      severity: Severity.LOW,
      title: `Meta description is ${metaDescription.length} characters`,
      description: tooLong
        ? `Descriptions longer than about ${DESCRIPTION_MAX} characters get cut off with an ellipsis.`
        : `Short descriptions leave persuasion space unused. Aim for ${DESCRIPTION_MIN}-${DESCRIPTION_MAX} characters.`,
      evidence: metaDescription,
    });
  }

  // -------------------------------------------------------------------------
  // Headings
  // -------------------------------------------------------------------------
  if (h1s.length === 0) {
    issues.push({
      code: 'seo.h1.missing',
      category: AuditCategory.SEO,
      severity: Severity.HIGH,
      title: 'No H1 heading',
      description:
        'The H1 tells both search engines and screen-reader users what this page is about. Every page should have exactly one.',
    });
    recommendations.push({
      category: AuditCategory.SEO,
      title: 'Add a single H1 heading',
      explanation:
        'Mark the main headline of the page as an <h1>. If the headline is styled text inside a <div>, changing the tag alone is usually enough — keep the same CSS class.',
      expectedImpact: 'Clarifies the page topic for search engines and gives assistive technology a reliable landmark.',
      difficulty: Difficulty.EASY,
      estimatedMinutes: 15,
      priority: Priority.HIGH,
      impactScore: impactScore({ severity: Severity.HIGH, difficulty: Difficulty.EASY, categoryWeight: CATEGORY_WEIGHTS.SEO }),
      kind: 'QUICK_WIN',
    });
  } else if (h1s.length > 1) {
    issues.push({
      code: 'seo.h1.multiple',
      category: AuditCategory.SEO,
      severity: Severity.LOW,
      title: `${h1s.length} H1 headings on one page`,
      description:
        'Multiple H1s dilute the topic signal and make the document outline ambiguous. Promote one to H1 and demote the rest to H2.',
      evidence: h1s.map((entry) => entry.text).join(' | ').slice(0, 300),
    });
  }

  if (h1s.length > 0 && h2Count === 0 && wordCount > 500) {
    issues.push({
      code: 'seo.headings.no-subheadings',
      category: AuditCategory.SEO,
      severity: Severity.LOW,
      title: 'Long page with no H2 subheadings',
      description:
        'A wall of text with no subheadings is hard to scan and gives search engines no structure to work with. Break the content into sections with H2s.',
    });
  }

  // -------------------------------------------------------------------------
  // Indexability & canonical
  // -------------------------------------------------------------------------
  if (noindex) {
    issues.push({
      code: 'seo.indexability.noindex',
      category: AuditCategory.SEO,
      severity: Severity.CRITICAL,
      title: 'This page is set to noindex',
      description:
        'A noindex directive tells search engines to drop this page from their index entirely. If that is not deliberate, this page currently cannot rank for anything.',
      evidence: robotsMeta ?? page.headers.get('x-robots-tag') ?? undefined,
    });
    recommendations.push({
      category: AuditCategory.SEO,
      title: 'Remove the noindex directive',
      explanation:
        'Delete the noindex value from the robots meta tag or the X-Robots-Tag response header, then request re-indexing in Google Search Console.',
      expectedImpact:
        'The page becomes eligible to appear in search results. Until this is fixed, no other SEO work on this page can pay off.',
      difficulty: Difficulty.EASY,
      estimatedMinutes: 20,
      priority: Priority.HIGH,
      impactScore: 100,
      kind: 'QUICK_WIN',
    });
  }

  if (robotsTxt?.blocksEverything) {
    issues.push({
      code: 'seo.robots.blocks-all',
      category: AuditCategory.SEO,
      severity: Severity.CRITICAL,
      title: 'robots.txt blocks all crawlers',
      description:
        'Your robots.txt contains a blanket "Disallow: /" for all user agents, which stops search engines from crawling the site.',
      evidence: robotsTxt.url,
    });
  }

  if (!canonicalUrl) {
    issues.push({
      code: 'seo.canonical.missing',
      category: AuditCategory.SEO,
      severity: Severity.MEDIUM,
      title: 'No canonical URL declared',
      description:
        'Without a canonical tag, the same content reachable at several URLs (with/without trailing slash, with tracking parameters) can be treated as duplicate pages, splitting ranking signals.',
    });
    recommendations.push({
      category: AuditCategory.SEO,
      title: 'Declare a canonical URL',
      explanation:
        'Add <link rel="canonical" href="…"> pointing at the preferred absolute URL for this page.',
      expectedImpact: 'Consolidates ranking signals onto one URL instead of scattering them across duplicates.',
      difficulty: Difficulty.EASY,
      estimatedMinutes: 20,
      priority: Priority.MEDIUM,
      impactScore: impactScore({ severity: Severity.MEDIUM, difficulty: Difficulty.EASY, categoryWeight: CATEGORY_WEIGHTS.SEO }),
      kind: 'QUICK_WIN',
    });
  }

  if (!lang) {
    issues.push({
      code: 'seo.lang.missing',
      category: AuditCategory.SEO,
      severity: Severity.LOW,
      title: 'No lang attribute on <html>',
      description:
        'Declaring the language helps search engines serve the page to the right audience and lets screen readers choose the correct pronunciation.',
    });
  }

  // -------------------------------------------------------------------------
  // Content depth & images
  // -------------------------------------------------------------------------
  if (wordCount < THIN_CONTENT_WORDS) {
    issues.push({
      code: 'seo.content.thin',
      category: AuditCategory.SEO,
      severity: wordCount < 120 ? Severity.HIGH : Severity.MEDIUM,
      title: `Only ${wordCount} words of content`,
      description:
        'Thin pages struggle to rank because there is little for a search engine to understand or match against a query. Depth matters more than a magic word count, but under 300 words is rarely enough to answer a question fully.',
    });
    recommendations.push({
      category: AuditCategory.SEO,
      title: 'Add substantive content to the page',
      explanation:
        'Cover the questions a visitor actually arrives with: what this is, who it is for, what it costs, and what happens next. Aim for genuine depth rather than padding.',
      expectedImpact: 'More matched queries, longer time on page, and a stronger topical signal.',
      difficulty: Difficulty.MEDIUM,
      estimatedMinutes: 180,
      priority: wordCount < 120 ? Priority.HIGH : Priority.MEDIUM,
      impactScore: impactScore({
        severity: wordCount < 120 ? Severity.HIGH : Severity.MEDIUM,
        difficulty: Difficulty.MEDIUM,
        categoryWeight: CATEGORY_WEIGHTS.SEO,
      }),
      kind: 'LONG_TERM',
    });
  }

  if (imagesMissingAlt > 0) {
    issues.push({
      code: 'seo.images.missing-alt',
      category: AuditCategory.SEO,
      severity: imagesMissingAlt > 5 ? Severity.MEDIUM : Severity.LOW,
      title: `${imagesMissingAlt} image${imagesMissingAlt === 1 ? '' : 's'} without alt text`,
      description:
        'Alt text describes an image to search engines and to anyone using a screen reader. Purely decorative images should carry alt="" so they are skipped deliberately.',
    });
    recommendations.push({
      category: AuditCategory.SEO,
      title: 'Write alt text for content images',
      explanation: `${imagesMissingAlt} image${imagesMissingAlt === 1 ? ' has' : 's have'} no alt attribute. Describe what each image shows in a short phrase; use alt="" for decorative ones.`,
      expectedImpact: 'Improves image search visibility and makes the page usable with a screen reader.',
      difficulty: Difficulty.EASY,
      estimatedMinutes: Math.min(120, 5 * imagesMissingAlt),
      priority: Priority.MEDIUM,
      impactScore: impactScore({ severity: Severity.MEDIUM, difficulty: Difficulty.EASY, categoryWeight: CATEGORY_WEIGHTS.SEO }),
      kind: 'QUICK_WIN',
    });
  }

  // -------------------------------------------------------------------------
  // Social & structured data
  // -------------------------------------------------------------------------
  if (!hasOpenGraph) {
    issues.push({
      code: 'seo.opengraph.missing',
      category: AuditCategory.SEO,
      severity: Severity.MEDIUM,
      title: 'No Open Graph tags',
      description:
        'Without og:title, og:description and og:image, links shared on LinkedIn, Facebook, Slack and iMessage render as a bare URL with no preview.',
    });
    recommendations.push({
      category: AuditCategory.SEO,
      title: 'Add Open Graph and Twitter Card tags',
      explanation:
        'Set og:title, og:description, og:image (1200×630) and og:url, plus twitter:card="summary_large_image". Most frameworks expose this through their metadata API.',
      expectedImpact:
        'Shared links render as rich preview cards, which reliably increases click-through from social and chat apps.',
      difficulty: Difficulty.EASY,
      estimatedMinutes: 45,
      priority: Priority.MEDIUM,
      impactScore: impactScore({ severity: Severity.MEDIUM, difficulty: Difficulty.EASY, categoryWeight: CATEGORY_WEIGHTS.SEO }),
      kind: 'QUICK_WIN',
    });
  } else if (!hasTwitterCard) {
    issues.push({
      code: 'seo.twitter.missing',
      category: AuditCategory.SEO,
      severity: Severity.LOW,
      title: 'No Twitter Card tags',
      description: 'Open Graph is present but Twitter-specific tags are missing, so X/Twitter may render a smaller preview.',
    });
  }

  if (sdTypes.length === 0) {
    issues.push({
      code: 'seo.structured-data.missing',
      category: AuditCategory.SEO,
      severity: Severity.MEDIUM,
      title: 'No structured data',
      description:
        'Schema.org markup is what makes rich results possible — star ratings, FAQs, breadcrumbs, product prices. Without it your result is plain text next to competitors with badges.',
      helpUrl: 'https://developers.google.com/search/docs/appearance/structured-data',
    });
    recommendations.push({
      category: AuditCategory.SEO,
      title: 'Add schema.org structured data',
      explanation:
        'Add JSON-LD for the types that fit this page — Organization and WebSite at minimum, plus Product, Article, FAQPage or LocalBusiness where relevant.',
      expectedImpact: 'Makes the page eligible for rich results, which occupy more space and attract more clicks.',
      difficulty: Difficulty.MEDIUM,
      estimatedMinutes: 90,
      priority: Priority.MEDIUM,
      impactScore: impactScore({ severity: Severity.MEDIUM, difficulty: Difficulty.MEDIUM, categoryWeight: CATEGORY_WEIGHTS.SEO }),
      kind: 'LONG_TERM',
    });
  }

  if (hasMalformedJsonLd($)) {
    issues.push({
      code: 'seo.structured-data.invalid',
      category: AuditCategory.SEO,
      severity: Severity.MEDIUM,
      title: 'Structured data contains invalid JSON',
      description:
        'At least one ld+json block failed to parse, so search engines will ignore it entirely — the markup is doing nothing.',
    });
  }

  // -------------------------------------------------------------------------
  // Crawl infrastructure
  // -------------------------------------------------------------------------
  if (robotsTxt && !robotsTxt.found) {
    issues.push({
      code: 'seo.robots.missing',
      category: AuditCategory.SEO,
      severity: Severity.LOW,
      title: 'No robots.txt',
      description:
        'A robots.txt is not required, but it is the conventional place to point crawlers at your sitemap and to keep them out of admin paths.',
    });
  }

  if (sitemap && !sitemap.found) {
    issues.push({
      code: 'seo.sitemap.missing',
      category: AuditCategory.SEO,
      severity: Severity.MEDIUM,
      title: 'No XML sitemap found',
      description:
        'A sitemap helps search engines discover every page, which matters most for large sites and for pages that are not linked from the main navigation.',
    });
    recommendations.push({
      category: AuditCategory.SEO,
      title: 'Publish an XML sitemap',
      explanation:
        'Generate /sitemap.xml listing every indexable URL, reference it from robots.txt, and submit it in Google Search Console.',
      expectedImpact: 'Faster and more complete discovery of your pages, especially newly published ones.',
      difficulty: Difficulty.EASY,
      estimatedMinutes: 45,
      priority: Priority.MEDIUM,
      impactScore: impactScore({ severity: Severity.MEDIUM, difficulty: Difficulty.EASY, categoryWeight: CATEGORY_WEIGHTS.SEO }),
      kind: 'QUICK_WIN',
    });
  }

  if (internalLinkCount === 0) {
    issues.push({
      code: 'seo.links.no-internal',
      category: AuditCategory.SEO,
      severity: Severity.MEDIUM,
      title: 'No internal links',
      description:
        'Internal links spread ranking authority through the site and give crawlers a path to your other pages. A page with none is a dead end.',
    });
  }

  const readable = urlIsReadable(pageUrl);
  if (!readable) {
    issues.push({
      code: 'seo.url.unreadable',
      category: AuditCategory.SEO,
      severity: Severity.LOW,
      title: 'URL is hard to read',
      description:
        'Clean, word-based URLs are easier to share, get truncated more gracefully in search results, and give a small relevance signal.',
      evidence: pageUrl.pathname + pageUrl.search,
    });
  }

  const dupRatio = duplicateRatio(text);
  if (dupRatio !== null && dupRatio > 0.3) {
    issues.push({
      code: 'seo.content.duplicated',
      category: AuditCategory.SEO,
      severity: Severity.MEDIUM,
      title: `${Math.round(dupRatio * 100)}% of sentences on this page are repeated`,
      description:
        'Heavy internal repetition suggests boilerplate padding rather than substance, and gives search engines little unique text to index.',
    });
  }

  const detail: SeoDetail = {
    title,
    titleLength: title?.length ?? null,
    metaDescription,
    descriptionLength: metaDescription?.length ?? null,
    canonicalUrl,
    robotsDirectives: robotsMeta,
    indexable,
    lang,
    h1Count: h1s.length,
    h2Count,
    h3Count,
    headingOutline: headings,
    wordCount,
    readingTimeSec,
    keywordDensity: keywordDensity(text),
    duplicateContentRatio: dupRatio,
    imageCount: images.length,
    imagesMissingAlt,
    hasOpenGraph,
    hasTwitterCard,
    hasStructuredData: sdTypes.length > 0,
    structuredDataTypes: sdTypes,
    hasSitemap: sitemap?.found ?? false,
    sitemapUrl: sitemap?.found ? sitemap.url : null,
    hasRobotsTxt: robotsTxt?.found ?? false,
    urlDepth: pageUrl.pathname.split('/').filter(Boolean).length,
    urlIsReadable: readable,
    internalLinkCount,
    externalLinkCount,
  };

  const score = scoreFromIssues(issues);

  return {
    category: AuditCategory.SEO,
    score,
    summary: buildSummary(score, issues.length, detail),
    issues,
    recommendations: recommendations.map((recommendation) => ({
      ...recommendation,
      kind: isQuickWin(recommendation.difficulty, recommendation.estimatedMinutes) ? 'QUICK_WIN' : 'LONG_TERM',
    })),
    detail,
  };
}

function buildSummary(score: number, issueCount: number, detail: SeoDetail): string {
  if (!detail.indexable) {
    return 'This page is currently blocked from search engines, so nothing else here can help it rank until that is fixed.';
  }
  if (score >= 90) {
    return `Strong on-page SEO. Title, description and structure are all in place across ${detail.wordCount} words of content.`;
  }
  if (score >= 75) {
    return `Solid foundations with ${issueCount} issue${issueCount === 1 ? '' : 's'} to tidy up — mostly metadata and structured data polish.`;
  }
  if (score >= 50) {
    return `Several fixable SEO gaps found. Addressing the ${issueCount} issue${issueCount === 1 ? '' : 's'} below would meaningfully improve how this page is understood and ranked.`;
  }
  return `Significant SEO problems: ${issueCount} issue${issueCount === 1 ? '' : 's'} found, including fundamentals that are costing this page visibility today.`;
}
