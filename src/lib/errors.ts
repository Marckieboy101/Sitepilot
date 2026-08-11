/**
 * Application error taxonomy.
 *
 * Server actions never throw raw errors across the boundary — Next.js strips
 * messages from unhandled server errors in production, which would leave the
 * UI with "An unexpected error occurred". Instead every action returns an
 * `ActionResult`, and these classes carry the code the UI switches on.
 */

export type ErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'RATE_LIMITED'
  | 'QUOTA_EXCEEDED'
  | 'UPGRADE_REQUIRED'
  | 'UPSTREAM_FAILED'
  | 'UNREACHABLE_SITE'
  | 'CONFIGURATION'
  | 'INTERNAL';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, status = 400, details?: Record<string, unknown>) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const errors = {
  unauthorized: (message = 'You need to sign in to continue.') =>
    new AppError('UNAUTHORIZED', message, 401),

  forbidden: (message = "You don't have access to this resource.") =>
    new AppError('FORBIDDEN', message, 403),

  notFound: (what = 'Resource') => new AppError('NOT_FOUND', `${what} not found.`, 404),

  validation: (message: string, details?: Record<string, unknown>) =>
    new AppError('VALIDATION', message, 422, details),

  rateLimited: (retryAfterSeconds: number) =>
    new AppError(
      'RATE_LIMITED',
      `Too many requests. Try again in ${retryAfterSeconds} seconds.`,
      429,
      { retryAfterSeconds },
    ),

  quotaExceeded: (message: string, details?: Record<string, unknown>) =>
    new AppError('QUOTA_EXCEEDED', message, 402, details),

  upgradeRequired: (feature: string) =>
    new AppError('UPGRADE_REQUIRED', `${feature} is available on Pro and Agency plans.`, 402, {
      feature,
    }),

  upstream: (service: string, message?: string) =>
    new AppError('UPSTREAM_FAILED', message ?? `${service} is temporarily unavailable.`, 502, {
      service,
    }),

  unreachable: (url: string, reason: string) =>
    new AppError('UNREACHABLE_SITE', `Could not reach ${url}: ${reason}`, 400, { url, reason }),

  configuration: (message: string) => new AppError('CONFIGURATION', message, 500),

  internal: (message = 'Something went wrong on our end.') =>
    new AppError('INTERNAL', message, 500),
};

/** Discriminated result returned by every server action. */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ErrorCode; message: string; details?: Record<string, unknown> } };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail(error: unknown): ActionResult<never> {
  if (error instanceof AppError) {
    return { ok: false, error: { code: error.code, message: error.message, details: error.details } };
  }
  return {
    ok: false,
    error: { code: 'INTERNAL', message: 'Something went wrong on our end. Please try again.' },
  };
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
