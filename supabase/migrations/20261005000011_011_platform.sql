-- Campus+ migration 011 — platform
-- Supabase CLI filename: 20261005000011_011_platform.sql
-- This file is part of the single authoritative migration history in supabase/migrations/.
-- =============================================================================
-- Campus+ 011 — settings, feature flags, rate limiting, search, feed, trending
-- =============================================================================
-- Everything here is deterministic and configuration-driven (spec §18, §76,
-- §77). No AI, no ranking service, no external search engine: PostgreSQL does
-- full-text search, tsvector + GIN indexes do the work, and the trending
-- formula is readable in one line of SQL.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- platform_settings — Admin/Super Admin controlled
-- ----------------------------------------------------------------------------

create table public.platform_settings (
  key         text primary key check (length(btrim(key)) between 1 and 80),
  value       jsonb not null,
  description text,
  category    text not null default 'general',
  is_public   boolean not null default false,
  updated_by  uuid references public.profiles (id) on delete set null,
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

comment on table public.platform_settings is
  'Runtime configuration. Changing a value is a Super Admin/Admin action and is audited.';

create trigger platform_settings_touch before update on public.platform_settings
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- feature_flags — module on/off without deleting code (spec §77)
-- ----------------------------------------------------------------------------

create table public.feature_flags (
  key         text primary key check (length(btrim(key)) between 1 and 80),
  label       text not null,
  description text,
  group_name  text not null default 'general',
  enabled     boolean not null default true,
  updated_by  uuid references public.profiles (id) on delete set null,
  updated_at  timestamptz not null default now()
);

create trigger feature_flags_touch before update on public.feature_flags
  for each row execute function public.touch_updated_at();

create or replace function public.feature_enabled(p_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_enabled boolean;
begin
  select enabled into v_enabled from public.feature_flags where key = p_key;
  -- Unknown flags are treated as enabled so a missing row can never hide a
  -- module from the whole campus.
  return coalesce(v_enabled, true);
end;
$$;

create or replace function public.setting(p_key text, p_default jsonb default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_value jsonb;
begin
  select value into v_value from public.platform_settings where key = p_key;
  return coalesce(v_value, p_default);
end;
$$;

create or replace function public.setting_int(p_key text, p_default integer)
returns integer
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_value jsonb := public.setting(p_key, null);
begin
  if v_value is null or jsonb_typeof(v_value) <> 'number' then
    return p_default;
  end if;
  return (v_value)::text::integer;
end;
$$;

-- ----------------------------------------------------------------------------
-- rate_limits (spec §61). No Redis, no external service.
-- ----------------------------------------------------------------------------

create table public.rate_limits (
  bucket       text not null,
  key          text not null,
  window_start timestamptz not null default now(),
  counter      integer not null default 0,
  primary key (bucket, key)
);

comment on table public.rate_limits is
  'Rolling-window counters. RLS is enabled with no policies: only consume_rate_limit() (definer) reads or writes this table.';

create or replace function public.consume_rate_limit(
  p_bucket text,
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
  v_start timestamptz;
  v_reset_at timestamptz;
begin
  if p_bucket is null or p_key is null or p_limit is null or p_window_seconds is null then
    raise exception 'consume_rate_limit requires bucket, key, limit and window.' using errcode = '22023';
  end if;

  -- A student may only consume their own bucket. Server-side jobs (secret key)
  -- may use any key, which is how pre-authentication limits are applied.
  if not public.is_trusted_writer()
     and p_key <> coalesce(public.current_profile_id()::text, '') then
    raise exception 'Rate limit key mismatch.' using errcode = '42501';
  end if;

  insert into public.rate_limits (bucket, key, window_start, counter)
  values (p_bucket, p_key, now(), 1)
  on conflict (bucket, key) do update
    set counter = case
          when public.rate_limits.window_start < now() - make_interval(secs => p_window_seconds) then 1
          else public.rate_limits.counter + 1
        end,
        window_start = case
          when public.rate_limits.window_start < now() - make_interval(secs => p_window_seconds) then now()
          else public.rate_limits.window_start
        end
  returning counter, window_start into v_count, v_start;

  v_reset_at := v_start + make_interval(secs => p_window_seconds);

  return jsonb_build_object(
    'allowed', v_count <= p_limit,
    'remaining', greatest(p_limit - v_count, 0),
    'retry_after_seconds', greatest(ceil(extract(epoch from (v_reset_at - now())))::integer, 0)
  );
end;
$$;

create or replace function public.reset_rate_limit(p_bucket text, p_key text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not (public.has_permission('manage_platform_settings') or public.is_trusted_writer()) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;
  delete from public.rate_limits where bucket = p_bucket and key = p_key;
end;
$$;

-- ----------------------------------------------------------------------------
-- Global search (spec §54, §86)
-- ----------------------------------------------------------------------------
-- SECURITY INVOKER on purpose: every table read inside is filtered by its own
-- RLS policy, which is what makes search respect blocks, visibility, account
-- status, community privacy and conversation privacy without a second
-- authorization implementation.

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
    '%' || replace(replace(q, '%', '\%'), '_', '\_') || '%' as like_q,
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
) results
order by rank desc, title asc
limit (select lim from params)
offset (select off from params);
$$;

comment on function public.global_search(text, text, integer, integer) is
  'Conventional PostgreSQL search across public entities. SECURITY INVOKER so RLS enforces blocks, visibility and privacy.';

-- ----------------------------------------------------------------------------
-- Trending — deterministic, readable, no machine learning (spec §18)
-- ----------------------------------------------------------------------------
--   score = (reactions*2 + comments*3 + participants) / (age_hours + 2)^1.5
-- `participants` counts distinct commenters, so a thread with many voices
-- outranks a thread with many self-replies.

create or replace function public.trending_posts(
  p_limit integer default 20,
  p_hours integer default 72
)
returns table (
  id uuid,
  author_id uuid,
  username text,
  display_name text,
  title text,
  body text,
  kind public.post_kind,
  gif jsonb,
  reaction_count integer,
  comment_count integer,
  participant_count integer,
  created_at timestamptz,
  score real
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    p.id,
    p.author_id,
    pr.username,
    pr.display_name,
    p.title,
    p.body,
    p.kind,
    p.gif,
    p.reaction_count,
    p.comment_count,
    coalesce(c.participants, 0) as participant_count,
    p.created_at,
    (
      (p.reaction_count * 2 + p.comment_count * 3 + coalesce(c.participants, 0))::numeric
      / power(
          greatest(extract(epoch from (now() - p.created_at)) / 3600.0, 0) + 2,
          1.5
        )
    )::real as score
  from public.posts p
  join public.profiles pr on pr.id = p.author_id
  left join (
    select cm.post_id, count(distinct cm.author_id) as participants
    from public.comments cm
    where cm.status = 'published' and cm.deleted_at is null
    group by cm.post_id
  ) c on c.post_id = p.id
  where p.status = 'published'
    and p.deleted_at is null
    and p.created_at > now() - make_interval(hours => greatest(p_hours, 1))
  order by score desc, p.created_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

comment on function public.trending_posts(integer, integer) is
  'Deterministic trending score documented in lib/constants.js#TRENDING_FORMULA.';

-- ----------------------------------------------------------------------------
-- Campus feed — one query, transparent ordering (spec §17)
-- ----------------------------------------------------------------------------

create or replace function public.campus_feed(
  p_limit integer default 20,
  p_offset integer default 0,
  p_sort text default 'newest'
)
returns table (
  item_type text,
  id uuid,
  title text,
  body text,
  gif jsonb,
  author_username text,
  author_display_name text,
  is_official boolean,
  community_slug text,
  meta jsonb,
  created_at timestamptz,
  sort_at timestamptz
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with items as (
    -- student posts and discussions
    select
      case when p.kind = 'discussion' then 'discussion' else 'post' end as item_type,
      p.id,
      p.title,
      p.body,
      p.gif,
      pr.username as author_username,
      pr.display_name as author_display_name,
      p.is_official,
      c.slug as community_slug,
      jsonb_build_object(
        'kind', p.kind,
        'reaction_count', p.reaction_count,
        'comment_count', p.comment_count,
        'pinned', p.pinned
      ) as meta,
      p.created_at,
      p.created_at as sort_at
    from public.posts p
    join public.profiles pr on pr.id = p.author_id
    left join public.communities c on c.id = p.community_id
    where p.community_id is null
      and p.status = 'published'
      and p.deleted_at is null
      and public.feature_enabled('feed')

    union all

    -- official notices
    select
      'notice',
      n.id,
      n.title,
      n.body,
      null,
      null,
      null,
      true,
      null,
      jsonb_build_object('category', n.category, 'importance', n.importance, 'pinned', n.pinned),
      coalesce(n.published_at, n.created_at),
      case when n.pinned then now() + interval '1 day' else coalesce(n.published_at, n.created_at) end
    from public.notices n
    where n.status = 'published'
      and (n.expires_at is null or n.expires_at > now())
      and public.feature_enabled('noticeboard')

    union all

    -- upcoming events
    select
      'event',
      e.id,
      e.title,
      e.description,
      null,
      null,
      null,
      true,
      null,
      jsonb_build_object('starts_on', e.starts_on, 'start_time', e.start_time, 'location', e.location, 'organizer', e.organizer),
      e.created_at,
      case when e.starts_on <= current_date then now() else (e.starts_on::timestamptz) end
    from public.events e
    where e.status = 'published'
      and (e.ends_on is null or e.ends_on >= current_date)
      and public.feature_enabled('events')

    union all

    -- published opportunities
    select
      'opportunity',
      o.id,
      o.title,
      o.description,
      null,
      null,
      null,
      o.source = 'official',
      null,
      jsonb_build_object('organization', o.organization, 'deadline', o.deadline, 'source', o.source),
      o.created_at,
      o.created_at
    from public.opportunities o
    where o.status = 'published'
      and public.feature_enabled('opportunities')

    union all

    -- active marketplace highlights
    select
      'listing',
      l.id,
      l.title,
      l.description,
      null,
      pr.username,
      pr.display_name,
      false,
      null,
      jsonb_build_object('price', l.price, 'is_free', l.is_free, 'condition', l.condition),
      l.created_at,
      l.created_at
    from public.marketplace_listings l
    join public.profiles pr on pr.id = l.seller_id
    where l.status = 'active'
      and public.feature_enabled('marketplace')
      and public.setting('feed_marketplace_highlights', 'true'::jsonb) = 'true'::jsonb
  )
  select *
  from items
  order by
    case when p_sort = 'trending' then null else sort_at end desc nulls last,
    -- deterministic secondary signal for trending: engagement density
    case when p_sort = 'trending'
      then coalesce((meta->>'reaction_count')::int, 0) * 2 + coalesce((meta->>'comment_count')::int, 0) * 3
      else 0 end desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

comment on function public.campus_feed(integer, integer, text) is
  'Unified home feed. Ordering is explicit: newest by timestamp, or trending by the documented engagement formula.';

-- ----------------------------------------------------------------------------
-- Achievements — deterministic evaluation (spec §51)
-- ----------------------------------------------------------------------------

create or replace function public.evaluate_achievements(p_user uuid default null)
returns text[]
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := coalesce(p_user, public.current_profile_id());
  v_awarded text[] := '{}';
  v_posts integer;
  v_communities integer;
  v_comment_reactions integer;
  v_rsvps integer;
  v_sold integer;
  v_projects integer;
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not (public.is_trusted_writer() or p_user is null or p_user = public.current_profile_id() or public.is_staff()) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  select count(*) into v_posts from public.posts where author_id = v_user;
  select count(*) into v_communities from public.communities where created_by = v_user;
  select coalesce(sum(c.reaction_count), 0) into v_comment_reactions from public.comments c where c.author_id = v_user;
  select count(*) into v_rsvps from public.event_registrations where user_id = v_user;
  select count(*) into v_sold from public.marketplace_listings where seller_id = v_user and status = 'sold';
  select count(*) into v_projects from public.projects where creator_id = v_user;

  with rules as (
    select 'early_contributor'::text as key, v_posts >= 1 as met
    union all select 'community_builder', v_communities >= 1
    union all select 'helpful_member', v_comment_reactions >= 10
    union all select 'event_participant', v_rsvps >= 1
    union all select 'marketplace_seller', v_sold >= 1
    union all select 'project_showcase_contributor', v_projects >= 1
  ),
  awarded as (
    insert into public.user_achievements (user_id, achievement_key)
    select v_user, r.key
    from rules r
    join public.achievements a on a.key = r.key and a.is_active
    where r.met
    on conflict (user_id, achievement_key) do nothing
    returning achievement_key
  )
  select coalesce(array_agg(achievement_key), '{}') into v_awarded from awarded;

  return v_awarded;
end;
$$;

comment on function public.evaluate_achievements(uuid) is
  'Grants achievements whose documented deterministic rule is satisfied. Idempotent.';

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------

alter table public.platform_settings enable row level security;
alter table public.feature_flags enable row level security;
alter table public.rate_limits enable row level security;

-- settings: everyone needs a few public values (platform name); the rest is for
-- administrators.
create policy platform_settings_select_public on public.platform_settings
  for select to authenticated using (is_public or public.has_permission('manage_platform_settings'));
create policy platform_settings_manage on public.platform_settings
  for all to authenticated
  using (public.has_permission('manage_platform_settings'))
  with check (public.has_permission('manage_platform_settings'));

create policy feature_flags_select_all on public.feature_flags
  for select to authenticated using (true);
create policy feature_flags_manage on public.feature_flags
  for all to authenticated
  using (public.has_permission('manage_feature_flags'))
  with check (public.has_permission('manage_feature_flags'));

-- rate_limits: intentionally no policies. Only the definer function touches it.
