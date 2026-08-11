'use client';

import * as React from 'react';

import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { Globe, Monitor, Smartphone, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { startAuditAction } from '@/features/audit/actions';
import { cn } from '@/lib/utils';

/**
 * Audit launcher.
 *
 * The run is a single server action that takes 30-90 seconds, so there is no
 * real progress channel to report from. Rather than fake a percentage, the
 * dialog names the stage the pipeline is in on a timer calibrated to a typical
 * run, and holds on the last stage if the audit takes longer. An honest
 * "Scoring the results…" that lingers reads far better than a progress bar
 * that reaches 95% and stops.
 */

const STAGES = [
  { label: 'Fetching your page', detail: 'Requesting the URL and following redirects' },
  { label: 'Rendering in a browser', detail: 'Running the page with JavaScript enabled' },
  { label: 'Checking SEO', detail: 'Metadata, headings, structured data and links' },
  { label: 'Measuring performance', detail: 'Core Web Vitals via PageSpeed Insights' },
  { label: 'Testing accessibility', detail: 'Full axe-core pass against WCAG 2.2 AA' },
  { label: 'Reviewing UX and design', detail: 'AI is reading the rendered page' },
  { label: 'Writing your report', detail: 'Prioritising fixes by impact against effort' },
];

interface NewAuditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultUrl?: string;
  websiteId?: string;
  projectId?: string;
}

export function NewAuditDialog({
  open,
  onOpenChange,
  defaultUrl = '',
  websiteId,
  projectId,
}: NewAuditDialogProps) {
  const router = useRouter();
  const [url, setUrl] = React.useState(defaultUrl);
  const [device, setDevice] = React.useState<'MOBILE' | 'DESKTOP'>('MOBILE');
  const [running, setRunning] = React.useState(false);
  const [stage, setStage] = React.useState(0);

  React.useEffect(() => {
    if (!running) {
      setStage(0);
      return;
    }
    const timer = setInterval(() => {
      setStage((current) => Math.min(current + 1, STAGES.length - 1));
    }, 7000);
    return () => clearInterval(timer);
  }, [running]);

  React.useEffect(() => {
    if (open) setUrl(defaultUrl);
  }, [open, defaultUrl]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!url.trim() || running) return;

    setRunning(true);
    const result = await startAuditAction({ url: url.trim(), device, websiteId, projectId });
    setRunning(false);

    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }

    toast.success(`Audit complete — scored ${result.data.overallScore}/100`);
    onOpenChange(false);
    router.push(`/dashboard/audits/${result.data.auditId}`);
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Closing mid-run would orphan the request without cancelling it, and
        // the user would lose the result they already paid a credit for.
        if (running) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-md" hideClose={running}>
        <DialogHeader>
          <DialogTitle>{running ? 'Auditing your website' : 'New audit'}</DialogTitle>
          <DialogDescription>
            {running
              ? 'This usually takes under a minute. Keep this window open.'
              : 'Paste any public URL. We analyse the exact page a visitor would see.'}
          </DialogDescription>
        </DialogHeader>

        {running ? (
          <div className="space-y-1 py-2" role="status" aria-live="polite">
            {STAGES.map((entry, index) => {
              const state = index < stage ? 'done' : index === stage ? 'active' : 'pending';
              return (
                <div key={entry.label} className="flex items-start gap-3 rounded-lg px-2 py-2">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
                    {state === 'done' && (
                      <svg viewBox="0 0 20 20" className="size-4 text-success" fill="none" aria-hidden="true">
                        <path
                          d="M5 10.5 8.5 14 15 6.5"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                    {state === 'active' && (
                      <span className="relative flex size-2.5">
                        <span className="animate-pulse-ring absolute inline-flex size-full rounded-full bg-primary" />
                        <span className="relative inline-flex size-2.5 rounded-full bg-primary" />
                      </span>
                    )}
                    {state === 'pending' && <span className="size-1.5 rounded-full bg-muted-foreground/30" />}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        'text-sm transition-colors',
                        state === 'pending' ? 'text-muted-foreground/50' : 'text-foreground',
                        state === 'active' && 'font-medium',
                      )}
                    >
                      {entry.label}
                    </p>
                    <AnimatePresence>
                      {state === 'active' && (
                        <motion.p
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="text-xs text-muted-foreground"
                        >
                          {entry.detail}
                        </motion.p>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="audit-url">Website URL</Label>
              <Input
                id="audit-url"
                autoFocus
                inputMode="url"
                spellCheck={false}
                placeholder="yourwebsite.com/pricing"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                icon={<Globe />}
              />
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Device</legend>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    { value: 'MOBILE', label: 'Mobile', icon: Smartphone, hint: 'How Google indexes' },
                    { value: 'DESKTOP', label: 'Desktop', icon: Monitor, hint: '1440px viewport' },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setDevice(option.value)}
                    aria-pressed={device === option.value}
                    className={cn(
                      'flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-all',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      device === option.value
                        ? 'border-primary bg-primary/[0.06]'
                        : 'border-border hover:border-border/80 hover:bg-accent/50',
                    )}
                  >
                    <option.icon
                      className={cn('size-4', device === option.value ? 'text-primary' : 'text-muted-foreground')}
                      aria-hidden="true"
                    />
                    <span className="text-sm font-medium">{option.label}</span>
                    <span className="text-xs text-muted-foreground">{option.hint}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            <Button type="submit" variant="gradient" size="lg" className="w-full" disabled={!url.trim()}>
              <Sparkles className="size-4" />
              Run audit
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Convenience trigger used on empty states and detail pages. */
export function NewAuditButton({
  children,
  defaultUrl,
  websiteId,
  projectId,
  variant = 'gradient',
  size = 'default',
  className,
}: {
  children?: React.ReactNode;
  defaultUrl?: string;
  websiteId?: string;
  projectId?: string;
  variant?: React.ComponentProps<typeof Button>['variant'];
  size?: React.ComponentProps<typeof Button>['size'];
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <Button variant={variant} size={size} className={className} onClick={() => setOpen(true)}>
        {children ?? (
          <>
            <Sparkles className="size-4" />
            Run an audit
          </>
        )}
      </Button>
      <NewAuditDialog
        open={open}
        onOpenChange={setOpen}
        defaultUrl={defaultUrl}
        websiteId={websiteId}
        projectId={projectId}
      />
    </>
  );
}
