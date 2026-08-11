import type { Metadata } from 'next';
import Link from 'next/link';
import { FileText } from 'lucide-react';

import { NewAuditButton } from '@/components/dashboard/new-audit-dialog';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { ScoreRing } from '@/components/shared/score-ring';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { requireSession } from '@/features/auth/session';
import { db } from '@/lib/db';
import { displayUrl } from '@/lib/url';
import { truncate } from '@/lib/utils';

export const metadata: Metadata = { title: 'AI reports' };

export default async function ReportsPage() {
  const session = await requireSession();

  const reports = await db.aiReport.findMany({
    where: { audit: { website: { project: { organizationId: session.organizationId } } } },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      executiveSummary: true,
      strengths: true,
      weaknesses: true,
      model: true,
      createdAt: true,
      audit: {
        select: { id: true, url: true, overallScore: true, createdAt: true },
      },
    },
  });

  return (
    <div className="space-y-8">
      <PageHeader
        title="AI reports"
        description="Every written report we've generated, newest first."
        actions={<NewAuditButton />}
      />

      {reports.length === 0 ? (
        <EmptyState
          icon={<FileText />}
          title="No reports yet"
          description="Each completed audit produces a written report explaining what the numbers mean and what to fix first."
          action={<NewAuditButton size="lg" />}
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {reports.map((report) => (
            <Link
              key={report.id}
              href={`/dashboard/audits/${report.audit.id}`}
              className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Card variant="default" interactive className="h-full">
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{displayUrl(report.audit.url, 40)}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {report.createdAt.toLocaleDateString('en-US', {
                          month: 'long',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </p>
                    </div>
                    {report.audit.overallScore != null && (
                      <ScoreRing
                        score={report.audit.overallScore}
                        size={52}
                        strokeWidth={4}
                        showBand={false}
                      />
                    )}
                  </div>

                  <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                    {truncate(report.executiveSummary.split(/\n{2,}/)[0], 260)}
                  </p>

                  <div className="mt-4 flex flex-wrap gap-1.5">
                    <Badge variant="success">{report.strengths.length} strengths</Badge>
                    <Badge variant="warning">{report.weaknesses.length} weaknesses</Badge>
                    <Badge variant="muted" className="font-mono text-[0.625rem]">
                      {report.model === 'deterministic-fallback' ? 'rule-based' : report.model}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
