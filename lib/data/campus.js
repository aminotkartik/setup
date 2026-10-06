import 'server-only';

/**
 * Read helpers for the campus surfaces: notices, events, clubs, lost & found,
 * housing, rides, team finder, resources, opportunities, projects and the
 * text-only campus utilities (spec §25–§46).
 *
 * Every query runs as the signed-in student, so RLS decides what is visible:
 * official content stays official, community submissions stay visibly
 * community-submitted, and unpublished rows never leak.
 */

import { PAGE_SIZE } from '@/lib/constants';

const PUBLISHED = 'published';

/* -------------------------------------------------------------------------- */
/* Notices                                                                    */
/* -------------------------------------------------------------------------- */

export async function listNotices(supabase, { limit = 20, offset = 0, category = null, includeExpired = false } = {}) {
  const query = supabase
    .from('notices')
    .select('id, title, body, category, importance, pinned, expires_at, status, created_by, updated_by, published_at, created_at')
    .eq('status', PUBLISHED)
    .order('pinned', { ascending: false })
    .order('published_at', { ascending: false })
    .range(offset, offset + Math.max(0, limit - 1));
  if (category) query.eq('category', category);
  if (!includeExpired) query.or(`expires_at.is.null,expires_at.gte.${new Date().toISOString()}`);
  const { data, error } = await query;
  if (error) return { items: [], unavailable: true };
  return { items: data || [], unavailable: false };
}

export async function getNotice(supabase, id) {
  const { data } = await supabase
    .from('notices')
    .select('id, title, body, category, importance, pinned, expires_at, status, created_by, updated_by, published_at, created_at, updated_at')
    .eq('id', id)
    .maybeSingle();
  return data || null;
}

/* -------------------------------------------------------------------------- */
/* Events                                                                     */
/* -------------------------------------------------------------------------- */

export async function listEvents(supabase, { limit = 20, offset = 0, upcoming = true, clubId = null } = {}) {
  const query = supabase
    .from('events')
    .select('id, title, description, starts_on, ends_on, start_time, end_time, location, organizer, registration_url, capacity, show_attendees, club_id, status, is_official, created_by, updated_by, published_at, created_at')
    .eq('status', PUBLISHED)
    .order('starts_on', { ascending: true })
    .range(offset, offset + Math.max(0, limit - 1));
  if (upcoming) query.gte('starts_on', new Date().toISOString().slice(0, 10));
  if (clubId) query.eq('club_id', clubId);
  const { data, error } = await query;
  if (error) return { items: [], unavailable: true };
  return { items: data || [], unavailable: false };
}

export async function getEvent(supabase, id) {
  const { data } = await supabase
    .from('events')
    .select('id, title, description, starts_on, ends_on, start_time, end_time, location, organizer, registration_info, registration_url, club_id, capacity, show_attendees, discussion_post_id, status, is_official, created_by, updated_by, published_at, created_at, updated_at')
    .eq('id', id)
    .maybeSingle();
  return data || null;
}

export async function getEventRsvp(supabase, eventId, profileId) {
  if (!profileId) return null;
  const { data } = await supabase
    .from('event_registrations')
    .select('id, status, note, created_at')
    .eq('event_id', eventId)
    .eq('user_id', profileId)
    .maybeSingle();
  return data || null;
}

export async function listEventAttendees(supabase, eventId, { limit = 40 } = {}) {
  const { data: registrations } = await supabase
    .from('event_registrations')
    .select('user_id, status, created_at')
    .eq('event_id', eventId)
    .in('status', ['going', 'interested'])
    .order('created_at', { ascending: true })
    .limit(limit);
  const ids = [...new Set((registrations || []).map((row) => row.user_id))];
  if (!ids.length) return [];
  const { data: people } = await supabase
    .from('public_profiles')
    .select('id, username, display_name, is_staff')
    .in('id', ids);
  const byId = new Map((people || []).map((person) => [person.id, person]));
  return (registrations || []).map((row) => ({
    ...row,
    username: byId.get(row.user_id)?.username || null,
    display_name: byId.get(row.user_id)?.display_name || null,
  }));
}

/* -------------------------------------------------------------------------- */
/* Communities, clubs and study groups                                        */
/* -------------------------------------------------------------------------- */

const COMMUNITY_COLUMNS =
  'id, kind, name, slug, description, subject, branch, year, meeting_info, recruitment_info, ' +
  'contact_info, external_url, visibility, join_policy, status, is_official, created_by, ' +
  'member_count, post_count, created_at';

export async function listCommunities(
  supabase,
  { kind = null, limit = 24, offset = 0, q = null, order = 'members' } = {},
) {
  let query = supabase.from('communities').select(COMMUNITY_COLUMNS).eq('status', PUBLISHED);
  if (kind) query = Array.isArray(kind) ? query.in('kind', kind) : query.eq('kind', kind);
  if (q) query = query.ilike('name', `%${q}%`);
  if (order === 'newest') query = query.order('created_at', { ascending: false });
  else query = query.order('member_count', { ascending: false }).order('name', { ascending: true });
  const { data, error } = await query.range(offset, offset + Math.max(0, limit - 1));
  if (error) return { items: [], unavailable: true };
  return { items: data || [], unavailable: false };
}

export async function getCommunityBySlug(supabase, slug) {
  const { data } = await supabase
    .from('communities')
    .select('id, kind, name, slug, description, subject, branch, year, meeting_info, recruitment_info, ' +
    'contact_info, external_url, visibility, join_policy, status, is_official, created_by, ' +
    'member_count, post_count, created_at, updated_at, approved_at, approved_by')
    .eq('slug', slug)
    .maybeSingle();
  return data || null;
}

export async function getCommunityById(supabase, id) {
  const { data } = await supabase.from('communities').select(COMMUNITY_COLUMNS).eq('id', id).maybeSingle();
  return data || null;
}

export async function getCommunityMembership(supabase, communityId, profileId) {
  if (!profileId) return null;
  const { data } = await supabase
    .from('community_members')
    .select('id, community_id, user_id, role, status, joined_at')
    .eq('community_id', communityId)
    .eq('user_id', profileId)
    .maybeSingle();
  return data || null;
}

export async function listCommunityMembers(supabase, communityId, { limit = 60 } = {}) {
  const { data: members } = await supabase
    .from('community_members')
    .select('user_id, role, status, joined_at')
    .eq('community_id', communityId)
    .eq('status', 'active')
    .order('role', { ascending: true })
    .order('joined_at', { ascending: true })
    .limit(limit);
  const ids = [...new Set((members || []).map((member) => member.user_id))];
  if (!ids.length) return [];
  const { data: people } = await supabase
    .from('public_profiles')
    .select('id, username, display_name, is_staff')
    .in('id', ids);
  const byId = new Map((people || []).map((person) => [person.id, person]));
  return (members || []).map((member) => ({
    ...member,
    username: byId.get(member.user_id)?.username || null,
    display_name: byId.get(member.user_id)?.display_name || null,
    is_staff: byId.get(member.user_id)?.is_staff === true,
  }));
}

export async function listJoinRequests(supabase, communityId, { limit = 30 } = {}) {
  const { data: requests } = await supabase
    .from('community_join_requests')
    .select('id, user_id, message, status, decided_by, decided_at, created_at')
    .eq('community_id', communityId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(limit);
  const ids = [...new Set((requests || []).map((row) => row.user_id))];
  if (!ids.length) return [];
  const { data: people } = await supabase
    .from('public_profiles')
    .select('id, username, display_name, is_staff')
    .in('id', ids);
  const byId = new Map((people || []).map((person) => [person.id, person]));
  return (requests || []).map((row) => ({
    ...row,
    username: byId.get(row.user_id)?.username || null,
    display_name: byId.get(row.user_id)?.display_name || null,
  }));
}

export async function getCommunityChatConversation(supabase, communityId) {
  const { data } = await supabase
    .from('conversations')
    .select('id, kind, title, status, last_message_at')
    .eq('community_id', communityId)
    .eq('kind', 'group')
    .maybeSingle();
  return data || null;
}

/* -------------------------------------------------------------------------- */
/* Lost & found, housing, rides, teams                                        */
/* -------------------------------------------------------------------------- */

export async function listLostFound(supabase, { kind = null, resolved = false, limit = 24, offset = 0 } = {}) {
  let query = supabase
    .from('lost_found')
    .select('id, kind, title, description, location, occurred_on, status, resolved_at, creator_id, created_at')
    .eq('status', PUBLISHED)
    .order('created_at', { ascending: false })
    .range(offset, offset + Math.max(0, limit - 1));
  if (kind) query = query.eq('kind', kind);
  if (!resolved) query = query.is('resolved_at', null);
  const { data, error } = await query;
  if (error) return { items: [], unavailable: true };
  return { items: data || [], unavailable: false };
}

export async function getLostFound(supabase, id) {
  const { data } = await supabase
    .from('lost_found')
    .select('id, kind, title, description, location, occurred_on, status, resolved_at, resolved_by, creator_id, created_at, updated_at')
    .eq('id', id)
    .maybeSingle();
  return data || null;
}

export async function listHousingPosts(supabase, { limit = 24, offset = 0 } = {}) {
  const { data, error } = await supabase
    .from('housing_posts')
    .select('id, title, description, area, budget, room_type, available_from, status, creator_id, created_at')
    .eq('status', PUBLISHED)
    .order('created_at', { ascending: false })
    .range(offset, offset + Math.max(0, limit - 1));
  if (error) return { items: [], unavailable: true };
  return { items: data || [], unavailable: false };
}

export async function getHousingPost(supabase, id) {
  const { data } = await supabase
    .from('housing_posts')
    .select('id, title, description, area, budget, room_type, available_from, status, creator_id, created_at, updated_at')
    .eq('id', id)
    .maybeSingle();
  return data || null;
}

export async function listRidePosts(supabase, { limit = 24, offset = 0 } = {}) {
  const { data, error } = await supabase
    .from('ride_posts')
    .select('id, origin, destination, ride_date, ride_time, description, seats, status, creator_id, created_at')
    .eq('status', PUBLISHED)
    .order('ride_date', { ascending: true })
    .range(offset, offset + Math.max(0, limit - 1));
  if (error) return { items: [], unavailable: true };
  return { items: data || [], unavailable: false };
}

export async function listTeamPosts(supabase, { limit = 24, offset = 0 } = {}) {
  const { data, error } = await supabase
    .from('team_posts')
    .select('id, project_name, description, required_skills, team_size, deadline, status, creator_id, created_at')
    .eq('status', PUBLISHED)
    .order('created_at', { ascending: false })
    .range(offset, offset + Math.max(0, limit - 1));
  if (error) return { items: [], unavailable: true };
  return { items: data || [], unavailable: false };
}

export async function listTeamRequests(supabase, teamPostId) {
  const { data } = await supabase
    .from('team_post_requests')
    .select('id, user_id, message, status, decided_at, created_at')
    .eq('team_post_id', teamPostId)
    .order('created_at', { ascending: true });
  return data || [];
}

/* -------------------------------------------------------------------------- */
/* Resources, opportunities, projects                                         */
/* -------------------------------------------------------------------------- */

export async function listResources(supabase, { limit = 24, offset = 0, branch = null, type = null } = {}) {
  let query = supabase
    .from('official_resources')
    .select('id, title, description, url, branch, year, semester, subject, type, is_official, status, submitted_by, approved_by, published_at, created_at')
    .eq('status', PUBLISHED)
    .order('published_at', { ascending: false })
    .range(offset, offset + Math.max(0, limit - 1));
  if (branch) query = query.eq('branch', branch);
  if (type) query = query.eq('type', type);
  const { data, error } = await query;
  if (error) return { items: [], unavailable: true };
  return { items: data || [], unavailable: false };
}

export async function getResource(supabase, id) {
  const { data } = await supabase
    .from('official_resources')
    .select('id, title, description, url, branch, year, semester, subject, type, is_official, status, submitted_by, created_by, approved_by, published_at, created_at, updated_at')
    .eq('id', id)
    .maybeSingle();
  return data || null;
}

export async function listOpportunities(supabase, { limit = 24, offset = 0, source = null } = {}) {
  let query = supabase
    .from('opportunities')
    .select('id, title, organization, description, eligibility, deadline, url, location, mode, source, status, approved_by, published_at, created_at')
    .eq('status', PUBLISHED)
    .order('published_at', { ascending: false })
    .range(offset, offset + Math.max(0, limit - 1));
  if (source) query = query.eq('source', source);
  const { data, error } = await query;
  if (error) return { items: [], unavailable: true };
  return { items: data || [], unavailable: false };
}

export async function getOpportunity(supabase, id) {
  const { data } = await supabase
    .from('opportunities')
    .select('id, title, organization, description, eligibility, deadline, url, location, mode, source, status, created_by, approved_by, published_at, created_at, updated_at')
    .eq('id', id)
    .maybeSingle();
  return data || null;
}

export async function listProjects(supabase, { limit = 24, offset = 0 } = {}) {
  const { data, error } = await supabase
    .from('projects')
    .select('id, title, description, technologies, repo_url, live_url, team_members, creator_id, status, reaction_count, created_at')
    .eq('status', PUBLISHED)
    .order('created_at', { ascending: false })
    .range(offset, offset + Math.max(0, limit - 1));
  if (error) return { items: [], unavailable: true };
  return { items: data || [], unavailable: false };
}

export async function getProject(supabase, id) {
  const { data } = await supabase
    .from('projects')
    .select('id, title, description, technologies, repo_url, live_url, team_members, creator_id, status, reaction_count, moderated_by, moderated_at, moderation_reason, created_at, updated_at')
    .eq('id', id)
    .maybeSingle();
  return data || null;
}

/* -------------------------------------------------------------------------- */
/* Campus utilities (text-only directory, spec §43–§46)                       */
/* -------------------------------------------------------------------------- */

const UTILITY_TABLES = {
  locations: {
    table: 'campus_locations',
    columns: 'id, name, description, block, category, external_map_url, sort_order',
    order: { column: 'sort_order', ascending: true },
  },
  services: {
    table: 'campus_services',
    columns: 'id, title, description, category, location, hours, contact_info, external_url',
    order: { column: 'title', ascending: true },
  },
  transport: {
    table: 'transport_information',
    columns: 'id, route_name, description, timings, pickup_locations, service_status, contact_info',
    order: { column: 'route_name', ascending: true },
  },
  cafeteria: {
    table: 'cafeteria_information',
    columns: 'id, title, description, menu_text, offers, hours, location, contact_info',
    order: { column: 'title', ascending: true },
  },
  calendar: {
    table: 'academic_calendar',
    columns: 'id, title, description, entry_type, starts_on, ends_on, audience',
    order: { column: 'starts_on', ascending: true },
    dateColumn: 'starts_on',
  },
  links: {
    table: 'official_links',
    columns: 'id, title, description, purpose, audience, url, deadline',
    order: { column: 'title', ascending: true },
  },
  help: {
    table: 'help_contacts',
    columns: 'id, title, category, description, contact_info, location, availability, sort_order',
    order: { column: 'sort_order', ascending: true },
  },
};

export const UTILITY_KEYS = Object.keys(UTILITY_TABLES);

export async function listUtility(supabase, key, { limit = 60, from = null } = {}) {
  const config = UTILITY_TABLES[key];
  if (!config) return { items: [], unavailable: true };
  let query = supabase
    .from(config.table)
    .select(config.columns)
    .eq('status', PUBLISHED)
    .order(config.order.column, { ascending: config.order.ascending })
    .limit(limit);
  if (from && config.dateColumn) query = query.gte(config.dateColumn, from);
  const { data, error } = await query;
  if (error) return { items: [], unavailable: true };
  return { items: data || [], unavailable: false };
}

/** Official content counts used by the campus hub (real numbers only). */
export async function getCampusSummary(supabase) {
  const [notices, events, clubs, communities, resources, opportunities, projects] = await Promise.all([
    supabase.from('notices').select('id', { count: 'exact', head: true }).eq('status', PUBLISHED),
    supabase.from('events').select('id', { count: 'exact', head: true }).eq('status', PUBLISHED).gte('starts_on', new Date().toISOString().slice(0, 10)),
    supabase.from('communities').select('id', { count: 'exact', head: true }).eq('kind', 'club').eq('status', PUBLISHED),
    supabase.from('communities').select('id', { count: 'exact', head: true }).eq('kind', 'community').eq('status', PUBLISHED),
    supabase.from('official_resources').select('id', { count: 'exact', head: true }).eq('status', PUBLISHED),
    supabase.from('opportunities').select('id', { count: 'exact', head: true }).eq('status', PUBLISHED),
    supabase.from('projects').select('id', { count: 'exact', head: true }).eq('status', PUBLISHED),
  ]);
  return {
    notices: notices.count ?? 0,
    events: events.count ?? 0,
    clubs: clubs.count ?? 0,
    communities: communities.count ?? 0,
    resources: resources.count ?? 0,
    opportunities: opportunities.count ?? 0,
    projects: projects.count ?? 0,
  };
}

export const CAMPUS_PAGE_SIZE = PAGE_SIZE.default;
