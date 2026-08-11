import { cache } from 'react';

import { Plan } from '@prisma/client';

import { db } from '@/lib/db';
import { errors } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { slugify } from '@/lib/utils';

/**
 * The bridge between Supabase auth and the application database.
 *
 * Supabase owns credentials; Postgres owns everything else. Rather than a
 * database trigger (invisible, hard to evolve, and untestable from the app),
 * the mirror row is created lazily on first authenticated request by
 * `ensureUser`. That keeps signup working identically for email, OAuth and
 * magic-link flows, and makes the bootstrap logic ordinary testable code.
 *
 * `cache()` dedupes within a single render pass, so a layout, a page and three
 * components asking "who is signed in?" produce one auth call and one query.
 */

export interface SessionContext {
  userId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  emailVerified: boolean;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  plan: Plan;
}

const log = logger.child({ module: 'auth/session' });

/** The raw Supabase user, or null when signed out. Never throws. */
export const getAuthUser = cache(async () => {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) return null;
    return user;
  } catch (caught) {
    // `cookies()` throws a DynamicServerError during static generation to
    // signal that the route must render dynamically. Swallowing it would make
    // the page prerender as signed-out instead — so it has to propagate.
    if (caught instanceof Error && caught.name === 'DynamicServerError') throw caught;

    // Anything else here means Supabase is not configured; treat as signed out
    // so the marketing site still renders during local setup.
    return null;
  }
});

function displayNameFrom(metadata: Record<string, unknown> | undefined, email: string): string | null {
  const candidate =
    (metadata?.full_name as string | undefined) ??
    (metadata?.name as string | undefined) ??
    (metadata?.user_name as string | undefined);
  if (candidate && candidate.trim()) return candidate.trim();
  const local = email.split('@')[0];
  return local ? local.replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : null;
}

/** Reserves a unique organization slug, appending a counter on collision. */
async function uniqueSlug(base: string): Promise<string> {
  const seed = slugify(base) || 'workspace';
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = attempt === 0 ? seed : `${seed}-${attempt + 1}`;
    const taken = await db.organization.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
  return `${seed}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Returns the full session context, provisioning the user's mirror row,
 * personal organization, free subscription and settings on first sight.
 */
export const getSession = cache(async (): Promise<SessionContext | null> => {
  const authUser = await getAuthUser();
  if (!authUser?.email) return null;

  const existing = await db.user.findUnique({
    where: { id: authUser.id },
    select: {
      id: true,
      email: true,
      name: true,
      avatarUrl: true,
      emailVerified: true,
      memberships: {
        orderBy: { joinedAt: 'asc' },
        take: 1,
        select: {
          organization: {
            select: {
              id: true,
              name: true,
              slug: true,
              subscription: { select: { plan: true } },
            },
          },
        },
      },
    },
  });

  const membership = existing?.memberships[0];

  if (existing && membership) {
    return {
      userId: existing.id,
      email: existing.email,
      name: existing.name,
      avatarUrl: existing.avatarUrl,
      emailVerified: Boolean(existing.emailVerified),
      organizationId: membership.organization.id,
      organizationName: membership.organization.name,
      organizationSlug: membership.organization.slug,
      plan: membership.organization.subscription?.plan ?? Plan.FREE,
    };
  }

  return provisionUser({
    id: authUser.id,
    email: authUser.email,
    name: displayNameFrom(authUser.user_metadata, authUser.email),
    avatarUrl: (authUser.user_metadata?.avatar_url as string | undefined) ?? null,
    emailVerifiedAt: authUser.email_confirmed_at ? new Date(authUser.email_confirmed_at) : null,
  });
});

interface ProvisionInput {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  emailVerifiedAt: Date | null;
}

/**
 * Idempotent first-login bootstrap. Wrapped in a transaction so a user can
 * never end up with a row but no organization — two concurrent requests from
 * the same fresh login would otherwise race into a half-provisioned account.
 */
export async function provisionUser(input: ProvisionInput): Promise<SessionContext> {
  const workspaceName = input.name ? `${input.name}'s Workspace` : 'My Workspace';
  const slug = await uniqueSlug(input.name ?? input.email.split('@')[0]);

  const result = await db.$transaction(async (tx) => {
    const user = await tx.user.upsert({
      where: { id: input.id },
      create: {
        id: input.id,
        email: input.email,
        name: input.name,
        avatarUrl: input.avatarUrl,
        emailVerified: input.emailVerifiedAt,
        lastSeenAt: new Date(),
        settings: { create: {} },
      },
      update: {
        email: input.email,
        emailVerified: input.emailVerifiedAt,
        lastSeenAt: new Date(),
      },
      select: { id: true, email: true, name: true, avatarUrl: true, emailVerified: true },
    });

    const membership = await tx.organizationMember.findFirst({
      where: { userId: user.id },
      orderBy: { joinedAt: 'asc' },
      select: {
        organization: {
          select: { id: true, name: true, slug: true, subscription: { select: { plan: true } } },
        },
      },
    });

    if (membership) return { user, organization: membership.organization };

    const organization = await tx.organization.create({
      data: {
        name: workspaceName,
        slug,
        ownerId: user.id,
        members: { create: { userId: user.id, role: 'OWNER' } },
        subscription: { create: { plan: Plan.FREE } },
        projects: {
          create: {
            name: 'My Websites',
            description: 'Default project — every audit lands here unless you pick another.',
          },
        },
      },
      select: { id: true, name: true, slug: true, subscription: { select: { plan: true } } },
    });

    return { user, organization };
  });

  log.info('provisioned user', { userId: result.user.id, organizationId: result.organization.id });

  return {
    userId: result.user.id,
    email: result.user.email,
    name: result.user.name,
    avatarUrl: result.user.avatarUrl,
    emailVerified: Boolean(result.user.emailVerified),
    organizationId: result.organization.id,
    organizationName: result.organization.name,
    organizationSlug: result.organization.slug,
    plan: result.organization.subscription?.plan ?? Plan.FREE,
  };
}

/** Session or 401. Use in every server action and protected data loader. */
export async function requireSession(): Promise<SessionContext> {
  const session = await getSession();
  if (!session) throw errors.unauthorized();
  return session;
}
