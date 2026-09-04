import type { Metadata } from 'next';
import Link from 'next/link';

import { AuthShell } from '@/components/auth/auth-shell';
import { SignUpForm } from '@/components/auth/forms';
import { AuthDivider, GoogleButton } from '@/components/auth/google-button';

export const metadata: Metadata = {
  title: 'Create your account',
  description: 'Start auditing your website with WebDataScout — three full audits free.',
};

export default function SignUpPage() {
  return (
    <AuthShell
      title="Create your account"
      description="Three full audits free. No card required."
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
