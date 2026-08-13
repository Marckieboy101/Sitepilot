import { randomUUID } from 'node:crypto';

import {
  AuditCategory,
  AuditStatus,
  Difficulty,
  Plan,
  PrismaClient,
  Priority,
  RecommendationKind,
  Severity,
} from '@prisma/client';

import { CATEGORY_WEIGHTS, computeOverallScore } from '../src/config/scoring';

/**
 * Development seed.
 *
 * Creates one workspace with a plausible three-month audit history so the
 * dashboard, trend charts and history timeline have something real to render
 * during development. Scores drift upward with noise rather than climbing
 * linearly — a perfectly smooth line hides exactly the chart bugs you want a
 * seed to expose.
 *
 * Idempotent: re-running replaces the seeded workspace rather than stacking
 * duplicates.
 */

const db = new PrismaClient();

const SEED_EMAIL = 'demo@sitepilot.local';

/** Deterministic PRNG so a given run always produces the same history. */
function makeRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 2 ** 32;
    return state / 2 ** 32;
  };
}

const random = makeRandom(42);

function clamp(value: number, min = 5, max = 99): number {
  return Math.round(Math.min(max, Math.max(min, value)));
}

const CATEGORY_START: Record<AuditCategory, number> = {
  [AuditCategory.SEO]: 58,
  [AuditCategory.PERFORMANCE]: 41,
  [AuditCategory.ACCESSIBILITY]: 63,
  [AuditCategory.UX]: 66,
  [AuditCategory.DESIGN]: 71,
  [AuditCategory.CONTENT]: 60,
  [AuditCategory.SECURITY]: 38,
  [AuditCategory.TECHNICAL]: 69,
};

interface SeedSite {
  url: string;
  label: string;
  runs: number;
  /** Points gained per run, before noise. */
  improvement: number;
}

const SITES: SeedSite[] = [
  { url: 'https://northgategoods.example.com', label: 'Northgate Goods — homepage', runs: 9, improvement: 4.2 },
  { url: 'https://northgategoods.example.com/pricing', label: 'Pricing page', runs: 6, improvement: 3.1 },
  { url: 'https://fernwaylabs.example.com', label: 'Fernway Labs', runs: 4, improvement: 1.4 },
];

const ISSUE_POOL: Array<{
  code: string;
  category: AuditCategory;
  severity: Severity;
  title: string;
  description: string;
}> = [
  {
    code: 'seo.description.missing',
    category: AuditCategory.SEO,
    severity: Severity.HIGH,
    title: 'No meta description',
    description:
      'Without a meta description Google writes your search snippet for you, and you lose control of the pitch that decides whether someone clicks your result.',
  },
  {
    code: 'performance.largestContentfulPaint',
    category: AuditCategory.PERFORMANCE,
    severity: Severity.HIGH,
    title: 'Largest Contentful Paint is 4.8 s',
    description:
      'The main content takes almost five seconds to appear. Google considers anything above 2.5 seconds to need improvement.',
  },
  {
    code: 'security.csp',
    category: AuditCategory.SECURITY,
    severity: Severity.HIGH,
    title: 'Missing Content-Security-Policy',
    description:
      'CSP is the main defence against cross-site scripting: it tells the browser which sources may execute code.',
  },
  {
    code: 'a11y.color-contrast',
    category: AuditCategory.ACCESSIBILITY,
    severity: Severity.HIGH,
    title: 'Elements must have sufficient colour contrast (14 elements)',
    description:
      'Low-contrast text is unreadable for anyone with reduced vision, and hard for everyone outdoors or on a dim screen.',
  },
  {
    code: 'seo.structured-data.missing',
    category: AuditCategory.SEO,
    severity: Severity.MEDIUM,
    title: 'No structured data',
    description:
      'Schema.org markup is what makes rich results possible — star ratings, FAQs, breadcrumbs, product prices.',
  },
  {
    code: 'technical.links.broken',
    category: AuditCategory.TECHNICAL,
    severity: Severity.MEDIUM,
    title: '3 broken links',
    description: 'Broken links send visitors to dead ends and waste crawl budget.',
  },
  {
    code: 'content.trust.weak',
    category: AuditCategory.CONTENT,
    severity: Severity.MEDIUM,
    title: 'Few trust signals on the page',
    description:
      'We found little of the evidence visitors look for before acting — testimonials, contact details, policies or guarantees.',
  },
];

const RECOMMENDATION_POOL = [
  {
    category: AuditCategory.PERFORMANCE,
    kind: RecommendationKind.QUICK_WIN,
    priority: Priority.HIGH,
    difficulty: Difficulty.EASY,
    estimatedMinutes: 45,
    impactScore: 94,
    title: 'Compress and convert the hero image',
    explanation:
      'The hero image is 2.4 MB as a PNG. Export it as WebP at 80% quality and serve it through a <picture> element with the PNG as a fallback.',
    expectedImpact:
      'Cuts roughly 1.8 seconds off Largest Contentful Paint on a 4G connection, which is the single biggest speed win available on this page.',
  },
  {
    category: AuditCategory.SEO,
    kind: RecommendationKind.QUICK_WIN,
    priority: Priority.HIGH,
    difficulty: Difficulty.EASY,
    estimatedMinutes: 15,
    impactScore: 88,
    title: 'Write a meta description',
    explanation:
      'Add a 70-160 character summary that states what the visitor gets and includes a light call to action.',
    expectedImpact:
      'Descriptions do not affect ranking directly, but a well-written one measurably lifts click-through rate from the results page.',
  },
  {
    category: AuditCategory.SECURITY,
    kind: RecommendationKind.QUICK_WIN,
    priority: Priority.HIGH,
    difficulty: Difficulty.EASY,
    estimatedMinutes: 30,
    impactScore: 84,
    title: 'Add Strict-Transport-Security',
    explanation:
      'Send Strict-Transport-Security: max-age=31536000; includeSubDomains once every subdomain serves HTTPS.',
    expectedImpact: 'Browsers refuse to talk to your domain over HTTP at all, closing the downgrade window.',
  },
  {
    category: AuditCategory.ACCESSIBILITY,
    kind: RecommendationKind.LONG_TERM,
    priority: Priority.HIGH,
    difficulty: Difficulty.MEDIUM,
    estimatedMinutes: 180,
    impactScore: 76,
    title: 'Fix colour contrast across the design system',
    explanation:
      'Fourteen elements fall below 4.5:1. The root cause is the muted grey token used for secondary text; darkening it once fixes most of them.',
    expectedImpact:
      'Makes body text readable for anyone with reduced vision, and removes a WCAG 2.2 AA failure that applies site-wide.',
  },
  {
    category: AuditCategory.CONTENT,
    kind: RecommendationKind.QUICK_WIN,
    priority: Priority.MEDIUM,
    difficulty: Difficulty.EASY,
    estimatedMinutes: 90,
    impactScore: 62,
    title: 'Add credibility markers above the fold',
    explanation:
      'Add a named customer testimonial with a photo, and move your phone number and address into the header.',
    expectedImpact: 'Reduces the hesitation that stops first-time visitors from getting in touch.',
  },
  {
    category: AuditCategory.UX,
    kind: RecommendationKind.LONG_TERM,
    priority: Priority.MEDIUM,
    difficulty: Difficulty.MEDIUM,
    estimatedMinutes: 240,
    impactScore: 58,
    title: 'Simplify the primary navigation',
    explanation:
      'Nine top-level items is more than a visitor will scan. Group them into four, with the rest under a single "More" menu.',
    expectedImpact: 'Visitors find the page they came for faster, and the mobile menu stops needing a scroll.',
  },
];

async function main() {
  console.log('Seeding SitePilot AI…');

  if (!process.env.DATABASE_URL) {
    console.warn('DATABASE_URL not set — skipping seed. Set DATABASE_URL to run seeds.');
    return;
  }

  // Remove any previous seed run so this is safe to repeat.
  const existing = await db.user.findUnique({ where: { email: SEED_EMAIL }, select: { id: true } });
  if (existing) {
    await db.user.delete({ where: { id: existing.id } });
    console.log('  removed previous seed data');
  }

  const userId = randomUUID();

  const user = await db.user.create({
    data: {
      id: userId,
      email: SEED_EMAIL,
      name: 'Demo User',
      emailVerified: new Date(),
      settings: { create: {} },
      ownedOrgs: {
        create: {
          name: 'Demo Workspace',
          slug: `demo-workspace-${Date.now().toString(36)}`,
          members: { create: { userId, role: 'OWNER' } },
          subscription: {
            create: {
              plan: Plan.PRO,
              status: 'ACTIVE',
              currentPeriodStart: new Date(Date.now() - 12 * 24 * 3600 * 1000),
              currentPeriodEnd: new Date(Date.now() + 18 * 24 * 3600 * 1000),
            },
          },
        },
      },
    },
    select: { id: true, ownedOrgs: { select: { id: true } } },
  });

  const organizationId = user.ownedOrgs[0].id;

  const project = await db.project.create({
    data: {
      organizationId,
      name: 'Northgate Goods',
      description: 'Client site — leather goods retailer.',
      color: '#6366f1',
    },
    select: { id: true },
  });

  let totalAudits = 0;

  for (const site of SITES) {
    const domain = new URL(site.url).hostname;

    const website = await db.website.create({
      data: {
        projectId: project.id,
        url: site.url,
        domain,
        label: site.label,
        faviconUrl: `https://www.google.com/s2/favicons?domain=${domain}&sz=64`,
      },
      select: { id: true },
    });

    let previousOverall: number | null = null;

    for (let run = 0; run < site.runs; run += 1) {
      // Oldest first, roughly ten days apart.
      const daysAgo = (site.runs - run) * 10;
      const createdAt = new Date(Date.now() - daysAgo * 24 * 3600 * 1000);

      const categoryScores = (Object.keys(CATEGORY_START) as AuditCategory[]).map((category) => {
        const drift = site.improvement * run;
        const noise = (random() - 0.5) * 9;
        return { category, score: clamp(CATEGORY_START[category] + drift + noise) };
      });

      const overallScore = computeOverallScore(categoryScores);

      // Fewer issues surface as the site improves.
      const issueCount = Math.max(1, ISSUE_POOL.length - Math.floor(run * 0.8));
      const issues = ISSUE_POOL.slice(0, issueCount);
      const recommendations = RECOMMENDATION_POOL.slice(
        0,
        Math.max(2, RECOMMENDATION_POOL.length - Math.floor(run * 0.6)),
      );

      const seo = categoryScores.find((entry) => entry.category === AuditCategory.SEO)!.score;
      const performance = categoryScores.find((entry) => entry.category === AuditCategory.PERFORMANCE)!.score;
      const accessibility = categoryScores.find((entry) => entry.category === AuditCategory.ACCESSIBILITY)!.score;
      const technical = categoryScores.find((entry) => entry.category === AuditCategory.TECHNICAL)!.score;
      const security = categoryScores.find((entry) => entry.category === AuditCategory.SECURITY)!.score;

      await db.audit.create({
        data: {
          websiteId: website.id,
          requestedById: user.id,
          url: site.url,
          status: AuditStatus.COMPLETED,
          device: 'MOBILE',
          overallScore,
          previousScore: previousOverall,
          createdAt,
          updatedAt: createdAt,
          startedAt: createdAt,
          completedAt: new Date(createdAt.getTime() + 48_000),
          durationMs: 42_000 + Math.round(random() * 20_000),
          pageMeta: {
            statusCode: 200,
            redirectChain: [],
            contentType: 'text/html; charset=utf-8',
            renderedWithBrowser: true,
            detectedTech: ['Next.js', 'React', 'Tailwind CSS', 'Google Analytics 4'],
          },

          categoryScores: {
            create: categoryScores.map((entry) => ({
              category: entry.category,
              score: entry.score,
              weight: CATEGORY_WEIGHTS[entry.category],
              summary: `${entry.category} scored ${entry.score} on this run.`,
            })),
          },

          seoResult: {
            create: {
              score: seo,
              title: 'Handmade Leather Wallets — Northgate Goods',
              titleLength: 42,
              metaDescription: run > 2 ? 'Full-grain leather wallets, hand-stitched in Bristol.' : null,
              descriptionLength: run > 2 ? 53 : null,
              canonicalUrl: site.url,
              indexable: true,
              lang: 'en',
              h1Count: 1,
              h2Count: 4,
              h3Count: 3,
              headingOutline: [
                { level: 1, text: 'Handmade leather wallets built to last a decade' },
                { level: 2, text: 'Why full-grain leather' },
                { level: 2, text: 'What comes with every order' },
              ],
              wordCount: 620 + run * 40,
              readingTimeSec: 165,
              keywordDensity: [
                { term: 'leather', count: 18, density: 2.9 },
                { term: 'wallet', count: 12, density: 1.9 },
                { term: 'bristol', count: 5, density: 0.8 },
              ],
              imageCount: 12,
              imagesMissingAlt: Math.max(0, 5 - run),
              hasOpenGraph: run > 1,
              hasTwitterCard: run > 3,
              hasStructuredData: run > 4,
              structuredDataTypes: run > 4 ? ['Organization', 'Product'] : [],
              hasSitemap: true,
              sitemapUrl: `${new URL(site.url).origin}/sitemap.xml`,
              hasRobotsTxt: true,
              urlDepth: new URL(site.url).pathname.split('/').filter(Boolean).length,
              urlIsReadable: true,
              internalLinkCount: 24,
              externalLinkCount: 3,
            },
          },

          performanceResult: {
            create: {
              score: performance,
              source: 'psi',
              firstContentfulPaint: 2600 - run * 90,
              largestContentfulPaint: 4800 - run * 220,
              cumulativeLayoutShift: Math.max(0.02, 0.24 - run * 0.02),
              totalBlockingTime: Math.max(60, 520 - run * 35),
              speedIndex: 4100 - run * 150,
              timeToInteractive: 5600 - run * 250,
              serverResponseTime: 380,
              totalBytes: 4_200_000 - run * 180_000,
              imageBytes: 2_600_000 - run * 140_000,
              scriptBytes: 890_000,
              styleBytes: 140_000,
              fontBytes: 210_000,
              documentBytes: 48_000,
              requestCount: 74,
              usesCompression: true,
              usesTextCaching: run > 3,
              usesModernImages: run > 5,
              opportunities: [
                {
                  id: 'modern-image-formats',
                  title: 'Serve images in next-gen formats',
                  description: 'WebP and AVIF often provide better compression than PNG or JPEG.',
                  savingsMs: 1800,
                  savingsBytes: 1_400_000,
                },
                {
                  id: 'unused-javascript',
                  title: 'Reduce unused JavaScript',
                  description: 'Remove dead code and defer scripts not needed for first paint.',
                  savingsMs: 640,
                  savingsBytes: 320_000,
                },
              ],
            },
          },

          accessibilityResult: {
            create: {
              score: accessibility,
              violationCount: Math.max(0, 9 - run),
              passCount: 68,
              incompleteCount: 4,
              criticalCount: Math.max(0, 2 - Math.floor(run / 3)),
              seriousCount: Math.max(0, 4 - Math.floor(run / 2)),
              moderateCount: 2,
              minorCount: 1,
              contrastIssues: Math.max(0, 14 - run * 2),
              missingAltText: Math.max(0, 5 - run),
              missingFormLabels: Math.max(0, 2 - Math.floor(run / 3)),
              missingAriaLabels: 1,
              headingOrderIssues: 1,
              focusIssues: run > 4 ? 0 : 1,
              keyboardIssues: 0,
              wcagTags: ['wcag2a', 'wcag2aa', 'wcag21aa'],
              rawViolations: [],
            },
          },

          technicalResult: {
            create: {
              score: technical,
              httpsEnabled: true,
              sslValid: true,
              hstsEnabled: run > 4,
              cspEnabled: run > 6,
              xFrameOptions: run > 2,
              xContentTypeOptions: run > 2,
              referrerPolicy: run > 3,
              permissionsPolicy: run > 6,
              securityScore: security,
              statusCode: 200,
              redirectCount: 1,
              redirectChain: [site.url.replace('https://', 'http://')],
              hasCanonical: true,
              canonicalSelfReferencing: true,
              totalLinks: 27,
              brokenLinks: Math.max(0, 3 - Math.floor(run / 2)),
              internalLinks: 24,
              externalLinks: 3,
              nofollowLinks: 1,
              scriptCount: 14,
              stylesheetCount: 3,
              inlineScriptCount: 6,
              renderBlockingCount: Math.max(2, 8 - run),
              detectedTech: ['Next.js', 'React', 'Tailwind CSS', 'Google Analytics 4'],
            },
          },

          aiAnalysis: {
            create: {
              uxScore: categoryScores.find((entry) => entry.category === AuditCategory.UX)!.score,
              designScore: categoryScores.find((entry) => entry.category === AuditCategory.DESIGN)!.score,
              contentScore: categoryScores.find((entry) => entry.category === AuditCategory.CONTENT)!.score,
              uxFindings: {
                navigation: {
                  score: 64,
                  verdict: 'Nine top-level items is more than a visitor will scan.',
                  notes:
                    'The primary nav carries nine links of roughly equal visual weight, so nothing reads as the main path. Grouping them into four, with the rest under a "More" menu, would make the important routes obvious.',
                },
                callToActions: {
                  score: 58,
                  verdict: 'The primary CTA sits below the fold on mobile.',
                  notes:
                    'On a 390px viewport the "Shop wallets" button appears after roughly 900px of scrolling. Visitors who do not scroll never see the one action you want them to take.',
                },
              },
              designFindings: {
                colorPalette: {
                  score: 78,
                  verdict: 'Restrained palette, let down by the secondary grey.',
                  notes:
                    'Two brand colours plus neutrals is a sensible choice and it reads as deliberate. The muted grey used for secondary text is too light against white, which is also where most of the contrast failures come from.',
                },
                typography: {
                  score: 74,
                  verdict: 'Clear hierarchy, but too many sizes in play.',
                  notes:
                    'Eleven distinct font sizes appear on the page. Reducing to a scale of six would tighten the rhythm without changing the look.',
                },
              },
              contentFindings: {
                clarity: {
                  score: 71,
                  verdict: 'The value proposition takes too long to arrive.',
                  notes:
                    'The headline describes the product but not who it is for or why it beats a cheaper alternative. That argument appears three sections down, after most visitors have decided.',
                },
              },
              model: 'gpt-4o',
              promptTokens: 5240,
              outputTokens: 1180,
              costCents: 2.49,
            },
          },

          aiReport: {
            create: {
              executiveSummary: `Your website scores ${overallScore} out of 100 overall.${
                previousOverall != null
                  ? ` That is ${Math.abs(overallScore - previousOverall)} points ${overallScore > previousOverall ? 'better' : 'worse'} than the previous audit.`
                  : ''
              }\n\nThe headline problem is speed. Your largest image is 2.4 MB and loads before anything else renders, which means visitors on a phone wait almost five seconds before they see your product. Roughly a third of them will not wait that long.\n\nThe second problem is quieter but costs you just as much: there is no meta description, so Google is writing your search snippet for you. You have no control over the sentence that decides whether someone clicks your result or a competitor's.\n\nStart with the image. It is a forty-five minute job and it is worth more than everything else on this list combined.`,
              strengths: [
                'Clear heading structure with a single, descriptive H1 that states what the page is about.',
                'HTTPS is correctly configured with a valid certificate and a clean redirect from HTTP.',
                'The writing is specific and concrete — it names the material, the workshop and the guarantee rather than making vague quality claims.',
              ],
              weaknesses: [
                'Page weight of 4.2 MB, dominated by uncompressed images, making the site slow on mobile data.',
                'Missing meta description, so the search result snippet is out of your control.',
                'Fourteen colour-contrast failures, mostly from one over-light grey text token.',
              ],
              longTermOutlook:
                'Over the next quarter the work that compounds is an image pipeline that converts and sizes automatically on upload, and a contrast-safe colour token in the design system. Both fix whole classes of problem rather than individual instances, which is what stops these findings from reappearing on every audit.',
              model: 'gpt-4o',
              promptTokens: 4120,
              outputTokens: 1460,
              costCents: 2.49,
            },
          },

          issues: {
            create: issues.map((issue) => ({
              category: issue.category,
              severity: issue.severity,
              code: issue.code,
              title: issue.title,
              description: issue.description,
            })),
          },

          recommendations: {
            create: recommendations.map((recommendation, index) => ({
              ...recommendation,
              sortOrder: index,
            })),
          },
        },
      });

      previousOverall = overallScore;
      totalAudits += 1;
    }
  }

  await db.notification.create({
    data: {
      userId: user.id,
      kind: 'audit',
      title: 'Audit complete — 78/100',
      body: 'northgategoods.example.com scored 78, 6 points up on the last run.',
      href: '/dashboard',
    },
  });

  console.log(`  created ${SITES.length} websites and ${totalAudits} audits`);
  console.log(`\nSigned-in demo data belongs to ${SEED_EMAIL}.`);
  console.log('Create a Supabase user with that email to sign in as the demo account.');
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
