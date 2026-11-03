'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { PLANS } from '@/config/plans';
import { db } from '@/lib/db';
import { clientEnv, serverEnv } from '@/lib/env';
import { errors, fail, ok, type ActionResult } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';

import { requireSession } from '../auth/session';
import { oneTimeScanPriceCents } from './scan-pricing';
import { mollieConfigured } from './stripe';

const log = logger.child({ module: 'billing/actions' });

const checkoutSchema = z.object({
  plan: z.enum(['PRO', 'AGENCY', 'ONE_TIME']),
  interval: z.enum(['monthly', 'yearly']).default('monthly'),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;

function toAmountString(cents: number, currency: string): { value: string; currency: string } {
  return {
    value: (cents / 100).toFixed(2),
    currency,
  };
}

async function createMolliePayment(input: {
  amountCents: number;
  description: string;
  orderId: string;
  organizationId: string;
  userId: string;
  email: string;
  type: 'SCAN_CREDIT' | 'PLAN';
  plan: 'PRO' | 'AGENCY' | null;
  interval: 'monthly' | 'yearly' | null;
  successUrl: string;
}) {
  const env = serverEnv();
  const apiKey = env.MOLLIE_API_KEY;
  if (!apiKey) {
    throw errors.configuration('Mollie is not configured on this deployment.');
  }

  const response = await fetch('https://api.mollie.com/v2/payments', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'GetTravik/1.0',
    },
    body: JSON.stringify({
      amount: toAmountString(input.amountCents, env.MOLLIE_CURRENCY),
      description: input.description,
      redirectUrl: input.successUrl,
      metadata: {
        orderId: input.orderId,
        organizationId: input.organizationId,
        userId: input.userId,
        email: input.email,
        type: input.type,
        plan: input.plan,
        interval: input.interval,
      },
      webhookUrl: `${clientEnv.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')}/api/webhooks/mollie`,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw errors.upstream('Mollie', `Payment could not be started. ${body}`);
  }

  const data = (await response.json()) as {
    _links?: { checkout?: { href?: string } };
    url?: string;
    id?: string;
  };

  const paymentUrl = data._links?.checkout?.href ?? data.url;
  if (!paymentUrl) {
    throw errors.upstream('Mollie', 'Payment was created without a redirect URL.');
  }
  if (!data.id) {
    throw errors.upstream('Mollie', 'Payment was created without a payment ID.');
  }

  return { url: paymentUrl, id: data.id };
}

/** Creates a Mollie checkout for a scan credit or a paid plan term. */
export async function createCheckoutAction(input: CheckoutInput): Promise<ActionResult<{ url: string }>> {
  try {
    const session = await requireSession();
    enforceRateLimit(`checkout:${session.userId}`, RATE_LIMITS.mutation);

    if (!mollieConfigured()) {
      throw errors.configuration('Mollie is not configured on this deployment.');
    }

    const parsed = checkoutSchema.safeParse(input);
    if (!parsed.success) throw errors.validation('Pick a valid plan.');

    const plan = parsed.data.plan;
    const interval = parsed.data.interval;
    const env = serverEnv();
    const organization = await db.organization.findUnique({
      where: { id: session.organizationId },
      select: { paidScanPurchases: true },
    });
    if (!organization) throw errors.notFound('Workspace');

    const amountCents =
      plan === 'ONE_TIME'
        ? oneTimeScanPriceCents(organization.paidScanPurchases)
        : interval === 'yearly'
          ? PLANS[plan].yearlyPriceCents
          : PLANS[plan].monthlyPriceCents;

    const baseUrl = clientEnv.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
    const successUrl = `${baseUrl}/dashboard/billing?checkout=success&type=${plan === 'ONE_TIME' ? 'scan' : 'plan'}`;
    const order = await db.molliePayment.create({
      data: {
        organizationId: session.organizationId,
        type: plan === 'ONE_TIME' ? 'SCAN_CREDIT' : 'PLAN',
        plan: plan === 'ONE_TIME' ? null : plan,
        interval: plan === 'ONE_TIME' ? null : interval,
        amountCents,
        currency: env.MOLLIE_CURRENCY,
      },
    });

    try {
      const payment = await createMolliePayment({
        amountCents,
        description:
          plan === 'ONE_TIME'
            ? `GetTravik ${organization.paidScanPurchases === 0 ? 'first ' : ''}full scan`
            : `${PLANS[plan].name} ${interval} plan`,
        orderId: order.id,
        organizationId: session.organizationId,
        userId: session.userId,
        email: session.email,
        type: order.type,
        plan: plan === 'ONE_TIME' ? null : plan,
        interval: plan === 'ONE_TIME' ? null : interval,
        successUrl,
      });

      await db.molliePayment.update({
        where: { id: order.id },
        data: { molliePaymentId: payment.id },
      });

      return ok({ url: payment.url });
    } catch (error) {
      await db.molliePayment.update({
        where: { id: order.id },
        data: { status: 'creation_failed' },
      });
      throw error;
    }
  } catch (error) {
    log.error('checkout creation failed', { error });
    return fail(error);
  }
}

const brandingSchema = z.object({
  brandColor: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i, 'Enter a hex colour like #6366f1')
    .nullish()
    .or(z.literal('')),
  brandLogoUrl: z.string().url('Enter a valid image URL').nullish().or(z.literal('')),
  reportFooterText: z.string().max(200).nullish().or(z.literal('')),
});

export type BrandingInput = z.infer<typeof brandingSchema>;

/** White-label report settings. Agency plan only ? enforced server-side. */
export async function updateBrandingAction(input: BrandingInput): Promise<ActionResult<null>> {
  try {
    const session = await requireSession();
    const { requireFeature } = await import('./quota');
    await requireFeature(session.organizationId, 'whiteLabel');

    const parsed = brandingSchema.safeParse(input);
    if (!parsed.success) throw errors.validation(parsed.error.issues[0]?.message ?? 'Check the form.');

    await db.organization.update({
      where: { id: session.organizationId },
      data: {
        brandColor: parsed.data.brandColor || null,
        brandLogoUrl: parsed.data.brandLogoUrl || null,
        reportFooterText: parsed.data.reportFooterText || null,
      },
    });

    revalidatePath('/dashboard/billing');
    revalidatePath('/dashboard/settings');
    return ok(null);
  } catch (error) {
    return fail(error);
  }
}
