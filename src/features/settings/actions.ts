'use server';

import { revalidatePath } from 'next/cache';
import { DeviceStrategy, ThemePreference } from '@prisma/client';
import { z } from 'zod';

import { db } from '@/lib/db';
import { errors, fail, ok, type ActionResult } from '@/lib/errors';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';
import { slugify } from '@/lib/utils';

import { requireSession } from '../auth/session';

const preferencesSchema = z.object({
  theme: z.nativeEnum(ThemePreference),
  defaultDevice: z.nativeEnum(DeviceStrategy),
  weeklyDigest: z.boolean(),
  auditCompleteEmails: z.boolean(),
  productUpdates: z.boolean(),
  timezone: z.string().max(64),
});

export type PreferencesInput = z.infer<typeof preferencesSchema>;

export async function updatePreferencesAction(input: PreferencesInput): Promise<ActionResult<null>> {
  try {
    const session = await requireSession();
    enforceRateLimit(`mutate:${session.userId}`, RATE_LIMITS.mutation);

    const parsed = preferencesSchema.safeParse(input);
    if (!parsed.success) throw errors.validation('Those settings are not valid.');

    await db.userSettings.upsert({
      where: { userId: session.userId },
      create: { userId: session.userId, ...parsed.data },
      update: parsed.data,
    });

    revalidatePath('/dashboard/settings');
    return ok(null);
  } catch (error) {
    return fail(error);
  }
}

const organizationSchema = z.object({
  name: z.string().min(1, 'Give your workspace a name').max(80).trim(),
});

export type OrganizationInput = z.infer<typeof organizationSchema>;

export async function updateOrganizationAction(input: OrganizationInput): Promise<ActionResult<null>> {
  try {
    const session = await requireSession();

    const parsed = organizationSchema.safeParse(input);
    if (!parsed.success) throw errors.validation(parsed.error.issues[0]?.message ?? 'Check the form.');

    // Only owners and admins can rename the workspace everyone shares.
    const membership = await db.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: session.organizationId, userId: session.userId } },
      select: { role: true },
    });

    if (!membership || (membership.role !== 'OWNER' && membership.role !== 'ADMIN')) {
      throw errors.forbidden('Only workspace owners and admins can change this.');
    }

    await db.organization.update({
      where: { id: session.organizationId },
      data: { name: parsed.data.name },
    });

    revalidatePath('/dashboard', 'layout');
    return ok(null);
  } catch (error) {
    return fail(error);
  }
}

/**
 * Deletes the signed-in user's account and everything they own.
 *
 * Requires the user to type their own email as confirmation. Cascades handle
 * the data; the Supabase auth record is left for the admin key to clean up
 * asynchronously, because deleting it first would drop the session mid-request
 * and leave the database work half-done.
 */
const deleteAccountSchema = z.object({
  confirmation: z.string(),
});

export async function deleteAccountAction(
  input: z.infer<typeof deleteAccountSchema>,
): Promise<ActionResult<null>> {
  try {
    const session = await requireSession();

    const parsed = deleteAccountSchema.safeParse(input);
    if (!parsed.success) throw errors.validation('Type your email address exactly to confirm.');

    if (parsed.data.confirmation.trim().toLowerCase() !== session.email.toLowerCase()) {
      throw errors.validation('Type your email address exactly to confirm.');
    }

    // Cascades: user → organizations owned → projects → websites → audits.
    await db.user.delete({ where: { id: session.userId } });

    return ok(null);
  } catch (error) {
    return fail(error);
  }
}

/** Regenerates the workspace slug from its current name. */
export async function refreshOrganizationSlugAction(): Promise<ActionResult<{ slug: string }>> {
  try {
    const session = await requireSession();

    const organization = await db.organization.findUnique({
      where: { id: session.organizationId },
      select: { name: true },
    });
    if (!organization) throw errors.notFound('Workspace');

    const base = slugify(organization.name) || 'workspace';
    let slug = base;

    for (let attempt = 1; attempt < 10; attempt += 1) {
      const clash = await db.organization.findFirst({
        where: { slug, NOT: { id: session.organizationId } },
        select: { id: true },
      });
      if (!clash) break;
      slug = `${base}-${attempt + 1}`;
    }

    await db.organization.update({ where: { id: session.organizationId }, data: { slug } });

    revalidatePath('/dashboard/settings');
    return ok({ slug });
  } catch (error) {
    return fail(error);
  }
}
