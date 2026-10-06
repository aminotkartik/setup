import 'server-only';

/**
 * Read helpers for the single messaging system (spec §21).
 *
 * Conversations are either `direct` (exactly two students, canonical pair key)
 * or `group` (community chat, study group). Everything here runs as the signed-in
 * student, so RLS decides which conversations and messages exist for them —
 * including the rule that a blocked pair cannot read each other's threads.
 */

import { PAGE_SIZE } from '@/lib/constants';

export const MESSAGE_COLUMNS = 'id, conversation_id, sender_id, body, gif, status, edited_at, deleted_at, created_at';
export const CONVERSATION_COLUMNS = 'id, kind, title, community_id, status, last_message_at, created_at';

/**
 * Unread badge saturation point. The inbox read model
 * (`public.conversation_inbox`, migration 020) counts unread messages inside
 * the newest 30 messages of each conversation and never returns more than this,
 * which is what makes the badge read "30+" past the cap.
 */
export const UNREAD_WINDOW = 30;

/** Active memberships of the signed-in student. */
export async function getMemberships(supabase, profileId) {
  if (!profileId) return [];
  const { data } = await supabase
    .from('conversation_members')
    .select('conversation_id, role, status, is_muted, last_read_at, last_read_message_id')
    .eq('user_id', profileId)
    .eq('status', 'active');
  return data || [];
}

/**
 * Conversation list with the newest message and an unread marker.
 *
 * `conversation_inbox()` (migration 020) is the read model: one RLS-scoped row
 * per visible conversation with the newest message and the unread count for the
 * same 30-message window the UI has always shown. It replaces fetching 30 full
 * messages per conversation — the thread view still reads `messages` directly.
 */
export async function listConversations(supabase, profileId, { limit = 30 } = {}) {
  const memberships = await getMemberships(supabase, profileId);
  if (!memberships.length) return { conversations: [], unavailable: false };

  const membershipByConversation = new Map(memberships.map((m) => [m.conversation_id, m]));

  const [inboxResult, memberResult] = await Promise.all([
    supabase.rpc('conversation_inbox', { p_limit: limit }),
    supabase
      .from('conversation_members')
      .select('conversation_id, user_id, role, last_read_at')
      .in('conversation_id', [...membershipByConversation.keys()])
      .eq('status', 'active'),
  ]);

  const { data: rows, error } = inboxResult;
  if (error) return { conversations: [], unavailable: true };

  const conversations = rows || [];
  if (!conversations.length) return { conversations: [], unavailable: false };

  const members = memberResult.data || [];
  const personIds = [...new Set(members.map((member) => member.user_id))];
  const { data: people } = personIds.length
    ? await supabase.from('public_profiles').select('id, username, display_name, is_staff').in('id', personIds)
    : { data: [] };
  const personById = new Map((people || []).map((person) => [person.id, person]));

  const membersByConversation = new Map();
  for (const member of members) {
    if (!membersByConversation.has(member.conversation_id)) membersByConversation.set(member.conversation_id, []);
    membersByConversation.get(member.conversation_id).push({
      ...member,
      username: personById.get(member.user_id)?.username || null,
      display_name: personById.get(member.user_id)?.display_name || null,
      is_staff: personById.get(member.user_id)?.is_staff === true,
    });
  }

  return {
    conversations: conversations.map((conversation) => {
      const membership = membershipByConversation.get(conversation.id) || {};
      const membersOfConversation = membersByConversation.get(conversation.id) || [];
      const others = membersOfConversation.filter((member) => member.user_id !== profileId);
      const unread = conversation.unread || 0;
      const lastMessage = conversation.last_message_created_at
        ? {
            id: conversation.last_message_id,
            conversation_id: conversation.id,
            sender_id: conversation.last_message_sender_id,
            body: conversation.last_message_body,
            gif: conversation.last_message_gif,
            created_at: conversation.last_message_created_at,
          }
        : null;

      return {
        id: conversation.id,
        kind: conversation.kind,
        title: conversation.title,
        community_id: conversation.community_id,
        status: conversation.status,
        last_message_at: conversation.last_message_at,
        created_at: conversation.created_at,
        is_muted: membership.is_muted === true || conversation.is_muted === true,
        members: membersOfConversation,
        other: conversation.kind === 'direct' ? others[0] || null : null,
        lastMessage,
        unread,
        unreadSaturated: unread >= UNREAD_WINDOW,
      };
    }),
    unavailable: false,
  };
}

/** Total unread direct/group messages for the navigation badge (same window). */
export async function getUnreadMessageTotal(supabase, profileId) {
  const { conversations } = await listConversations(supabase, profileId, { limit: 50 });
  return conversations.reduce((total, conversation) => total + conversation.unread, 0);
}

/** Conversation header data plus a page of messages, oldest → newest. */
export async function getConversation(
  supabase,
  conversationId,
  { profileId, limit = PAGE_SIZE.messages, before = null } = {},
) {
  const { data: conversation } = await supabase
    .from('conversations')
    .select(CONVERSATION_COLUMNS)
    .eq('id', conversationId)
    .maybeSingle();
  if (!conversation) return null;

  const messageQuery = supabase
    .from('messages')
    .select(MESSAGE_COLUMNS)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (before) messageQuery.lt('created_at', before);

  const [{ data: memberRows }, { data: messageRows }, { data: readRows }] = await Promise.all([
    supabase
      .from('conversation_members')
      .select('conversation_id, user_id, role, status, is_muted, last_read_at')
      .eq('conversation_id', conversationId),
    messageQuery,
    supabase
      .from('message_reads')
      .select('user_id, last_read_at, last_message_id')
      .eq('conversation_id', conversationId),
  ]);

  const memberList = (memberRows || []).filter((member) => member.status === 'active');
  const personIds = [...new Set(memberList.map((member) => member.user_id))];
  const { data: people } = personIds.length
    ? await supabase.from('public_profiles').select('id, username, display_name, is_staff').in('id', personIds)
    : { data: [] };
  const personById = new Map((people || []).map((person) => [person.id, person]));

  const messages = (messageRows || []).slice().reverse();
  return {
    conversation,
    members: memberList.map((member) => ({
      ...member,
      username: personById.get(member.user_id)?.username || null,
      display_name: personById.get(member.user_id)?.display_name || null,
      is_staff: personById.get(member.user_id)?.is_staff === true,
    })),
    reads: readRows || [],
    messages,
    hasMore: Boolean(messageRows && messageRows.length === limit),
    myMembership: memberList.find((member) => member.user_id === profileId) || null,
    other: conversation.kind === 'direct' ? memberList.find((member) => member.user_id !== profileId) || null : null,
  };
}

/** Older page of a thread (used by "Load earlier messages"). */
export async function listMessages(supabase, conversationId, { limit = PAGE_SIZE.messages, before } = {}) {
  const query = supabase
    .from('messages')
    .select(MESSAGE_COLUMNS)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (before) query.lt('created_at', before);
  const { data } = await query;
  return (data || []).slice().reverse();
}

export function conversationTitle(conversation, other, members = []) {
  if (conversation?.title) return conversation.title;
  if (other) return other.display_name || `@${other.username}`;
  const names = members.filter(Boolean).map((member) => member.display_name || `@${member.username}`);
  return names.length ? names.join(', ') : 'Conversation';
}
