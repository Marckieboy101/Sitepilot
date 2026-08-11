'use client';

import * as React from 'react';

import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Clock,
  ExternalLink,
  Info,
  Lightbulb,
  Link2,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';

import { DifficultyBadge, PriorityBadge, SeverityBadge } from '@/components/shared/severity-badge';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CATEGORY_LABELS, METRIC_THRESHOLDS, metricVerdict, type MetricKey } from '@/config/scoring';
import { updateRecommendationStatusAction } from '@/features/audit/actions';
import { cn, formatBytes, formatEstimate, formatMs } from '@/lib/utils';
import type {
  AuditCategory,
  Difficulty,
  Priority,
  RecommendationStatus,
  Severity,
} from '@prisma/client';

/**
 * Report rendering components.
 *
 * The organising principle: a reader should be able to stop at any point and
 * still have something actionable. Executive summary first, then the
 * prioritised fixes, then the raw evidence — never the other way round.
 */

// ---------------------------------------------------------------------------
// Executive summary
// ---------------------------------------------------------------------------

export function ExecutiveSummary({
  summary,
  strengths,
  weaknesses,
  longTermOutlook,
  model,
}: {
  summary: string;
  strengths: string[];
  weaknesses: string[];
  longTermOutlook: string | null;
  model: string;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div className="space-y-1.5">
          <CardTitle>Executive summary</CardTitle>
          <CardDescription>What this audit means for your website.</CardDescription>
        </div>
        <Badge variant="muted" className="shrink-0 font-mono text-[0.6875rem]">
          {model === 'deterministic-fallback' ? 'rule-based' : model}
        </Badge>
      </CardHeader>

      <CardContent className="space-y-8">
        <div className="space-y-4 text-[0.9375rem] leading-relaxed text-muted-foreground">
          {summary.split(/\n{2,}/).map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </div>

        {(strengths.length > 0 || weaknesses.length > 0) && (
          <div className="grid gap-6 sm:grid-cols-2">
            {strengths.length > 0 && (
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <Check className="size-4 text-success" aria-hidden="true" />
                  Strengths
                </h3>
                <ul className="mt-3 space-y-2.5">
                  {strengths.map((item, index) => (
                    <li key={index} className="flex gap-2.5 text-sm leading-relaxed text-muted-foreground">
                      <span className="mt-2 size-1 shrink-0 rounded-full bg-success" aria-hidden="true" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {weaknesses.length > 0 && (
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <AlertTriangle className="size-4 text-warning" aria-hidden="true" />
                  Holding you back
                </h3>
                <ul className="mt-3 space-y-2.5">
                  {weaknesses.map((item, index) => (
                    <li key={index} className="flex gap-2.5 text-sm leading-relaxed text-muted-foreground">
                      <span className="mt-2 size-1 shrink-0 rounded-full bg-warning" aria-hidden="true" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {longTermOutlook && (
          <div className="rounded-xl border border-border bg-muted/40 p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <TrendingUp className="size-4 text-primary" aria-hidden="true" />
              Longer term
            </h3>
            <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">{longTermOutlook}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------------------

export interface RecommendationItem {
  id: string;
  category: AuditCategory;
  kind: 'QUICK_WIN' | 'LONG_TERM';
  priority: Priority;
  status: RecommendationStatus;
  title: string;
  explanation: string;
  expectedImpact: string;
  difficulty: Difficulty;
  estimatedMinutes: number;
  impactScore: number;
}

export function RecommendationList({ recommendations }: { recommendations: RecommendationItem[] }) {
  const [filter, setFilter] = React.useState<'all' | 'quick' | 'high'>('all');

  const filtered = React.useMemo(() => {
    if (filter === 'quick') return recommendations.filter((item) => item.kind === 'QUICK_WIN');
    if (filter === 'high') return recommendations.filter((item) => item.priority === 'HIGH');
    return recommendations;
  }, [filter, recommendations]);

  const quickWinCount = recommendations.filter((item) => item.kind === 'QUICK_WIN').length;
  const highCount = recommendations.filter((item) => item.priority === 'HIGH').length;

  if (recommendations.length === 0) {
    return (
      <Card>
        <CardContent className="py-14 text-center">
          <Check className="mx-auto size-8 text-success" aria-hidden="true" />
          <p className="mt-3 font-medium">Nothing to fix</p>
          <p className="mt-1 text-sm text-muted-foreground">
            This audit found no actionable improvements. That is rare — nice work.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5">
            <CardTitle>What to fix, in order</CardTitle>
            <CardDescription>
              Ranked by impact against the effort each one takes. Start at the top.
            </CardDescription>
          </div>

          <div
            className="flex gap-1 rounded-lg bg-muted p-1"
            role="group"
            aria-label="Filter recommendations"
          >
            {(
              [
                { value: 'all', label: `All ${recommendations.length}` },
                { value: 'quick', label: `Quick wins ${quickWinCount}` },
                { value: 'high', label: `High ${highCount}` },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setFilter(option.value)}
                aria-pressed={filter === option.value}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  filter === option.value
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No recommendations match that filter.
          </p>
        ) : (
          filtered.map((recommendation, index) => (
            <RecommendationRow key={recommendation.id} recommendation={recommendation} index={index + 1} />
          ))
        )}
      </CardContent>
    </Card>
  );
}

function RecommendationRow({
  recommendation,
  index,
}: {
  recommendation: RecommendationItem;
  index: number;
}) {
  const [expanded, setExpanded] = React.useState(index === 1);
  const [status, setStatus] = React.useState(recommendation.status);
  const [saving, setSaving] = React.useState(false);
  const router = useRouter();
  const bodyId = `recommendation-${recommendation.id}`;

  const done = status === 'DONE';

  async function toggleDone() {
    const next: RecommendationStatus = done ? 'OPEN' : 'DONE';
    // Optimistic: the checkbox should respond instantly, and a failed write
    // is recoverable by rolling back.
    setStatus(next);
    setSaving(true);

    const result = await updateRecommendationStatusAction({
      recommendationId: recommendation.id,
      status: next,
    });
    setSaving(false);

    if (!result.ok) {
      setStatus(status);
      toast.error(result.error.message);
      return;
    }

    router.refresh();
  }

  return (
    <div
      className={cn(
        'rounded-xl border transition-colors',
        done ? 'border-border/60 bg-muted/30' : 'border-border bg-card',
      )}
    >
      <div className="flex items-start gap-3 p-4">
        <button
          type="button"
          onClick={toggleDone}
          disabled={saving}
          aria-pressed={done}
          aria-label={done ? `Mark "${recommendation.title}" as not done` : `Mark "${recommendation.title}" as done`}
          className={cn(
            'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            done ? 'border-success bg-success text-white' : 'border-input hover:border-primary',
          )}
        >
          {done && <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />}
        </button>

        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-controls={bodyId}
          className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <div className="flex items-start justify-between gap-3">
            <p className={cn('text-sm font-medium', done && 'text-muted-foreground line-through')}>
              {recommendation.title}
            </p>
            <ChevronDown
              className={cn(
                'mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform',
                expanded && 'rotate-180',
              )}
              aria-hidden="true"
            />
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <PriorityBadge priority={recommendation.priority} />
            <Badge variant="outline">{CATEGORY_LABELS[recommendation.category]}</Badge>
            <DifficultyBadge difficulty={recommendation.difficulty} />
            {recommendation.kind === 'QUICK_WIN' && (
              <Badge variant="success">
                <Zap className="size-3" aria-hidden="true" /> Quick win
              </Badge>
            )}
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="size-3" aria-hidden="true" />
              {formatEstimate(recommendation.estimatedMinutes)}
            </span>
          </div>
        </button>
      </div>

      {expanded && (
        <div id={bodyId} className="space-y-4 border-t border-border/60 px-4 py-4 pl-12">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">What to do</p>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              {recommendation.explanation}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Expected impact
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              {recommendation.expectedImpact}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

export interface IssueItem {
  id: string;
  category: AuditCategory;
  severity: Severity;
  code: string;
  title: string;
  description: string;
  evidence: string | null;
  helpUrl: string | null;
}

export function IssueList({ issues }: { issues: IssueItem[] }) {
  const grouped = React.useMemo(() => {
    const map = new Map<AuditCategory, IssueItem[]>();
    for (const issue of issues) {
      const list = map.get(issue.category) ?? [];
      list.push(issue);
      map.set(issue.category, list);
    }
    return Array.from(map.entries());
  }, [issues]);

  if (issues.length === 0) {
    return (
      <Card>
        <CardContent className="py-14 text-center">
          <Check className="mx-auto size-8 text-success" aria-hidden="true" />
          <p className="mt-3 font-medium">No issues found</p>
          <p className="mt-1 text-sm text-muted-foreground">Every check we run passed on this page.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {grouped.map(([category, categoryIssues]) => (
        <Card key={category}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {CATEGORY_LABELS[category]}
              <Badge variant="muted">{categoryIssues.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {categoryIssues.map((issue) => (
              <div key={issue.id} className="rounded-xl border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <p className="text-sm font-medium">{issue.title}</p>
                  <SeverityBadge severity={issue.severity} />
                </div>

                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{issue.description}</p>

                {issue.evidence && (
                  <pre className="mt-3 max-h-40 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs leading-relaxed text-muted-foreground">
                    {issue.evidence}
                  </pre>
                )}

                <div className="mt-3 flex items-center gap-3">
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.6875rem] text-muted-foreground">
                    {issue.code}
                  </code>
                  {issue.helpUrl && (
                    <a
                      href={issue.helpUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline"
                    >
                      Documentation <ExternalLink className="size-3" aria-hidden="true" />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Core Web Vitals
// ---------------------------------------------------------------------------

const VERDICT_STYLE = {
  good: { label: 'Good', className: 'text-success', bar: 'bg-success' },
  'needs-improvement': { label: 'Needs work', className: 'text-warning', bar: 'bg-warning' },
  poor: { label: 'Poor', className: 'text-destructive', bar: 'bg-destructive' },
} as const;

export function WebVitals({
  metrics,
  source,
}: {
  metrics: Partial<Record<MetricKey, number | null>>;
  source: string;
}) {
  const entries = (Object.keys(METRIC_THRESHOLDS) as MetricKey[])
    .map((key) => ({ key, value: metrics[key] ?? null }))
    .filter((entry) => entry.value != null);

  if (entries.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          Performance metrics were not available for this run.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div className="space-y-1.5">
          <CardTitle>Core Web Vitals</CardTitle>
          <CardDescription>
            {source === 'psi'
              ? 'Measured by Google PageSpeed Insights.'
              : 'Estimated from our own measurement — connect a PageSpeed API key for lab-grade numbers.'}
          </CardDescription>
        </div>
        <Badge variant={source === 'psi' ? 'success' : 'warning'}>
          {source === 'psi' ? 'Lighthouse' : 'Estimated'}
        </Badge>
      </CardHeader>

      <CardContent className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map(({ key, value }) => {
          const threshold = METRIC_THRESHOLDS[key];
          const verdict = metricVerdict(key, value) ?? 'good';
          const style = VERDICT_STYLE[verdict];

          // Position on a 0-to-2× "poor" scale so the marker stays on-scale
          // even for a catastrophically slow page.
          const scaleMax = threshold.poor * 2;
          const position = Math.min(100, ((value ?? 0) / scaleMax) * 100);

          return (
            <div key={key} className="rounded-xl border border-border p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-medium text-muted-foreground">{threshold.label}</p>
                <span className={cn('text-[0.6875rem] font-medium', style.className)}>{style.label}</span>
              </div>

              <p className={cn('mt-2 text-xl font-semibold tabular-nums', style.className)}>
                {threshold.unit === 'ms' ? formatMs(value) : (value ?? 0).toFixed(3)}
              </p>

              <div className="relative mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                {/* Threshold bands behind the marker give the number context. */}
                <div className="absolute inset-y-0 left-0 bg-success/25" style={{ width: `${(threshold.good / scaleMax) * 100}%` }} />
                <div
                  className="absolute inset-y-0 bg-warning/25"
                  style={{
                    left: `${(threshold.good / scaleMax) * 100}%`,
                    width: `${((threshold.poor - threshold.good) / scaleMax) * 100}%`,
                  }}
                />
                <div
                  className="absolute top-1/2 size-2.5 -translate-y-1/2 rounded-full ring-2 ring-background"
                  style={{ left: `calc(${position}% - 5px)`, backgroundColor: 'currentColor' }}
                />
              </div>

              <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">{threshold.description}</p>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// AI dimension breakdown
// ---------------------------------------------------------------------------

export interface DimensionEntry {
  score: number;
  verdict: string;
  notes: string;
}

export function DimensionBreakdown({
  title,
  description,
  dimensions,
}: {
  title: string;
  description: string;
  dimensions: Record<string, DimensionEntry>;
}) {
  const entries = Object.entries(dimensions).sort((a, b) => a[1].score - b[1].score);

  if (entries.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {entries.map(([key, dimension]) => (
          <div key={key} className="rounded-xl border border-border p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium capitalize">
                  {key.replace(/([A-Z])/g, ' $1').toLowerCase()}
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">{dimension.verdict}</p>
              </div>
              <span className="shrink-0 text-lg font-semibold tabular-nums">{dimension.score}</span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{dimension.notes}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Technical detail panels
// ---------------------------------------------------------------------------

export function DetailGrid({ rows }: { rows: Array<{ label: string; value: React.ReactNode }> }) {
  return (
    <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
      {rows.map((row) => (
        <div key={row.label} className="flex items-baseline justify-between gap-4 border-b border-border/50 pb-2">
          <dt className="text-sm text-muted-foreground">{row.label}</dt>
          <dd className="text-sm font-medium tabular-nums">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function BooleanValue({ value, trueLabel = 'Yes', falseLabel = 'No' }: { value: boolean | null; trueLabel?: string; falseLabel?: string }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={value ? 'text-success' : 'text-destructive'}>{value ? trueLabel : falseLabel}</span>
  );
}

export function BrokenLinksPanel({
  links,
}: {
  links: Array<{ id: string; href: string; anchorText: string | null; statusCode: number | null; isInternal: boolean }>;
}) {
  if (links.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link2 className="size-4 text-destructive" aria-hidden="true" />
          Broken links
          <Badge variant="destructive">{links.length}</Badge>
        </CardTitle>
        <CardDescription>Links on this page that did not resolve when we checked them.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {links.map((link) => (
          <div key={link.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5">
            <Badge variant={link.isInternal ? 'destructive' : 'warning'} className="shrink-0">
              {link.statusCode ?? 'unreachable'}
            </Badge>
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-xs">{link.href}</p>
              {link.anchorText && (
                <p className="truncate text-xs text-muted-foreground">“{link.anchorText}”</p>
              )}
            </div>
            <Badge variant="muted" className="hidden shrink-0 sm:inline-flex">
              {link.isInternal ? 'internal' : 'external'}
            </Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function WarningsBanner({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;

  return (
    <div className="rounded-xl border border-warning/30 bg-warning/[0.06] p-4">
      <div className="flex gap-3">
        <Info className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
        <div className="min-w-0 space-y-1.5">
          <p className="text-sm font-medium">Some checks were limited on this run</p>
          <ul className="space-y-1">
            {warnings.map((warning, index) => (
              <li key={index} className="text-sm leading-relaxed text-muted-foreground">
                {warning}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export function PageWeightPanel({
  totalBytes,
  imageBytes,
  scriptBytes,
  styleBytes,
  fontBytes,
  documentBytes,
  requestCount,
}: {
  totalBytes: number | null;
  imageBytes: number | null;
  scriptBytes: number | null;
  styleBytes: number | null;
  fontBytes: number | null;
  documentBytes: number | null;
  requestCount: number | null;
}) {
  const segments = [
    { label: 'Images', bytes: imageBytes, color: 'hsl(var(--chart-1))' },
    { label: 'JavaScript', bytes: scriptBytes, color: 'hsl(var(--chart-2))' },
    { label: 'CSS', bytes: styleBytes, color: 'hsl(var(--chart-3))' },
    { label: 'Fonts', bytes: fontBytes, color: 'hsl(var(--chart-4))' },
    { label: 'HTML', bytes: documentBytes, color: 'hsl(var(--chart-5))' },
  ].filter((segment): segment is { label: string; bytes: number; color: string } => Boolean(segment.bytes));

  const total = totalBytes ?? segments.reduce((sum, segment) => sum + segment.bytes, 0);
  if (total === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Page weight</CardTitle>
        <CardDescription>
          {formatBytes(total)} across {requestCount ?? '—'} requests.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {segments.length > 0 ? (
          <>
            <div className="flex h-3 overflow-hidden rounded-full" role="img" aria-label={`Page weight breakdown: ${segments.map((segment) => `${segment.label} ${formatBytes(segment.bytes)}`).join(', ')}`}>
              {segments.map((segment) => (
                <div
                  key={segment.label}
                  style={{ width: `${(segment.bytes / total) * 100}%`, backgroundColor: segment.color }}
                />
              ))}
            </div>
            <ul className="mt-5 space-y-2.5">
              {segments.map((segment) => (
                <li key={segment.label} className="flex items-center gap-2.5 text-sm">
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: segment.color }}
                    aria-hidden="true"
                  />
                  <span className="text-muted-foreground">{segment.label}</span>
                  <span className="ml-auto font-medium tabular-nums">{formatBytes(segment.bytes)}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Total transfer was {formatBytes(total)}. A detailed breakdown needs a PageSpeed Insights run.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function OpportunityList({
  opportunities,
}: {
  opportunities: Array<{ id: string; title: string; description: string; savingsMs?: number; savingsBytes?: number }>;
}) {
  if (opportunities.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lightbulb className="size-4 text-warning" aria-hidden="true" />
          Performance opportunities
        </CardTitle>
        <CardDescription>Savings Lighthouse estimates for this page.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {opportunities.map((opportunity) => (
          <div key={opportunity.id} className="rounded-xl border border-border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <p className="text-sm font-medium">{opportunity.title}</p>
              <div className="flex gap-1.5">
                {opportunity.savingsMs != null && <Badge variant="warning">{formatMs(opportunity.savingsMs)}</Badge>}
                {opportunity.savingsBytes != null && (
                  <Badge variant="info">{formatBytes(opportunity.savingsBytes)}</Badge>
                )}
              </div>
            </div>
            {opportunity.description && (
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{opportunity.description}</p>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
