/**
 * @mentions (spec §55).
 *
 * Mentions are parsed server-side from the stored text, resolved against public
 * usernames only (never emails), filtered through blocks and account status,
 * and turned into notifications. The rendered link comes from the resolved
 * username, so no HTML is ever built from user text (spec §71 — XSS).
 */

import 'server-only';
import { notify } from '@/lib/notifications';
import { LIMITS, ROUTES } from '@/lib/constants';

const MENTION_REGEX = /(^|[^\w@])@([a-z0-9_]{3,24})\b/gi;

/** Unique lowercase usernames mentioned in a block of text. */
export function extractMentionUsernames(text) {
  if (!text) return [];
  const found = new Set();
  const source = String(text).slice(0, LIMITS.post.max);
  let match;
  MENTION_REGEX.lastIndex = 0;
  while ((match = MENTION_REGEX.exec(source)) !== null) {
    found.add(match[2].toLowerCase());
  }
  return [...found].slice(0, 10);
}

/** Resolve mentioned usernames to visible profiles (blocks + status respected). */
export async function resolveMentions(supabase, usernames, { excludeUserId = null } = {}) {
  const list = (usernames || []).filter(Boolean);
  if (!list.length) return [];
  // Mentions resolve against the public projection only. `is_active` filters out
  // suspended/banned/deactivated students without ever exposing account state.
  const { data, error } = await supabase
    .from('public_profiles')
    .select('id, username, display_name')
    .in('username', list)
    .eq('is_active', true);
  if (error) return [];
  return (data || []).filter((profile) => profile.id !== excludeUserId);
}

/**
 * Resolve + notify in one call, used after a post/comment/message is stored.
 *
 * @returns {Promise<Array<{id:string,username:string}>>} resolvable mentions,
 *          used by the UI to render mention links.
 */
export async function handleMentions(supabase, {
  text,
  actorUserId,
  actorName,
  link,
  referenceType,
  referenceId,
  extraRecipients = [],
}) {
  const usernames = extractMentionUsernames(text);
  if (!usernames.length) return [];
  const profiles = await resolveMentions(supabase, usernames, { excludeUserId: actorUserId });

  const recipients = new Map(profiles.map((p) => [p.id, p]));
  for (const extra of extraRecipients) {
    if (extra?.id && extra.id !== actorUserId) recipients.set(extra.id, extra);
  }

  await Promise.all(
    [...recipients.values()].map((profile) =>
      notify(supabase, {
        recipientId: profile.id,
        type: 'mention',
        title: `${actorName} mentioned you`,
        body: String(text || '').slice(0, 140),
        referenceType,
        referenceId,
        url: link || null,
      }),
    ),
  );

  return profiles.map((p) => ({ id: p.id, username: p.username, display_name: p.display_name }));
}

/** Split text into render segments for safe display (plain text + mention links). */
export function segmentMentions(text) {
  const source = String(text ?? '');
  const segments = [];
  let cursor = 0;
  let match;
  MENTION_REGEX.lastIndex = 0;
  while ((match = MENTION_REGEX.exec(source)) !== null) {
    const prefix = match[1];
    const start = match.index + prefix.length;
    if (start > cursor) segments.push({ type: 'text', value: source.slice(cursor, start) });
    segments.push({ type: 'mention', value: match[2].toLowerCase() });
    cursor = start + match[2].length + 1;
  }
  if (cursor < source.length) segments.push({ type: 'text', value: source.slice(cursor) });
  return segments;
}

export function mentionUrl(username) {
  return ROUTES.user(username);
}
