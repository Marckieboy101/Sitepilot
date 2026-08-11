import { db } from '@/lib/db';

/**
 * Notification reads.
 *
 * Deliberately NOT in `actions.ts`: everything exported from a `'use server'`
 * module becomes a callable RPC endpoint, so a function taking `userId` as an
 * argument would let any client read anyone's notifications. Callers here are
 * server components that have already resolved the session.
 */
export async function getNotifications(userId: string, limit = 12) {
  return db.notification.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { id: true, title: true, body: true, href: true, readAt: true, createdAt: true },
  });
}

export async function countUnreadNotifications(userId: string): Promise<number> {
  return db.notification.count({ where: { userId, readAt: null } });
}
