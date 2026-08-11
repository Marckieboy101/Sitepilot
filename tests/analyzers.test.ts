import { Severity } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { analyzeAccessibility } from '@/features/audit/analyzers/accessibility';
import { analyzeContent, fleschReadingEase } from '@/features/audit/analyzers/content';
import { analyzeSecurity } from '@/features/audit/analyzers/security';
import { analyzeSeo, keywordDensity } from '@/features/audit/analyzers/seo';
import { analyzeTechnical } from '@/features/audit/analyzers/technical';

import { BROKEN_PAGE, HEALTHY_PAGE, NOINDEX_PAGE, SECURE_HEADERS, makeContext } from './fixtures';

/** Convenience: does the result contain an issue with this rule code? */
function hasIssue(issues: Array<{ code: string }>, code: string): boolean {
  return issues.some((issue) => issue.code === code);
}

describe('analyzeSeo', () => {
  it('scores a well-built page highly and finds no critical issues', () => {
    const result = analyzeSeo(makeContext(HEALTHY_PAGE));

    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.issues.filter((issue) => issue.severity === Severity.CRITICAL)).toHaveLength(0);
    expect(result.detail.title).toContain('Handmade Leather Wallets');
    expect(result.detail.h1Count).toBe(1);
    expect(result.detail.hasOpenGraph).toBe(true);
    expect(result.detail.hasStructuredData).toBe(true);
    expect(result.detail.structuredDataTypes).toContain('Organization');
    expect(result.detail.indexable).toBe(true);
  });

  it('does not flag a decorative image with alt=""', () => {
    // HEALTHY_PAGE has one content image with alt and one decorative alt="".
    const result = analyzeSeo(makeContext(HEALTHY_PAGE));
    expect(result.detail.imageCount).toBe(2);
    expect(result.detail.imagesMissingAlt).toBe(0);
  });

  it('catches the full set of failures on a broken page', () => {
    const result = analyzeSeo(makeContext(BROKEN_PAGE));

    expect(result.score).toBeLessThan(50);
    expect(hasIssue(result.issues, 'seo.title.missing')).toBe(true);
    expect(hasIssue(result.issues, 'seo.description.missing')).toBe(true);
    expect(hasIssue(result.issues, 'seo.h1.missing')).toBe(true);
    expect(hasIssue(result.issues, 'seo.canonical.missing')).toBe(true);
    expect(hasIssue(result.issues, 'seo.lang.missing')).toBe(true);
    expect(hasIssue(result.issues, 'seo.opengraph.missing')).toBe(true);
    expect(hasIssue(result.issues, 'seo.images.missing-alt')).toBe(true);
    expect(hasIssue(result.issues, 'seo.structured-data.invalid')).toBe(true);
  });

  it('treats noindex as critical and marks the page unindexable', () => {
    const result = analyzeSeo(makeContext(NOINDEX_PAGE));

    expect(result.detail.indexable).toBe(false);
    const noindex = result.issues.find((issue) => issue.code === 'seo.indexability.noindex');
    expect(noindex?.severity).toBe(Severity.CRITICAL);
    expect(result.summary).toContain('blocked from search engines');
  });

  it('honours X-Robots-Tag as well as the meta tag', () => {
    const result = analyzeSeo(
      makeContext(HEALTHY_PAGE, { headers: { 'x-robots-tag': 'noindex' } }),
    );
    expect(result.detail.indexable).toBe(false);
  });

  it('detects a robots.txt that blocks every crawler', () => {
    const result = analyzeSeo(
      makeContext(HEALTHY_PAGE, {
        robotsTxt: {
          found: true,
          url: 'https://example.com/robots.txt',
          content: 'User-agent: *\nDisallow: /',
          sitemaps: [],
          blocksEverything: true,
        },
      }),
    );

    expect(hasIssue(result.issues, 'seo.robots.blocks-all')).toBe(true);
    expect(result.detail.indexable).toBe(false);
  });

  it('produces a recommendation for every high-severity issue it raises', () => {
    const result = analyzeSeo(makeContext(BROKEN_PAGE));
    const severe = result.issues.filter(
      (issue) => issue.severity === Severity.CRITICAL || issue.severity === Severity.HIGH,
    );
    // Not one-to-one, but a page this broken must yield actionable output.
    expect(severe.length).toBeGreaterThan(0);
    expect(result.recommendations.length).toBeGreaterThan(0);
  });
});

describe('keywordDensity', () => {
  it('excludes stop words and ranks by frequency', () => {
    const result = keywordDensity('leather leather leather wallet wallet the the the and of a');
    expect(result[0].term).toBe('leather');
    expect(result[0].count).toBe(3);
    expect(result.map((entry) => entry.term)).not.toContain('the');
  });

  it('returns an empty list for empty text', () => {
    expect(keywordDensity('')).toEqual([]);
  });
});

describe('analyzeSecurity', () => {
  it('gives a fully hardened HTTPS origin a top score', () => {
    const result = analyzeSecurity(makeContext(HEALTHY_PAGE, { headers: SECURE_HEADERS }));
    expect(result.score).toBe(100);
    expect(result.issues).toHaveLength(0);
  });

  it('scores an HTTPS page with no headers well below a hardened one', () => {
    const bare = analyzeSecurity(makeContext(HEALTHY_PAGE));
    const hardened = analyzeSecurity(makeContext(HEALTHY_PAGE, { headers: SECURE_HEADERS }));

    expect(bare.score).toBeLessThan(hardened.score);
    expect(hasIssue(bare.issues, 'security.hsts')).toBe(true);
    expect(hasIssue(bare.issues, 'security.csp')).toBe(true);
  });

  it('treats missing HTTPS as the dominant failure', () => {
    const http = analyzeSecurity(makeContext(HEALTHY_PAGE, { url: 'http://example.com/' }));
    const https = analyzeSecurity(makeContext(HEALTHY_PAGE));

    expect(http.score).toBeLessThan(https.score);
    const httpsIssue = http.issues.find((issue) => issue.code === 'security.https');
    expect(httpsIssue?.severity).toBe(Severity.CRITICAL);
  });

  it('accepts CSP frame-ancestors in place of X-Frame-Options', () => {
    const result = analyzeSecurity(
      makeContext(HEALTHY_PAGE, {
        headers: { 'content-security-policy': "default-src 'self'; frame-ancestors 'self'" },
      }),
    );
    expect(hasIssue(result.issues, 'security.x-frame-options')).toBe(false);
  });

  it('flags mixed content on an HTTPS page', () => {
    const result = analyzeSecurity(
      makeContext('<html><body><script src="http://cdn.example.org/a.js"></script></body></html>'),
    );
    expect(hasIssue(result.issues, 'security.mixed-content')).toBe(true);
  });
});

describe('analyzeTechnical', () => {
  // Link probing is disabled throughout — these tests must never touch the
  // network, and link health is the one part that would.
  const options = { checkLinks: false } as const;

  it('reports a healthy page as technically sound', async () => {
    const result = await analyzeTechnical(makeContext(HEALTHY_PAGE), options);

    expect(result.detail.httpsEnabled).toBe(true);
    expect(result.detail.hasCanonical).toBe(true);
    expect(result.detail.canonicalSelfReferencing).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(80);
  });

  it('flags a missing viewport tag as high severity', async () => {
    const result = await analyzeTechnical(makeContext(BROKEN_PAGE), options);
    const viewport = result.issues.find((issue) => issue.code === 'technical.viewport.missing');
    expect(viewport?.severity).toBe(Severity.HIGH);
  });

  it('treats plain HTTP as critical', async () => {
    const result = await analyzeTechnical(
      makeContext(HEALTHY_PAGE, { url: 'http://example.com/' }),
      options,
    );
    const issue = result.issues.find((entry) => entry.code === 'technical.https.missing');
    expect(issue?.severity).toBe(Severity.CRITICAL);
  });

  it('flags a long redirect chain', async () => {
    const result = await analyzeTechnical(
      makeContext(HEALTHY_PAGE, {
        redirectChain: ['http://example.com', 'https://example.com', 'https://www.example.com'],
      }),
      options,
    );
    expect(hasIssue(result.issues, 'technical.redirects.chain')).toBe(true);
    expect(result.detail.redirectCount).toBe(3);
  });

  it('separates internal from external links', async () => {
    const result = await analyzeTechnical(makeContext(HEALTHY_PAGE), options);
    expect(result.detail.internalLinks).toBeGreaterThan(0);
    expect(result.detail.externalLinks).toBe(1); // partner.example.org
  });

  it('detects a canonical pointing elsewhere', async () => {
    const html = HEALTHY_PAGE.replace(
      '<link rel="canonical" href="https://example.com/">',
      '<link rel="canonical" href="https://other.com/page">',
    );
    const result = await analyzeTechnical(makeContext(html), options);

    expect(result.detail.canonicalSelfReferencing).toBe(false);
    expect(hasIssue(result.issues, 'technical.canonical.cross-page')).toBe(true);
  });

  it('reports a 5xx status as critical', async () => {
    const result = await analyzeTechnical(makeContext(HEALTHY_PAGE, { status: 503 }), options);
    const issue = result.issues.find((entry) => entry.code === 'technical.status.error');
    expect(issue?.severity).toBe(Severity.CRITICAL);
  });
});

describe('analyzeAccessibility', () => {
  it('caps a static-only scan below a perfect score', () => {
    // No browser means no axe run, so contrast and computed styles were never
    // tested — a clean result must not read as a clean bill of health.
    const result = analyzeAccessibility(makeContext(HEALTHY_PAGE));

    expect(result.score).toBeLessThanOrEqual(92);
    expect(result.summary).toContain('Partial scan');
  });

  it('finds unlabelled fields and unnamed controls on a broken page', () => {
    const result = analyzeAccessibility(makeContext(BROKEN_PAGE));

    expect(result.detail.missingFormLabels).toBeGreaterThan(0);
    expect(result.detail.missingAriaLabels).toBeGreaterThan(0);
    expect(result.detail.missingAltText).toBe(3);
    expect(result.detail.keyboardIssues).toBeGreaterThan(0);
    expect(result.detail.headingOrderIssues).toBeGreaterThan(0);
  });

  it('counts a field wrapped in its own label as labelled', () => {
    const html = '<html><body><form><label>Email <input type="email"></label></form></body></html>';
    const result = analyzeAccessibility(makeContext(html));
    expect(result.detail.missingFormLabels).toBe(0);
  });

  it('uses axe results when a browser snapshot is present', () => {
    const result = analyzeAccessibility(
      makeContext(HEALTHY_PAGE, {
        browser: {
          axe: {
            violations: [
              {
                id: 'color-contrast',
                impact: 'serious',
                help: 'Elements must have sufficient colour contrast',
                description: 'Text needs a contrast ratio of at least 4.5:1.',
                helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast',
                tags: ['wcag2aa', 'wcag143'],
                nodes: [{ target: ['.hero p'], html: '<p>low contrast</p>' }],
              },
            ],
            passes: 42,
            incomplete: 3,
          },
          screenshots: [],
          renderedHtml: null,
          metrics: {},
          visual: null,
        },
      }),
    );

    expect(result.detail.violationCount).toBe(1);
    expect(result.detail.contrastIssues).toBe(1);
    expect(result.detail.seriousCount).toBe(1);
    expect(result.summary).not.toContain('Partial scan');
    expect(result.recommendations.some((rec) => rec.title.includes('contrast'))).toBe(true);
  });

  it('does not report the same problem twice when axe already covers it', () => {
    const result = analyzeAccessibility(
      makeContext(BROKEN_PAGE, {
        browser: {
          axe: {
            violations: [
              {
                id: 'image-alt',
                impact: 'critical',
                help: 'Images must have alternate text',
                description: 'Images need alt text.',
                helpUrl: 'https://example.com/rule',
                tags: ['wcag2a'],
                nodes: [{ target: ['img'], html: '<img src="/hero.jpg">' }],
              },
            ],
            passes: 10,
            incomplete: 0,
          },
          screenshots: [],
          renderedHtml: null,
          metrics: {},
          visual: null,
        },
      }),
    );

    const altIssues = result.issues.filter((issue) => issue.code.includes('image-alt'));
    expect(altIssues).toHaveLength(1);
  });
});

describe('analyzeContent', () => {
  it('recognises calls to action and trust signals on a healthy page', () => {
    const result = analyzeContent(makeContext(HEALTHY_PAGE));

    expect(result.detail.hasCallToAction).toBe(true);
    expect(result.detail.ctaLabels.length).toBeGreaterThan(0);
    expect(result.detail.trustSignals.length).toBeGreaterThanOrEqual(2);
    expect(result.detail.wordCount).toBeGreaterThan(150);
  });

  it('flags a page with no call to action', () => {
    const result = analyzeContent(makeContext(BROKEN_PAGE));
    expect(hasIssue(result.issues, 'content.cta.missing')).toBe(true);
    expect(result.score).toBeLessThan(80);
  });

  it('flags generic CTA wording', () => {
    const html = '<html><body><p>Some text here about things.</p><button>Submit</button></body></html>';
    const result = analyzeContent(makeContext(html));
    expect(hasIssue(result.issues, 'content.cta.generic')).toBe(true);
  });

  it('does not treat prose containing "subscribe" as a CTA', () => {
    const html = '<html><body><p>Many people subscribe to newsletters these days.</p></body></html>';
    const result = analyzeContent(makeContext(html));
    expect(result.detail.hasCallToAction).toBe(false);
  });
});

describe('fleschReadingEase', () => {
  it('scores plain writing higher than dense writing', () => {
    // Both samples need 50+ words and 3+ sentences, or the function correctly
    // refuses to score them.
    const plain = fleschReadingEase(
      'The cat sat on the mat. It was a warm day and the sun was out. Birds sang in the old tree. ' +
        'We ate our lunch on the grass. Then we went home. It was a good day. ' +
        'The dog ran up the hill. He found a stick and brought it back. We threw it again. ' +
        'By five the sky went grey, so we packed up the rug and set off for the bus.',
    );
    const dense = fleschReadingEase(
      'The implementation of multidimensional organisational restructuring necessitates comprehensive ' +
        'reconsideration of institutional methodologies. Interdepartmental communication infrastructures ' +
        'frequently demonstrate insufficient adaptability to continuously evolving operational ' +
        'requirements. Consequently, administrative stakeholders must systematically evaluate ' +
        'the interdependencies characterising contemporary bureaucratic configurations before ' +
        'authorising transformational initiatives of considerable magnitude. Such deliberation ' +
        'inevitably presupposes substantial familiarity with the governing regulatory frameworks.',
    );

    expect(plain).not.toBeNull();
    expect(dense).not.toBeNull();
    expect(plain!).toBeGreaterThan(dense!);
  });

  it('returns null when there is not enough text to judge', () => {
    expect(fleschReadingEase('Too short.')).toBeNull();
  });
});
