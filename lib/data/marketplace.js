import 'server-only';

/**
 * Marketplace reads (spec §17–§20).
 *
 * One module for the whole market: listings, free items, gigs and campus deals.
 * The contact note is never read from the base table — it is released only by
 * `get_listing_contact_note()` after a student expresses interest, which is the
 * entire point of that column.
 */

import { PAGE_SIZE } from '@/lib/constants';

export const LISTING_COLUMNS =
  'id, seller_id, category_id, title, description, price, is_free, is_negotiable, condition, ' +
  'location, status, is_official, moderated_by, moderated_at, moderation_reason, created_at, updated_at';

const GIG_COLUMNS =
  'id, creator_id, category_id, title, description, category, compensation, availability, status, created_at, updated_at';

export async function listCategories(supabase, { scope = null } = {}) {
  let query = supabase
    .from('marketplace_categories')
    .select('id, name, slug, description, scope, sort_order')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (scope) query = query.eq('scope', scope);
  const { data } = await query;
  return data || [];
}

export async function listListings(
  supabase,
  { status = ['active', 'reserved'], categoryId = null, free = null, q = null, sellerId = null, limit = 24, offset = 0 } = {},
) {
  let query = supabase
    .from('marketplace_listings')
    .select(LISTING_COLUMNS)
    .order('created_at', { ascending: false })
    .range(offset, offset + Math.max(0, limit - 1));
  query = Array.isArray(status) ? query.in('status', status) : query.eq('status', status);
  if (categoryId) query = query.eq('category_id', categoryId);
  if (free === true) query = query.eq('is_free', true);
  if (free === false) query = query.eq('is_free', false);
  if (sellerId) query = query.eq('seller_id', sellerId);
  if (q) query = query.textSearch('search_vector', q, { config: 'english', type: 'websearch' });
  const { data, error } = await query;
  if (error) return { items: [], unavailable: true };
  return { items: data || [], unavailable: false };
}

export async function getListing(supabase, id) {
  const { data } = await supabase.from('marketplace_listings').select(LISTING_COLUMNS).eq('id', id).maybeSingle();
  return data || null;
}

export async function getListingSeller(supabase, sellerId) {
  const { data } = await supabase
    .from('public_profiles')
    .select('id, username, display_name, is_staff, marketplace_completed_count, reputation_score, reputation_count')
    .eq('id', sellerId)
    .maybeSingle();
  return data || null;
}

/** Released only after interest: the seller's own note for the buyer. */
export async function getListingContactNote(supabase, listingId) {
  const { data, error } = await supabase.rpc('get_listing_contact_note', { p_listing: listingId });
  if (error) return null;
  return data || null;
}

export async function getMyListingInterest(supabase, listingId, profileId) {
  if (!profileId) return null;
  const { data } = await supabase
    .from('marketplace_interactions')
    .select('id, kind, created_at')
    .eq('listing_id', listingId)
    .eq('user_id', profileId)
    .maybeSingle();
  return data || null;
}

export async function listListingInteractions(supabase, listingId, { limit = 30 } = {}) {
  const { data: interactions } = await supabase
    .from('marketplace_interactions')
    .select('id, user_id, kind, created_at')
    .eq('listing_id', listingId)
    .order('created_at', { ascending: true })
    .limit(limit);
  const ids = [...new Set((interactions || []).map((row) => row.user_id))];
  if (!ids.length) return [];
  const { data: people } = await supabase
    .from('public_profiles')
    .select('id, username, display_name')
    .in('id', ids);
  const byId = new Map((people || []).map((person) => [person.id, person]));
  return (interactions || []).map((row) => ({
    ...row,
    username: byId.get(row.user_id)?.username || null,
    display_name: byId.get(row.user_id)?.display_name || null,
  }));
}

export async function getListingRating(supabase, listingId, raterId) {
  if (!raterId) return null;
  const { data } = await supabase
    .from('ratings')
    .select('id, score, comment, role, created_at')
    .eq('listing_id', listingId)
    .eq('rater_id', raterId)
    .maybeSingle();
  return data || null;
}

export async function listMyListings(supabase, profileId, { limit = 30 } = {}) {
  if (!profileId) return [];
  const { data } = await supabase
    .from('marketplace_listings')
    .select(LISTING_COLUMNS)
    .eq('seller_id', profileId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return data || [];
}

export async function listGigs(supabase, { status = 'published', limit = 24, offset = 0, q = null } = {}) {
  let query = supabase
    .from('gigs')
    .select(GIG_COLUMNS)
    .order('created_at', { ascending: false })
    .range(offset, offset + Math.max(0, limit - 1));
  query = Array.isArray(status) ? query.in('status', status) : query.eq('status', status);
  if (q) query = query.textSearch('search_vector', q, { config: 'english', type: 'websearch' });
  const { data, error } = await query;
  if (error) return { items: [], unavailable: true };
  return { items: data || [], unavailable: false };
}

export async function getGig(supabase, id) {
  const { data } = await supabase.from('gigs').select(GIG_COLUMNS).eq('id', id).maybeSingle();
  return data || null;
}

export async function listDeals(supabase, { limit = 24 } = {}) {
  const { data, error } = await supabase
    .from('campus_deals')
    .select('id, title, description, merchant, discount_details, valid_from, valid_until, contact_info, status, is_official, created_by, published_at, created_at')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(limit);
  if (error) return { items: [], unavailable: true };
  return { items: data || [], unavailable: false };
}

export async function getDeal(supabase, id) {
  const { data } = await supabase
    .from('campus_deals')
    .select('id, title, description, merchant, discount_details, valid_from, valid_until, contact_info, status, is_official, created_by, published_at, created_at, updated_at')
    .eq('id', id)
    .maybeSingle();
  return data || null;
}

export async function getMarketSummary(supabase) {
  const [active, free, gigs, sold] = await Promise.all([
    supabase.from('marketplace_listings').select('id', { count: 'exact', head: true }).in('status', ['active', 'reserved']),
    supabase.from('marketplace_listings').select('id', { count: 'exact', head: true }).eq('is_free', true).in('status', ['active', 'reserved']),
    supabase.from('gigs').select('id', { count: 'exact', head: true }).eq('status', 'published'),
    supabase.from('marketplace_listings').select('id', { count: 'exact', head: true }).eq('status', 'sold'),
  ]);
  return {
    active: active.count ?? 0,
    free: free.count ?? 0,
    gigs: gigs.count ?? 0,
    sold: sold.count ?? 0,
  };
}

export const MARKET_PAGE_SIZE = PAGE_SIZE.default;
