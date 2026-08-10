'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';

import { db } from '@/lib/db';
import { clientEnv } from '@/lib/env';
import { errors, fail, ok, type ActionResult } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { requireSession } from './session';
import {
  forgotPasswordSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
  updateProfileSchema,
  type ForgotPasswordInput,
  type ResetPasswordInput,
  type SignInInput,
  type SignUpInput,
  type UpdateProfileInput,
} from './schemas';

const log = logger.child({ module: 'auth/actions' });

async function clientIp(): Promise<string> {
  const headerList = await headers();
  return (
    headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headerList.get('x-real-ip') ??
    'unknown'
  );
}

function callbackUrl(next?: string): string {
  const base = clientEnv.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
  const target = next && next.startsWith('/') ? next : '/dashboard';
  return `${base}/auth/callback?next=${encodeURIComponent(target)}`;
}

export async function signUpAction(input: SignUpInput): Promise<ActionResult<{ needsVerification: boolean }>> {
  try {
    enforceRateLimit(`signup:${await clientIp()}`, RATE_LIMITS.auth);

    const parsed = signUpSchema.safeParse(input);
    if (!parsed.success) {
      throw errors.validation(parsed.error.issues[0]?.message ?? 'Check the form and try again.');
    }

    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        emailRedirectTo: callbackUrl('/dashboard'),
        data: { full_name: parsed.data.name },
      },
    });

    if (error) {
      log.warn('signup rejected', { reason: error.message });
      throw errors.validation(error.message);
    }

    // Supabase returns a user with no identities when the address is already
    // registered. Surfacing that difference would let anyone enumerate our
    // user list, so both cases produce the same "check your email" response.
    const needsVerification = !data.session;

    return ok({ needsVerification });
  } catch (error) {
    return fail(error);
  }
}

export async function signInAction(input: SignInInput): Promise<ActionResult<{ redirectTo: string }>> {
  try {
    enforceRateLimit(`signin:${await clientIp()}`, RATE_LIMITS.auth);

    const parsed = signInSchema.safeParse(input);
    if (!parsed.success) {
      throw errors.validation(parsed.error.issues[0]?.message ?? 'Check the form and try again.');
    }

    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    });

    if (error) {
      // Deliberately generic: distinguishing "no such user" from "wrong
      // password" is a free account-enumeration oracle.
      throw errors.validation('That email or password is incorrect.');
    }

    return ok({ redirectTo: '/dashboard' });
  } catch (error) {
    return fail(error);
  }
}

export async function signInWithGoogleAction(next?: string): Promise<ActionResult<{ url: string }>> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: callbackUrl(next),
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    });

    if (error || !data.url) throw errors.upstream('Google sign-in', error?.message);
    return ok({ url: data.url });
  } catch (error) {
    return fail(error);
  }
}

export async function requestPasswordResetAction(
  input: ForgotPasswordInput,
): Promise<ActionResult<null>> {
  try {
    enforceRateLimit(`reset:${await clientIp()}`, RATE_LIMITS.auth);

    const parsed = forgotPasswordSchema.safeParse(input);
    if (!parsed.success) throw errors.validation('Enter a valid email address.');

    const supabase = await createServerSupabaseClient();
    const base = clientEnv.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');

    await supabase.auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo: `${base}/auth/callback?next=${encodeURIComponent('/reset-password/confirm')}`,
    });

    // Always report success — whether the address exists is not ours to leak.
    return ok(null);
  } catch (error) {
    return fail(error);
  }
}

export async function resetPasswordAction(input: ResetPasswordInput): Promise<ActionResult<null>> {
  try {
    const parsed = resetPasswordSchema.safeParse(input);
    if (!parsed.success) {
      throw errors.validation(parsed.error.issues[0]?.message ?? 'Check the form and try again.');
    }

    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // The recovery link establishes a session; without one this is someone
    // hitting the endpoint directly.
    if (!user) throw errors.unauthorized('This reset link has expired. Request a new one.');

    const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
    if (error) throw errors.validation(error.message);

    return ok(null);
  } catch (error) {
    return fail(error);
  }
}

export async function resendVerificationAction(email: string): Promise<ActionResult<null>> {
  try {
    enforceRateLimit(`resend:${await clientIp()}`, RATE_LIMITS.auth);

    const supabase = await createServerSupabaseClient();
    await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: callbackUrl('/dashboard') },
    });

    return ok(null);
  } catch (error) {
    return fail(error);
  }
}

export async function updateProfileAction(input: UpdateProfileInput): Promise<ActionResult<null>> {
  try {
    const session = await requireSession();
    const parsed = updateProfileSchema.safeParse(input);
    if (!parsed.success) {
      throw errors.validation(parsed.error.issues[0]?.message ?? 'Check the form and try again.');
    }

    await db.user.update({
      where: { id: session.userId },
      data: {
        name: parsed.data.name,
        avatarUrl: parsed.data.avatarUrl || null,
      },
    });

    revalidatePath('/dashboard/settings');
    revalidatePath('/dashboard', 'layout');
    return ok(null);
  } catch (error) {
    return fail(error);
  }
}

export async function signOutAction(): Promise<void> {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
  redirect('/login');
}
