import { serverEnv } from '@/lib/env';
import { logger } from '@/lib/logger';

/**
 * HTML → PDF.
 *
 * The document is handed to Chromium via `setContent`, never a URL, so the
 * browser needs no session and no network access to our origin. `waitUntil`
 * is deliberately not `networkidle` — the document is fully self-contained,
 * so there is nothing to wait for and the idle timer would only add seconds.
 */

const log = logger.child({ module: 'reports/pdf' });

export function pdfGenerationAvailable(): boolean {
  return Boolean(serverEnv().CHROMIUM_EXECUTABLE_PATH);
}

export async function htmlToPdf(html: string): Promise<Buffer | null> {
  const executablePath = serverEnv().CHROMIUM_EXECUTABLE_PATH;
  if (!executablePath) return null;

  let browser: Awaited<ReturnType<typeof import('puppeteer-core').launch>> | null = null;

  try {
    const puppeteer = await import('puppeteer-core');

    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      timeout: 20_000,
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    // Backgrounds and coloured badges are meaningful here, not decoration.
    await page.emulateMediaType('print');

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '16mm', right: '14mm', bottom: '16mm', left: '14mm' },
      timeout: 45_000,
    });

    return Buffer.from(pdf);
  } catch (error) {
    log.error('PDF generation failed', { error });
    return null;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

/** Filename-safe slug for the download. */
export function pdfFilename(url: string, date: Date): string {
  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return 'report';
    }
  })();

  const stamp = date.toISOString().slice(0, 10);
  return `sitepilot-audit-${host.replace(/[^a-z0-9.-]/gi, '-')}-${stamp}.pdf`;
}
