import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { clientEnv, sanitizeSupabaseKey, sanitizeSupabaseUrl, serverEnv } from '@/lib/env';

/**
 * Server Supabase client, bound to the request's cookie jar.
 *
 * Server Components cannot write cookies, so `setAll` is wrapped in a
 * try/catch: token refresh during a render is a no-op there and the refreshed
 * cookie is written by the middleware on the next request instead. Server
 * Actions and Route Handlers *can* write, and this same client handles both.
 */
export async function createServerSupabaseClient() {
  const cookieStore = await cookies();

  const url = sanitizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL) ?? clientEnv.NEXT_PUBLIC_SUPABASE_URL;
  const key = sanitizeSupabaseKey(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) ?? clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      'Supabase auth is not configured. Set real NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY values to enable signup and sign in.',
    );
  }

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component — middleware refreshes the session.
        }
      },
    },
  });
}

/**
 * Service-role client. Bypasses row-level security, so it is only used for
 * operations the user cannot perform on their own behalf (reading auth users
 * during sync, writing to protected storage buckets). Never import from a
 * client component.
 */
export function createAdminClient() {
  const env = serverEnv();
  const url = sanitizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL) ?? clientEnv.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = sanitizeSupabaseKey(process.env.SUPABASE_SERVICE_ROLE_KEY) ?? env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error('Supabase admin client requires a real SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL.');
  }

  return createServerClient(url, env.SUPABASE_SERVICE_ROLE_KEY, {
    cookies: { getAll: () => [], setAll: () => undefined },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
