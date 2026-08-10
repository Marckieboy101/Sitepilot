import * as cheerio from 'cheerio';

import { logger } from '@/lib/logger';
import { MOBILE_USER_AGENT, USER_AGENT, safeFetch } from '@/lib/http';
import { assertPublicUrl } from '@/lib/url';

import type { FetchedPage, PageContext, RobotsTxt, SitemapInfo } from './types';

const log = logger.child({ module: 'audit/fetch-page' });

/**
 * Builds the `PageContext` every analyzer reads from.
 *
 * The page itself is required; robots.txt and the sitemap are best-effort —
 * a site that 404s its robots.txt is a finding, not a reason to abort the run.
 */

/** Chrome's own DOM-content extraction ignores these entirely. */
const NON_CONTENT_SELECTORS = 'script, style, noscript, template, svg, iframe, object';

export async function fetchPage(
  targetUrl: string,
  options: { device?: 'MOBILE' | 'DESKTOP'; signal?: AbortSignal } = {},
): Promise<FetchedPage> {
  const { device = 'MOBILE', signal } = options;
  const safe = assertPublicUrl(targetUrl);

  const response = await safeFetch(safe.normalized, {
    headers: { 'User-Agent': device === 'MOBILE' ? MOBILE_USER_AGENT : USER_AGENT },
    timeoutMs: 25_000,
    signal,
  });

  const contentType = response.headers.get('content-type') ?? '';
  if (response.body && !/text\/html|application\/xhtml/i.test(contentType) && response.status < 400) {
    log.warn('non-HTML content type', { url: safe.normalized, contentType });
  }

  return {
    finalUrl: response.url,
    requestedUrl: safe.normalized,
    status: response.status,
    headers: response.headers,
    html: response.body,
    bytes: response.bytes,
    redirectChain: response.redirectChain,
    timingMs: response.timingMs,
    truncated: response.truncated,
  };
}

export async function fetchRobotsTxt(pageUrl: string): Promise<RobotsTxt | null> {
  const robotsUrl = new URL('/robots.txt', pageUrl).toString();

  try {
    const response = await safeFetch(robotsUrl, { timeoutMs: 8_000, maxBytes: 512 * 1024 });

    if (response.status >= 400) {
      return { found: false, url: robotsUrl, content: '', sitemaps: [], blocksEverything: false };
    }

    const content = response.body;
    const sitemaps = Array.from(content.matchAll(/^\s*sitemap:\s*(\S+)/gim)).map((match) => match[1]);

    return {
      found: true,
      url: robotsUrl,
      content: content.slice(0, 20_000),
      sitemaps,
      blocksEverything: blocksAllCrawlers(content),
    };
  } catch (error) {
    log.debug('robots.txt fetch failed', { url: robotsUrl, error });
    return null;
  }
}

/**
 * Detects a site-wide crawl block.
 *
 * Only the `*` group and our own agent matter — a `Disallow: /` under
 * `User-agent: AhrefsBot` is a deliberate scraper block, not an SEO problem,
 * and flagging it would be a false positive on a great many healthy sites.
 */
function blocksAllCrawlers(content: string): boolean {
  const lines = content.split(/\r?\n/).map((line) => line.replace(/#.*$/, '').trim());

  let inRelevantGroup = false;
  let groupHasBlanketDisallow = false;

  for (const line of lines) {
    const agentMatch = /^user-agent:\s*(.+)$/i.exec(line);
    if (agentMatch) {
      const agent = agentMatch[1].trim().toLowerCase();
      // A new group starts; reset unless it's a continuation of agent lines.
      if (!inRelevantGroup || groupHasBlanketDisallow) groupHasBlanketDisallow = false;
      inRelevantGroup = agent === '*' || agent.includes('sitepilot') || agent === 'googlebot';
      continue;
    }

    if (!inRelevantGroup) continue;

    const disallowMatch = /^disallow:\s*(.*)$/i.exec(line);
    if (disallowMatch && disallowMatch[1].trim() === '/') groupHasBlanketDisallow = true;

    const allowMatch = /^allow:\s*(.*)$/i.exec(line);
    if (allowMatch && allowMatch[1].trim() === '/') groupHasBlanketDisallow = false;
  }

  return groupHasBlanketDisallow;
}

export async function fetchSitemap(
  pageUrl: string,
  robots: RobotsTxt | null,
): Promise<SitemapInfo | null> {
  // Prefer whatever robots.txt declares; fall back to the conventional path.
  const candidates = [
    ...(robots?.sitemaps ?? []),
    new URL('/sitemap.xml', pageUrl).toString(),
    new URL('/sitemap_index.xml', pageUrl).toString(),
  ];

  for (const candidate of candidates.slice(0, 3)) {
    try {
      const response = await safeFetch(candidate, { timeoutMs: 8_000, maxBytes: 2 * 1024 * 1024 });
      if (response.status >= 400 || !response.body.includes('<')) continue;

      const isIndex = /<sitemapindex/i.test(response.body);
      const urlCount = (response.body.match(/<loc>/gi) ?? []).length;

      return { found: true, url: candidate, urlCount, isIndex };
    } catch {
      continue;
    }
  }

  return { found: false, url: candidates[candidates.length - 1], urlCount: 0, isIndex: false };
}

/** Visible text, with chrome stripped and whitespace collapsed. */
export function extractText($: cheerio.CheerioAPI): string {
  const $body = $('body').clone();
  $body.find(NON_CONTENT_SELECTORS).remove();
  return $body.text().replace(/\s+/g, ' ').trim();
}

export interface BuildContextOptions {
  device?: 'MOBILE' | 'DESKTOP';
  includeRobots?: boolean;
  signal?: AbortSignal;
}

/**
 * Fetches the page and its crawl metadata in parallel and assembles the
 * analyzer context.
 */
export async function buildPageContext(
  targetUrl: string,
  options: BuildContextOptions = {},
): Promise<PageContext> {
  const { device = 'MOBILE', includeRobots = true, signal } = options;

  const page = await fetchPage(targetUrl, { device, signal });

  const robotsTxt = includeRobots ? await fetchRobotsTxt(page.finalUrl) : null;
  const sitemap = includeRobots ? await fetchSitemap(page.finalUrl, robotsTxt) : null;

  const $ = cheerio.load(page.html);

  return {
    page,
    $,
    text: extractText($),
    robotsTxt,
    sitemap,
    browser: null,
    device,
  };
}
