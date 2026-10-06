'use server';

/**
 * Notifications (spec §47).
 *
 * One system, one table. Notifications are written only by `notify_user()`
 * (never by a client insert), and a student can only mark their own rows read —
 * RLS enforces both.
 */

import { revalidatePath } from 'next/cache';
import { getServerClient } from '@/lib/supabase/server';
import { getActiveUser } from '@/lib/auth/session';
import { fromPostgresError, errors, toActionError } from '@/lib/errors';

export async function markNotificationRead(formData) {
  try {
    if (!(await getActiveUser())) throw errors.unauthenticated();
    const id = String(formData.get('id') || '');
    const supabase = await getServerClient();
    const { error } = await supabase.rpc('mark_notification_read', { p_id: id });
    if (error) throw fromPostgresError(error);
    revalidatePath('/notifications');
    revalidatePath('/', 'layout');
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

export async function markAllNotificationsRead() {
  try {
    if (!(await getActiveUser())) throw errors.unauthenticated();
    const supabase = await getServerClient();
    const { error } = await supabase.rpc('mark_all_notifications_read');
    if (error) throw fromPostgresError(error);
    revalidatePath('/notifications');
    revalidatePath('/', 'layout');
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

export async function clearNotification(formData) {
  try {
    if (!(await getActiveUser())) throw errors.unauthenticated();
    const id = String(formData.get('id') || '');
    const supabase = await getServerClient();
    const { error } = await supabase.from('notifications').delete().eq('id', id);
    if (error) throw fromPostgresError(error);
    revalidatePath('/notifications');
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}
