/**
 * Audit trail (spec §59, §105, §120).
 *
 * Every administrative or moderation action records a row through
 * `public.log_audit()` — a SECURITY DEFINER function that stamps the real actor
 * from the session, so a client cannot forge the actor column.
 */

import 'server-only';
import { fromPostgresError } from '@/lib/errors';

/**
 * @param {object} supabase user-scoped client
 * @param {{ action: string, targetType?: string, targetId?: string, metadata?: object,
 *           alsoModerationAction?: boolean, reason?: string, visibility?: string }} input
 */
export async function logAudit(supabase, {
  action,
  targetType = null,
  targetId = null,
  metadata = null,
  alsoModerationAction = false,
  reason = null,
  visibility = 'staff',
}) {
  if (!supabase || !action) return { ok: false };
  const { error } = await supabase.rpc('log_audit', {
    p_action: action,
    p_target_type: targetType,
    p_target_id: targetId ? String(targetId) : null,
    p_metadata: metadata || null,
    p_also_moderation: alsoModerationAction,
    p_reason: reason,
    p_visibility: visibility,
  });
  if (error) {
    // Never fail the user's action because logging hiccuped; but do surface it
    // in server logs so the operator notices an incomplete audit trail.
    console.warn('[campus+] audit log write failed:', error.message, { action, targetType, targetId });
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/** Query audit logs — requires the caller to hold `view_audit_logs` (RLS). */
export async function listAuditLogs(supabase, { action = null, actorId = null, limit = 50, offset = 0 } = {}) {
  let query = supabase
    .from('audit_logs')
    .select(
      `id, action, target_type, target_id, metadata, created_at, visibility,
       actor:profiles!audit_logs_actor_user_id_fkey ( id, username, display_name )`,
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (action) query = query.eq('action', action);
  if (actorId) query = query.eq('actor_user_id', actorId);

  const { data, error, count } = await query;
  if (error) throw fromPostgresError(error);
  return { items: data || [], count: count || 0 };
}
