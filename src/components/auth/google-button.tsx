'use client';

import * as React from 'react';

import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { signInWithGoogleAction } from '@/features/auth/actions';

/** Google's mark, inlined so it never blocks on an external request. */
function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.65l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1a11 11 0 0 0-9.82 6.05l3.66 2.84c.87-2.6 3.3-4.51 6.16-4.51Z"
      />
    </svg>
  );
}

export function GoogleButton({ next, label = 'Continue with Google' }: { next?: string; label?: string }) {
  const [pending, setPending] = React.useState(false);

  async function handleClick() {
    setPending(true);
    const result = await signInWithGoogleAction(next);

    if (!result.ok) {
      toast.error(result.error.message);
      setPending(false);
      return;
    }

    // A full navigation, not a router push: this leaves our origin for
    // Google's consent screen.
    window.location.href = result.data.url;
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="lg"
      className="w-full"
      onClick={handleClick}
      loading={pending}
      loadingText="Redirecting…"
    >
      <GoogleIcon />
      {label}
    </Button>
  );
}

export function AuthDivider({ label = 'or' }: { label?: string }) {
  return (
    <div className="relative my-6">
      <div className="absolute inset-0 flex items-center" aria-hidden="true">
        <span className="w-full border-t border-border" />
      </div>
      <div className="relative flex justify-center">
        <span className="bg-background px-3 text-xs uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      </div>
    </div>
  );
}
