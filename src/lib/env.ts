import { z } from 'zod';

/**
 * Environment contract.
 *
 * Server variables are parsed lazily so that importing this module from a
 * client bundle never throws — only `serverEnv()` touches the server schema,
 * and it is unreachable from client components.
 *
 * Optional integrations (PageSpeed, Chromium, Stripe) resolve to `undefined`
 * rather than failing: the audit engine degrades feature-by-feature instead of
 * refusing to boot, which keeps local development usable with just a database.
 */

export function normalizeEnvValue(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;

  const unwrapped = trimmed.replace(/^(['"])(.*)\1$/, '$2');
  return unwrapped.trim();
}

export function sanitizeSupabaseUrl(value: string | undefined): string | undefined {
  const normalized = normalizeEnvValue(value);
  if (!normalized) return undefined;

  const lower = normalized.toLowerCase();
  if (lower === 'https://your-project.supabase.co' || lower.includes('your-project.supabase.co')) {
    return undefined;
  }

  return normalized;
}

export function sanitizeSupabaseKey(value: string | undefined): string | undefined {
  const normalized = normalizeEnvValue(value);
  if (!normalized) return undefined;

  const lower = normalized.toLowerCase();
  if (
    lower === 'your-anon-key' ||
    lower === 'your-service-role-key' ||
    lower === 'anon-key' ||
    lower === 'service-role-key'
  ) {
    return undefined;
  }

  return normalized;
}

const clientSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.preprocess(
    (value) => normalizeEnvValue(typeof value === 'string' ? value : undefined),
    z.string().url().default('http://localhost:3000'),
  ),
  NEXT_PUBLIC_SUPABASE_URL: z.preprocess(
    (value) => sanitizeSupabaseUrl(typeof value === 'string' ? value : undefined),
    z.string().url().optional(),
  ),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.preprocess(
    (value) => sanitizeSupabaseKey(typeof value === 'string' ? value : undefined),
    z.string().min(1).optional(),
  ),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.preprocess(
    (value) => normalizeEnvValue(typeof value === 'string' ? value : undefined),
    z.string().optional(),
  ),
});

const serverSchema = z.object({
  NODE_ENV: z.preprocess(
    (value) => normalizeEnvValue(typeof value === 'string' ? value : undefined),
    z.enum(['development', 'test', 'production']).default('development'),
  ),

  DATABASE_URL: z.preprocess(
    (value) => normalizeEnvValue(typeof value === 'string' ? value : undefined),
    z.string().min(1, 'DATABASE_URL is required'),
  ),
  DIRECT_URL: z.preprocess(
    (value) => normalizeEnvValue(typeof value === 'string' ? value : undefined),
    z.string().optional(),
  ),

  SUPABASE_SERVICE_ROLE_KEY: z.preprocess(
    (value) => sanitizeSupabaseKey(typeof value === 'string' ? value : undefined),
    z.string().optional(),
  ),

  OPENAI_API_KEY: z.preprocess(
    (value) => normalizeEnvValue(typeof value === 'string' ? value : undefined),
    z.string().optional(),
  ),
  OPENAI_MODEL: z.preprocess(
    (value) => normalizeEnvValue(typeof value === 'string' ? value : undefined),
    z.string().default('gpt-4o'),
  ),
  OPENAI_MODEL_FAST: z.preprocess(
    (value) => normalizeEnvValue(typeof value === 'string' ? value : undefined),
    z.string().default('gpt-4o-mini'),
  ),

  GOOGLE_PAGESPEED_API_KEY: emptyAsUndefined(),
  CHROMIUM_EXECUTABLE_PATH: emptyAsUndefined(),

  STRIPE_SECRET_KEY: emptyAsUndefined(),
  STRIPE_WEBHOOK_SECRET: emptyAsUndefined(),
  STRIPE_PRICE_PRO_MONTHLY: emptyAsUndefined(),
  STRIPE_PRICE_PRO_YEARLY: emptyAsUndefined(),
  STRIPE_PRICE_AGENCY_MONTHLY: emptyAsUndefined(),
  STRIPE_PRICE_AGENCY_YEARLY: emptyAsUndefined(),

  LOG_LEVEL: z.preprocess(
    (value) => normalizeEnvValue(typeof value === 'string' ? value : undefined),
    z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  ),
});

/** Treats `FOO=""` in a .env file the same as an unset variable. */
function emptyAsUndefined() {
  return z.preprocess(
    (value) => normalizeEnvValue(typeof value === 'string' ? value : undefined),
    z.string().optional().transform((value) => (value && value.trim().length > 0 ? value : undefined)),
  );
}

export type ClientEnv = z.infer<typeof clientSchema>;
export type ServerEnv = z.infer<typeof serverSchema>;

function formatIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `  • ${issue.path.join('.')}: ${issue.message}`).join('\n');
}

// Next.js inlines `process.env.NEXT_PUBLIC_*` at build time only for literal
// member accesses, so these must be written out rather than looped over.
const parsedClient = clientSchema.safeParse({
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
});

if (!parsedClient.success) {
  throw new Error(`Invalid public environment variables:\n${formatIssues(parsedClient.error)}`);
}

export const clientEnv: ClientEnv = parsedClient.data;

let cachedServerEnv: ServerEnv | null = null;

/** Server-only environment. Throws on first call if required vars are missing. */
export function serverEnv(): ServerEnv {
  if (cachedServerEnv) return cachedServerEnv;

  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid server environment variables:\n${formatIssues(parsed.error)}`);
  }

  cachedServerEnv = parsed.data;
  return cachedServerEnv;
}

/** Feature availability, derived from which integrations are configured. */
export function features() {
  const env = serverEnv();
  return {
    openai: Boolean(env.OPENAI_API_KEY),
    pageSpeed: Boolean(env.GOOGLE_PAGESPEED_API_KEY),
    browser: Boolean(env.CHROMIUM_EXECUTABLE_PATH),
    stripe: Boolean(env.STRIPE_SECRET_KEY),
    supabaseAdmin: Boolean(env.SUPABASE_SERVICE_ROLE_KEY),
  } as const;
}

export const isProduction = process.env.NODE_ENV === 'production';
export const isTest = process.env.NODE_ENV === 'test';
