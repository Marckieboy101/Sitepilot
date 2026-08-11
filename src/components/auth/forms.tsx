'use client';

import * as React from 'react';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2, Eye, EyeOff, Lock, Mail, User } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  requestPasswordResetAction,
  resetPasswordAction,
  signInAction,
  signUpAction,
} from '@/features/auth/actions';
import {
  forgotPasswordSchema,
  passwordStrength,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
  type ForgotPasswordInput,
  type ResetPasswordInput,
  type SignInInput,
  type SignUpInput,
} from '@/features/auth/schemas';
import { cn } from '@/lib/utils';

/**
 * Auth forms.
 *
 * Validation runs client-side through the same Zod schemas the server actions
 * use, so the messages match exactly and the server remains the authority. The
 * client copy exists to make the form pleasant, not to be trusted.
 */

function FieldError({ message, id }: { message?: string; id: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-xs text-destructive">
      {message}
    </p>
  );
}

function PasswordField({
  id,
  label,
  error,
  registration,
  autoComplete,
  describedBy,
}: {
  id: string;
  label: string;
  error?: string;
  registration: ReturnType<ReturnType<typeof useForm>['register']>;
  autoComplete: string;
  describedBy?: string;
}) {
  const [visible, setVisible] = React.useState(false);

  return (
    <div className="space-y-1.5">
      {/* The sign-in form renders its own label alongside a "forgot password"
          link, so an empty label here means "already labelled above". */}
      {label && <Label htmlFor={id}>{label}</Label>}
      <div className="relative">
        <span
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        >
          <Lock className="size-4" />
        </span>
        <Input
          id={id}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          className="pl-10 pr-10"
          error={Boolean(error)}
          aria-describedby={[error ? `${id}-error` : null, describedBy].filter(Boolean).join(' ') || undefined}
          {...registration}
        />
        <button
          type="button"
          onClick={() => setVisible((value) => !value)}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={visible ? 'Hide password' : 'Show password'}
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      <FieldError message={error} id={`${id}-error`} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sign up
// ---------------------------------------------------------------------------

export function SignUpForm() {
  const [sent, setSent] = React.useState<string | null>(null);
  const router = useRouter();

  const form = useForm<SignUpInput>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { name: '', email: '', password: '', acceptTerms: false },
  });

  const password = form.watch('password');
  const strength = React.useMemo(() => passwordStrength(password ?? ''), [password]);

  async function onSubmit(values: SignUpInput) {
    const result = await signUpAction(values);

    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }

    if (result.data.needsVerification) {
      setSent(values.email);
      return;
    }

    // Session already established (email confirmation disabled on the project).
    router.push('/dashboard');
    router.refresh();
  }

  if (sent) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-success/12">
          <CheckCircle2 className="size-6 text-success" aria-hidden="true" />
        </div>
        <h2 className="mt-4 font-semibold">Check your inbox</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          We sent a verification link to <span className="font-medium text-foreground">{sent}</span>. Click
          it to activate your account.
        </p>
        <p className="mt-4 text-xs text-muted-foreground">
          Nothing after a minute or two? Check your spam folder, or{' '}
          <button
            type="button"
            onClick={() => setSent(null)}
            className="font-medium text-foreground underline underline-offset-4"
          >
            try a different address
          </button>
          .
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          autoComplete="name"
          icon={<User />}
          placeholder="Alex Rivera"
          error={Boolean(form.formState.errors.name)}
          aria-describedby={form.formState.errors.name ? 'name-error' : undefined}
          {...form.register('name')}
        />
        <FieldError message={form.formState.errors.name?.message} id="name-error" />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="email">Work email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          icon={<Mail />}
          placeholder="you@company.com"
          error={Boolean(form.formState.errors.email)}
          aria-describedby={form.formState.errors.email ? 'email-error' : undefined}
          {...form.register('email')}
        />
        <FieldError message={form.formState.errors.email?.message} id="email-error" />
      </div>

      <PasswordField
        id="password"
        label="Password"
        autoComplete="new-password"
        error={form.formState.errors.password?.message}
        registration={form.register('password')}
        describedBy="password-strength"
      />

      {password && (
        <div id="password-strength" className="space-y-1.5">
          <div className="flex gap-1" aria-hidden="true">
            {[0, 1, 2, 3].map((index) => (
              <span
                key={index}
                className={cn(
                  'h-1 flex-1 rounded-full transition-colors',
                  index < strength.score
                    ? strength.score <= 1
                      ? 'bg-destructive'
                      : strength.score === 2
                        ? 'bg-warning'
                        : strength.score === 3
                          ? 'bg-info'
                          : 'bg-success'
                    : 'bg-muted',
                )}
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Password strength: {strength.label}</p>
        </div>
      )}

      <div className="flex items-start gap-2.5 pt-1">
        <Checkbox
          id="acceptTerms"
          checked={form.watch('acceptTerms')}
          onCheckedChange={(checked) =>
            form.setValue('acceptTerms', checked === true, {
              shouldValidate: form.formState.isSubmitted,
            })
          }
          aria-describedby={form.formState.errors.acceptTerms ? 'terms-error' : undefined}
        />
        <div className="space-y-1">
          <Label htmlFor="acceptTerms" className="text-sm font-normal leading-snug text-muted-foreground">
            I agree to the{' '}
            <Link href="/terms" className="text-foreground underline underline-offset-4">
              terms of service
            </Link>{' '}
            and{' '}
            <Link href="/privacy" className="text-foreground underline underline-offset-4">
              privacy policy
            </Link>
            .
          </Label>
          <FieldError message={form.formState.errors.acceptTerms?.message} id="terms-error" />
        </div>
      </div>

      <Button
        type="submit"
        variant="gradient"
        size="lg"
        className="w-full"
        loading={form.formState.isSubmitting}
        loadingText="Creating account…"
      >
        Create account
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------

export function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Only accept same-origin relative paths — an absolute `next` would turn
  // the login page into an open redirect.
  const rawNext = searchParams.get('next');
  const next = rawNext && rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/dashboard';

  const form = useForm<SignInInput>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '' },
  });

  async function onSubmit(values: SignInInput) {
    const result = await signInAction(values);

    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }

    router.push(next);
    router.refresh();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          icon={<Mail />}
          placeholder="you@company.com"
          error={Boolean(form.formState.errors.email)}
          aria-describedby={form.formState.errors.email ? 'email-error' : undefined}
          {...form.register('email')}
        />
        <FieldError message={form.formState.errors.email?.message} id="email-error" />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Password</Label>
          <Link
            href="/reset-password"
            className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Forgot password?
          </Link>
        </div>
        <PasswordField
          id="password"
          label=""
          autoComplete="current-password"
          error={form.formState.errors.password?.message}
          registration={form.register('password')}
        />
      </div>

      <Button
        type="submit"
        variant="gradient"
        size="lg"
        className="w-full"
        loading={form.formState.isSubmitting}
        loadingText="Signing in…"
      >
        Sign in
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

export function ForgotPasswordForm() {
  const [sent, setSent] = React.useState(false);

  const form = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  async function onSubmit(values: ForgotPasswordInput) {
    const result = await requestPasswordResetAction(values);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-success/12">
          <Mail className="size-6 text-success" aria-hidden="true" />
        </div>
        <h2 className="mt-4 font-semibold">Check your email</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          If an account exists for that address, a reset link is on its way. The link expires in one hour.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          icon={<Mail />}
          placeholder="you@company.com"
          error={Boolean(form.formState.errors.email)}
          {...form.register('email')}
        />
        <FieldError message={form.formState.errors.email?.message} id="email-error" />
      </div>

      <Button
        type="submit"
        variant="gradient"
        size="lg"
        className="w-full"
        loading={form.formState.isSubmitting}
        loadingText="Sending…"
      >
        Send reset link
      </Button>
    </form>
  );
}

export function ResetPasswordForm() {
  const router = useRouter();

  const form = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: '', confirmPassword: '' },
  });

  async function onSubmit(values: ResetPasswordInput) {
    const result = await resetPasswordAction(values);

    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }

    toast.success('Password updated. Signing you in…');
    router.push('/dashboard');
    router.refresh();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <PasswordField
        id="password"
        label="New password"
        autoComplete="new-password"
        error={form.formState.errors.password?.message}
        registration={form.register('password')}
      />
      <PasswordField
        id="confirmPassword"
        label="Confirm password"
        autoComplete="new-password"
        error={form.formState.errors.confirmPassword?.message}
        registration={form.register('confirmPassword')}
      />

      <Button
        type="submit"
        variant="gradient"
        size="lg"
        className="w-full"
        loading={form.formState.isSubmitting}
        loadingText="Updating…"
      >
        Update password
      </Button>
    </form>
  );
}
