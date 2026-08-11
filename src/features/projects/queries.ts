import { AuditStatus } from '@prisma/client';

import { db } from '@/lib/db';

/**
 * Project read models. Server-only, scoped by organization in the WHERE clause.
 */

export interface ProjectSummary {
  id: string;
  name: string;
  description: string | null;
  color: string;
  createdAt: Date;
  websiteCount: number;
  auditCount: number;
  averageScore: number | null;
  websites: Array<{
    id: string;
    url: string;
    domain: string;
    label: string | null;
    faviconUrl: string | null;
    latestScore: number | null;
    latestAuditId: string | null;
    latestAuditAt: Date | null;
    auditCount: number;
  }>;
}

export async function listProjects(organizationId: string): Promise<ProjectSummary[]> {
  const projects = await db.project.findMany({
    where: { organizationId, archived: false },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      name: true,
      description: true,
      color: true,
      createdAt: true,
      websites: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          url: true,
          domain: true,
          label: true,
          faviconUrl: true,
          _count: { select: { audits: true } },
          // One completed audit per website is enough for the card; pulling
          // the full history here would be a query amplification.
          audits: {
            where: { status: AuditStatus.COMPLETED },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { id: true, overallScore: true, createdAt: true },
          },
        },
      },
    },
  });

  return projects.map((project) => {
    const websites = project.websites.map((website) => {
      const latest = website.audits[0];
      return {
        id: website.id,
        url: website.url,
        domain: website.domain,
        label: website.label,
        faviconUrl: website.faviconUrl,
        latestScore: latest?.overallScore ?? null,
        latestAuditId: latest?.id ?? null,
        latestAuditAt: latest?.createdAt ?? null,
        auditCount: website._count.audits,
      };
    });

    const scored = websites.filter((website) => website.latestScore != null);

    return {
      id: project.id,
      name: project.name,
      description: project.description,
      color: project.color,
      createdAt: project.createdAt,
      websiteCount: websites.length,
      auditCount: websites.reduce((sum, website) => sum + website.auditCount, 0),
      averageScore:
        scored.length > 0
          ? Math.round(scored.reduce((sum, website) => sum + (website.latestScore ?? 0), 0) / scored.length)
          : null,
      websites,
    };
  });
}

/** Lightweight list for pickers. */
export async function listProjectOptions(organizationId: string) {
  return db.project.findMany({
    where: { organizationId, archived: false },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, color: true },
  });
}

export async function listWebsiteOptions(organizationId: string) {
  return db.website.findMany({
    where: { project: { organizationId } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      url: true,
      domain: true,
      label: true,
      project: { select: { id: true, name: true } },
    },
  });
}
