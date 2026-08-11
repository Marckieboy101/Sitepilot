import { AuditCategory, Difficulty, Priority, Severity } from '@prisma/client';

import { CATEGORY_WEIGHTS, impactScore, isQuickWin, scoreFromIssues } from '@/config/scoring';
import { probeStatus } from '@/lib/http';
import { chunk, unique } from '@/lib/utils';
import { isSameSite, resolveHref } from '@/lib/url';

import type {
  AnalyzerIssue,
  AnalyzerRecommendation,
  CategoryResult,
  DiscoveredLink,
  PageContext,
  TechnicalDetail,
} from '../types';

/**
 * Technical health: crawlability, redirects, link integrity and markup hygiene.
 *
 * Link checking is the expensive part. It is bounded three ways — a cap on how
 * many distinct links are probed, small concurrent batches, and a short
 * per-request timeout — because a page with 400 links would otherwise turn one
 * audit into 400 outbound requests and blow the function's time budget.
 */

const MAX_LINKS_CHECKED = 40;
const LINK_BATCH_SIZE = 8;

/** What a fingerprint rule is allowed to look at. */
interface TechProbe {
  $: PageContext['$'];
  page: PageContext['page'];
  html: string;
}

/** Signatures for the frameworks and platforms worth naming in a report. */
const TECH_SIGNATURES: Array<{ name: string; test: (probe: TechProbe) => boolean }> = [
  { name: 'Next.js', test: ({ $, page }) => $('#__next, script[src*="/_next/"]').length > 0 || page.headers.has('x-nextjs-cache') },
  { name: 'React', test: ({ $ }) => $('[data-reactroot], #root, #__next').length > 0 },
  { name: 'Vue', test: ({ $ }) => $('[data-v-app], #app[data-server-rendered]').length > 0 },
  { name: 'Svelte', test: ({ html }) => /svelte-[a-z0-9]{6}/.test(html) },
  { name: 'Angular', test: ({ $ }) => $('[ng-version]').length > 0 },
  { name: 'WordPress', test: ({ html }) => /wp-content|wp-includes/.test(html) },
  { name: 'Shopify', test: ({ html }) => /cdn\.shopify\.com|Shopify\.theme/.test(html) },
  { name: 'Webflow', test: ({ $ }) => $('html[data-wf-site]').length > 0 },
  { name: 'Squarespace', test: ({ html }) => /squarespace\.com|static1\.squarespace/.test(html) },
  { name: 'Wix', test: ({ html }) => /wix\.com|wixstatic/.test(html) },
  { name: 'Tailwind CSS', test: ({ html }) => /class="[^"]*\b(?:flex|grid)\b[^"]*\b(?:items-center|justify-between|gap-\d)/.test(html) },
  { name: 'Google Analytics 4', test: ({ html }) => /gtag\/js\?id=G-|googletagmanager\.com\/gtag/.test(html) },
  { name: 'Google Tag Manager', test: ({ html }) => /googletagmanager\.com\/gtm\.js/.test(html) },
  { name: 'Cloudflare', test: ({ page }) => (page.headers.get('server') ?? '').toLowerCase().includes('cloudflare') },
  { name: 'Vercel', test: ({ page }) => page.headers.has('x-vercel-id') },
  { name: 'HubSpot', test: ({ html }) => /js\.hs-scripts\.com|hubspot/.test(html) },
  { name: 'Stripe', test: ({ html }) => /js\.stripe\.com/.test(html) },
];

interface HtmlLink {
  href: string;
  anchorText: string | null;
  isInternal: boolean;
  isNofollow: boolean;
}

function collectLinks(context: PageContext): HtmlLink[] {
  const { $, page } = context;
  const seen = new Map<string, HtmlLink>();

  $('a[href]').each((_, element) => {
    const $anchor = $(element);
    const resolved = resolveHref($anchor.attr('href') ?? '', page.finalUrl);
    if (!resolved || seen.has(resolved)) return;

    const rel = ($anchor.attr('rel') ?? '').toLowerCase();
    seen.set(resolved, {
      href: resolved,
      anchorText: $anchor.text().replace(/\s+/g, ' ').trim().slice(0, 160) || null,
      isInternal: isSameSite(resolved, page.finalUrl),
      isNofollow: rel.includes('nofollow'),
    });
  });

  return Array.from(seen.values());
}

/**
 * Probes a sample of links for broken targets.
 *
 * Internal links are prioritised: a broken link on your own site is your bug
 * and your problem, whereas an external 403 is often just a site that blocks
 * bots. Failures are swallowed per-link so one hanging host cannot fail the
 * whole audit.
 */
async function checkLinks(links: HtmlLink[]): Promise<DiscoveredLink[]> {
  const prioritised = [...links].sort((a, b) => Number(b.isInternal) - Number(a.isInternal));
  const toCheck = prioritised.slice(0, MAX_LINKS_CHECKED);
  const skipped = prioritised.slice(MAX_LINKS_CHECKED);

  const checked: DiscoveredLink[] = [];

  for (const batch of chunk(toCheck, LINK_BATCH_SIZE)) {
    const results = await Promise.all(
      batch.map(async (link): Promise<DiscoveredLink> => {
        const { status, ok } = await probeStatus(link.href, 7_000);
        return {
          ...link,
          statusCode: status,
          // A 401/403 from an external host is almost always bot protection,
          // not a dead link. Only count it as broken for our own domain.
          isBroken: !ok && (link.isInternal || status === null || status >= 404),
        };
      }),
    );
    checked.push(...results);
  }

  return [
    ...checked,
    ...skipped.map((link) => ({ ...link, statusCode: null, isBroken: false })),
  ];
}

export interface TechnicalOptions {
  /** Disable outbound link probing (used by the fast anonymous preview). */
  checkLinks?: boolean;
}

export async function analyzeTechnical(
  context: PageContext,
  options: TechnicalOptions = {},
): Promise<CategoryResult<TechnicalDetail>> {
  const { $, page } = context;
  const issues: AnalyzerIssue[] = [];
  const recommendations: AnalyzerRecommendation[] = [];

  const pageUrl = new URL(page.finalUrl);
  const httpsEnabled = pageUrl.protocol === 'https:';

  const htmlLinks = collectLinks(context);
  const links = options.checkLinks === false
    ? htmlLinks.map((link) => ({ ...link, statusCode: null, isBroken: false }))
    : await checkLinks(htmlLinks);

  const brokenLinks = links.filter((link) => link.isBroken);
  const internalLinks = links.filter((link) => link.isInternal).length;
  const externalLinks = links.length - internalLinks;
  const nofollowLinks = links.filter((link) => link.isNofollow).length;

  const scripts = $('script[src]').toArray();
  const inlineScripts = $('script:not([src])').toArray().filter((element) => $(element).attr('type') !== 'application/ld+json');
  const stylesheets = $('link[rel="stylesheet"]').toArray();

  // Render-blocking = a stylesheet, or a script in <head> without defer/async.
  const renderBlockingScripts = scripts.filter((element) => {
    const $script = $(element);
    if ($script.attr('defer') !== undefined || $script.attr('async') !== undefined) return false;
    if ($script.attr('type') === 'module') return false;
    return $script.parents('head').length > 0;
  });
  const renderBlockingCount = renderBlockingScripts.length + stylesheets.length;

  const canonicalUrl = $('link[rel="canonical"]').attr('href')?.trim() || null;
  let canonicalSelfReferencing: boolean | null = null;
  if (canonicalUrl) {
    try {
      const canonical = new URL(canonicalUrl, page.finalUrl);
      canonicalSelfReferencing =
        canonical.hostname.replace(/^www\./, '') === pageUrl.hostname.replace(/^www\./, '') &&
        canonical.pathname.replace(/\/$/, '') === pageUrl.pathname.replace(/\/$/, '');
    } catch {
      canonicalSelfReferencing = false;
    }
  }

  const probe: TechProbe = { $, page, html: page.html };
  const detectedTech = unique(
    TECH_SIGNATURES.filter((signature) => {
      // A single bad regex must not take down the whole analyzer.
      try {
        return signature.test(probe);
      } catch {
        return false;
      }
    }).map((signature) => signature.name),
  );

  // -------------------------------------------------------------------------
  // Findings
  // -------------------------------------------------------------------------

  if (!httpsEnabled) {
    issues.push({
      code: 'technical.https.missing',
      category: AuditCategory.TECHNICAL,
      severity: Severity.CRITICAL,
      title: 'The page is served over plain HTTP',
      description:
        'Browsers mark HTTP pages as "Not secure", anything typed into a form travels in the clear, and HTTPS has been a confirmed ranking signal for years.',
    });
    recommendations.push({
      category: AuditCategory.TECHNICAL,
      title: 'Move the site to HTTPS',
      explanation:
        'Install a TLS certificate (Let\'s Encrypt is free and automatable) and redirect all HTTP traffic to HTTPS with a 301.',
      expectedImpact:
        'Removes the browser security warning that scares visitors away, protects form submissions, and recovers a ranking signal.',
      difficulty: Difficulty.MEDIUM,
      estimatedMinutes: 120,
      priority: Priority.HIGH,
      impactScore: 100,
      kind: 'LONG_TERM',
    });
  }

  if (page.status >= 400) {
    issues.push({
      code: 'technical.status.error',
      category: AuditCategory.TECHNICAL,
      severity: Severity.CRITICAL,
      title: `The page returned HTTP ${page.status}`,
      description:
        'Visitors and search engines are receiving an error response rather than the page content.',
      evidence: page.finalUrl,
    });
  }

  if (page.redirectChain.length > 2) {
    issues.push({
      code: 'technical.redirects.chain',
      category: AuditCategory.TECHNICAL,
      severity: Severity.MEDIUM,
      title: `${page.redirectChain.length} redirects before the page loads`,
      description:
        'Every hop in a redirect chain adds a full round trip before anything renders, and each one leaks a little ranking authority.',
      evidence: page.redirectChain.join(' → '),
    });
    recommendations.push({
      category: AuditCategory.TECHNICAL,
      title: 'Collapse the redirect chain',
      explanation:
        'Point the first URL straight at the final destination so there is a single 301 instead of a chain.',
      expectedImpact: 'Removes several hundred milliseconds from the first load and preserves link equity.',
      difficulty: Difficulty.EASY,
      estimatedMinutes: 45,
      priority: Priority.MEDIUM,
      impactScore: impactScore({ severity: Severity.MEDIUM, difficulty: Difficulty.EASY, categoryWeight: CATEGORY_WEIGHTS.TECHNICAL }),
      kind: 'QUICK_WIN',
    });
  }

  if (brokenLinks.length > 0) {
    const brokenInternal = brokenLinks.filter((link) => link.isInternal);
    issues.push({
      code: 'technical.links.broken',
      category: AuditCategory.TECHNICAL,
      severity: brokenInternal.length > 0 ? Severity.HIGH : Severity.MEDIUM,
      title: `${brokenLinks.length} broken link${brokenLinks.length === 1 ? '' : 's'}`,
      description:
        'Broken links send visitors to dead ends and waste the crawl budget search engines allocate to your site.',
      evidence: brokenLinks
        .slice(0, 8)
        .map((link) => `${link.statusCode ?? 'unreachable'} — ${link.href}`)
        .join('\n'),
    });
    recommendations.push({
      category: AuditCategory.TECHNICAL,
      title: 'Fix or remove broken links',
      explanation: `${brokenLinks.length} link${brokenLinks.length === 1 ? '' : 's'} on this page do not resolve. Update the destinations, or remove the links if the target is gone for good.`,
      expectedImpact: 'Visitors stop hitting dead ends, and crawlers spend their budget on pages that exist.',
      difficulty: Difficulty.EASY,
      estimatedMinutes: Math.min(120, 10 * brokenLinks.length),
      priority: brokenInternal.length > 0 ? Priority.HIGH : Priority.MEDIUM,
      impactScore: impactScore({
        severity: brokenInternal.length > 0 ? Severity.HIGH : Severity.MEDIUM,
        difficulty: Difficulty.EASY,
        categoryWeight: CATEGORY_WEIGHTS.TECHNICAL,
      }),
      kind: 'QUICK_WIN',
    });
  }

  if (canonicalSelfReferencing === false) {
    issues.push({
      code: 'technical.canonical.cross-page',
      category: AuditCategory.TECHNICAL,
      severity: Severity.MEDIUM,
      title: 'Canonical tag points at a different page',
      description:
        'This page tells search engines the real version lives elsewhere, so it will usually be dropped from the index in favour of that URL. Deliberate for duplicates; damaging if not.',
      evidence: canonicalUrl ?? undefined,
    });
  }

  if (renderBlockingCount > 6) {
    issues.push({
      code: 'technical.assets.render-blocking',
      category: AuditCategory.TECHNICAL,
      severity: Severity.MEDIUM,
      title: `${renderBlockingCount} render-blocking resources`,
      description:
        'Each blocking stylesheet or head script must download and execute before the browser can paint anything, which directly delays what the visitor sees.',
    });
    recommendations.push({
      category: AuditCategory.TECHNICAL,
      title: 'Unblock the critical rendering path',
      explanation:
        'Add defer or async to head scripts that are not needed for first paint, inline the small amount of CSS required above the fold, and load the rest asynchronously.',
      expectedImpact: 'Typically the largest single improvement to First Contentful Paint on script-heavy pages.',
      difficulty: Difficulty.MEDIUM,
      estimatedMinutes: 180,
      priority: Priority.HIGH,
      impactScore: impactScore({ severity: Severity.HIGH, difficulty: Difficulty.MEDIUM, categoryWeight: CATEGORY_WEIGHTS.TECHNICAL }),
      kind: 'LONG_TERM',
    });
  }

  if (inlineScripts.length > 12) {
    issues.push({
      code: 'technical.assets.inline-scripts',
      category: AuditCategory.TECHNICAL,
      severity: Severity.LOW,
      title: `${inlineScripts.length} inline script blocks`,
      description:
        'Inline scripts cannot be cached between page loads and make a strict Content-Security-Policy impossible to adopt without nonces.',
    });
  }

  if (!$('meta[name="viewport"]').attr('content')) {
    issues.push({
      code: 'technical.viewport.missing',
      category: AuditCategory.TECHNICAL,
      severity: Severity.HIGH,
      title: 'No viewport meta tag',
      description:
        'Without a viewport tag, mobile browsers render the page at desktop width and zoom out, leaving text unreadably small. Google indexes mobile-first.',
    });
    recommendations.push({
      category: AuditCategory.TECHNICAL,
      title: 'Add the viewport meta tag',
      explanation:
        'Add <meta name="viewport" content="width=device-width, initial-scale=1"> to the document head.',
      expectedImpact:
        'The page starts rendering at the correct size on phones. On a site without it, this single line is the difference between usable and unusable on mobile.',
      difficulty: Difficulty.EASY,
      estimatedMinutes: 5,
      priority: Priority.HIGH,
      impactScore: 96,
      kind: 'QUICK_WIN',
    });
  }

  if (page.truncated) {
    issues.push({
      code: 'technical.html.oversized',
      category: AuditCategory.TECHNICAL,
      severity: Severity.MEDIUM,
      title: 'The HTML document is unusually large',
      description:
        'The document exceeded our 8 MB read limit. Very large HTML payloads delay parsing and usually indicate content that should be paginated or loaded on demand.',
    });
  }

  const detail: TechnicalDetail = {
    httpsEnabled,
    // Certificate details require a TLS handshake inspection that the fetch
    // API does not expose; a successful HTTPS response is itself proof the
    // chain validated, which is the part users care about.
    sslValid: httpsEnabled ? page.status > 0 : null,
    sslIssuer: null,
    sslExpiresAt: null,
    hstsEnabled: page.headers.has('strict-transport-security'),
    cspEnabled: page.headers.has('content-security-policy'),
    xFrameOptions: page.headers.has('x-frame-options'),
    xContentTypeOptions: page.headers.has('x-content-type-options'),
    referrerPolicy: page.headers.has('referrer-policy'),
    permissionsPolicy: page.headers.has('permissions-policy'),
    securityScore: 0, // filled in by the engine from the security analyzer
    statusCode: page.status,
    redirectCount: page.redirectChain.length,
    redirectChain: page.redirectChain,
    hasCanonical: Boolean(canonicalUrl),
    canonicalSelfReferencing,
    totalLinks: links.length,
    brokenLinks: brokenLinks.length,
    internalLinks,
    externalLinks,
    nofollowLinks,
    scriptCount: scripts.length,
    stylesheetCount: stylesheets.length,
    inlineScriptCount: inlineScripts.length,
    renderBlockingCount,
    detectedTech,
    links,
  };

  const score = scoreFromIssues(issues);

  return {
    category: AuditCategory.TECHNICAL,
    score,
    summary: buildSummary(score, detail),
    issues,
    recommendations: recommendations.map((recommendation) => ({
      ...recommendation,
      kind: isQuickWin(recommendation.difficulty, recommendation.estimatedMinutes) ? 'QUICK_WIN' : 'LONG_TERM',
    })),
    detail,
  };
}

function buildSummary(score: number, detail: TechnicalDetail): string {
  if (score >= 90) {
    return `Technically clean: HTTPS, ${detail.totalLinks} links with no broken targets, and a tidy asset graph.`;
  }
  if (score >= 70) {
    return `Mostly healthy. ${detail.brokenLinks > 0 ? `${detail.brokenLinks} broken link${detail.brokenLinks === 1 ? '' : 's'} and ` : ''}${detail.renderBlockingCount} render-blocking resources are the main things to tidy.`;
  }
  return `Technical problems are holding this page back — ${!detail.httpsEnabled ? 'no HTTPS, ' : ''}${detail.brokenLinks} broken link${detail.brokenLinks === 1 ? '' : 's'} and ${detail.redirectCount} redirect${detail.redirectCount === 1 ? '' : 's'} before the page loads.`;
}
