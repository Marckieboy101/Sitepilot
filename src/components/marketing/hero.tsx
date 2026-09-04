'use client';

import * as React from 'react';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { Globe, Sparkles, Zap } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { publicAuditAction, type PublicAuditResult } from '@/features/audit/actions';
import { cn } from '@/lib/utils';

import { AuroraBackground } from './aurora-background';
import { AuditPreviewError, AuditPreviewLoading, AuditPreviewResult } from './audit-preview';

/**
 * Hero with a working audit, not a mock.
 *
 * The URL field runs a real (reduced) audit through the same engine the
 * product uses. That decision costs real compute on anonymous traffic, which
 * is why the public path skips the browser, link probing and the AI pass, and
 * is rate-limited by IP — but a demo that actually analyses the visitor's own
 * site converts on a completely different scale to a screenshot of one.
 */

const rise = {
  hidden: { opacity: 0, y: 20 },
  visible: (index: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, delay: index * 0.08, ease: [0.16, 1, 0.3, 1] as const },
  }),
};

type State =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'done'; result: PublicAuditResult }
  | { status: 'error'; message: string };

export function Hero() {
  const [url, setUrl] = React.useState('');
  const [state, setState] = React.useState<State>({ status: 'idle' });
  const resultRef = React.useRef<HTMLDivElement>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!url.trim() || state.status === 'running') return;

    setState({ status: 'running' });
    // Bring the result panel into view while it loads, so the staged progress
    // copy is actually visible rather than below the fold.
    requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));

    const response = await publicAuditAction({ url: url.trim() });

    if (response.ok) setState({ status: 'done', result: response.data });
    else setState({ status: 'error', message: response.error.message });
  }

  return (
    <section className="relative overflow-hidden pb-20 pt-32 sm:pb-28 sm:pt-40">
      <AuroraBackground />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <motion.div initial="hidden" animate="visible" custom={0} variants={rise}>
            <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/60 px-3.5 py-1.5 text-xs font-medium backdrop-blur">
              <Sparkles className="size-3.5 text-primary" aria-hidden="true" />
              AI that explains what to fix, and why it matters
            </span>
          </motion.div>

          <motion.h1
            initial="hidden"
            animate="visible"
            custom={1}
            variants={rise}
            className="mt-7 text-4xl font-semibold leading-[1.08] tracking-[-0.035em] sm:text-6xl lg:text-[4.25rem]"
          >
            Know exactly why your
            <br className="hidden sm:block" />{' '}
            <span className="text-gradient">website underperforms</span>
          </motion.h1>

          <motion.p
            initial="hidden"
            animate="visible"
            custom={2}
            variants={rise}
            className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground"
          >
            WebDataScout runs a full technical audit — SEO, Core Web Vitals, accessibility, security —
            then explains the results in plain English and tells you what to fix first.
          </motion.p>

          <motion.form
            initial="hidden"
            animate="visible"
            custom={3}
            variants={rise}
            onSubmit={handleSubmit}
            className="mx-auto mt-9 flex max-w-xl flex-col gap-3 sm:flex-row"
          >
            <label htmlFor="hero-url" className="sr-only">
              Website URL to audit
            </label>
            <Input
              id="hero-url"
              type="text"
              inputMode="url"
              autoComplete="url"
              spellCheck={false}
              placeholder="yourwebsite.com"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              icon={<Globe />}
              className="h-13 flex-1 bg-card/70 text-base backdrop-blur sm:h-14"
              disabled={state.status === 'running'}
            />
            <Button
              type="submit"
              variant="gradient"
              size="xl"
              loading={state.status === 'running'}
              loadingText="Analysing…"
              disabled={!url.trim()}
              className="sm:w-auto"
            >
              <Zap className="size-4" />
              Analyse free
            </Button>
          </motion.form>

          <motion.p
            initial="hidden"
            animate="visible"
            custom={4}
            variants={rise}
            className="mt-4 text-sm text-muted-foreground"
          >
            No signup for the preview · 3 full audits free ·{' '}
            <Link href="/signup" className="font-medium text-foreground underline-offset-4 hover:underline">
              Create an account
            </Link>{' '}
            for the AI report
          </motion.p>
        </div>

        {/* Result panel. Reserved space avoids a jarring layout jump. */}
        <div ref={resultRef} className={cn('mx-auto mt-14 max-w-3xl', state.status === 'idle' && 'hidden')}>
          {state.status === 'running' && <AuditPreviewLoading />}
          {state.status === 'error' && (
            <AuditPreviewError message={state.message} onRetry={() => setState({ status: 'idle' })} />
          )}
          {state.status === 'done' && <AuditPreviewResult result={state.result} />}
        </div>

        {state.status === 'idle' && (
          <motion.div
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="mx-auto mt-16 max-w-5xl"
          >
            <DashboardMockup />
          </motion.div>
        )}
      </div>
    </section>
  );
}

/**
 * Stylised product shot. Built from real markup rather than an image so it is
 * crisp at every density, follows the theme, and costs no image bytes.
 */
function DashboardMockup() {
  const categories = [
    { label: 'SEO', score: 92, color: 'hsl(var(--chart-3))' },
    { label: 'Performance', score: 68, color: 'hsl(var(--chart-4))' },
    { label: 'Accessibility', score: 84, color: 'hsl(var(--chart-2))' },
    { label: 'UX', score: 77, color: 'hsl(var(--chart-1))' },
    { label: 'Design', score: 88, color: 'hsl(var(--chart-6))' },
    { label: 'Security', score: 45, color: 'hsl(var(--chart-5))' },
  ];

  return (
    <div className="relative" aria-hidden="true">
      <div className="absolute -inset-x-8 -top-8 bottom-0 rounded-[2rem] bg-[linear-gradient(120deg,hsl(var(--glow-a)/0.16),hsl(var(--glow-b)/0.16))] blur-3xl" />

      <div className="glass-strong relative overflow-hidden rounded-2xl shadow-2xl">
        {/* Window chrome */}
        <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
          <span className="size-2.5 rounded-full bg-destructive/60" />
          <span className="size-2.5 rounded-full bg-warning/60" />
          <span className="size-2.5 rounded-full bg-success/60" />
          <div className="ml-3 flex-1 rounded-md bg-muted/60 px-3 py-1 font-mono text-[0.6875rem] text-muted-foreground">
            app.webdatascout.ai/dashboard
          </div>
        </div>

        <div className="grid gap-6 p-6 sm:grid-cols-[1fr_1.4fr] sm:p-8">
          <div className="flex flex-col items-center justify-center rounded-xl border border-border/60 bg-card/50 p-6">
            <div className="relative flex size-32 items-center justify-center">
              <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90 size-full">
                <circle cx="50" cy="50" r="44" fill="none" stroke="hsl(var(--muted))" strokeWidth="8" />
                <circle
                  cx="50"
                  cy="50"
                  r="44"
                  fill="none"
                  stroke="hsl(var(--chart-1))"
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray="276.5"
                  strokeDashoffset="63.6"
                />
              </svg>
              <div className="text-center">
                <div className="text-3xl font-semibold tracking-tight">77</div>
                <div className="text-[0.625rem] uppercase tracking-wider text-muted-foreground">Overall</div>
              </div>
            </div>
            <p className="mt-4 text-center text-xs text-muted-foreground">
              <span className="font-medium text-success">+12</span> since last audit
            </p>
          </div>

          <div className="space-y-3.5 rounded-xl border border-border/60 bg-card/50 p-6">
            {categories.map((category) => (
              <div key={category.label} className="flex items-center gap-3">
                <span className="w-24 shrink-0 text-xs text-muted-foreground">{category.label}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${category.score}%`, backgroundColor: category.color }}
                  />
                </div>
                <span className="w-6 text-right text-xs font-medium tabular-nums">{category.score}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-border/60 px-6 py-5 sm:px-8">
          <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/[0.06] p-4">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">Fix this first:</span> your hero image is 2.4 MB
              and loads before anything else renders. Compressing it to WebP would cut around 1.8 seconds
              off the time visitors wait for the page to appear.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
