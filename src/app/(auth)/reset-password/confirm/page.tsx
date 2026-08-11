import type { Metadata } from 'next';

import { AuthShell } from '@/components/auth/auth-shell';
import { ResetPasswordForm } from '@/components/auth/forms';

export const metadata: Metadata = {
  title: 'Choose a new password',
  robots: { index: false, follow: false },
};

export default function ConfirmResetPage() {
  return (
    <AuthShell
      title="Choose a new password"
      description="Pick something you haven't used elsewhere. Longer is stronger."
    >
      <ResetPasswordForm />
    </AuthShell>
  );
}
