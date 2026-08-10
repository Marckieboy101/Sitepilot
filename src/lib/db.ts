import { PrismaClient } from '@prisma/client';

import { isProduction } from './env';

/**
 * Prisma singleton.
 *
 * Next.js dev-mode hot reload re-evaluates modules on every edit, which would
 * otherwise open a new connection pool per reload until Postgres refuses
 * connections. Stashing the client on `globalThis` keeps exactly one pool.
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: isProduction ? ['error'] : ['error', 'warn'],
  });

if (!isProduction) globalForPrisma.prisma = db;

export type { Prisma } from '@prisma/client';
export * from '@prisma/client';
