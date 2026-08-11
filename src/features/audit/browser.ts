import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

import { serverEnv } from '@/lib/env';
import { logger } from '@/lib/logger';
import { assertPublicUrl } from '@/lib/url';

import type { AxeResults, AxeViolation, BrowserSnapshot, CapturedScreenshot, VisualProfile } from './types';

/**
 * Headless-browser capture: axe-core, screenshots and a visual profile.
 *
 * Entirely optional. When `CHROMIUM_EXECUTABLE_PATH` is unset — or Chromium
 * fails to launch, which is common on constrained serverless runtimes — this
 * returns null and the engine proceeds with static analysis. That trade is
 * deliberate: a missing screenshot is a degraded report, but a browser launch
 * failure taking down every audit would be an outage.
 *
 * `puppeteer-core` is imported dynamically so the dependency is never pulled
 * into a bundle that doesn't use it.
 */

const log = logger.child({ module: 'audit/browser' });

const NAVIGATION_TIMEOUT_MS = 30_000;
const AXE_TIMEOUT_MS = 30_000;
const TOTAL_BUDGET_MS = 70_000;

const VIEWPORTS = {
  DESKTOP: { width: 1440, height: 900, isMobile: false, deviceScaleFactor: 1 },
  MOBILE: { width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 },
} as const;

export function browserAvailable(): boolean {
  return Boolean(serverEnv().CHROMIUM_EXECUTABLE_PATH);
}

/** Reads the axe-core browser bundle off disk so it can be injected inline. */
async function loadAxeSource(): Promise<string> {
  const require = createRequire(import.meta.url);
  const axePath = require.resolve('axe-core/axe.min.js');
  return readFile(axePath, 'utf8');
}

interface RawAxeResult {
  violations: Array<{
    id: string;
    impact: string | null;
    help: string;
    description: string;
    helpUrl: string;
    tags: string[];
    nodes: Array<{ target: string[]; html: string; failureSummary?: string }>;
  }>;
  passes: unknown[];
  incomplete: unknown[];
}

function normalizeAxe(raw: RawAxeResult): AxeResults {
  const violations: AxeViolation[] = raw.violations.map((violation) => ({
    id: violation.id,
    impact: (violation.impact as AxeViolation['impact']) ?? null,
    help: violation.help,
    description: violation.description,
    helpUrl: violation.helpUrl,
    tags: violation.tags,
    // Keep a handful of examples per rule: enough to point a developer at the
    // problem, not so many that a page with 500 unlabelled inputs blows up the
    // JSONB column.
    nodes: violation.nodes.slice(0, 5).map((node) => ({
      target: node.target,
      html: node.html.slice(0, 500),
      failureSummary: node.failureSummary?.slice(0, 500),
    })),
  }));

  return {
    violations,
    passes: raw.passes.length,
    incomplete: raw.incomplete.length,
  };
}

export interface CaptureOptions {
  device: 'MOBILE' | 'DESKTOP';
  /** Screenshots roughly double the run time; skipped for the free preview. */
  captureScreenshots?: boolean;
  runAxe?: boolean;
}

export async function captureWithBrowser(
  targetUrl: string,
  options: CaptureOptions,
): Promise<BrowserSnapshot | null> {
  const executablePath = serverEnv().CHROMIUM_EXECUTABLE_PATH;
  if (!executablePath) return null;

  const safe = assertPublicUrl(targetUrl);
  const deadline = Date.now() + TOTAL_BUDGET_MS;

  let browser: Awaited<ReturnType<typeof import('puppeteer-core').launch>> | null = null;

  try {
    const puppeteer = await import('puppeteer-core');

    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--hide-scrollbars',
        '--mute-audio',
        // The page under audit is untrusted; keep it away from anything local.
        '--disable-extensions',
        '--no-first-run',
      ],
      timeout: 20_000,
    });

    const page = await browser.newPage();
    const viewport = VIEWPORTS[options.device];
    await page.setViewport(viewport);
    await page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
    await page.setJavaScriptEnabled(true);

    let transferredBytes = 0;
    let requestCount = 0;
    page.on('response', (response) => {
      requestCount += 1;
      const length = Number(response.headers()['content-length'] ?? 0);
      if (Number.isFinite(length)) transferredBytes += length;
    });

    // `networkidle2` rather than `load`: SPAs finish loading long after the
    // load event, and their real content only exists after hydration.
    await page.goto(safe.normalized, { waitUntil: 'networkidle2', timeout: NAVIGATION_TIMEOUT_MS });

    const metrics = await collectMetrics(page);
    const visual = await collectVisualProfile(page);
    const renderedHtml = await page.content().catch(() => null);

    let axe: AxeResults | null = null;
    if (options.runAxe !== false && Date.now() < deadline) {
      axe = await runAxe(page);
    }

    const screenshots: CapturedScreenshot[] = [];
    if (options.captureScreenshots && Date.now() < deadline) {
      screenshots.push(...(await captureScreenshots(page, options.device, viewport)));
    }

    return {
      axe,
      screenshots,
      renderedHtml: renderedHtml ? renderedHtml.slice(0, 2_000_000) : null,
      metrics: { ...metrics, transferredBytes, requestCount },
      visual,
    };
  } catch (error) {
    log.warn('browser capture failed; continuing with static analysis', { url: targetUrl, error });
    return null;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

type PuppeteerPage = Awaited<
  ReturnType<Awaited<ReturnType<typeof import('puppeteer-core').launch>>['newPage']>
>;

async function collectMetrics(page: PuppeteerPage): Promise<BrowserSnapshot['metrics']> {
  try {
    return await page.evaluate(() => {
      const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      const paints = performance.getEntriesByType('paint');
      const fcp = paints.find((entry) => entry.name === 'first-contentful-paint');

      // LCP is only exposed through the buffered observer entries.
      const lcpEntries = performance.getEntriesByType('largest-contentful-paint');
      const lcp = lcpEntries.length > 0 ? lcpEntries[lcpEntries.length - 1] : undefined;

      return {
        domContentLoadedMs: navigation?.domContentLoadedEventEnd,
        loadMs: navigation?.loadEventEnd,
        firstContentfulPaintMs: fcp?.startTime,
        largestContentfulPaintMs: lcp?.startTime,
      };
    });
  } catch {
    return {};
  }
}

/**
 * Samples computed styles to build the palette and type inventory the AI
 * design analysis reasons about. Reading actual computed values is the point —
 * the CSS source may define fifty colours of which the page uses four.
 */
async function collectVisualProfile(page: PuppeteerPage): Promise<VisualProfile | null> {
  try {
    return await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('body *')).slice(0, 2500);

      const tally = (values: string[]) => {
        const counts = new Map<string, number>();
        for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
        return Array.from(counts.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([value]) => value);
      };

      const colors: string[] = [];
      const backgrounds: string[] = [];
      const families: string[] = [];
      const sizes: number[] = [];
      const radii: string[] = [];

      for (const element of elements) {
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') continue;

        if (element.textContent?.trim()) colors.push(style.color);

        const background = style.backgroundColor;
        if (background && background !== 'rgba(0, 0, 0, 0)' && background !== 'transparent') {
          backgrounds.push(background);
        }

        families.push(style.fontFamily.split(',')[0].replace(/["']/g, '').trim());

        const size = parseFloat(style.fontSize);
        if (Number.isFinite(size)) sizes.push(Math.round(size));

        if (style.borderRadius && style.borderRadius !== '0px') radii.push(style.borderRadius);
      }

      return {
        colors: tally(colors).slice(0, 12),
        backgroundColors: tally(backgrounds).slice(0, 12),
        fontFamilies: tally(families).slice(0, 8),
        fontSizes: Array.from(new Set(sizes)).sort((a, b) => a - b),
        borderRadii: tally(radii).slice(0, 8),
        buttonCount: document.querySelectorAll('button, [role="button"], input[type="submit"]').length,
        formCount: document.querySelectorAll('form').length,
        imageCount: document.images.length,
        headingCount: document.querySelectorAll('h1,h2,h3,h4,h5,h6').length,
        viewportWidth: window.innerWidth,
        documentHeight: document.documentElement.scrollHeight,
      };
    });
  } catch {
    return null;
  }
}

async function runAxe(page: PuppeteerPage): Promise<AxeResults | null> {
  try {
    const axeSource = await loadAxeSource();
    await page.evaluate(axeSource);

    const raw = (await Promise.race([
      page.evaluate(async () => {
        const axe = (window as unknown as { axe: { run: (options: unknown) => Promise<unknown> } }).axe;
        return axe.run({
          runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
          resultTypes: ['violations', 'passes', 'incomplete'],
        });
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('axe timeout')), AXE_TIMEOUT_MS)),
    ])) as RawAxeResult;

    return normalizeAxe(raw);
  } catch (error) {
    log.warn('axe-core run failed', { error });
    return null;
  }
}

async function captureScreenshots(
  page: PuppeteerPage,
  device: 'MOBILE' | 'DESKTOP',
  viewport: { width: number; height: number },
): Promise<CapturedScreenshot[]> {
  const shots: CapturedScreenshot[] = [];

  try {
    const viewportShot = await page.screenshot({ type: 'webp', quality: 80, fullPage: false, encoding: 'base64' });
    shots.push({
      kind: device === 'MOBILE' ? 'MOBILE_VIEWPORT' : 'DESKTOP_VIEWPORT',
      url: `data:image/webp;base64,${viewportShot}`,
      width: viewport.width,
      height: viewport.height,
      bytes: Math.round((viewportShot as string).length * 0.75),
    });
  } catch (error) {
    log.debug('viewport screenshot failed', { error });
  }

  try {
    // Full-page shots on infinite-scroll sites can be enormous; cap the height.
    const height = await page.evaluate(() => Math.min(document.documentElement.scrollHeight, 6000));
    const fullShot = await page.screenshot({
      type: 'webp',
      quality: 70,
      fullPage: false,
      clip: { x: 0, y: 0, width: viewport.width, height },
      encoding: 'base64',
    });
    shots.push({
      kind: device === 'MOBILE' ? 'MOBILE_FULL' : 'DESKTOP_FULL',
      url: `data:image/webp;base64,${fullShot}`,
      width: viewport.width,
      height,
      bytes: Math.round((fullShot as string).length * 0.75),
    });
  } catch (error) {
    log.debug('full-page screenshot failed', { error });
  }

  return shots;
}
