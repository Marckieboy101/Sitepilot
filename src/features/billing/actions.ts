'use server';

import { revalidatePath } from 'next/cache';
import { Plan } from '@prisma/client';
import { z } from 'zod';

import { db } from '@/lib/db';
import { clientEnv } from '@/lib/env';
import { errors, fail, ok, type ActionResult } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';

import { requireSession } from '../auth/session';
import { priceIdFor, stripe, stripeConfigured } from './stripe';

const log = logger.child({ module: 'billing/actions' });

const checkoutSchema = z.object({
  plan: z.enum(['PRO', 'AGENCY']),
  interval: z.enum(['monthly', 'yearly']).default('monthly'),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;

/**
 * Creates a Stripe Checkout session.
 *
 * The organization id is stamped into both `client_reference_id` and the
 * subscription metadata. The webhook reads it from there rather than trying to
 * match on customer email — emails change, and a mismatch would silently
 * upgrade the wrong account.
 */
export async function createCheckoutAction(input: CheckoutInput): Promise<ActionResult<{ url: string }>> {
  try {
    const session = await requireSession();
    enforceRateLimit(`checkout:${session.userId}`, RATE_LIMITS.mutation);

    if (!stripeConfigured()) throw errors.configuration('Billing is not configured on this deployment.');

    const parsed = checkoutSchema.safeParse(input);
    if (!parsed.success) throw errors.validation('Pick a valid plan.');

    const plan = Plan[parsed.data.plan];
    const priceId = priceIdFor(plan, parsed.data.interval);

    const subscription = await db.subscription.findUnique({
      where: { organizationId: session.organizationId },
      select: { stripeCustomerId: true },
    });

    const baseUrl = clientEnv.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');

    const checkout = await stripe().checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      // Reuse the existing customer so a second purchase does not create a
      // duplicate record with a split payment history.
      ...(subscription?.stripeCustomerId
        ? { customer: subscription.stripeCustomerId }
        : { customer_email: session.email }),
      client_reference_id: session.organizationId,
      subscription_data: {
        metadata: { organizationId: session.organizationId, userId: session.userId },
      },
      metadata: { organizationId: session.organizationId },
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
      success_url: `${baseUrl}/dashboard/billing?checkout=success`,
      cancel_url: `${baseUrl}/dashboard/billing?checkout=cancelled`,
    });

    if (!checkout.url) throw errors.upstream('Stripe', 'Checkout could not be started.');

    return ok({ url: checkout.url });
  } catch (error) {
    log.error('checkout creation failed', { error });
    return fail(error);
  }
}

/** Opens the Stripe-hosted billing portal for plan changes and invoices. */
export async function createPortalAction(): Promise<ActionResult<{ url: string }>> {
  try {
    const session = await requireSession();

    if (!stripeConfigured()) throw errors.configuration('Billing is not configured on this deployment.');

    const subscription = await db.subscription.findUnique({
      where: { organizationId: session.organizationId },
      select: { stripeCustomerId: true },
    });

    if (!subscription?.stripeCustomerId) {
      throw errors.validation('There is no billing account to manage yet.');
    }

    const baseUrl = clientEnv.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');

    const portal = await stripe().billingPortal.sessions.create({
      customer: subscription.stripeCustomerId,
      return_url: `${baseUrl}/dashboard/billing`,
    });

    return ok({ url: portal.url });
  } catch (error) {
    log.error('portal creation failed', { error });
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

/** White-label report settings. Agency plan only — enforced server-side. */
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
