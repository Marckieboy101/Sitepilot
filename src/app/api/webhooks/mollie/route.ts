import { addMonths } from 'date-fns';
import { NextResponse, type NextRequest } from 'next/server';

import { SubscriptionStatus } from '@prisma/client';

import { db } from '@/lib/db';
import { serverEnv } from '@/lib/env';
import { logger } from '@/lib/logger';

const log = logger.child({ module: 'webhooks/mollie' });

interface MolliePayment {
  id: string;
  status: string;
  amount?: { value?: string; currency?: string };
  metadata?: { orderId?: string };
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const contentType = request.headers.get('content-type') ?? '';
  let paymentId: string | undefined;
  try {
    paymentId = contentType.includes('application/json')
      ? (JSON.parse(rawBody) as { id?: string }).id
      : new URLSearchParams(rawBody).get('id') ?? undefined;
  } catch {
    return NextResponse.json({ error: 'Invalid Mollie webhook payload.' }, { status: 400 });
  }

  if (!paymentId) {
    return NextResponse.json({ error: 'Missing Mollie payment ID.' }, { status: 400 });
  }

  try {
    const apiKey = serverEnv().MOLLIE_API_KEY;
    if (!apiKey) {
      log.error('Mollie webhook received without API configuration');
      return NextResponse.json({ error: 'Payment provider is not configured.' }, { status: 503 });
    }

    const response = await fetch(`https://api.mollie.com/v2/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) {
      log.error('could not verify Mollie payment', { paymentId, status: response.status });
      return NextResponse.json({ error: 'Could not verify payment.' }, { status: 502 });
    }

    const payment = (await response.json()) as MolliePayment;
    paymentId = payment.id;
    const orderId = payment.metadata?.orderId;
    if (!orderId) {
      log.warn('Mollie payment has no matching order metadata', { paymentId });
      return NextResponse.json({ received: true });
    }

    const order = await db.molliePayment.findUnique({ where: { id: orderId } });
    if (!order) {
      log.warn('Mollie payment order was not found', { paymentId, orderId });
      return NextResponse.json({ error: 'Payment order was not found.' }, { status: 404 });
    }

    const amountCents = Math.round(Number.parseFloat(payment.amount?.value ?? '') * 100);
    if (
      order.molliePaymentId && order.molliePaymentId !== paymentId ||
      !Number.isFinite(amountCents) ||
      amountCents !== order.amountCents ||
      payment.amount?.currency !== order.currency
    ) {
      log.error('Mollie payment did not match its stored order', { paymentId, orderId });
      return NextResponse.json({ error: 'Payment does not match the order.' }, { status: 400 });
    }

    const status = payment.status.toLowerCase();
    const paid = status === 'paid';

    await db.$transaction(async (tx) => {
      const updated = await tx.molliePayment.updateMany({
        where: { id: order.id, status: { not: 'paid' } },
        data: { molliePaymentId: paymentId, status },
      });
      if (updated.count === 0 || !paid) return;

      if (order.type === 'SCAN_CREDIT') {
        await tx.organization.update({
          where: { id: order.organizationId },
          data: {
            scanCredits: { increment: 1 },
            paidScanPurchases: { increment: 1 },
          },
        });
        return;
      }

      if (!order.plan || (order.interval !== 'monthly' && order.interval !== 'yearly')) {
        throw new Error(`Paid Mollie order ${order.id} is missing its plan period.`);
      }

      const periodStart = new Date();
      const periodEnd = addMonths(periodStart, order.interval === 'yearly' ? 12 : 1);
      await tx.subscription.upsert({
        where: { organizationId: order.organizationId },
        create: {
          organizationId: order.organizationId,
          plan: order.plan,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
        },
        update: {
          plan: order.plan,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: false,
          canceledAt: null,
        },
      });
    });

    log.info('Mollie payment processed', { paymentId, orderId, status });
    return NextResponse.json({ received: true });
  } catch (error) {
    log.error('Mollie webhook processing failed', { paymentId, error });
    return NextResponse.json({ error: 'Payment processing failed.' }, { status: 500 });
  }
}
