import { z } from 'zod';

/**
 * Auth form contracts. Shared by React Hook Form on the client and the server
 * actions, so validation rules cannot diverge between the two.
 */

export const emailSchema = z
  .string()
  .min(1, 'Email is required')
  .email('Enter a valid email address')
  .max(254)
  .transform((value) => value.trim().toLowerCase());

/**
 * Length is the requirement that actually correlates with resistance to
 * cracking, so the floor is 8 with a nudge toward longer, rather than a
 * character-class checklist that mostly produces `Password1!`.
 */
export const passwordSchema = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(128, 'That password is too long');

export const signUpSchema = z.object({
  name: z.string().min(1, 'Tell us your name').max(80).trim(),
  email: emailSchema,
  password: passwordSchema,
  acceptTerms: z.boolean().refine((value) => value, {
    message: 'Please accept the terms to continue',
  }),
});

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password'),
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  });

export const updateProfileSchema = z.object({
  name: z.string().min(1, 'Name is required').max(80).trim(),
  avatarUrl: z.string().url().nullish().or(z.literal('')),
});

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/** Rough strength signal for the signup meter. Advisory only, never blocking. */
export function passwordStrength(password: string): { score: 0 | 1 | 2 | 3 | 4; label: string } {
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password) || /[^\w\s]/.test(password)) score += 1;

  const labels = ['Too short', 'Weak', 'Fair', 'Good', 'Strong'] as const;
  const clamped = Math.min(4, score) as 0 | 1 | 2 | 3 | 4;
  return { score: clamped, label: labels[clamped] };
}
