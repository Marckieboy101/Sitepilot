'use client';

import * as React from 'react';

import { useSearchParams } from 'next/navigation';
import { Check, CreditCard, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { PLANS, PLAN_ORDER, yearlySavingPercent } from '@/config/plans';
import { createCheckoutAction, createPortalAction } from '@/features/billing/actions';
import { cn, formatCurrency } from '@/lib/utils';
import type { Plan, SubscriptionStatus } from '@prisma/client';

interface BillingPanelProps {
  plan: Plan;
  status: SubscriptionStatus;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
  hasStripeCustomer: boolean;
  billingConfigured: boolean;
  usage: {
    auditsRun: number;
    aiReports: number;
    aiChatMessages: number;
    pdfExports: number;
    competitorRuns: number;
  };
  limits: {
    auditsPerMonth: number | null;
    aiChatMessagesPerMonth: number | null;
    projects: number | null;
  };
  invoices: Array<{
    id: string;
    number: string | null;
    amountPaid: number;
    currency: string;
    status: string;
    hostedInvoiceUrl: string | null;
    createdAt: Date;
  }>;
}

const STATUS_COPY: Partial<Record<SubscriptionStatus, { label: string; variant: 'success' | 'warning' | 'destructive' | 'muted' }>> = {
  ACTIVE: { label: 'Active', variant: 'success' },
  TRIALING: { label: 'Trial', variant: 'success' },
  PAST_DUE: { label: 'Payment failed', variant: 'destructive' },
  CANCELED: { label: 'Cancelled', variant: 'muted' },
  UNPAID: { label: 'Unpaid', variant: 'destructive' },
  PAUSED: { label: 'Paused', variant: 'warning' },
};

export function BillingPanel(props: BillingPanelProps) {
  const searchParams = useSearchParams();
  const [yearly, setYearly] = React.useState(false);
  const [pending, setPending] = React.useState<string | null>(null);

  // Checkout returns via a query param rather than a webhook the browser can
  // see, so the confirmation toast is driven from the URL.
  React.useEffect(() => {
    const checkout = searchParams.get('checkout');
    if (checkout === 'success') {
      toast.success('Payment received — your new plan is active.');
    } else if (checkout === 'cancelled') {
      toast.info('Checkout cancelled. Nothing was charged.');
    }
  }, [searchParams]);

  async function handleUpgrade(plan: 'PRO' | 'AGENCY') {
    setPending(plan);
    const result = await createCheckoutAction({ plan, interval: yearly ? 'yearly' : 'monthly' });

    if (!result.ok) {
      toast.error(result.error.message);
      setPending(null);
      return;
    }

    window.location.href = result.data.url;
  }

  async function handlePortal() {
    setPending('portal');
    const result = await createPortalAction();

    if (!result.ok) {
      toast.error(result.error.message);
      setPending(null);
      return;
    }

    window.location.href = result.data.url;
  }

  const statusCopy = STATUS_COPY[props.status];
  const currentPlan = PLANS[props.plan];

  return (
    <div className="space-y-6">
      {/* -- Current plan --------------------------------------------------- */}
      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2.5">
              {currentPlan.name} plan
              {statusCopy && <Badge variant={statusCopy.variant}>{statusCopy.label}</Badge>}
            </CardTitle>
            <CardDescription>
              {props.cancelAtPeriodEnd && props.currentPeriodEnd
                ? `Cancels on ${props.currentPeriodEnd.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}. You keep everything until then.`
                : props.currentPeriodEnd
                  ? `Renews on ${props.currentPeriodEnd.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.`
                  : currentPlan.tagline}
            </CardDescription>
          </div>

          {props.hasStripeCustomer && props.billingConfigured && (
            <Button variant="outline" onClick={handlePortal} loading={pending === 'portal'}>
              <CreditCard className="size-4" />
              Manage billing
            </Button>
          )}
        </CardHeader>

        <CardContent>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <UsageMeter
              label="Audits this month"
              used={props.usage.auditsRun}
              limit={props.limits.auditsPerMonth}
            />
            <UsageMeter
              label="AI chat messages"
              used={props.usage.aiChatMessages}
              limit={props.limits.aiChatMessagesPerMonth}
            />
            <UsageMeter label="PDF exports" used={props.usage.pdfExports} limit={null} />
            <UsageMeter label="Competitor runs" used={props.usage.competitorRuns} limit={null} />
            <UsageMeter label="AI reports" used={props.usage.aiReports} limit={null} />
          </div>

          <p className="mt-6 text-xs text-muted-foreground">
            Usage resets on the first of each month (UTC).
          </p>
        </CardContent>
      </Card>

      {props.status === 'PAST_DUE' && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/[0.06] p-4">
          <p className="text-sm font-medium text-destructive">We couldn&apos;t take your last payment</p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Your plan is still active for now. Update your card in the billing portal to avoid losing
            access.
          </p>
        </div>
      )}

      {!props.billingConfigured && (
        <div className="rounded-xl border border-warning/30 bg-warning/[0.06] p-4">
          <p className="text-sm font-medium">Billing is not configured on this deployment</p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Set the Stripe environment variables to enable plan upgrades.
          </p>
        </div>
      )}

      {/* -- Plans ---------------------------------------------------------- */}
      <div className="flex items-center justify-center gap-3">
        <span className={cn('text-sm', !yearly && 'font-medium')}>Monthly</span>
        <Switch checked={yearly} onCheckedChange={setYearly} aria-label="Show yearly pricing" />
        <span className={cn('text-sm', yearly && 'font-medium')}>Yearly</span>
        <Badge variant="success">Save {yearlySavingPercent('PRO')}%</Badge>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {PLAN_ORDER.map((planId) => {
          const plan = PLANS[planId];
          const isCurrent = planId === props.plan;
          const price = yearly ? plan.yearlyPriceCents : plan.monthlyPriceCents;
          const isFree = plan.monthlyPriceCents === 0;

          return (
            <Card
              key={planId}
              variant={isCurrent ? 'gradient' : 'default'}
              className={cn('flex flex-col', isCurrent && 'ring-1 ring-primary/30')}
            >
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>{plan.name}</CardTitle>
                  {isCurrent && <Badge>Current</Badge>}
                </div>
                <CardDescription>{plan.tagline}</CardDescription>
                <div className="pt-4">
                  <span className="text-3xl font-semibold tracking-[-0.03em]">
                    {isFree ? 'Free' : formatCurrency(price)}
                  </span>
                  {!isFree && (
                    <span className="ml-1.5 text-sm text-muted-foreground">
                      /{yearly ? 'year' : 'month'}
                    </span>
                  )}
                </div>
              </CardHeader>

              <CardContent className="flex flex-1 flex-col">
                <ul className="flex-1 space-y-2.5">
                  {plan.bullets.map((bullet) => (
                    <li key={bullet} className="flex items-start gap-2.5 text-sm">
                      <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                      <span className="text-muted-foreground">{bullet}</span>
                    </li>
                  ))}
                </ul>

                {!isCurrent && !isFree && (
                  <Button
                    variant="gradient"
                    className="mt-6 w-full"
                    disabled={!props.billingConfigured}
                    loading={pending === planId}
                    onClick={() => handleUpgrade(planId as 'PRO' | 'AGENCY')}
                  >
                    {PLAN_ORDER.indexOf(planId) > PLAN_ORDER.indexOf(props.plan)
                      ? `Upgrade to ${plan.name}`
                      : `Switch to ${plan.name}`}
                  </Button>
                )}

                {isCurrent && (
                  <Button variant="outline" className="mt-6 w-full" disabled>
                    Your current plan
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* -- Invoices ------------------------------------------------------- */}
      {props.invoices.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Invoices</CardTitle>
            <CardDescription>Your billing history.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {props.invoices.map((invoice) => (
                <li key={invoice.id} className="flex items-center gap-4 px-6 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{invoice.number ?? 'Invoice'}</p>
                    <p className="text-xs text-muted-foreground">
                      {invoice.createdAt.toLocaleDateString('en-US', {
                        month: 'long',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </p>
                  </div>
                  <span className="text-sm font-medium tabular-nums">
                    {formatCurrency(invoice.amountPaid, invoice.currency)}
                  </span>
                  <Badge variant={invoice.status === 'paid' ? 'success' : 'warning'}>
                    {invoice.status}
                  </Badge>
                  {invoice.hostedInvoiceUrl && (
                    <a
                      href={invoice.hostedInvoiceUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-muted-foreground transition-colors hover:text-foreground"
                      aria-label={`View invoice ${invoice.number ?? ''}`}
                    >
                      <ExternalLink className="size-4" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function UsageMeter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const percent = limit == null ? 0 : Math.min(100, (used / limit) * 100);
  const exhausted = limit != null && used >= limit;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className={cn('text-sm font-medium tabular-nums', exhausted && 'text-destructive')}>
          {used}
          {limit != null ? ` / ${limit}` : ''}
        </span>
      </div>
      {limit != null ? (
        <Progress
          value={percent}
          className="mt-2 h-1.5"
          indicatorColor={exhausted ? 'hsl(var(--destructive))' : undefined}
        />
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">Unlimited</p>
      )}
    </div>
  );
}
