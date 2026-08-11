'use client';

import * as React from 'react';

import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, ArrowRight, Check, Sparkles } from 'lucide-react';

import { ScoreBar, ScoreRing } from '@/components/shared/score-ring';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { CATEGORY_LABELS } from '@/config/scoring';
import type { PublicAuditResult } from '@/features/audit/actions';
import { displayUrl } from '@/lib/url';
import type { AuditCategory } from '@prisma/client';

/**
 * Result panel for the landing-page trial audit.
 *
 * The staged loading copy is not decoration: a real audit takes 15-25 seconds,
 * and naming the step in progress is what keeps that from feeling broken. The
 * stages advance on a timer rather than from real progress events — the run is
 * a single server action with no progress channel — so the wording is
 * deliberately about what the system is doing overall, never a percentage we
 * would be inventing.
 */

const STAGES = [
  'Fetching your page…',
  'Parsing HTML and metadata…',
  'Checking SEO fundamentals…',
  'Measuring performance…',
  'Scanning for accessibility barriers…',
  'Reviewing security headers…',
  'Scoring the results…',
];

export function AuditPreviewLoading() {
  const [stage, setStage] = React.useState(0);

  React.useEffect(() => {
    const timer = setInterval(() => {
      setStage((current) => Math.min(current + 1, STAGES.length - 1));
    }, 2600);
    return () => clearInterval(timer);
  }, []);

  return (
    <Card variant="glass" className="overflow-hidden p-6 sm:p-8">
      <div className="flex items-center gap-3">
        <span className="relative flex size-2.5">
          <span className="animate-pulse-ring absolute inline-flex size-full rounded-full bg-primary" />
          <span className="relative inline-flex size-2.5 rounded-full bg-primary" />
        </span>
        <AnimatePresence mode="wait">
          <motion.p
            key={stage}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25 }}
            className="text-sm font-medium text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            {STAGES[stage]}
          </motion.p>
        </AnimatePresence>
      </div>

      <div className="mt-7 grid gap-8 sm:grid-cols-[auto_1fr] sm:items-center">
        <Skeleton className="mx-auto size-[148px] rounded-full sm:mx-0" />
        <div className="space-y-3.5">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="flex items-center gap-3">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-1.5 flex-1" />
              <Skeleton className="h-3 w-7" />
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

export function AuditPreviewError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card variant="glass" className="p-6 sm:p-8">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
          <AlertTriangle className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">We couldn&apos;t audit that URL</p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{message}</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
            Try another URL
          </Button>
        </div>
      </div>
    </Card>
  );
}

export function AuditPreviewResult({ result }: { result: PublicAuditResult }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    >
      <Card variant="glass" className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-6 py-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="size-2 shrink-0 rounded-full bg-success" aria-hidden="true" />
            <p className="truncate font-mono text-xs text-muted-foreground">{displayUrl(result.url, 48)}</p>
          </div>
          <Badge variant="secondary">Free preview</Badge>
        </div>

        <div className="grid gap-8 p-6 sm:grid-cols-[auto_1fr] sm:items-center sm:p-8">
          <div className="flex justify-center sm:justify-start">
            <ScoreRing score={result.overallScore} size={148} label="Overall" />
          </div>

          <div className="space-y-3.5">
            {result.categories.slice(0, 6).map((category) => (
              <ScoreBar
                key={category.category}
                label={CATEGORY_LABELS[category.category as AuditCategory] ?? category.category}
                score={category.score}
              />
            ))}
          </div>
        </div>

        {result.topIssues.length > 0 && (
          <div className="border-t border-border/60 px-6 py-5 sm:px-8">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Top issues found
            </p>
            <ul className="mt-3 space-y-2">
              {result.topIssues.slice(0, 3).map((issue, index) => (
                <li key={index} className="flex items-start gap-2.5 text-sm">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" />
                  <span className="text-muted-foreground">{issue.title}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {result.quickWins.length > 0 && (
          <div className="border-t border-border/60 px-6 py-5 sm:px-8">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Quick wins</p>
            <ul className="mt-3 space-y-2">
              {result.quickWins.map((win, index) => (
                <li key={index} className="flex items-start gap-2.5 text-sm">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden="true" />
                  <span className="text-muted-foreground">{win.title}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="border-t border-border/60 bg-[linear-gradient(120deg,hsl(var(--glow-a)/0.07),hsl(var(--glow-b)/0.07))] px-6 py-5 sm:px-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-start gap-2.5">
              <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
              <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
                This is the fast preview. A full audit adds the AI report, UX and design analysis,
                screenshots, a prioritised fix list and PDF export.
              </p>
            </div>
            <Button variant="gradient" asChild>
              <Link href="/signup">
                Get the full report <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
