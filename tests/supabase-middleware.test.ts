import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';

import { updateSession } from '@/lib/supabase/middleware';

describe('updateSession auth callback fallback', () => {
  it('forwards a root-level Supabase code to the auth callback', async () => {
    const request = new NextRequest(
      'http://localhost:3000/?code=one-time-code&next=%2Fdashboard',
    );

    const response = await updateSession(request);
    const location = response.headers.get('location');

    expect(response.status).toBe(307);
    expect(location).not.toBeNull();
    const destination = new URL(location!);
    expect(destination.pathname).toBe('/auth/callback');
    expect(destination.searchParams.get('code')).toBe('one-time-code');
    expect(destination.searchParams.get('next')).toBe('/dashboard');
  });
});
