import * as cheerio from 'cheerio';

import { extractText } from '@/features/audit/fetch-page';
import type { PageContext } from '@/features/audit/types';

/**
 * Page fixtures for analyzer tests.
 *
 * Analyzers are pure functions of a `PageContext`, so a fixture is just HTML
 * plus headers — no network, no database, no browser. That is the whole point
 * of the analyzer contract, and these helpers are what make it pay off.
 */

export function makeContext(
  html: string,
  options: {
    url?: string;
    status?: number;
    headers?: Record<string, string>;
    redirectChain?: string[];
    robotsTxt?: PageContext['robotsTxt'];
    sitemap?: PageContext['sitemap'];
    browser?: PageContext['browser'];
    device?: 'MOBILE' | 'DESKTOP';
  } = {},
): PageContext {
  const {
    url = 'https://example.com/',
    status = 200,
    headers = {},
    redirectChain = [],
    robotsTxt = { found: true, url: 'https://example.com/robots.txt', content: '', sitemaps: [], blocksEverything: false },
    sitemap = { found: true, url: 'https://example.com/sitemap.xml', urlCount: 10, isIndex: false },
    browser = null,
    device = 'MOBILE',
  } = options;

  const $ = cheerio.load(html);

  return {
    page: {
      finalUrl: url,
      requestedUrl: url,
      status,
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8', ...headers }),
      html,
      bytes: Buffer.byteLength(html),
      redirectChain,
      timingMs: 180,
      truncated: false,
    },
    $,
    text: extractText($),
    robotsTxt,
    sitemap,
    browser,
    device,
  };
}

/** A well-built page: everything an analyzer checks for is present. */
export const HEALTHY_PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Handmade Leather Wallets — Northgate Goods</title>
  <meta name="description" content="Full-grain leather wallets, cut and stitched by hand in Bristol. Free UK delivery, 30-day returns and lifetime repairs on every order.">
  <link rel="canonical" href="https://example.com/">
  <meta property="og:title" content="Handmade Leather Wallets">
  <meta property="og:description" content="Hand-stitched full-grain leather.">
  <meta property="og:image" content="https://example.com/og.png">
  <meta name="twitter:card" content="summary_large_image">
  <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"Organization","name":"Northgate Goods"}
  </script>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <header><nav><a href="/">Home</a> <a href="/shop">Shop</a> <a href="/about">About</a></nav></header>
  <main>
    <h1>Handmade leather wallets built to last a decade</h1>
    <p>Every wallet is cut from a single piece of full-grain leather and stitched by hand in our Bristol workshop. We have been making them the same way since 2009, and we will repair yours free for as long as you own it.</p>
    <h2>Why full-grain leather</h2>
    <p>Full-grain keeps the outermost layer of the hide intact, which is the part that carries the tight fibre structure. It resists wear rather than flaking, and it develops a patina instead of looking tired. Cheaper wallets use corrected grain, which is sanded and stamped to hide flaws — it looks uniform on day one and looks worn out by month six.</p>
    <h2>What comes with every order</h2>
    <p>Free UK delivery, a 30-day return window with no questions asked, and lifetime repairs. If a stitch goes, send it back and we will fix it.</p>
    <h3>Customer testimonials</h3>
    <p>Read what our customers say about their wallets after three years of daily use. Our privacy policy and terms of service are linked below, and you can reach us on 0117 496 0000 or at hello@example.com.</p>
    <img src="/wallet.jpg" alt="A brown leather bifold wallet, open to show six card slots">
    <img src="/decorative-line.svg" alt="">
    <form>
      <label for="email">Email address</label>
      <input id="email" type="email" name="email">
      <button type="submit">Get 10% off your first order</button>
    </form>
    <a href="/shop" class="cta">Buy now</a>
  </main>
  <footer>
    <a href="/privacy">Privacy policy</a>
    <a href="/terms">Terms of service</a>
    <a href="https://partner.example.org">Our leather supplier</a>
  </footer>
</body>
</html>`;

/** A page failing most of what the analyzers check. */
export const BROKEN_PAGE = `<!doctype html>
<html>
<head>
  <script src="/a.js"></script>
  <script src="/b.js"></script>
  <script src="/c.js"></script>
  <script type="application/ld+json">{ this is not valid json }</script>
</head>
<body>
  <div onclick="doThing()">Click me</div>
  <img src="/hero.jpg">
  <img src="/two.jpg">
  <img src="/three.jpg">
  <form>
    <input type="text" name="q" placeholder="Search">
    <input type="email" name="email" placeholder="Email">
  </form>
  <button></button>
  <a href="/somewhere"></a>
  <h2>A subheading with no H1 above it</h2>
  <h4>And a heading level skipped entirely</h4>
  <p>Short.</p>
</body>
</html>`;

export const NOINDEX_PAGE = `<!doctype html>
<html lang="en">
<head>
  <title>Staging environment — do not index</title>
  <meta name="robots" content="noindex, nofollow">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body><h1>Staging</h1><p>Nothing to see here.</p></body>
</html>`;

/** Response headers for a fully hardened origin. */
export const SECURE_HEADERS = {
  'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
  'content-security-policy': "default-src 'self'",
  'x-frame-options': 'SAMEORIGIN',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=()',
};
