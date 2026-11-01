/**
 * Supabase Realtime wiring for the campus feed.
 *
 * Same contract as `lib/messaging/realtime.js`, for a different table: one private
 * per-student channel, `postgres_changes` bindings, and *nothing* rendered straight
 * from these payloads. A Realtime row is a raw `posts` record — no author block,
 * no poll options, no viewer reaction state — so the surface it lands on treats it
 * as a signal to re-read through `lib/data/feed.js`, the shared hydration path.
 * That is what keeps an instant update and a normally loaded post identical.
 *
 * Security notes, all of them deliberate:
 *
 *   - The client is the browser's publishable-key client. There is no service-role
 *     client here and none is needed: delivery is authorised per subscriber by the
 *     table's own SELECT policies (`posts_select_visible`, `posts_select_author`,
 *     `posts_select_staff`), which already encode published state, blocks, mutes,
 *     account status and community membership. A student therefore cannot receive a
 *     post they could not have fetched.
 *   - The channel is private (`config: { private: true }`) on a
 *     `feed:<profile id>` topic, so Realtime additionally requires the
 *     `realtime.messages` read policy from migration 014/029 to match the
 *     subscriber's own profile id. It is an extra boundary on top of table RLS,
 *     never a replacement for it.
 *   - Exactly one subscription per signed-in tab, owned by the shell provider —
 *     never one per feed card.
 */

import { isPermanentRealtimeAuthorizationError } from '@/lib/realtime/authorization';

/** Explicitly hand the current session to Realtime before creating a channel. */
export async function authenticateRealtime(client) {
  if (!client) return false;
  const { data, error } = await client.auth.getSession();
  const token = data?.session?.access_token;
  if (error || !token) return false;
  await client.realtime.setAuth(token);
  return true;
}

/** The `feed:` topic is scoped to the subscriber's own profile id (see above). */
export function feedChannelTopic(profileId) {
  return `feed:${profileId}`;
}

/**
 * Subscribe to the post changes one student is allowed to see.
 *
 * `INSERT` carries no column filter on purpose: which rows arrive is RLS's
 * decision, not a query string's. `UPDATE` compares the old and new pin/status
 * metadata, which is how a pin, unpin, hide, remove or delete changes an open
 * feed. Reaction and comment counters move on the same table constantly and are
 * discarded before invalidation, not a reason to make every reader re-query.
 * Migration 038's narrow replica-identity index supplies those old columns;
 * without them, the safe fallback retains the previous non-published filter.
 * `DELETE` only ever reaches a student whose SELECT policy still admits the row
 * being removed (real Campus+ deletes are soft, i.e. the UPDATE binding above);
 * it is bound so a retention purge is handled by the same path rather than by a
 * special case.
 *
 * @returns {() => void} cleanup. Idempotent; callbacks stop firing after it runs.
 */
export function subscribeToFeedPosts(client, profileId, { onPostChange, onStatus } = {}) {
  if (!client || !profileId) return () => {};
  let disposed = false;

  const emit = (eventType, record) => {
    if (disposed || !record?.id) return;
    // Only the id and the event kind cross this boundary. The row itself is
    // deliberately not handed to the surface to render.
    onPostChange?.({ eventType, postId: String(record.id), status: record.status || null });
  };

  const channel = client
    .channel(feedChannelTopic(profileId), { config: { private: true } })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, (payload) => {
      emit('INSERT', payload.new);
    })
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'posts' },
      (payload) => {
        const before = payload.old || {};
        const after = payload.new || {};
        // With migration 038, old.id/pinned/status arrive without old post
        // content. If an older database omits them, do not turn every counter
        // update into a refresh: retain the previous removal-only behaviour.
        const relevant = typeof before.pinned === 'boolean' && typeof before.status === 'string'
          ? before.pinned !== after.pinned || before.status !== after.status
          : after.status !== 'published';
        if (relevant) emit('UPDATE', after);
      },
    )
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'posts' }, (payload) => {
      emit('DELETE', payload.old);
    })
    .subscribe((status, error) => {
      if (disposed) return;
      if (status === 'CHANNEL_ERROR' && isPermanentRealtimeAuthorizationError(error)) {
        // Phoenix would otherwise rejoin this permanently rejected channel every
        // few seconds. Remove it once; the shell's slow HTTP reconciliation still
        // covers gaps, while transient socket/token errors keep normal backoff.
        disposed = true;
        void client.removeChannel(channel);
      }
      onStatus?.(status, error);
    });

  return () => {
    if (disposed) return;
    disposed = true;
    void client.removeChannel(channel);
  };
}
