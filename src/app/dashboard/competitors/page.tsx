import type { Metadata } from 'next';

import { CompetitorWorkspace } from '@/components/dashboard/competitor-workspace';
import { PageHeader } from '@/components/shared/page-header';
import { PLANS } from '@/config/plans';
import { requireSession } from '@/features/auth/session';
import { getEntitlements } from '@/features/billing/quota';
import { db } from '@/lib/db';

export const metadata: Metadata = { title: 'Competitors' };

export default async function CompetitorsPage() {
  const session = await requireSession();

  const [entitlements, websites, comparisons] = await Promise.all([
    getEntitlements(session.organizationId),
    db.website.findMany({
      where: { project: { organizationId: session.organizationId } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        url: true,
        label: true,
        domain: true,
        competitors: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, url: true, label: true, domain: true },
        },
        _count: { select: { audits: { where: { status: 'COMPLETED' } } } },
      },
    }),
    db.comparison.findMany({
      where: { organizationId: session.organizationId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        title: true,
        aiSummary: true,
        createdAt: true,
        entries: {
          select: {
            id: true,
            label: true,
            url: true,
            isSelf: true,
            overallScore: true,
            seoScore: true,
            performanceScore: true,
            accessibilityScore: true,
            uxScore: true,
            designScore: true,
            contentScore: true,
            securityScore: true,
          },
        },
      },
    }),
  ]);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Competitors"
        description="Audit competing sites with the same engine and see where you actually stand."
      />

      <CompetitorWorkspace
        websites={websites.map((website) => ({
          id: website.id,
          url: website.url,
          label: website.label,
          domain: website.domain,
          hasAudit: website._count.audits > 0,
          competitors: website.competitors,
        }))}
        comparisons={comparisons}
        enabled={PLANS[entitlements.plan].features.competitorAnalysis}
      />
    </div>
  );
}
