'use client';

import * as React from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { Toaster } from 'sonner';

import { TooltipProvider } from '@/components/ui/tooltip';

/**
 * Client-side providers, mounted once in the root layout.
 *
 * The QueryClient is created inside state rather than at module scope: a
 * module-level client is shared across every request on the server, which
 * leaks one user's cached data into another user's render.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Server Components already deliver fresh data on navigation, so
            // an immediate background refetch on mount is wasted work.
            staleTime: 60 * 1000,
            gcTime: 5 * 60 * 1000,
            refetchOnWindowFocus: false,
            retry: (failureCount, error) => {
              // Don't retry the client's own mistakes.
              const status = (error as { status?: number })?.status;
              if (status && status >= 400 && status < 500) return false;
              return failureCount < 2;
            },
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
        <TooltipProvider delayDuration={200} skipDelayDuration={300}>
          {children}
          <Toaster
            position="bottom-right"
            closeButton
            richColors
            toastOptions={{
              classNames: {
                toast: 'rounded-xl border border-border bg-card text-card-foreground shadow-xl',
                description: 'text-muted-foreground',
              },
            }}
          />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
