import '@testing-library/jest-dom/vitest';

/**
 * Test environment.
 *
 * `serverEnv()` validates on first call and caches, so the required variables
 * are set here rather than in each test. Optional integrations are left unset
 * on purpose: the default test run exercises the degraded paths (no PageSpeed,
 * no Chromium, no AI), which is also how the app behaves on a fresh local
 * install.
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgresql://localhost:5432/sitepilot_test';
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000';
process.env.LOG_LEVEL ??= 'error';
