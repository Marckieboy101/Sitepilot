import type { Metadata } from 'next';
import Link from 'next/link';

import { AuthShell } from '@/components/auth/auth-shell';
import { SignUpForm } from '@/components/auth/forms';
import { AuthDivider, GoogleButton } from '@/components/auth/google-button';

export const metadata: Metadata = {
  title: 'Create your account',
  description: 'Start auditing your website with GetTravik — one limited-statistics preview, with full audits available from $5.',
};

export default function SignUpPage() {
  return (
    <AuthShell
      title="Create your account"
      description="One limited-statistics preview. First full audit $5; then $8 each or choose a plan."
      footer={
        <>
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-foreground underline-offset-4 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <GoogleButton label="Sign up with Google" />
      <AuthDivider label="or sign up with email" />
      <SignUpForm />
    </AuthShell>
  );
}
