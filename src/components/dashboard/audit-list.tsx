'use client';

import * as React from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Globe, MoreHorizontal, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { NewAuditButton } from '@/components/dashboard/new-audit-dialog';
import { EmptyState } from '@/components/shared/empty-state';
import { ScoreRing } from '@/components/shared/score-ring';
import { TrendIndicator } from '@/components/shared/trend-indicator';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { deleteAuditAction } from '@/features/audit/actions';
import { displayUrl } from '@/lib/url';
import { formatDuration } from '@/lib/utils';
import type { AuditStatus } from '@prisma/client';

export interface AuditRow {
  id: string;
  url: string;
  status: AuditStatus;
  device: string;
  overallScore: number | null;
  previousScore: number | null;
  createdAt: Date;
  durationMs: number | null;
  projectName: string;
  criticalIssues: number;
}

const STATUS_VARIANT = {
  COMPLETED: 'success',
  RUNNING: 'info',
  QUEUED: 'muted',
  FAILED: 'destructive',
  CANCELED: 'muted',
} as const;

export function AuditList({ audits }: { audits: AuditRow[] }) {
  const [query, setQuery] = React.useState('');

  // Client-side filtering over an already-paginated page. Round-tripping to
  // the server for a substring match on twenty rows would be slower and worse.
  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return audits;
    return audits.filter(
      (audit) =>
        audit.url.toLowerCase().includes(needle) || audit.projectName.toLowerCase().includes(needle),
    );
  }, [query, audits]);

  if (audits.length === 0) {
    return (
      <EmptyState
        icon={<Globe />}
        title="No audits yet"
        description="Run your first audit and it will appear here with its full report and history."
        action={<NewAuditButton size="lg" />}
      />
    );
  }

  return (
    <div className="space-y-4">
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Filter by URL or project…"
        className="max-w-sm"
        aria-label="Filter audits"
      />

      {filtered.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">No audits match “{query}”.</p>
      ) : (
        <Card className="overflow-hidden p-0">
          <ul className="divide-y divide-border">
            {filtered.map((audit) => (
              <AuditRowItem key={audit.id} audit={audit} />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function AuditRowItem({ audit }: { audit: AuditRow }) {
  const router = useRouter();
  const [deleting, setDeleting] = React.useState(false);

  async function handleDelete() {
    setDeleting(true);
    const result = await deleteAuditAction(audit.id);
    setDeleting(false);

    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }

    toast.success('Audit deleted');
    router.refresh();
  }

  return (
    <li className="group relative flex items-center gap-4 px-5 py-4 transition-colors hover:bg-accent/40">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Globe className="size-4" aria-hidden="true" />
      </span>

      <div className="min-w-0 flex-1">
        {/* Stretched link makes the whole row clickable while keeping the
            action menu above it in the stacking order. */}
        <Link href={`/dashboard/audits/${audit.id}`} className="after:absolute after:inset-0">
          <span className="block truncate text-sm font-medium">{displayUrl(audit.url, 56)}</span>
        </Link>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span>{audit.projectName}</span>
          <span aria-hidden="true">·</span>
          <span>
            {audit.createdAt.toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}
          </span>
          <span aria-hidden="true">·</span>
          <span className="capitalize">{audit.device.toLowerCase()}</span>
          {audit.durationMs && (
            <>
              <span aria-hidden="true">·</span>
              <span>{formatDuration(audit.durationMs)}</span>
            </>
          )}
        </span>
      </div>

      <div className="hidden items-center gap-3 sm:flex">
        {audit.criticalIssues > 0 && (
          <Badge variant="destructive">{audit.criticalIssues} critical</Badge>
        )}
        <TrendIndicator current={audit.overallScore} previous={audit.previousScore} />
      </div>

      {audit.status === 'COMPLETED' && audit.overallScore != null ? (
        <ScoreRing score={audit.overallScore} size={46} strokeWidth={4} showBand={false} />
      ) : (
        <Badge variant={STATUS_VARIANT[audit.status]}>{audit.status.toLowerCase()}</Badge>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="relative z-10 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
            aria-label={`Actions for ${displayUrl(audit.url)}`}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={`/dashboard/audits/${audit.id}`}>View report</Link>
          </DropdownMenuItem>
          <DropdownMenuItem destructive disabled={deleting} onSelect={() => void handleDelete()}>
            <Trash2 /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
