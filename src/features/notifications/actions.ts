'use server';

import { revalidatePath } from 'next/cache';

import { db } from '@/lib/db';
import { fail, ok, type ActionResult } from '@/lib/errors';

import { requireSession } from '../auth/session';

export async function markNotificationsReadAction(): Promise<ActionResult<null>> {
  try {
    const session = await requireSession();

    await db.notification.updateMany({
      where: { userId: session.userId, readAt: null },
      data: { readAt: new Date() },
    });

    revalidatePath('/dashboard', 'layout');
    return ok(null);
  } catch (error) {
    return fail(error);
  }
}
