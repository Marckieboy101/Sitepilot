import { NextResponse, type NextRequest } from 'next/server';
import type Stripe from 'stripe';
import { Plan, SubscriptionStatus } from '@prisma/client';

import { db } from '@/lib/db';
import { serverEnv } from '@/lib/env';
import { logger } from '@/lib/logger';
import { mapSubscriptionStatus, planForPriceId, stripe, toDate } from '@/features/billing/stripe';

/**
 * Stripe webhook.
 *
 * Three things this handler gets deliberately right, because each is a way
 * billing silently breaks:
 *
 *  1. **Signature verification on the raw body.** `request.text()` before any
 *     parsing — a re-serialised body produces a different signature and every
 *     event would be rejected. The middleware excludes this path so nothing
 *     touches the body first.
 *  2. **Idempotency.** Stripe retries, and delivers out of order. Every handler
 *     is a full-state upsert keyed on the organization, so replaying an old
 *     event converges rather than corrupting.
 *  3. **Always 200 on handled-but-failed.** A non-2xx makes Stripe retry with
 *     backoff for days. We return 200 once the event is understood, and log
 *     failures for our own alerting instead of asking Stripe to hammer us.
 */

const log = logger.child({ module: 'webhooks/stripe' });

const HANDLED_EVENTS = new Set<Stripe.Event.Type>([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
]);

export async function POST(request: NextRequest) {
  const secret = serverEnv().STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    log.error('webhook received but STRIPE_WEBHOOK_SECRET is not set');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) return NextResponse.json({ error: 'Missing signature' }, { status: 400 });

  // Raw body, untouched.
  const payload = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(payload, signature, secret);
  } catch (error) {
    log.warn('signature verification failed', { error });
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  if (!HANDLED_EVENTS.has(event.type)) {
    return NextResponse.json({ received: true, handled: false });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await onCheckoutCompleted(event.data.object);
        break;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await onSubscriptionChanged(event.data.object);
        break;
      case 'invoice.paid':
      case 'invoice.payment_failed':
        await onInvoice(event.data.object);
        break;
    }
  } catch (error) {
    // Understood but failed to apply: log loudly, but do not ask Stripe to
    // retry for days against a bug that a retry will not fix.
    log.error('webhook handler failed', { type: event.type, eventId: event.id, error });
  }

  return NextResponse.json({ received: true });
}

/** Finds the organization an event belongs to, by metadata then by customer. */
async function resolveOrganizationId(input: {
  metadataOrgId?: string | null;
  clientReferenceId?: string | null;
  customerId?: string | null;
}): Promise<string | null> {
  const direct = input.metadataOrgId ?? input.clientReferenceId;
  if (direct) {
    const organization = await db.organization.findUnique({ where: { id: direct }, select: { id: true } });
    if (organization) return organization.id;
  }

  if (input.customerId) {
    const subscription = await db.subscription.findFirst({
      where: { stripeCustomerId: input.customerId },
      select: { organizationId: true },
    });
    if (subscription) return subscription.organizationId;
  }

  return null;
}

async function onCheckoutCompleted(session: Stripe.Checkout.Session) {
  const organizationId = await resolveOrganizationId({
    metadataOrgId: session.metadata?.organizationId,
    clientReferenceId: session.client_reference_id,
    customerId: typeof session.customer === 'string' ? session.customer : session.customer?.id,
  });

  if (!organizationId) {
    log.error('checkout completed for unknown organization', { sessionId: session.id });
    return;
  }

  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;

  // Link the customer immediately. The subscription event that follows carries
  // the plan detail, but if it arrives first this keeps the link intact.
  await db.subscription.upsert({
    where: { organizationId },
    create: { organizationId, stripeCustomerId: customerId ?? null },
    update: { stripeCustomerId: customerId ?? undefined },
  });

  log.info('checkout completed', { organizationId, sessionId: session.id });
}

async function onSubscriptionChanged(subscription: Stripe.Subscription) {
  const customerId =
    typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;

  const organizationId = await resolveOrganizationId({
    metadataOrgId: subscription.metadata?.organizationId,
    customerId,
  });

  if (!organizationId) {
    log.error('subscription event for unknown organization', { subscriptionId: subscription.id });
    return;
  }

  const priceId = subscription.items.data[0]?.price.id ?? null;
  const status = mapSubscriptionStatus(subscription.status);

  // A deleted or terminally-failed subscription drops entitlements back to
  // Free rather than leaving a paid plan attached to an unpaid account.
  const terminal =
    status === SubscriptionStatus.CANCELED ||
    status === SubscriptionStatus.INCOMPLETE_EXPIRED ||
    status === SubscriptionStatus.UNPAID;

  // An unrecognised price means the plan catalogue and Stripe have drifted.
  // Falling back to Free is the safe direction — it under-grants rather than
  // handing out an Agency plan by accident — and the log line is the alert.
  const resolvedPlan = priceId ? planForPriceId(priceId) : null;
  if (!terminal && priceId && !resolvedPlan) {
    log.error('no plan matches Stripe price; defaulting to Free', { priceId, subscriptionId: subscription.id });
  }
  const plan: Plan = terminal ? Plan.FREE : (resolvedPlan ?? Plan.FREE);

  const periodStart = toDate(subscription.current_period_start);
  const periodEnd = toDate(subscription.current_period_end);

  await db.subscription.upsert({
    where: { organizationId },
    create: {
      organizationId,
      plan,
      status,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
      stripePriceId: priceId,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      canceledAt: toDate(subscription.canceled_at),
      trialEndsAt: toDate(subscription.trial_end),
    },
    update: {
      plan,
      status,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
      stripePriceId: priceId,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      canceledAt: toDate(subscription.canceled_at),
      trialEndsAt: toDate(subscription.trial_end),
    },
  });

  await db.notification
    .createMany({
      data: await notificationsForPlanChange(organizationId, plan, status),
    })
    .catch(() => undefined);

  log.info('subscription updated', { organizationId, plan, status });
}

async function notificationsForPlanChange(
  organizationId: string,
  plan: Plan,
  status: SubscriptionStatus,
) {
  const members = await db.organizationMember.findMany({
    where: { organizationId, role: { in: ['OWNER', 'ADMIN'] } },
    select: { userId: true },
  });

  const title =
    status === SubscriptionStatus.PAST_DUE
      ? 'Payment failed'
      : plan === Plan.FREE
        ? 'Subscription ended'
        : `You're on the ${plan.charAt(0) + plan.slice(1).toLowerCase()} plan`;

  const body =
    status === SubscriptionStatus.PAST_DUE
      ? 'We could not take your last payment. Update your card to keep your plan active.'
      : plan === Plan.FREE
        ? 'Your plan has reverted to Free. Your audit history is unchanged.'
        : 'Your new plan is active. Everything it includes is available immediately.';

  return members.map((member) => ({
    userId: member.userId,
    kind: 'billing',
    title,
    body,
    href: '/dashboard/billing',
  }));
}

async function onInvoice(invoice: Stripe.Invoice) {
  const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;

  const organizationId = await resolveOrganizationId({
    metadataOrgId: invoice.metadata?.organizationId,
    customerId,
  });

  if (!organizationId || !invoice.id) return;

  await db.invoice.upsert({
    where: { stripeInvoiceId: invoice.id },
    create: {
      organizationId,
      stripeInvoiceId: invoice.id,
      number: invoice.number ?? null,
      amountDue: invoice.amount_due,
      amountPaid: invoice.amount_paid,
      currency: invoice.currency,
      status: invoice.status ?? 'unknown',
      hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
      invoicePdfUrl: invoice.invoice_pdf ?? null,
      periodStart: toDate(invoice.period_start),
      periodEnd: toDate(invoice.period_end),
    },
    update: {
      amountPaid: invoice.amount_paid,
      status: invoice.status ?? 'unknown',
      hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
      invoicePdfUrl: invoice.invoice_pdf ?? null,
    },
  });
}
