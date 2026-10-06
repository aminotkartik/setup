import 'server-only';

/**
 * Read-side helpers for the feed, posts and profiles.
 *
 * Reads run as the signed-in student through the publishable key, so RLS is the
 * authority on visibility: blocks, account status, community membership and
 * moderation state are applied by the database, not by these functions.
 */

import { PAGE_SIZE } from '@/lib/constants';

/**
 * Hydrate raw post rows with everything the card needs: author identity (from
 * the block-aware public projection), staffing flag, community, counters, the
 * viewer's own reaction and poll options.
 *
 * Kept as one function so every surface that lists posts (home, explore,
 * community, profile, post detail) renders identical data and identical
 * visibility rules.
 */
export async function hydratePosts(supabase, rows, { currentProfileId = null } = {}) {
  const posts = rows || [];
  if (!posts.length) return [];

  const authorIds = [...new Set(posts.map((post) => post.author_id).filter(Boolean))];
  const postIds = posts.map((post) => post.id);

  const [{ data: authors }, { data: myReactions }, { data: polls }, { data: options }, { data: myVotes }] =
    await Promise.all([
      supabase.from('public_profiles').select('id, username, display_name, is_staff').in('id', authorIds),
      currentProfileId
        ? supabase
            .from('reactions')
            .select('target_id')
            .eq('user_id', currentProfileId)
            .eq('target_type', 'post')
            .in('target_id', postIds)
        : Promise.resolve({ data: [] }),
      supabase.from('posts').select('id, poll_closes_at').in('id', postIds).eq('kind', 'poll'),
      supabase
        .from('poll_options')
        .select('id, post_id, label, position, vote_count')
        .in('post_id', postIds)
        .order('position'),
      currentProfileId
        ? supabase.from('poll_votes').select('post_id, option_id').eq('user_id', currentProfileId).in('post_id', postIds)
        : Promise.resolve({ data: [] }),
    ]);

  const authorById = new Map((authors || []).map((author) => [author.id, author]));
  const reactedIds = new Set((myReactions || []).map((row) => row.target_id));
  const pollIds = new Set((polls || []).map((row) => row.id));
  const closesAt = new Map((polls || []).map((row) => [row.id, row.poll_closes_at]));
  const myVoteByPost = new Map((myVotes || []).map((row) => [row.post_id, row.option_id]));
  const optionsByPost = new Map();
  for (const option of options || []) {
    if (!optionsByPost.has(option.post_id)) optionsByPost.set(option.post_id, []);
    optionsByPost.get(option.post_id).push(option);
  }

  return posts.map((post) => {
    const author = authorById.get(post.author_id) || {};
    return {
      ...post,
      author_username: author.username || null,
      author_display_name: author.display_name || null,
      author_is_staff: author.is_staff === true,
      reacted_by_me: reactedIds.has(post.id),
      poll: pollIds.has(post.id)
        ? {
            closes_at: closesAt.get(post.id) || null,
            options: (optionsByPost.get(post.id) || []).map((option) => ({
              ...option,
              mine: myVoteByPost.get(post.id) === option.id,
            })),
          }
        : null,
    };
  });
}

const POST_COLUMNS =
  'id, author_id, kind, title, body, gif, community_id, visibility, status, is_official, pinned, ' +
  'comment_count, reaction_count, created_at';

/** Fetch posts for a set of ids (order preserved) and hydrate them. */
export async function getPostsByIds(supabase, ids, { currentProfileId = null } = {}) {
  if (!ids.length) return [];
  const { data, error } = await supabase.from('posts').select(POST_COLUMNS).in('id', ids);
  if (error) return [];
  const byId = new Map((data || []).map((post) => [post.id, post]));
  return hydratePosts(supabase, ids.map((id) => byId.get(id)).filter(Boolean), { currentProfileId });
}

/** One post with its comments, in reading order. */
export async function getPostDetail(supabase, postId, { currentProfileId = null } = {}) {
  const { data: post } = await supabase.from('posts').select(POST_COLUMNS).eq('id', postId).maybeSingle();
  if (!post) return null;

  const [hydrated] = await hydratePosts(supabase, [post], { currentProfileId });

  const { data: comments } = await supabase
    .from('comments')
    .select('id, post_id, parent_id, author_id, body, gif, status, reaction_count, created_at')
    .eq('post_id', postId)
    .order('created_at', { ascending: true });

  const commentRows = comments || [];
  const commentAuthorIds = [...new Set(commentRows.map((row) => row.author_id))];
  const [{ data: commentAuthors }, { data: myCommentReactions }] = await Promise.all([
    commentAuthorIds.length
      ? supabase.from('public_profiles').select('id, username, display_name, is_staff').in('id', commentAuthorIds)
      : Promise.resolve({ data: [] }),
    currentProfileId && commentRows.length
      ? supabase
          .from('reactions')
          .select('target_id')
          .eq('user_id', currentProfileId)
          .eq('target_type', 'comment')
          .in('target_id', commentRows.map((row) => row.id))
      : Promise.resolve({ data: [] }),
  ]);

  const authorById = new Map((commentAuthors || []).map((author) => [author.id, author]));
  const reacted = new Set((myCommentReactions || []).map((row) => row.target_id));

  return {
    post: hydrated,
    comments: commentRows.map((comment) => ({
      ...comment,
      author_username: authorById.get(comment.author_id)?.username || null,
      author_display_name: authorById.get(comment.author_id)?.display_name || null,
      author_is_staff: authorById.get(comment.author_id)?.is_staff === true,
      reacted_by_me: reacted.has(comment.id),
    })),
  };
}

/**
 * The home feed. `campus_feed()` is the single unified feed function — posts,
 * discussions, official notices, events and marketplace highlights — with
 * deterministic ordering (spec §16): no algorithm, no personalisation.
 */
export async function getCampusFeed(supabase, { limit = PAGE_SIZE.feed, offset = 0, sort = 'newest' } = {}) {
  const { data, error } = await supabase.rpc('campus_feed', {
    p_limit: limit,
    p_offset: offset,
    p_sort: sort,
  });
  if (error) return { items: [], unavailable: true };

  const items = (data || []).map((item) => ({
    id: item.id,
    type: item.item_type,
    title: item.title,
    body: item.body,
    gif: item.gif,
    authorUsername: item.author_username,
    authorDisplayName: item.author_display_name,
    isOfficial: item.is_official,
    communitySlug: item.community_slug,
    meta: item.meta || {},
    createdAt: item.created_at,
    sortAt: item.sort_at,
  }));

  // Pull the underlying post rows so the feed can render real cards (reactions,
  // comments, poll state) for the posts it includes.
  const postIds = items.filter((item) => item.type === 'post' || item.type === 'discussion' || item.type === 'poll').map((item) => item.id);
  const posts = await getPostsByIds(supabase, postIds, {
    currentProfileId: null,
  });
  const postById = new Map(posts.map((post) => [post.id, post]));

  return { items: items.map((item) => ({ ...item, post: postById.get(item.id) || null })), unavailable: false };
}

/** Trending uses the same deterministic SQL score documented in the UI. */
export async function getTrendingPosts(supabase, { limit = 10, hours = 72 } = {}) {
  const { data, error } = await supabase.rpc('trending_posts', { p_limit: limit, p_hours: hours });
  if (error) return [];
  return data || [];
}

/** Published posts by one author, newest first (profile pages). */
export async function getPostsByAuthor(
  supabase,
  authorId,
  { limit = PAGE_SIZE.feed, offset = 0, currentProfileId = null } = {},
) {
  if (!authorId) return [];
  const { data, error } = await supabase
    .from('posts')
    .select(POST_COLUMNS)
    .eq('author_id', authorId)
    .order('created_at', { ascending: false })
    .range(offset, offset + Math.max(0, limit - 1));
  if (error) return [];
  return hydratePosts(supabase, data || [], { currentProfileId });
}

/** Published posts inside one community, newest first (community page). */
export async function getCommunityPosts(
  supabase,
  communityId,
  { limit = PAGE_SIZE.feed, offset = 0, currentProfileId = null } = {},
) {
  if (!communityId) return [];
  const { data, error } = await supabase
    .from('posts')
    .select(POST_COLUMNS)
    .eq('community_id', communityId)
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false })
    .range(offset, offset + Math.max(0, limit - 1));
  if (error) return [];
  return hydratePosts(supabase, data || [], { currentProfileId });
}
