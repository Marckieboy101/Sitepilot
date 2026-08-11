import { Suspense } from 'react';

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Gauge,
  Globe,
  ListChecks,
  Sparkles,
} from 'lucide-react';

import {
  CategoryBarChart,
  MonthlyImprovementChart,
  ScoreTrendChart,
} from '@/components/charts';
import { NewAuditButton } from '@/components/dashboard/new-audit-dialog';
import { CategoryCard, StatCard } from '@/components/dashboard/stat-card';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { ScoreRing } from '@/components/shared/score-ring';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { CATEGORY_DESCRIPTIONS, CATEGORY_LABELS } from '@/config/scoring';
import { requireSession } from '@/features/auth/session';
import {
  getDashboardSummary,
  getMonthlyImprovements,
  getOrganizationTrend,
  getRecentAudits,
} from '@/features/audit/queries';
import { displayUrl } from '@/lib/url';
import { formatDuration } from '@/lib/utils';
import type { AuditCategory } from '@prisma/client';

export const metadata: Metadata = { title: 'Dashboard' };

export default async function DashboardPage() {
  const session = await requireSession();

  return (
    <div className="space-y-8">
      <PageHeader
        title={`Welcome back${session.name ? `, ${session.name.split(' ')[0]}` : ''}`}
        description="Your website health at a glance, and what to fix next."
        actions={<NewAuditButton size="lg" />}
      />

      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent organizationId={session.organizationId} />
      </Suspense>
    </div>
  );
}

async function DashboardContent({ organizationId }: { organizationId: string }) {
  // Four independent reads, so they run concurrently rather than serially —
  // the page is only as slow as the slowest one.
  const [summary, trend, monthly, recent] = await Promise.all([
    getDashboardSummary(organizationId),
    getOrganizationTrend(organizationId),
    getMonthlyImprovements(organizationId),
    getRecentAudits(organizationId, 5),
  ]);

  if (summary.totalAudits === 0) {
    return (
      <EmptyState
        icon={<Gauge />}
        title="Run your first audit"
        description="Paste any public URL and we'll analyse SEO, performance, accessibility, security, UX and design — then explain what to fix first."
        action={<NewAuditButton size="lg" />}
      />
    );
  }

  return (
    <div className="space-y-8">
      {/* -- Headline stats ---------------------------------------------- */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Latest score"
          value={summary.latestScore ?? '—'}
          current={summary.latestScore}
          previous={summary.previousScore}
          icon={<Gauge />}
        />
        <StatCard
          label="Average score"
          value={summary.averageScore ?? '—'}
          hint={`across ${summary.totalAudits} audits`}
          icon={<CheckCircle2 />}
        />
        <StatCard
          label="Open recommendations"
          value={summary.openRecommendations}
          hint="waiting to be actioned"
          icon={<ListChecks />}
        />
        <StatCard
          label="Critical issues"
          value={summary.criticalIssues}
          hint={summary.criticalIssues === 0 ? 'nothing urgent' : 'need attention'}
          icon={<AlertTriangle />}
        />
      </div>

      {/* -- Score + trend ----------------------------------------------- */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_2fr]">
        <Card>
          <CardHeader>
            <CardTitle>Overall health</CardTitle>
            <CardDescription>Weighted across all eight categories.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center pb-8">
            <ScoreRing score={summary.latestScore ?? 0} size={168} />
            <p className="mt-5 text-center text-sm leading-relaxed text-muted-foreground">
              {summary.websitesTracked} website{summary.websitesTracked === 1 ? '' : 's'} tracked across{' '}
              {summary.projectCount} project{summary.projectCount === 1 ? '' : 's'}.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Score history</CardTitle>
            <CardDescription>Every audit you&apos;ve run, oldest first.</CardDescription>
          </CardHeader>
          <CardContent>
            {trend.length < 2 ? (
              <p className="py-16 text-center text-sm text-muted-foreground">
                Run another audit to start seeing your trend.
              </p>
            ) : (
              <ScoreTrendChart
                data={trend.map((point) => ({
                  label: point.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                  score: point.score,
                }))}
              />
            )}
          </CardContent>
        </Card>
      </div>

      {/* -- Category breakdown ------------------------------------------ */}
      {summary.categoryAverages.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold tracking-[-0.02em]">Category averages</h2>
              <p className="text-sm text-muted-foreground">Mean score per category across your audits.</p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {summary.categoryAverages.map((entry) => (
              <CategoryCard
                key={entry.category}
                label={CATEGORY_LABELS[entry.category as AuditCategory] ?? entry.category}
                score={entry.score}
                description={CATEGORY_DESCRIPTIONS[entry.category as AuditCategory]}
              />
            ))}
          </div>
        </section>
      )}

      {/* -- Charts ------------------------------------------------------- */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Category comparison</CardTitle>
            <CardDescription>Where your sites are strongest and weakest.</CardDescription>
          </CardHeader>
          <CardContent>
            <CategoryBarChart
              data={summary.categoryAverages.map((entry) => ({
                category: CATEGORY_LABELS[entry.category as AuditCategory] ?? entry.category,
                score: entry.score,
              }))}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Monthly improvement</CardTitle>
            <CardDescription>Average score per month over the last six months.</CardDescription>
          </CardHeader>
          <CardContent>
            <MonthlyImprovementChart data={monthly} />
          </CardContent>
        </Card>
      </div>

      {/* -- Recent audits ------------------------------------------------ */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div className="space-y-1.5">
            <CardTitle>Recent audits</CardTitle>
            <CardDescription>Your five most recent runs.</CardDescription>
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/dashboard/audits">
              View all <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y divide-border">
            {recent.map((audit) => (
              <li key={audit.id}>
                <Link
                  href={`/dashboard/audits/${audit.id}`}
                  className="flex items-center gap-4 px-6 py-4 transition-colors hover:bg-accent/50"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <Globe className="size-4" aria-hidden="true" />
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{displayUrl(audit.url, 52)}</span>
                    <span className="block text-xs text-muted-foreground">
                      {audit.projectName} ·{' '}
                      {audit.createdAt.toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                      {audit.durationMs ? ` · ${formatDuration(audit.durationMs)}` : ''}
                    </span>
                  </span>

                  {audit.criticalIssues > 0 && (
                    <Badge variant="destructive" className="hidden sm:inline-flex">
                      {audit.criticalIssues} critical
                    </Badge>
                  )}

                  {audit.status === 'COMPLETED' && audit.overallScore != null ? (
                    <ScoreRing score={audit.overallScore} size={44} strokeWidth={4} showBand={false} />
                  ) : (
                    <Badge variant={audit.status === 'FAILED' ? 'destructive' : 'muted'}>
                      {audit.status.toLowerCase()}
                    </Badge>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* -- Assistant nudge ---------------------------------------------- */}
      <Card variant="gradient" className="overflow-hidden">
        <CardContent className="flex flex-wrap items-center justify-between gap-6 p-6">
          <div className="flex items-start gap-4">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
              <Sparkles className="size-5" aria-hidden="true" />
            </span>
            <div className="max-w-lg">
              <p className="font-semibold">Ask the assistant what to do first</p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                It has your latest audit in context — ask why a score is low, what to prioritise, or have
                it rewrite a headline for you.
              </p>
            </div>
          </div>
          <Button variant="gradient" asChild>
            <Link href="/dashboard/assistant">
              Open assistant <ArrowRight className="size-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-32" />
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_2fr]">
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-36" />
        ))}
      </div>
    </div>
  );
}
