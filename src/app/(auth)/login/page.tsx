import { Suspense } from 'react';

import type { Metadata } from 'next';
import Link from 'next/link';

import { AuthShell } from '@/components/auth/auth-shell';
import { SignInForm } from '@/components/auth/forms';
import { AuthDivider, GoogleButton } from '@/components/auth/google-button';
import { Skeleton } from '@/components/ui/skeleton';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to your Momo account.',
};

export default function LoginPage() {
  return (
    <AuthShell
      title="Welcome back"
      description="Sign in to run audits and pick up where you left off."
      footer={
        <>
          Don&apos;t have an account?{' '}
          <Link href="/signup" className="font-medium text-foreground underline-offset-4 hover:underline">
            Start free
          </Link>
        </>
      }
    >
      <GoogleButton label="Sign in with Google" />
      <AuthDivider label="or sign in with email" />
      {/* useSearchParams needs a Suspense boundary to keep the route static. */}
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <SignInForm />
      </Suspense>
    </AuthShell>
  );
}
