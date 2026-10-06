/**
 * The single notification system (spec §53).
 *
 * All notifications flow through the database function `notify_user`, which:
 *   - is callable by authenticated users but writes rows as the definer,
 *   - refuses to notify blocked relationships,
 *   - refuses self-notifications,
 *   - does not allow a caller to spoof arbitrary "system" content,
 *   - is rate limited.
 *
 * Features never create their own notification tables or channels.
 */

import 'server-only';
import { NOTIFICATION_TYPES } from '@/lib/constants';
import { ROUTES } from '@/lib/constants';

/**
 * @param {object} supabase user-scoped client
 * @param {{ recipientId: string, type: string, title: string, body?: string,
 *           referenceType?: string, referenceId?: string, url?: string }} input
 */
export async function notify(supabase, {
  recipientId,
  type,
  title,
  body = null,
  referenceType = null,
  referenceId = null,
  url = null,
}) {
  if (!supabase || !recipientId || !title) return { ok: false, skipped: true };
  if (!NOTIFICATION_TYPES.includes(type)) {
    // Unknown types are a programming error: log and skip rather than write junk.
    console.warn(`[campus+] unknown notification type: ${type}`);
    return { ok: false, skipped: true };
  }

  const { error } = await supabase.rpc('notify_user', {
    p_recipient: recipientId,
    p_type: type,
    p_title: title.slice(0, 140),
    p_body: body ? String(body).slice(0, 500) : null,
    p_reference_type: referenceType,
    p_reference_id: referenceId ? String(referenceId) : null,
    p_url: url ? String(url).slice(0, 300) : null,
  });

  if (error) {
    // A failed notification must never fail the underlying user action.
    console.warn('[campus+] notification skipped:', error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/** Notify every member of a conversation except the sender. */
export async function notifyConversation(supabase, { memberIds, senderId, senderName, conversationId, preview }) {
  const recipients = (memberIds || []).filter((id) => id && id !== senderId);
  await Promise.all(
    recipients.map((recipientId) =>
      notify(supabase, {
        recipientId,
        type: 'dm_new',
        title: `New message from ${senderName}`,
        body: preview ? preview.slice(0, 140) : null,
        referenceType: 'conversation',
        referenceId: conversationId,
        url: ROUTES.conversation(conversationId),
      }),
    ),
  );
}

export function notificationIcon(type) {
  switch (type) {
    case 'dm_new':
    case 'marketplace_message':
      return 'chat';
    case 'mention':
      return 'at';
    case 'comment':
    case 'reply':
      return 'comment';
    case 'reaction':
      return 'heart';
    case 'marketplace_status':
    case 'marketplace_rating':
      return 'tag';
    case 'event_update':
    case 'event_reminder':
      return 'calendar';
    case 'community_activity':
    case 'club_activity':
      return 'users';
    case 'moderation_notice':
    case 'report_result':
      return 'shield';
    default:
      return 'bell';
  }
}

export function describeNotificationType(type) {
  return type.replace(/_/g, ' ');
}
