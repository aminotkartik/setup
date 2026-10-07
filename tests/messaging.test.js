import { describe, expect, it } from 'vitest';

import { getConversation, conversationTitle } from '@/lib/data/messaging';

/**
 * Regression coverage for the "Direct message with @undefined" bug.
 *
 * `getConversation()` used to derive `other` from the raw
 * `conversation_members` rows, which carry no username/display_name at all —
 * so `other.display_name || `@${other.username}`` rendered the literal string
 * "undefined" once `display_name` fell through. `other` must come from the
 * same profile-enriched rows as `members`.
 */
function mockSupabase({ conversation, members, messages = [], reads = [], people }) {
  return {
    from(table) {
      if (table === 'conversations') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: conversation }) }) }) };
      }
      if (table === 'conversation_members') {
        return { select: () => ({ eq: async () => ({ data: members }) }) };
      }
      if (table === 'messages') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  // `before` is applied via `.lt()` in getConversation, chained before awaiting.
                  lt: () => Promise.resolve({ data: messages }),
                  then: (resolve) => resolve({ data: messages }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'message_reads') {
        return { select: () => ({ eq: async () => ({ data: reads }) }) };
      }
      if (table === 'public_profiles') {
        return { select: () => ({ in: async () => ({ data: people }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

describe('getConversation', () => {
  it('resolves "other" with a real username/display_name, never leaving them undefined', async () => {
    const supabase = mockSupabase({
      conversation: { id: 'c1', kind: 'direct', title: null, community_id: null, status: 'published' },
      members: [
        { conversation_id: 'c1', user_id: 'me', role: 'member', status: 'active', is_muted: false, last_read_at: null },
        { conversation_id: 'c1', user_id: 'them', role: 'member', status: 'active', is_muted: false, last_read_at: null },
      ],
      people: [
        { id: 'me', username: 'me_user', display_name: 'Me', is_staff: false },
        { id: 'them', username: 'their_user', display_name: null, is_staff: false },
      ],
    });

    const result = await getConversation(supabase, 'c1', { profileId: 'me' });
    expect(result.other).not.toBeNull();
    expect(result.other.user_id).toBe('them');
    expect(result.other.username).toBe('their_user');
    // The historical bug: this key was simply absent (`undefined`) on the raw
    // conversation_members row used before the fix.
    expect(result.other.username).not.toBeUndefined();
    expect(result.other.display_name).not.toBeUndefined();

    const label = result.other.display_name || `@${result.other.username}`;
    expect(label).toBe('@their_user');
    expect(label).not.toContain('undefined');
  });

  it('falls back to "Student" instead of "@undefined" when a member has no public profile row', async () => {
    const supabase = mockSupabase({
      conversation: { id: 'c2', kind: 'direct', title: null, community_id: null, status: 'published' },
      members: [
        { conversation_id: 'c2', user_id: 'me', role: 'member', status: 'active', is_muted: false, last_read_at: null },
        { conversation_id: 'c2', user_id: 'ghost', role: 'member', status: 'active', is_muted: false, last_read_at: null },
      ],
      // "ghost" has no row here — e.g. a deactivated account no longer in public_profiles.
      people: [{ id: 'me', username: 'me_user', display_name: 'Me', is_staff: false }],
    });

    const result = await getConversation(supabase, 'c2', { profileId: 'me' });
    expect(result.other.username).toBeNull();
    expect(result.other.display_name).toBeNull();

    const title = conversationTitle(result.conversation, result.other, result.members);
    expect(title).toBe('Student');
    expect(title).not.toContain('undefined');
  });
});

describe('conversationTitle', () => {
  it('never renders "@undefined" for a member missing both names', () => {
    expect(conversationTitle({ title: null }, { username: undefined, display_name: undefined })).toBe('Student');
    expect(conversationTitle({ title: null }, null, [{ username: undefined, display_name: undefined }])).toBe('Student');
  });
});
