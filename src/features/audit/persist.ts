import type { AuditCategory, AuditStatus, Prisma, ScreenshotKind } from '@prisma/client';

import { CATEGORY_WEIGHTS } from '@/config/scoring';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { domainOf, faviconFor, normalizeUrl } from '@/lib/url';

import type { AuditRunResult } from './engine';

/**
 * Persists a completed audit.
 *
 * Written as one transaction: an audit with scores but no recommendations, or
 * with a report but no category rows, would render as a half-broken page. The
 * transaction has a raised timeout because it writes several hundred rows for
 * a link-heavy page.
 *
 * Screenshots are the one thing deliberately capped — base64 WebP data URLs
 * are large, and two per audit is enough for the report. In a deployment with
 * Supabase Storage configured these would be uploaded and only the URL stored;
 * `storeScreenshot` is the seam for that.
 */

const log = logger.child({ module: 'audit/persist' });

const TRANSACTION_TIMEOUT_MS = 30_000;
const MAX_LINK_ROWS = 250;
const MAX_ISSUE_ROWS = 200;

export interface PersistInput {
  /** The RUNNING row created by `createPendingAudit`. */
  auditId: string;
  websiteId: string;
  result: AuditRunResult;
}

/** Resolves (or creates) the Website row an audit belongs to. */
export async function resolveWebsite(input: {
  projectId: string;
  url: string;
  label?: string;
}): Promise<{ id: string; url: string }> {
  const normalized = normalizeUrl(input.url);
  const domain = domainOf(normalized);

  return db.website.upsert({
    where: { projectId_url: { projectId: input.projectId, url: normalized } },
    create: {
      projectId: input.projectId,
      url: normalized,
      domain,
      label: input.label ?? domain,
      faviconUrl: faviconFor(domain),
    },
    update: {},
    select: { id: true, url: true },
  });
}

/** Creates the QUEUED row so the UI has something to poll immediately. */
export async function createPendingAudit(input: {
  websiteId: string;
  userId: string;
  url: string;
  device: 'MOBILE' | 'DESKTOP';
}): Promise<string> {
  const audit = await db.audit.create({
    data: {
      websiteId: input.websiteId,
      requestedById: input.userId,
      url: input.url,
      device: input.device,
      status: AuditStatus.RUNNING,
      startedAt: new Date(),
    },
    select: { id: true },
  });

  return audit.id;
}

export async function markAuditFailed(auditId: string, message: string): Promise<void> {
  await db.audit
    .update({
      where: { id: auditId },
      data: { status: AuditStatus.FAILED, errorMessage: message.slice(0, 1000), completedAt: new Date() },
    })
    .catch((error) => log.error('could not mark audit failed', { auditId, error }));
}

/** The score of the most recent completed audit for the same website. */
export async function previousScoreFor(websiteId: string, excludeAuditId?: string): Promise<number | null> {
  const previous = await db.audit.findFirst({
    where: {
      websiteId,
      status: AuditStatus.COMPLETED,
      overallScore: { not: null },
      ...(excludeAuditId ? { id: { not: excludeAuditId } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    select: { overallScore: true },
  });

  return previous?.overallScore ?? null;
}

function screenshotKind(kind: string): ScreenshotKind {
  return (kind ?? 'DESKTOP_VIEWPORT') as ScreenshotKind;
}

/**
 * Seam for object storage. Today the WebP data URL is stored inline, which is
 * simple and works everywhere; swapping in a Supabase Storage upload only
 * requires changing this function.
 */
async function storeScreenshot(dataUrl: string): Promise<string> {
  return dataUrl;
}

/**
 * Fills in a RUNNING audit with its results.
 *
 * The row already exists, so this is an update with nested creates rather than
 * a create. That ordering matters: the audit is visible in history from the
 * moment it starts, and a crash leaves a FAILED row the user can see instead
 * of silently losing the run.
 */
export async function persistAudit(input: PersistInput): Promise<string> {
  const { result, auditId, websiteId } = input;

  const previousScore = await previousScoreFor(websiteId, auditId);

  const screenshots = await Promise.all(
    result.screenshots.slice(0, 2).map(async (shot) => ({
      kind: screenshotKind(shot.kind),
      url: await storeScreenshot(shot.url),
      width: shot.width,
      height: shot.height,
      bytes: shot.bytes,
    })),
  );

  await db.$transaction(
    async (tx) => {
      await tx.audit.update({
        where: { id: auditId },
        data: {
          url: result.finalUrl,
          status: AuditStatus.COMPLETED,
          overallScore: result.overallScore,
          previousScore,
          startedAt: new Date(Date.now() - result.durationMs),
          completedAt: new Date(),
          durationMs: result.durationMs,
          warnings: result.warnings.length > 0 ? (result.warnings as Prisma.InputJsonValue) : Prisma.JsonNull,
          pageMeta: result.pageMeta as unknown as Prisma.InputJsonValue,

          categoryScores: {
            create: result.categories.map((category) => ({
              category: category.category,
              score: category.score,
              weight: CATEGORY_WEIGHTS[category.category] ?? 1,
              summary: category.summary.slice(0, 1000),
            })),
          },

          seoResult: {
            create: {
              score: result.seo.score,
              title: result.seo.detail.title,
              titleLength: result.seo.detail.titleLength,
              metaDescription: result.seo.detail.metaDescription,
              descriptionLength: result.seo.detail.descriptionLength,
              canonicalUrl: result.seo.detail.canonicalUrl,
              robotsDirectives: result.seo.detail.robotsDirectives,
              indexable: result.seo.detail.indexable,
              lang: result.seo.detail.lang,
              h1Count: result.seo.detail.h1Count,
              h2Count: result.seo.detail.h2Count,
              h3Count: result.seo.detail.h3Count,
              headingOutline: result.seo.detail.headingOutline as unknown as Prisma.InputJsonValue,
              wordCount: result.seo.detail.wordCount,
              readingTimeSec: result.seo.detail.readingTimeSec,
              keywordDensity: result.seo.detail.keywordDensity as unknown as Prisma.InputJsonValue,
              duplicateContentRatio: result.seo.detail.duplicateContentRatio,
              imageCount: result.seo.detail.imageCount,
              imagesMissingAlt: result.seo.detail.imagesMissingAlt,
              hasOpenGraph: result.seo.detail.hasOpenGraph,
              hasTwitterCard: result.seo.detail.hasTwitterCard,
              hasStructuredData: result.seo.detail.hasStructuredData,
              structuredDataTypes: result.seo.detail.structuredDataTypes,
              hasSitemap: result.seo.detail.hasSitemap,
              sitemapUrl: result.seo.detail.sitemapUrl,
              hasRobotsTxt: result.seo.detail.hasRobotsTxt,
              urlDepth: result.seo.detail.urlDepth,
              urlIsReadable: result.seo.detail.urlIsReadable,
              internalLinkCount: result.seo.detail.internalLinkCount,
              externalLinkCount: result.seo.detail.externalLinkCount,
            },
          },

          performanceResult: {
            create: {
              score: result.performance.score,
              source: result.performance.detail.source,
              firstContentfulPaint: result.performance.detail.firstContentfulPaint,
              largestContentfulPaint: result.performance.detail.largestContentfulPaint,
              cumulativeLayoutShift: result.performance.detail.cumulativeLayoutShift,
              totalBlockingTime: result.performance.detail.totalBlockingTime,
              speedIndex: result.performance.detail.speedIndex,
              timeToInteractive: result.performance.detail.timeToInteractive,
              serverResponseTime: result.performance.detail.serverResponseTime,
              totalBytes: result.performance.detail.totalBytes,
              imageBytes: result.performance.detail.imageBytes,
              scriptBytes: result.performance.detail.scriptBytes,
              styleBytes: result.performance.detail.styleBytes,
              fontBytes: result.performance.detail.fontBytes,
              documentBytes: result.performance.detail.documentBytes,
              requestCount: result.performance.detail.requestCount,
              usesCompression: result.performance.detail.usesCompression,
              usesHttp2: result.performance.detail.usesHttp2,
              usesTextCaching: result.performance.detail.usesTextCaching,
              usesModernImages: result.performance.detail.usesModernImages,
              opportunities: result.performance.detail.opportunities as unknown as Prisma.InputJsonValue,
            },
          },

          accessibilityResult: {
            create: {
              score: result.accessibility.score,
              violationCount: result.accessibility.detail.violationCount,
              passCount: result.accessibility.detail.passCount,
              incompleteCount: result.accessibility.detail.incompleteCount,
              criticalCount: result.accessibility.detail.criticalCount,
              seriousCount: result.accessibility.detail.seriousCount,
              moderateCount: result.accessibility.detail.moderateCount,
              minorCount: result.accessibility.detail.minorCount,
              contrastIssues: result.accessibility.detail.contrastIssues,
              missingAltText: result.accessibility.detail.missingAltText,
              missingFormLabels: result.accessibility.detail.missingFormLabels,
              missingAriaLabels: result.accessibility.detail.missingAriaLabels,
              headingOrderIssues: result.accessibility.detail.headingOrderIssues,
              focusIssues: result.accessibility.detail.focusIssues,
              keyboardIssues: result.accessibility.detail.keyboardIssues,
              wcagTags: result.accessibility.detail.wcagTags,
              rawViolations: result.accessibility.detail.rawViolations as unknown as Prisma.InputJsonValue,
            },
          },

          technicalResult: {
            create: {
              score: result.technical.score,
              httpsEnabled: result.technical.detail.httpsEnabled,
              sslValid: result.technical.detail.sslValid,
              sslIssuer: result.technical.detail.sslIssuer,
              sslExpiresAt: result.technical.detail.sslExpiresAt,
              hstsEnabled: result.technical.detail.hstsEnabled,
              cspEnabled: result.technical.detail.cspEnabled,
              xFrameOptions: result.technical.detail.xFrameOptions,
              xContentTypeOptions: result.technical.detail.xContentTypeOptions,
              referrerPolicy: result.technical.detail.referrerPolicy,
              permissionsPolicy: result.technical.detail.permissionsPolicy,
              securityScore: result.security.score,
              statusCode: result.technical.detail.statusCode,
              redirectCount: result.technical.detail.redirectCount,
              redirectChain: result.technical.detail.redirectChain,
              hasCanonical: result.technical.detail.hasCanonical,
              canonicalSelfReferencing: result.technical.detail.canonicalSelfReferencing,
              totalLinks: result.technical.detail.totalLinks,
              brokenLinks: result.technical.detail.brokenLinks,
              internalLinks: result.technical.detail.internalLinks,
              externalLinks: result.technical.detail.externalLinks,
              nofollowLinks: result.technical.detail.nofollowLinks,
              scriptCount: result.technical.detail.scriptCount,
              stylesheetCount: result.technical.detail.stylesheetCount,
              inlineScriptCount: result.technical.detail.inlineScriptCount,
              renderBlockingCount: result.technical.detail.renderBlockingCount,
              detectedTech: result.technical.detail.detectedTech,
            },
          },

          ...(result.ai
            ? {
                aiAnalysis: {
                  create: {
                    uxScore: result.ai.ux.score,
                    designScore: result.ai.design.score,
                    contentScore: result.ai.content.score,
                    uxFindings: result.ai.ux.detail as Prisma.InputJsonValue,
                    designFindings: result.ai.design.detail as Prisma.InputJsonValue,
                    contentFindings: result.ai.content.detail as Prisma.InputJsonValue,
                    model: result.ai.usage.model,
                    promptTokens: result.ai.usage.promptTokens,
                    outputTokens: result.ai.usage.outputTokens,
                    costCents: result.ai.usage.costCents,
                  },
                },
              }
            : {}),

          aiReport: {
            create: {
              executiveSummary: result.report.executiveSummary,
              strengths: result.report.strengths,
              weaknesses: result.report.weaknesses,
              longTermOutlook: result.report.longTermOutlook,
              model: result.report.usage?.model ?? 'deterministic-fallback',
              promptTokens: result.report.usage?.promptTokens ?? null,
              outputTokens: result.report.usage?.outputTokens ?? null,
              costCents: result.report.usage?.costCents ?? null,
            },
          },

          issues: {
            create: result.issues.slice(0, MAX_ISSUE_ROWS).map((issue) => ({
              category: issue.category,
              severity: issue.severity,
              code: issue.code,
              title: issue.title.slice(0, 300),
              description: issue.description,
              evidence: issue.evidence?.slice(0, 2000),
              helpUrl: issue.helpUrl,
            })),
          },

          recommendations: {
            create: result.recommendations.map((recommendation, index) => ({
              category: recommendation.category,
              kind: recommendation.kind,
              priority: recommendation.priority,
              title: recommendation.title.slice(0, 300),
              explanation: recommendation.explanation,
              expectedImpact: recommendation.expectedImpact,
              difficulty: recommendation.difficulty,
              estimatedMinutes: recommendation.estimatedMinutes,
              impactScore: recommendation.impactScore,
              sortOrder: index,
            })),
          },

          ...(screenshots.length > 0 ? { screenshots: { create: screenshots } } : {}),

          links: {
            create: result.technical.detail.links.slice(0, MAX_LINK_ROWS).map((link) => ({
              href: link.href.slice(0, 2000),
              anchorText: link.anchorText,
              isInternal: link.isInternal,
              isNofollow: link.isNofollow,
              statusCode: link.statusCode,
              isBroken: link.isBroken,
            })),
          },
        },
        select: { id: true },
      });
    },
    { timeout: TRANSACTION_TIMEOUT_MS, maxWait: 10_000 },
  );

  log.info('audit persisted', { auditId, websiteId, score: result.overallScore });
  return auditId;
}

/** Notifies the requester that their audit is ready. */
export async function notifyAuditComplete(input: {
  userId: string;
  auditId: string;
  url: string;
  score: number;
  previousScore: number | null;
}): Promise<void> {
  const delta =
    input.previousScore == null
      ? null
      : input.score - input.previousScore;

  await db.notification
    .create({
      data: {
        userId: input.userId,
        kind: 'audit',
        title: `Audit complete — ${input.score}/100`,
        body:
          delta == null
            ? `Your first audit of ${input.url} is ready.`
            : `${input.url} scored ${input.score}, ${delta === 0 ? 'unchanged from' : `${Math.abs(delta)} points ${delta > 0 ? 'up on' : 'down from'}`} the last run.`,
        href: `/dashboard/audits/${input.auditId}`,
      },
    })
    .catch((error) => log.warn('notification create failed', { error }));
}

export const AUDIT_CATEGORY_ORDER: AuditCategory[] = [
  'SEO',
  'PERFORMANCE',
  'ACCESSIBILITY',
  'UX',
  'DESIGN',
  'CONTENT',
  'SECURITY',
  'TECHNICAL',
];
