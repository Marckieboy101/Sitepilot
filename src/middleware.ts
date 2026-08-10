import type { NextRequest } from 'next/server';

import { updateSession } from '@/lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Every path except static assets and the Stripe webhook.
     *
     * The webhook must be excluded: it carries no session cookie and its raw
     * body has to reach the route handler byte-for-byte for signature
     * verification, so there is nothing for the session refresh to do but add
     * latency to a request Stripe will retry if it's slow.
     */
    '/((?!_next/static|_next/image|favicon.ico|api/webhooks|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?)$).*)',
  ],
};
