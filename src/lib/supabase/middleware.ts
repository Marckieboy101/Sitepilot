import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { sanitizeSupabaseKey, sanitizeSupabaseUrl } from '@/lib/env';

/** Shape Supabase hands back from `setAll`. Annotated explicitly because the
 *  cookie-methods parameter is a union type, which defeats inference. */
type CookieToSet = { name: string; value: string; options: CookieOptions };

const PROTECTED_PREFIXES = ['/dashboard'];
const AUTH_ROUTES = ['/login', '/signup', '/reset-password'];

/**
 * Refreshes the Supabase session on every request and gates protected routes.
 *
 * Two rules that are easy to get wrong and break auth subtly:
 *  1. `supabase.auth.getUser()` must be called — it revalidates the JWT with
 *     Supabase. Reading the session from the cookie alone trusts a value the
 *     client controls.
 *  2. The response object returned here must be the one Supabase wrote cookies
 *     onto. Constructing a fresh `NextResponse` after the auth call silently
 *     drops the refreshed tokens and logs users out at random.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const url = sanitizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = sanitizeSupabaseKey(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  // Without a real Supabase config there is no session to refresh; let the
  // request through so the marketing site still renders during local setup.
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  const isAuthRoute = AUTH_ROUTES.some((route) => pathname.startsWith(route));

  if (!user && isProtected) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = '/login';
    redirect.searchParams.set('next', pathname);
    return NextResponse.redirect(redirect);
  }

  if (user && isAuthRoute) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = '/dashboard';
    redirect.search = '';
    return NextResponse.redirect(redirect);
  }

  return response;
}
