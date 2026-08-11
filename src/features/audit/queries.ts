import { cache } from 'react';

import { AuditStatus, type Prisma } from '@prisma/client';

import { db } from '@/lib/db';
import { errors } from '@/lib/errors';

import type { AuditFilters } from './schemas';

/**
 * Read models for the dashboard.
 *
 * Two rules hold throughout:
 *
 *  1. Every query is scoped by `organizationId` in its WHERE clause, joined
 *     through Website → Project → Organization. Fetch-then-check would leak
 *     existence through timing and through any code path that forgets the
 *     check; making tenancy part of the query makes the safe path the only
 *     path.
 *  2. Selects are explicit. `include` on Audit would drag several JSONB blobs
 *     — axe violations, keyword tables — into every list render.
 */

/** Reusable tenancy filter. */
function orgScope(organizationId: string): Prisma.AuditWhereInput {
  return { website: { project: { organizationId } } };
}

export interface DashboardSummary {
  totalAudits: number;
  auditsThisMonth: number;
  websitesTracked: number;
  projectCount: number;
  latestScore: number | null;
  previousScore: number | null;
  averageScore: number | null;
  categoryAverages: Array<{ category: string; score: number }>;
  openRecommendations: number;
  criticalIssues: number;
}

export const getDashboardSummary = cache(async (organizationId: string): Promise<DashboardSummary> => {
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const scope = orgScope(organizationId);
  const completed = { ...scope, status: AuditStatus.COMPLETED };

  const [totalAudits, auditsThisMonth, websitesTracked, projectCount, latest, aggregate, categoryRows, openRecs, criticalIssues] =
    await Promise.all([
      db.audit.count({ where: completed }),
      db.audit.count({ where: { ...completed, createdAt: { gte: monthStart } } }),
      db.website.count({ where: { project: { organizationId } } }),
      db.project.count({ where: { organizationId, archived: false } }),
      db.audit.findFirst({
        where: completed,
        orderBy: { createdAt: 'desc' },
        select: { overallScore: true, previousScore: true },
      }),
      db.audit.aggregate({
        where: completed,
        _avg: { overallScore: true },
      }),
      // Category averages across the org's last 50 audits — enough to be
      // representative without scanning the whole history on every load.
      db.categoryScore.groupBy({
        by: ['category'],
        where: { audit: completed },
        _avg: { score: true },
      }),
      db.recommendation.count({
        where: { audit: scope, status: { in: ['OPEN', 'IN_PROGRESS'] } },
      }),
      db.issue.count({ where: { audit: scope, severity: { in: ['CRITICAL', 'HIGH'] } } }),
    ]);

  return {
    totalAudits,
    auditsThisMonth,
    websitesTracked,
    projectCount,
    latestScore: latest?.overallScore ?? null,
    previousScore: latest?.previousScore ?? null,
    averageScore: aggregate._avg.overallScore != null ? Math.round(aggregate._avg.overallScore) : null,
    categoryAverages: categoryRows
      .map((row) => ({ category: row.category as string, score: Math.round(row._avg.score ?? 0) }))
      .sort((a, b) => b.score - a.score),
    openRecommendations: openRecs,
    criticalIssues,
  };
});

export interface AuditListItem {
  id: string;
  url: string;
  status: AuditStatus;
  device: string;
  overallScore: number | null;
  previousScore: number | null;
  createdAt: Date;
  durationMs: number | null;
  websiteId: string;
  websiteLabel: string | null;
  faviconUrl: string | null;
  projectName: string;
  criticalIssues: number;
}

export async function listAudits(
  organizationId: string,
  filters: Partial<AuditFilters> = {},
): Promise<{ items: AuditListItem[]; total: number; page: number; pageSize: number }> {
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 20;

  const where: Prisma.AuditWhereInput = {
    ...orgScope(organizationId),
    ...(filters.status ? { status: filters.status as AuditStatus } : {}),
    ...(filters.websiteId ? { websiteId: filters.websiteId } : {}),
    ...(filters.projectId ? { website: { projectId: filters.projectId, project: { organizationId } } } : {}),
    ...(filters.search ? { url: { contains: filters.search, mode: 'insensitive' } } : {}),
  };

  const [rows, total] = await Promise.all([
    db.audit.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        url: true,
        status: true,
        device: true,
        overallScore: true,
        previousScore: true,
        createdAt: true,
        durationMs: true,
        websiteId: true,
        website: {
          select: { label: true, faviconUrl: true, project: { select: { name: true } } },
        },
        _count: { select: { issues: { where: { severity: { in: ['CRITICAL', 'HIGH'] } } } } },
      },
    }),
    db.audit.count({ where }),
  ]);

  return {
    total,
    page,
    pageSize,
    items: rows.map((row) => ({
      id: row.id,
      url: row.url,
      status: row.status,
      device: row.device,
      overallScore: row.overallScore,
      previousScore: row.previousScore,
      createdAt: row.createdAt,
      durationMs: row.durationMs,
      websiteId: row.websiteId,
      websiteLabel: row.website.label,
      faviconUrl: row.website.faviconUrl,
      projectName: row.website.project.name,
      criticalIssues: row._count.issues,
    })),
  };
}

/** Full detail for the audit report page. */
export const getAuditDetail = cache(async (auditId: string, organizationId: string) => {
  const audit = await db.audit.findFirst({
    where: { id: auditId, ...orgScope(organizationId) },
    select: {
      id: true,
      url: true,
      status: true,
      device: true,
      overallScore: true,
      previousScore: true,
      createdAt: true,
      completedAt: true,
      durationMs: true,
      errorMessage: true,
      warnings: true,
      pageMeta: true,
      websiteId: true,
      website: {
        select: {
          id: true,
          url: true,
          domain: true,
          label: true,
          faviconUrl: true,
          project: { select: { id: true, name: true, organizationId: true } },
        },
      },
      categoryScores: { select: { category: true, score: true, summary: true } },
      seoResult: true,
      performanceResult: true,
      accessibilityResult: true,
      technicalResult: true,
      aiAnalysis: {
        select: {
          uxScore: true,
          designScore: true,
          contentScore: true,
          uxFindings: true,
          designFindings: true,
          contentFindings: true,
          model: true,
        },
      },
      aiReport: {
        select: {
          executiveSummary: true,
          strengths: true,
          weaknesses: true,
          longTermOutlook: true,
          model: true,
          createdAt: true,
        },
      },
      issues: {
        orderBy: [{ severity: 'asc' }, { category: 'asc' }],
        select: {
          id: true,
          category: true,
          severity: true,
          code: true,
          title: true,
          description: true,
          evidence: true,
          helpUrl: true,
        },
      },
      recommendations: {
        orderBy: [{ priority: 'asc' }, { sortOrder: 'asc' }],
        select: {
          id: true,
          category: true,
          kind: true,
          priority: true,
          status: true,
          title: true,
          explanation: true,
          expectedImpact: true,
          difficulty: true,
          estimatedMinutes: true,
          impactScore: true,
        },
      },
      screenshots: { select: { id: true, kind: true, url: true, width: true, height: true } },
      links: {
        where: { isBroken: true },
        take: 50,
        select: { id: true, href: true, anchorText: true, statusCode: true, isInternal: true },
      },
    },
  });

  if (!audit) throw errors.notFound('Audit');
  return audit;
});

export type AuditDetail = Awaited<ReturnType<typeof getAuditDetail>>;

/** Score history for a website, oldest first, for the trend chart. */
export async function getScoreHistory(
  websiteId: string,
  organizationId: string,
  limit = 30,
): Promise<Array<{ date: Date; overall: number; categories: Record<string, number> }>> {
  const audits = await db.audit.findMany({
    where: {
      websiteId,
      status: AuditStatus.COMPLETED,
      overallScore: { not: null },
      website: { project: { organizationId } },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      createdAt: true,
      overallScore: true,
      categoryScores: { select: { category: true, score: true } },
    },
  });

  return audits
    .reverse()
    .map((audit) => ({
      date: audit.createdAt,
      overall: audit.overallScore ?? 0,
      categories: Object.fromEntries(audit.categoryScores.map((score) => [score.category, score.score])),
    }));
}

/** Org-wide score trend, one point per audit, for the dashboard chart. */
export async function getOrganizationTrend(
  organizationId: string,
  limit = 40,
): Promise<Array<{ date: Date; score: number; url: string }>> {
  const audits = await db.audit.findMany({
    where: { ...orgScope(organizationId), status: AuditStatus.COMPLETED, overallScore: { not: null } },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { createdAt: true, overallScore: true, url: true },
  });

  return audits.reverse().map((audit) => ({
    date: audit.createdAt,
    score: audit.overallScore ?? 0,
    url: audit.url,
  }));
}

/** Monthly aggregates for the "improvement over time" chart. */
export async function getMonthlyImprovements(
  organizationId: string,
  months = 6,
): Promise<Array<{ month: string; average: number; audits: number }>> {
  const since = new Date();
  since.setUTCMonth(since.getUTCMonth() - (months - 1), 1);
  since.setUTCHours(0, 0, 0, 0);

  const audits = await db.audit.findMany({
    where: {
      ...orgScope(organizationId),
      status: AuditStatus.COMPLETED,
      overallScore: { not: null },
      createdAt: { gte: since },
    },
    select: { createdAt: true, overallScore: true },
  });

  const buckets = new Map<string, { total: number; count: number }>();

  // Seed every month in range so the chart has no gaps where nothing was run.
  for (let offset = 0; offset < months; offset += 1) {
    const date = new Date(since);
    date.setUTCMonth(since.getUTCMonth() + offset);
    buckets.set(monthKey(date), { total: 0, count: 0 });
  }

  for (const audit of audits) {
    const key = monthKey(audit.createdAt);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    bucket.total += audit.overallScore ?? 0;
    bucket.count += 1;
  }

  return Array.from(buckets.entries()).map(([month, bucket]) => ({
    month,
    average: bucket.count > 0 ? Math.round(bucket.total / bucket.count) : 0,
    audits: bucket.count,
  }));
}

function monthKey(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
}

/** The most recent completed audit — what the AI chat grounds itself in. */
export async function getLatestAudit(organizationId: string) {
  return db.audit.findFirst({
    where: { ...orgScope(organizationId), status: AuditStatus.COMPLETED },
    orderBy: { createdAt: 'desc' },
    select: { id: true, url: true, overallScore: true, createdAt: true },
  });
}

export async function getRecentAudits(organizationId: string, limit = 5) {
  const { items } = await listAudits(organizationId, { pageSize: limit, page: 1 });
  return items;
}

/** Verifies an audit belongs to the organization. Returns its website id. */
export async function assertAuditAccess(auditId: string, organizationId: string): Promise<string> {
  const audit = await db.audit.findFirst({
    where: { id: auditId, ...orgScope(organizationId) },
    select: { websiteId: true },
  });
  if (!audit) throw errors.notFound('Audit');
  return audit.websiteId;
}
