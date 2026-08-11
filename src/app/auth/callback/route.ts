import { NextResponse, type NextRequest } from 'next/server';

import { logger } from '@/lib/logger';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getSession } from '@/features/auth/session';

/**
 * OAuth / email-link callback.
 *
 * Supabase redirects here with a one-time `code` which is exchanged for a
 * session. Two things this handler is careful about:
 *
 *  1. `next` is validated as a same-origin relative path. Redirecting to an
 *     attacker-supplied absolute URL immediately after establishing a session
 *     is a textbook open redirect.
 *  2. `getSession()` is called before redirecting, which provisions the user's
 *     database row and personal organization. Doing it here means the
 *     dashboard's first render always finds a fully-provisioned account
 *     instead of racing the bootstrap.
 */

const log = logger.child({ module: 'auth/callback' });

function safeNext(raw: string | null): string {
  if (!raw) return '/dashboard';
  // Reject protocol-relative ("//evil.com") and absolute URLs.
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/dashboard';
  return raw;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;

  const code = searchParams.get('code');
  const next = safeNext(searchParams.get('next'));
  const errorDescription = searchParams.get('error_description');

  if (errorDescription) {
    log.warn('auth callback returned an error', { errorDescription });
    return NextResponse.redirect(
      `${origin}/auth/auth-error?reason=${encodeURIComponent(errorDescription)}`,
    );
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/auth/auth-error?reason=missing-code`);
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    log.warn('code exchange failed', { error: error.message });
    return NextResponse.redirect(
      `${origin}/auth/auth-error?reason=${encodeURIComponent(error.message)}`,
    );
  }

  // Provision the mirror row + organization before the dashboard loads.
  await getSession().catch((provisionError) => {
    log.error('user provisioning failed during callback', { error: provisionError });
    return null;
  });

  return NextResponse.redirect(`${origin}${next}`);
}
