import type { Metadata } from 'next';
import Link from 'next/link';
import { History } from 'lucide-react';

import { ScoreTrendChart } from '@/components/charts';
import { NewAuditButton } from '@/components/dashboard/new-audit-dialog';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { TrendIndicator } from '@/components/shared/trend-indicator';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BAND_COLORS, scoreBand } from '@/config/scoring';
import { requireSession } from '@/features/auth/session';
import { getScoreHistory } from '@/features/audit/queries';
import { db } from '@/lib/db';
import { displayUrl } from '@/lib/url';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'History' };

/**
 * Per-website timelines.
 *
 * Grouped by website rather than shown as one flat list: a score only means
 * something relative to the same page's previous score, so mixing several
 * sites into one chart would produce a line that moves for no reason anyone
 * could act on.
 */
export default async function HistoryPage() {
  const session = await requireSession();

  const websites = await db.website.findMany({
    where: {
      project: { organizationId: session.organizationId },
      audits: { some: { status: 'COMPLETED' } },
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      url: true,
      label: true,
      domain: true,
      project: { select: { name: true } },
    },
  });

  if (websites.length === 0) {
    return (
      <div className="space-y-8">
        <PageHeader title="History" description="Track how your scores change over time." />
        <EmptyState
          icon={<History />}
          title="No history yet"
          description="Once you've run two or more audits on the same page, the trend appears here."
          action={<NewAuditButton size="lg" />}
        />
      </div>
    );
  }

  const timelines = await Promise.all(
    websites.map(async (website) => ({
      website,
      history: await getScoreHistory(website.id, session.organizationId, 30),
    })),
  );

  return (
    <div className="space-y-8">
      <PageHeader
        title="History"
        description="How each page has scored over time, and what changed between runs."
        actions={<NewAuditButton />}
      />

      <div className="space-y-6">
        {timelines.map(({ website, history }) => (
          <WebsiteTimeline
            key={website.id}
            label={website.label ?? website.domain}
            url={website.url}
            projectName={website.project.name}
            history={history}
          />
        ))}
      </div>
    </div>
  );
}

async function WebsiteTimeline({
  label,
  url,
  projectName,
  history,
}: {
  label: string;
  url: string;
  projectName: string;
  history: Array<{ date: Date; overall: number; categories: Record<string, number> }>;
}) {
  const latest = history[history.length - 1];
  const previous = history.length > 1 ? history[history.length - 2] : null;

  const session = await requireSession();
  const audits = await db.audit.findMany({
    where: {
      url,
      status: 'COMPLETED',
      website: { project: { organizationId: session.organizationId } },
    },
    orderBy: { createdAt: 'desc' },
    take: 12,
    select: { id: true, overallScore: true, previousScore: true, createdAt: true },
  });

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div className="min-w-0 space-y-1.5">
          <CardTitle className="truncate">{label}</CardTitle>
          <CardDescription>
            {projectName} · {displayUrl(url, 48)} · {history.length} audit
            {history.length === 1 ? '' : 's'}
          </CardDescription>
        </div>
        {latest && (
          <div className="shrink-0 text-right">
            <p className="text-2xl font-semibold tabular-nums">{latest.overall}</p>
            <TrendIndicator current={latest.overall} previous={previous?.overall ?? null} />
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-6">
        {history.length >= 2 ? (
          <ScoreTrendChart
            height={220}
            data={history.map((point) => ({
              label: point.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
              score: point.overall,
            }))}
          />
        ) : (
          <p className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
            Run this audit again to start plotting a trend.
          </p>
        )}

        <div>
          <h3 className="mb-3 text-sm font-medium">Audit timeline</h3>
          <ol className="relative space-y-3 border-l border-border pl-5">
            {audits.map((audit) => {
              const band = audit.overallScore != null ? BAND_COLORS[scoreBand(audit.overallScore)] : null;
              return (
                <li key={audit.id} className="relative">
                  <span
                    className="absolute -left-[1.4375rem] top-2 size-2 rounded-full ring-4 ring-background"
                    style={{ backgroundColor: band?.hex ?? 'hsl(var(--muted-foreground))' }}
                    aria-hidden="true"
                  />
                  <Link
                    href={`/dashboard/audits/${audit.id}`}
                    className="flex items-center justify-between gap-4 rounded-lg px-3 py-2 transition-colors hover:bg-accent/50"
                  >
                    <span className="text-sm text-muted-foreground">
                      {audit.createdAt.toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </span>
                    <span className="flex items-center gap-3">
                      <TrendIndicator current={audit.overallScore} previous={audit.previousScore} />
                      {audit.overallScore != null && band && (
                        <Badge
                          className={cn('tabular-nums', band.bg, band.text)}
                          variant="muted"
                        >
                          {audit.overallScore}
                        </Badge>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </div>
      </CardContent>
    </Card>
  );
}
