import type { Metadata } from 'next';
import Link from 'next/link';

import { AuthShell } from '@/components/auth/auth-shell';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = {
  title: 'Sign-in problem',
  robots: { index: false, follow: false },
};

const FRIENDLY_REASONS: Record<string, string> = {
  'missing-code': 'That link is missing the code we need to sign you in.',
  'access_denied': 'The sign-in was cancelled before it completed.',
};

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;

  // The reason comes from the provider via the query string, so it is rendered
  // as plain text only — never as markup — and mapped to friendly copy where
  // we recognise it.
  const message = reason
    ? (FRIENDLY_REASONS[reason] ?? reason)
    : 'We could not complete that sign-in.';

  return (
    <AuthShell
      title="We couldn't sign you in"
      description="The link may have expired, or it has already been used."
    >
      <div className="space-y-6">
        <div className="rounded-xl border border-destructive/25 bg-destructive/[0.06] p-4">
          <p className="text-sm leading-relaxed text-muted-foreground">{message}</p>
        </div>

        <div className="grid gap-2">
          <Button variant="gradient" size="lg" asChild>
            <Link href="/login">Back to sign in</Link>
          </Button>
          <Button variant="outline" size="lg" asChild>
            <Link href="/reset-password">Send a new link</Link>
          </Button>
        </div>
      </div>
    </AuthShell>
  );
}
