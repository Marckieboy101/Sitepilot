'use client';

import * as React from 'react';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Globe, Lock, Plus, Sparkles, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';

import { ComparisonBarChart, CategoryRadarChart } from '@/components/charts';
import { EmptyState } from '@/components/shared/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  addCompetitorAction,
  removeCompetitorAction,
  runComparisonAction,
} from '@/features/competitors/actions';
import { displayUrl } from '@/lib/url';
import { cn } from '@/lib/utils';

export interface WebsiteWithCompetitors {
  id: string;
  url: string;
  label: string | null;
  domain: string;
  hasAudit: boolean;
  competitors: Array<{ id: string; url: string; label: string | null; domain: string }>;
}

export interface ComparisonRecord {
  id: string;
  title: string | null;
  aiSummary: string | null;
  createdAt: Date;
  entries: Array<{
    id: string;
    label: string;
    url: string;
    isSelf: boolean;
    overallScore: number;
    seoScore: number;
    performanceScore: number;
    accessibilityScore: number;
    uxScore: number;
    designScore: number;
    contentScore: number;
    securityScore: number;
  }>;
}

interface Props {
  websites: WebsiteWithCompetitors[];
  comparisons: ComparisonRecord[];
  enabled: boolean;
}

export function CompetitorWorkspace({ websites, comparisons, enabled }: Props) {
  const router = useRouter();
  const [selectedWebsiteId, setSelectedWebsiteId] = React.useState(websites[0]?.id ?? '');
  const [selectedCompetitors, setSelectedCompetitors] = React.useState<string[]>([]);
  const [addOpen, setAddOpen] = React.useState(false);
  const [running, setRunning] = React.useState(false);

  const website = websites.find((entry) => entry.id === selectedWebsiteId) ?? websites[0];

  React.useEffect(() => {
    // Selections are per-website; carrying them across would submit ids the
    // server would reject.
    setSelectedCompetitors([]);
  }, [selectedWebsiteId]);

  if (!enabled) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center py-16 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <Lock className="size-5" aria-hidden="true" />
          </span>
          <h2 className="mt-5 text-lg font-semibold">Competitor analysis is a Pro feature</h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
            Run the same audit against your competitors and see, category by category, where you genuinely
            lead and where you do not.
          </p>
          <Button variant="gradient" size="lg" className="mt-6" asChild>
            <Link href="/dashboard/billing">Upgrade to Pro</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (websites.length === 0) {
    return (
      <EmptyState
        icon={<Globe />}
        title="Add a website first"
        description="Competitor analysis compares one of your websites against others, so there needs to be something to compare."
        action={
          <Button variant="gradient" size="lg" asChild>
            <Link href="/dashboard/projects">Go to projects</Link>
          </Button>
        }
      />
    );
  }

  async function handleRun() {
    if (!website || selectedCompetitors.length === 0) return;

    setRunning(true);
    const result = await runComparisonAction({
      websiteId: website.id,
      competitorIds: selectedCompetitors,
    });
    setRunning(false);

    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }

    toast.success('Comparison complete');
    setSelectedCompetitors([]);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Compare against competitors</CardTitle>
          <CardDescription>
            We audit each competitor with the same engine, then score them side by side.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="website-select">Your website</Label>
            <Select value={selectedWebsiteId} onValueChange={setSelectedWebsiteId}>
              <SelectTrigger id="website-select" className="max-w-md">
                <SelectValue placeholder="Pick a website" />
              </SelectTrigger>
              <SelectContent>
                {websites.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {entry.label ?? entry.domain}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {website && !website.hasAudit && (
            <p className="rounded-xl border border-warning/30 bg-warning/[0.06] p-4 text-sm text-muted-foreground">
              Run an audit on this website first — there is nothing to compare against yet.
            </p>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Competitors</Label>
              <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
                <Plus className="size-3.5" /> Add
              </Button>
            </div>

            {!website || website.competitors.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
                No competitors added yet.
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-xl border border-border">
                {website.competitors.map((competitor) => (
                  <CompetitorRow
                    key={competitor.id}
                    competitor={competitor}
                    checked={selectedCompetitors.includes(competitor.id)}
                    onToggle={(checked) =>
                      setSelectedCompetitors((current) =>
                        checked
                          ? [...current, competitor.id]
                          : current.filter((id) => id !== competitor.id),
                      )
                    }
                  />
                ))}
              </ul>
            )}
          </div>

          <Button
            variant="gradient"
            size="lg"
            onClick={handleRun}
            loading={running}
            loadingText="Auditing competitors…"
            disabled={!website?.hasAudit || selectedCompetitors.length === 0}
          >
            <Sparkles className="size-4" />
            Run comparison
            {selectedCompetitors.length > 0 && ` (${selectedCompetitors.length})`}
          </Button>
        </CardContent>
      </Card>

      {comparisons.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title="No comparisons yet"
          description="Add a competitor above and run a comparison to see how you stack up."
        />
      ) : (
        comparisons.map((comparison) => <ComparisonCard key={comparison.id} comparison={comparison} />)
      )}

      {website && (
        <AddCompetitorDialog open={addOpen} onOpenChange={setAddOpen} websiteId={website.id} />
      )}
    </div>
  );
}

function CompetitorRow({
  competitor,
  checked,
  onToggle,
}: {
  competitor: { id: string; url: string; label: string | null; domain: string };
  checked: boolean;
  onToggle: (checked: boolean) => void;
}) {
  const router = useRouter();

  async function handleRemove() {
    const result = await removeCompetitorAction(competitor.id);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    toast.success('Competitor removed');
    router.refresh();
  }

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <Checkbox
        id={`competitor-${competitor.id}`}
        checked={checked}
        onCheckedChange={(value) => onToggle(value === true)}
      />
      <label htmlFor={`competitor-${competitor.id}`} className="min-w-0 flex-1 cursor-pointer">
        <span className="block truncate text-sm font-medium">{competitor.label ?? competitor.domain}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {displayUrl(competitor.url, 48)}
        </span>
      </label>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={handleRemove}
        aria-label={`Remove ${competitor.domain}`}
      >
        <Trash2 className="size-4" />
      </Button>
    </li>
  );
}

const CATEGORY_KEYS = [
  { key: 'seoScore', label: 'SEO' },
  { key: 'performanceScore', label: 'Performance' },
  { key: 'accessibilityScore', label: 'Accessibility' },
  { key: 'uxScore', label: 'UX' },
  { key: 'designScore', label: 'Design' },
  { key: 'contentScore', label: 'Content' },
  { key: 'securityScore', label: 'Security' },
] as const;

function ComparisonCard({ comparison }: { comparison: ComparisonRecord }) {
  const seriesKeys = comparison.entries.map((entry) => entry.label);

  const chartData = CATEGORY_KEYS.map(({ key, label }) => {
    const row: Record<string, string | number> = { category: label };
    for (const entry of comparison.entries) row[entry.label] = entry[key];
    return row;
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{comparison.title ?? 'Comparison'}</CardTitle>
        <CardDescription>
          {comparison.createdAt.toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          })}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-8">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {comparison.entries.map((entry) => (
            <div
              key={entry.id}
              className={cn(
                'rounded-xl border p-4',
                entry.isSelf ? 'border-primary/40 bg-primary/[0.05]' : 'border-border',
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{entry.label}</p>
                  <p className="truncate text-xs text-muted-foreground">{displayUrl(entry.url, 30)}</p>
                </div>
                <span className="shrink-0 text-xl font-semibold tabular-nums">{entry.overallScore}</span>
              </div>
              {entry.isSelf && (
                <Badge variant="default" className="mt-2.5">
                  Your site
                </Badge>
              )}
            </div>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="mb-3 text-sm font-medium">Category by category</h3>
            <ComparisonBarChart data={chartData} seriesKeys={seriesKeys} />
          </div>
          <div>
            <h3 className="mb-3 text-sm font-medium">Overall shape</h3>
            <CategoryRadarChart
              categories={CATEGORY_KEYS.map((entry) => entry.label)}
              series={comparison.entries.map((entry) => ({
                name: entry.label,
                data: Object.fromEntries(CATEGORY_KEYS.map(({ key, label }) => [label, entry[key]])),
              }))}
            />
          </div>
        </div>

        {comparison.aiSummary && (
          <div className="rounded-xl border border-border bg-muted/30 p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="size-4 text-primary" aria-hidden="true" />
              What this means
            </h3>
            <div className="mt-3 space-y-2.5 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
              {comparison.aiSummary}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AddCompetitorDialog({
  open,
  onOpenChange,
  websiteId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  websiteId: string;
}) {
  const router = useRouter();
  const [url, setUrl] = React.useState('');
  const [label, setLabel] = React.useState('');
  const [pending, setPending] = React.useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);

    const result = await addCompetitorAction({
      websiteId,
      url: url.trim(),
      label: label.trim() || undefined,
    });
    setPending(false);

    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }

    toast.success('Competitor added');
    setUrl('');
    setLabel('');
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a competitor</DialogTitle>
          <DialogDescription>
            Use the page that competes with yours most directly — usually their homepage or the equivalent
            landing page.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="competitor-url">Competitor URL</Label>
            <Input
              id="competitor-url"
              autoFocus
              inputMode="url"
              spellCheck={false}
              placeholder="competitor.com"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              icon={<Globe />}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="competitor-label">Label (optional)</Label>
            <Input
              id="competitor-label"
              placeholder="Main competitor"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="gradient" loading={pending} disabled={!url.trim()}>
              Add competitor
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
