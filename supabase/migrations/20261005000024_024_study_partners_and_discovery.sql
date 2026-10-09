-- Campus+ migration 024 — study partners and discovery
-- Supabase CLI filename: 20261005000024_024_study_partners_and_discovery.sql
-- This file is part of the single authoritative migration history in supabase/migrations/.
-- =============================================================================
-- Campus+ 024 — study partner finder, event submissions, discovery categories
-- =============================================================================
-- Additive only: one new table, two nullable category columns, two new
-- permissions, one feature flag, two RLS policies for student event
-- submissions, and an extended global_search(). No existing object is
-- redefined except global_search(), which keeps its signature.
--
--   Study Partner Finder — explicit opt-in requests. Coarse availability
--     categories only; no calendars, no locations, no presence. Closed and
--     expired requests never appear as active.
--   Events — student submissions land as non-official drafts for staff review;
--     a submission can never publish itself or appear official.
--   Opportunities — nullable discovery category; no workflow change.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- Permissions (mirror lib/constants.js PERMISSIONS + DEFAULT_STUDENT_PERMISSIONS)
-- ----------------------------------------------------------------------------

insert into public.permissions (key, label, description, group_name) values
  ('create_study_posts', 'Create study partner posts', 'Publish opt-in study partner requests.', 'Campus'),
  ('submit_events', 'Submit events', 'Submit community events for staff review (never published as official).', 'Campus')
on conflict (key) do update
  set label = excluded.label, description = excluded.description, group_name = excluded.group_name;

-- Every baseline role holds the student baseline, so all four gain the two keys.
insert into public.role_permissions (role_key, permission_key)
select r.key, p.key
from (values ('student'), ('moderator'), ('admin'), ('super_admin')) as r(key)
cross join (values ('create_study_posts'), ('submit_events')) as p(key)
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- Feature flag (mirrors lib/constants.js FEATURE_FLAGS)
-- ----------------------------------------------------------------------------

insert into public.feature_flags (key, label, description, group_name, enabled) values
  ('study_partners', 'Study partner finder', 'Opt-in subject/exam study requests.', 'campus', true)
on conflict (key) do nothing;

-- ----------------------------------------------------------------------------
-- study_partner_posts — opt-in study requests (separate from team finder)
-- ----------------------------------------------------------------------------

create table public.study_partner_posts (
  id               uuid primary key default gen_random_uuid(),
  title            text not null check (length(btrim(title)) between 3 and 140),
  description      text not null check (length(btrim(description)) between 10 and 1500),
  subject          text not null check (length(btrim(subject)) between 2 and 120),
  purpose          text not null check (purpose in ('subject_study', 'exam_prep', 'collaboration')),
  branch           text check (branch is null or length(branch) <= 80),
  year             text check (year is null or length(year) <= 40),
  academic_context text check (academic_context is null or length(academic_context) <= 200),
  mode             text not null default 'either' check (mode in ('oncampus', 'online', 'either')),
  availability     text[] not null default '{}'
    check (availability <@ array['weekday_morning', 'weekday_afternoon', 'weekday_evening', 'weekend', 'flexible']),
  expires_on       date,
  closed_at        timestamptz,
  status           public.content_status not null default 'published',
  creator_id       uuid not null references public.profiles (id) on delete cascade,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  search_vector    tsvector generated always as (
    to_tsvector('english'::regconfig, coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(subject, ''))
  ) stored
);

create index study_partner_posts_status_idx on public.study_partner_posts (status, created_at desc);
create index study_partner_posts_active_idx on public.study_partner_posts (created_at desc)
  where status = 'published' and closed_at is null;
create index study_partner_posts_creator_idx on public.study_partner_posts (creator_id, created_at desc);
create index study_partner_posts_subject_idx on public.study_partner_posts (subject);
create index study_partner_posts_filters_idx on public.study_partner_posts (purpose, mode);
create index study_partner_posts_search_idx on public.study_partner_posts using gin (search_vector);

create trigger study_partner_posts_touch before update on public.study_partner_posts
  for each row execute function public.touch_updated_at();

alter table public.study_partner_posts enable row level security;

-- Active = published, not closed by the creator, not expired, creator in good
-- standing and not blocked either way. Participation is opt-in: only rows a
-- student explicitly published are ever visible to others.
create policy study_posts_select_visible on public.study_partner_posts
  for select to authenticated
  using (
    status = 'published'
    and closed_at is null
    and (expires_on is null or expires_on >= CURRENT_DATE)
    and public.is_active_profile(creator_id)
    and not public.is_blocked_with_current(creator_id)
  );
create policy study_posts_select_own on public.study_partner_posts
  for select to authenticated using (creator_id = public.current_profile_id());
create policy study_posts_select_staff on public.study_partner_posts
  for select to authenticated using (public.has_permission('moderate_all'));
create policy study_posts_insert_own on public.study_partner_posts
  for insert to authenticated
  with check (
    creator_id = public.current_profile_id()
    and public.is_active_user()
    and public.has_permission('create_study_posts')
    and status = 'published'
    and closed_at is null
  );
create policy study_posts_update_own on public.study_partner_posts
  for update to authenticated
  using (creator_id = public.current_profile_id())
  with check (creator_id = public.current_profile_id());
create policy study_posts_update_staff on public.study_partner_posts
  for update to authenticated
  using (public.has_permission('moderate_all'))
  with check (public.has_permission('moderate_all'));
create policy study_posts_delete_own on public.study_partner_posts
  for delete to authenticated using (creator_id = public.current_profile_id());

revoke all on public.study_partner_posts from anon;

-- Column privileges mirror migration 015: narrow UPDATE to editable columns.
revoke update on public.study_partner_posts from authenticated, anon;
grant update (title, description, subject, purpose, branch, year, academic_context,
              mode, availability, expires_on, closed_at, status)
  on public.study_partner_posts to authenticated;

-- ----------------------------------------------------------------------------
-- Discovery categories (nullable, additive — existing rows read as uncategorised)
-- ----------------------------------------------------------------------------

alter table public.events
  add column if not exists category text
    check (category is null or category in
      ('academic', 'cultural', 'sports', 'technical', 'workshop', 'club', 'placement', 'other'));

create index if not exists events_category_idx on public.events (category)
  where status = 'published';

-- Staff manage events through direct updates (migration 015 narrowed UPDATE to
-- an explicit column list), so the new column must be granted to be editable.
grant update (category) on public.events to authenticated;

alter table public.opportunities
  add column if not exists category text
    check (category is null or category in
      ('internship', 'program', 'hackathon', 'competition', 'scholarship',
       'collaboration', 'club_recruitment', 'gig', 'other'));

create index if not exists opportunities_category_idx on public.opportunities (category);

grant update (category) on public.opportunities to authenticated;

-- ----------------------------------------------------------------------------
-- Student event submissions: non-official drafts, staff review, owner withdrawal
-- ----------------------------------------------------------------------------

-- A student submission is always a draft and never official. Publishing stays
-- staff-only through the existing events_update_staff policy.
create policy events_insert_community on public.events
  for insert to authenticated
  with check (
    public.has_permission('submit_events')
    and public.is_active_user()
    and is_official = false
    and status = 'draft'
    and created_by = public.current_profile_id()
  );

-- Submitters can track their own pending drafts; everyone else sees published
-- events (events_select_published) and staff see everything (events_select_staff).
create policy events_select_own on public.events
  for select to authenticated using (created_by = public.current_profile_id());

-- A submitter may withdraw their own unreviewed draft. Anything published is
-- staff-managed history and cannot be deleted by its submitter.
create policy events_delete_own_draft on public.events
  for delete to authenticated
  using (created_by = public.current_profile_id() and status = 'draft' and is_official = false);

-- ----------------------------------------------------------------------------
-- Global search: study & teams scope (signature unchanged)
-- ----------------------------------------------------------------------------

create or replace function public.global_search(
  p_query text,
  p_scope text default 'all',
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  scope text,
  id uuid,
  title text,
  subtitle text,
  snippet text,
  url text,
  meta jsonb,
  rank real
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
with params as (
  select
    nullif(btrim(coalesce(p_query, '')), '') as q,
    least(greatest(coalesce(p_limit, 20), 1), 50) as lim,
    greatest(coalesce(p_offset, 0), 0) as off,
    coalesce(p_scope, 'all') as scope
),
needle as (
  select
    q,
    lim,
    off,
    scope,
    '%' || replace(replace(q, '%', '\\%'), '_', '\\_') || '%' as like_q,
    websearch_to_tsquery('english', q) as tsq
  from params
  where q is not null and length(q) >= 2
)
select * from (
(
  -- people ------------------------------------------------------------------
  select
    'people'::text as scope,
    p.id,
    p.username as title,
    coalesce(nullif(p.display_name, ''), '@' || p.username) as subtitle,
    coalesce(p.bio, '') as snippet,
    '/user/' || p.username as url,
    jsonb_build_object(
      'branch', case when p.show_branch_year then p.branch else null end,
      'year', case when p.show_branch_year then p.year else null end,
      'reputation_score', p.reputation_score
    ) as meta,
    greatest(
      similarity(p.username, n.q),
      similarity(coalesce(p.display_name, ''), n.q) * 0.8
    )::real as rank
  from public.profiles p, needle n
  where n.scope in ('all', 'people')
    and public.is_active_profile(p.id)
    and not public.is_blocked_with_current(p.id)
    and (p.username ilike n.like_q or p.display_name ilike n.like_q)
  order by rank desc
  limit (select lim from params)
  )
  union all
(
  -- posts & discussions -----------------------------------------------------
  select
    case when po.kind = 'discussion' then 'discussions' else 'posts' end,
    po.id,
    coalesce(po.title, nullif(left(po.body, 80), '')),
    '@' || pr.username,
    left(po.body, 200),
    '/post/' || po.id::text,
    jsonb_build_object(
      'kind', po.kind,
      'is_official', po.is_official,
      'created_at', po.created_at,
      'reaction_count', po.reaction_count,
      'comment_count', po.comment_count
    ),
    ts_rank(po.search_vector, n.tsq)
  from public.posts po
  join public.profiles pr on pr.id = po.author_id
  cross join needle n
  where n.scope in ('all', 'posts', 'discussions')
    and (n.scope <> 'discussions' or po.kind = 'discussion')
    and po.status = 'published'
    and po.deleted_at is null
    and (po.search_vector @@ n.tsq or po.body ilike n.like_q or coalesce(po.title, '') ilike n.like_q)
  )
  union all
(
  -- communities / study groups / clubs --------------------------------------
  select
    case c.kind
      when 'study_group' then 'communities'
      when 'club' then 'clubs'
      else 'communities'
    end,
    c.id,
    c.name,
    case c.kind when 'club' then 'Club' when 'study_group' then 'Study group' else 'Community' end,
    left(c.description, 200),
    case c.kind
      when 'club' then '/campus/clubs/' || c.id::text
      else '/communities/' || c.slug
    end,
    jsonb_build_object('kind', c.kind, 'member_count', c.member_count, 'visibility', c.visibility),
    ts_rank(to_tsvector('english', c.name || ' ' || c.description), n.tsq)
  from public.communities c
  cross join needle n
  where n.scope in ('all', 'communities', 'clubs')
    and (n.scope <> 'clubs' or c.kind = 'club')
    and c.status = 'published'
    and public.can_view_community(c.id)
    and (c.name ilike n.like_q or c.description ilike n.like_q)
  )
  union all
(
  -- marketplace listings ----------------------------------------------------
  select
    'marketplace',
    l.id,
    l.title,
    case when l.is_free then 'Free' else '₹' || coalesce(l.price, 0)::text end,
    left(l.description, 200),
    '/market/listing/' || l.id::text,
    jsonb_build_object('price', l.price, 'is_free', l.is_free, 'condition', l.condition, 'status', l.status),
    ts_rank(l.search_vector, n.tsq)
  from public.marketplace_listings l
  cross join needle n
  where n.scope in ('all', 'marketplace')
    and l.status in ('active', 'reserved')
    and public.feature_enabled('marketplace')
    and (l.search_vector @@ n.tsq or l.title ilike n.like_q)
  )
  union all
(
  -- gigs --------------------------------------------------------------------
  select
    'marketplace',
    g.id,
    g.title,
    'Gig · ' || g.category,
    left(g.description, 200),
    '/market/gigs/' || g.id::text,
    jsonb_build_object('kind', 'gig', 'compensation', g.compensation),
    ts_rank(g.search_vector, n.tsq)
  from public.gigs g
  cross join needle n
  where n.scope in ('all', 'marketplace')
    and g.status = 'published'
    and public.feature_enabled('gigs')
    and (g.search_vector @@ n.tsq or g.title ilike n.like_q)
  )
  union all
(
  -- events ------------------------------------------------------------------
  select
    'events',
    e.id,
    e.title,
    'Event · ' || to_char(e.starts_on, 'DD Mon YYYY'),
    left(e.description, 200),
    '/campus/events/' || e.id::text,
    jsonb_build_object('starts_on', e.starts_on, 'location', e.location),
    ts_rank(e.search_vector, n.tsq)
  from public.events e
  cross join needle n
  where n.scope in ('all', 'events')
    and e.status = 'published'
    and public.feature_enabled('events')
    and (e.search_vector @@ n.tsq or e.title ilike n.like_q)
  )
  union all
(
  -- resources ---------------------------------------------------------------
  select
    'resources',
    r.id,
    r.title,
    coalesce(r.subject, '') || case when r.is_official then ' · Official' else ' · Community' end,
    left(r.description, 200),
    '/explore/resources/' || r.id::text,
    jsonb_build_object('type', r.type, 'is_official', r.is_official),
    ts_rank(r.search_vector, n.tsq)
  from public.official_resources r
  cross join needle n
  where n.scope in ('all', 'resources')
    and r.status = 'published'
    and (r.search_vector @@ n.tsq or r.title ilike n.like_q)
  )
  union all
(
  -- opportunities -----------------------------------------------------------
  select
    'opportunities',
    o.id,
    o.title,
    o.organization || case when o.source = 'official' then ' · Official' else ' · Community' end,
    left(o.description, 200),
    '/explore/opportunities/' || o.id::text,
    jsonb_build_object('deadline', o.deadline, 'mode', o.mode, 'source', o.source),
    ts_rank(o.search_vector, n.tsq)
  from public.opportunities o
  cross join needle n
  where n.scope in ('all', 'opportunities')
    and o.status = 'published'
    and (o.search_vector @@ n.tsq or o.title ilike n.like_q)
  )
  union all
(
  -- projects ----------------------------------------------------------------
  select
    'projects',
    pr.id,
    pr.title,
    pr.technologies,
    left(pr.description, 200),
    '/explore/projects/' || pr.id::text,
    jsonb_build_object('reaction_count', pr.reaction_count),
    ts_rank(pr.search_vector, n.tsq)
  from public.projects pr
  cross join needle n
  where n.scope in ('all', 'projects')
    and pr.status = 'published'
    and (pr.search_vector @@ n.tsq or pr.title ilike n.like_q)
  )
  union all
(
  -- study partner posts (opt-in requests only; closed/expired never match) --
  select
    'study',
    s.id,
    s.title,
    s.subject || ' · ' || case s.purpose
      when 'subject_study' then 'Subject study'
      when 'exam_prep' then 'Exam prep'
      else 'Collaboration'
    end,
    left(s.description, 200),
    '/campus/study/' || s.id::text,
    jsonb_build_object('purpose', s.purpose, 'mode', s.mode, 'subject', s.subject, 'kind', 'study_post'),
    ts_rank(s.search_vector, n.tsq)
  from public.study_partner_posts s
  cross join needle n
  where n.scope in ('all', 'study')
    and s.status = 'published'
    and s.closed_at is null
    and (s.expires_on is null or s.expires_on >= CURRENT_DATE)
    and public.feature_enabled('study_partners')
    and (s.search_vector @@ n.tsq or s.title ilike n.like_q or s.subject ilike n.like_q)
  )
  union all
(
  -- team finder posts ---------------------------------------------------------
  select
    'study',
    t.id,
    t.project_name,
    'Team finder · ' || left(t.required_skills, 60),
    left(t.description, 200),
    '/campus/teams',
    jsonb_build_object('kind', 'team_post'),
    ts_rank(t.search_vector, n.tsq)
  from public.team_posts t
  cross join needle n
  where n.scope in ('all', 'study')
    and t.status = 'published'
    and public.feature_enabled('team_finder')
    and (t.search_vector @@ n.tsq or t.project_name ilike n.like_q)
  )
) results
order by rank desc, title asc
limit (select lim from params)
offset (select off from params);
$$;

comment on function public.global_search(text, text, integer, integer) is
  'Conventional PostgreSQL search across public entities. SECURITY INVOKER so RLS enforces blocks, visibility and privacy.';
