-- Campus+ migration 010 — random
-- Supabase CLI filename: 20261005000010_010_random.sql
-- This file is part of the single authoritative migration history in supabase/migrations/.
-- =============================================================================
-- Campus+ 010 — Random: anonymous, moderated, human-to-human chat
-- =============================================================================
-- Design guarantees (spec §24, §25, §78, §122):
--
--  1. `random_sessions` (which maps two real identities) is NOT readable by the
--     participants. Only staff holding the `view_random_sessions` permission may
--     read it, and every such read is written to audit_logs by the application.
--  2. Participants interact through definer views/RPCs that expose a *side*
--     label ('you' / 'stranger') instead of profile ids.
--  3. Realtime uses private broadcast channels per session; authorization lives
--     in the `realtime.messages` policies created in migration 013.
--  4. Reports always carry the session id, so moderation remains possible even
--     though the two participants cannot identify each other.
-- =============================================================================

create table public.random_queue (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null unique references public.profiles (id) on delete cascade,
  joined_at  timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes',
  status     public.random_queue_status not null default 'waiting',
  session_id uuid,  -- FK added after random_sessions is created below
  constraint random_queue_expiry check (expires_at > joined_at)
);

create index random_queue_status_idx on public.random_queue (status, joined_at);
create index random_queue_session_idx on public.random_queue (session_id) where session_id is not null;

comment on table public.random_queue is
  'Waiting room for Random. `expires_at` keeps stale entries from matching after the student has closed the tab.';

create table public.random_sessions (
  id            uuid primary key default gen_random_uuid(),
  participant_a uuid not null references public.profiles (id) on delete cascade,
  participant_b uuid not null references public.profiles (id) on delete cascade,
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  ended_by      uuid references public.profiles (id) on delete set null,
  end_reason    text check (end_reason is null or end_reason in ('left', 'next', 'timeout', 'moderation', 'blocked', 'reported')),
  status        public.random_session_status not null default 'active',
  message_count integer not null default 0 check (message_count >= 0),
  expires_at    timestamptz not null default now() + interval '60 minutes',
  reviewed_by   uuid references public.profiles (id) on delete set null,
  reviewed_at   timestamptz,
  constraint random_sessions_distinct check (participant_a <> participant_b),
  constraint random_sessions_order check (participant_a < participant_b)
);

create index random_sessions_status_idx on public.random_sessions (status, started_at desc);
create index random_sessions_participant_a_idx on public.random_sessions (participant_a, started_at desc);
create index random_sessions_participant_b_idx on public.random_sessions (participant_b, started_at desc);

alter table public.random_queue
  add constraint random_queue_session_fk
  foreign key (session_id) references public.random_sessions (id) on delete set null;

comment on table public.random_sessions is
  'Internal identity mapping for anonymous sessions. Never exposed to participants; staff access requires view_random_sessions and is audited.';

create table public.random_session_participants (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references public.random_sessions (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  side         text not null check (side in ('a', 'b')),
  joined_at    timestamptz not null default now(),
  left_at      timestamptz,
  message_count integer not null default 0 check (message_count >= 0),
  unique (session_id, user_id),
  unique (session_id, side)
);

create index random_session_participants_user_idx on public.random_session_participants (user_id, joined_at desc);

create table public.random_messages (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references public.random_sessions (id) on delete cascade,
  sender_user_id  uuid not null references public.profiles (id) on delete cascade,
  content         text not null default '' check (length(content) <= 2000),
  gif             jsonb,
  status          public.content_status not null default 'published',
  created_at      timestamptz not null default now(),
  constraint random_messages_content_present check (length(btrim(content)) > 0 or gif is not null),
  constraint random_messages_gif_provider check (gif is null or (gif->>'provider') = 'giphy'),
  constraint random_messages_gif_url_host check (gif is null or (gif->>'url') ~ '^https://(media[0-9]?\.)?giphy\.com/')
);

create index random_messages_session_idx on public.random_messages (session_id, created_at);
create index random_messages_sender_idx on public.random_messages (sender_user_id);

create table public.random_reports (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid not null references public.random_sessions (id) on delete cascade,
  reporter_user_id uuid not null references public.profiles (id) on delete cascade,
  target_user_id   uuid not null references public.profiles (id) on delete cascade,
  reason           text not null check (reason in (
                     'spam', 'harassment', 'hate', 'nudity', 'violence', 'scam',
                     'misinformation', 'impersonation', 'academic_dishonesty',
                     'privacy', 'other')),
  details          text check (details is null or length(details) <= 1000),
  status           public.report_status not null default 'pending',
  reviewed_by      uuid references public.profiles (id) on delete set null,
  reviewed_at      timestamptz,
  resolution       text check (resolution is null or length(resolution) <= 1000),
  created_at       timestamptz not null default now(),
  constraint random_reports_distinct check (reporter_user_id <> target_user_id)
);

create index random_reports_status_idx on public.random_reports (status, created_at desc);
create index random_reports_session_idx on public.random_reports (session_id);
create index random_reports_target_idx on public.random_reports (target_user_id);
create index random_reports_reporter_idx on public.random_reports (reporter_user_id, created_at desc);

-- reports.random_session_id was created in 006 before this table existed.
alter table public.reports
  add constraint reports_random_session_fk
  foreign key (random_session_id) references public.random_sessions (id) on delete set null;

-- ----------------------------------------------------------------------------
-- Helpers
-- ----------------------------------------------------------------------------

create or replace function public.can_access_random_session(p_session uuid, p_user uuid default null)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.random_session_participants p
    where p.session_id = p_session
      and p.user_id = coalesce(p_user, public.current_profile_id())
      and p.left_at is null
  );
$$;

/** The other participant — used server-side only, never returned to a client. */
create or replace function public.random_other_participant(p_session uuid, p_user uuid default null)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when s.participant_a = coalesce(p_user, public.current_profile_id()) then s.participant_b
    else s.participant_a
  end
  from public.random_sessions s
  where s.id = p_session
    and coalesce(p_user, public.current_profile_id()) in (s.participant_a, s.participant_b);
$$;

/** Ends any session the caller is part of (used by leave/next/block flows). */
create or replace function public.end_random_session(p_session uuid, p_reason text default 'left')
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := public.current_profile_id();
begin
  if v_me is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not public.can_access_random_session(p_session, v_me) then
    raise exception 'You are not part of this session.' using errcode = '42501';
  end if;

  -- Only a session that is still active counts as a deliberate "Next"/"End"
  -- action, so repeat calls stay idempotent (the updates below use `coalesce`)
  -- and callers do not burn rate-limit budget twice. Closing a session that a
  -- moderator already closed still marks the participant as left.
  if exists (select 1 from public.random_sessions where id = p_session and status = 'active')
     and not coalesce((public.consume_rate_limit('random_next', v_me::text, 8, 600))->>'allowed', 'true')::boolean then
    raise exception 'You are starting new Random chats too quickly. Try again shortly.' using errcode = '42901';
  end if;

  update public.random_sessions
     set status = case when status = 'active' then 'ended'::public.random_session_status else status end,
         ended_at = coalesce(ended_at, now()),
         end_reason = coalesce(end_reason, case when p_reason in ('left','next','timeout','moderation','blocked','reported') then p_reason else 'left' end),
         ended_by = coalesce(ended_by, v_me)
   where id = p_session;

  update public.random_session_participants
     set left_at = coalesce(left_at, now())
   where session_id = p_session;
end;
$$;

-- ----------------------------------------------------------------------------
-- join_random_queue — matching
-- ----------------------------------------------------------------------------

create or replace function public.join_random_queue()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := public.current_profile_id();
  v_partner uuid;
  v_session uuid;
  v_existing uuid;
begin
  if v_me is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not public.is_active_user() then
    raise exception 'Your account cannot use Random.' using errcode = '42501';
  end if;
  if not public.has_permission('use_random_chat') then
    raise exception 'Random is not enabled for your account.' using errcode = '42501';
  end if;

  -- Already in a live session? Return it instead of queueing again.
  select s.id into v_existing
  from public.random_sessions s
  join public.random_session_participants p on p.session_id = s.id
  where p.user_id = v_me and p.left_at is null and s.status = 'active'
  order by s.started_at desc
  limit 1;
  if v_existing is not null then
    return jsonb_build_object('status', 'matched', 'session_id', v_existing, 'reused', true);
  end if;

  -- Already waiting? Just report the wait.
  if exists (select 1 from public.random_queue q where q.user_id = v_me and q.status = 'waiting' and q.expires_at > now()) then
    return jsonb_build_object('status', 'waiting');
  end if;

  -- Rate limit before touching the queue: joining repeatedly is the cheapest
  -- abuse of this feature (spec §61). Enforced here as well as in the route so a
  -- direct RPC call cannot skip it.
  if not coalesce((public.consume_rate_limit('random_join', v_me::text, 12, 3600))->>'allowed', 'true')::boolean then
    raise exception 'You are joining Random too often. Try again later.' using errcode = '42901';
  end if;

  -- Clear stale entries for this user, then take a place in the queue.
  delete from public.random_queue where user_id = v_me and (status <> 'waiting' or expires_at <= now());
  insert into public.random_queue (user_id, status)
  values (v_me, 'waiting')
  on conflict (user_id) do update set joined_at = now(), expires_at = now() + interval '10 minutes', status = 'waiting';

  -- Find the longest-waiting eligible partner:
  --   * not me, active account, waiting, not expired
  --   * no block in either direction
  --   * no active session of their own
  -- `for update skip locked` makes concurrent matches safe.
  select q.user_id into v_partner
  from public.random_queue q
  where q.user_id <> v_me
    and q.status = 'waiting'
    and q.expires_at > now()
    and public.is_active_profile(q.user_id)
    and not public.is_blocked(v_me, q.user_id)
    and not exists (
      select 1 from public.random_sessions s
      join public.random_session_participants p on p.session_id = s.id
      where p.user_id = q.user_id and p.left_at is null and s.status = 'active'
    )
  order by q.joined_at asc
  limit 1
  for update skip locked;

  if v_partner is null then
    return jsonb_build_object('status', 'waiting');
  end if;

  insert into public.random_sessions (participant_a, participant_b)
  values (least(v_me, v_partner), greatest(v_me, v_partner))
  returning id into v_session;

  insert into public.random_session_participants (session_id, user_id, side)
  values
    (v_session, least(v_me, v_partner), 'a'),
    (v_session, greatest(v_me, v_partner), 'b');

  update public.random_queue
     set status = 'matched', session_id = v_session
   where user_id in (v_me, v_partner);

  return jsonb_build_object('status', 'matched', 'session_id', v_session);
end;
$$;

comment on function public.join_random_queue() is
  'Atomic matchmaking. Returns {"status":"waiting"} or {"status":"matched","session_id":...}. Never returns the partner identity.';

create or replace function public.leave_random_queue()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := public.current_profile_id();
begin
  if v_me is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  delete from public.random_queue
   where user_id = v_me and status = 'waiting';
end;
$$;

/** Poll target for the "finding someone" screen: waiting | matched | idle. */
create or replace function public.random_queue_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := public.current_profile_id();
  v_row public.random_queue;
  v_session uuid;
begin
  if v_me is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select s.id into v_session
  from public.random_sessions s
  join public.random_session_participants p on p.session_id = s.id
  where p.user_id = v_me and p.left_at is null and s.status = 'active'
  order by s.started_at desc
  limit 1;
  if v_session is not null then
    return jsonb_build_object('status', 'matched', 'session_id', v_session);
  end if;

  select * into v_row from public.random_queue q where q.user_id = v_me;
  if v_row.id is null or v_row.status <> 'waiting' or v_row.expires_at <= now() then
    return jsonb_build_object('status', 'idle');
  end if;
  return jsonb_build_object('status', 'waiting', 'joined_at', v_row.joined_at);
end;
$$;

/** The participant-facing state of a session. Contains no identities. */
create or replace function public.random_session_state(p_session uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := public.current_profile_id();
  v_row public.random_sessions;
begin
  if not public.can_access_random_session(p_session, v_me) then
    return null;  -- do not distinguish "not found" from "not yours"
  end if;

  select * into v_row from public.random_sessions s where s.id = p_session;

  return jsonb_build_object(
    'id', v_row.id,
    'status', v_row.status,
    'started_at', v_row.started_at,
    'ended_at', v_row.ended_at,
    'expires_at', v_row.expires_at,
    'message_count', v_row.message_count,
    'end_reason', v_row.end_reason
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- send_random_message
-- ----------------------------------------------------------------------------

create or replace function public.send_random_message(
  p_session uuid,
  p_body text,
  p_gif jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := public.current_profile_id();
  v_other uuid;
  v_row public.random_messages;
  v_clean text := btrim(coalesce(p_body, ''));
begin
  if v_me is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not public.is_active_user() or not public.has_permission('use_random_chat') then
    raise exception 'You cannot send messages right now.' using errcode = '42501';
  end if;
  if not public.can_access_random_session(p_session, v_me) then
    raise exception 'You are not part of this session.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.random_sessions s where s.id = p_session and s.status = 'active' and s.ended_at is null) then
    raise exception 'This conversation has ended.' using errcode = '22023';
  end if;
  if length(v_clean) > 2000 then
    raise exception 'That message is too long.' using errcode = '22023';
  end if;
  if v_clean = '' and p_gif is null then
    raise exception 'Write a message or pick a GIF.' using errcode = '22023';
  end if;
  if p_gif is not null and coalesce(p_gif->>'provider', '') <> 'giphy' then
    raise exception 'Only approved GIFs can be attached.' using errcode = '22023';
  end if;

  v_other := public.random_other_participant(p_session, v_me);
  if public.is_blocked(v_me, v_other) then
    perform public.end_random_session(p_session, 'blocked');
    raise exception 'This conversation was ended.' using errcode = '42501';
  end if;

  insert into public.random_messages (session_id, sender_user_id, content, gif)
  values (p_session, v_me, v_clean, p_gif)
  returning * into v_row;

  update public.random_sessions
     set message_count = message_count + 1
   where id = p_session;

  update public.random_session_participants
     set message_count = message_count + 1
   where session_id = p_session and user_id = v_me;

  return jsonb_build_object(
    'id', v_row.id,
    'session_id', v_row.session_id,
    'mine', true,
    'content', v_row.content,
    'gif', v_row.gif,
    'created_at', v_row.created_at
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- report_random_session — the only way a participant reports
-- ----------------------------------------------------------------------------

create or replace function public.report_random_session(
  p_session uuid,
  p_reason text,
  p_details text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := public.current_profile_id();
  v_other uuid;
  v_id uuid;
begin
  if not public.can_access_random_session(p_session, v_me) then
    raise exception 'You are not part of this session.' using errcode = '42501';
  end if;
  if not coalesce((public.consume_rate_limit('report_create', v_me::text, 10, 3600))->>'allowed', 'true')::boolean then
    raise exception 'You are filing reports too quickly. Try again later.' using errcode = '42901';
  end if;
  v_other := public.random_other_participant(p_session, v_me);

  insert into public.random_reports (session_id, reporter_user_id, target_user_id, reason, details)
  values (p_session, v_me, v_other, p_reason, left(p_details, 1000))
  returning id into v_id;

  insert into public.reports (reporter_id, target_type, target_id, reason, details, random_session_id)
  values (v_me, 'random_session', p_session, p_reason, left(p_details, 1000), p_session);

  update public.random_sessions set status = 'reported' where id = p_session and status = 'active';

  return v_id;
end;
$$;

comment on function public.report_random_session(uuid, text, text) is
  'Creates both the Random-specific report and the central moderation report, then flags the session.';

/** Retention helper used by operator scripts / scheduled maintenance. */
create or replace function public.purge_random_data(p_older_than_days integer default 90)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  if not (public.has_permission('manage_platform_settings') or public.is_trusted_writer()) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;
  with doomed as (
    delete from public.random_sessions
    where started_at < now() - make_interval(days => greatest(p_older_than_days, 1))
      and status <> 'reported'   -- reported sessions are retained for moderation
    returning id
  )
  select count(*) into v_count from doomed;
  return coalesce(v_count, 0);
end;
$$;

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------

alter table public.random_queue enable row level security;
alter table public.random_sessions enable row level security;
alter table public.random_session_participants enable row level security;
alter table public.random_messages enable row level security;
alter table public.random_reports enable row level security;

-- random_queue: a student only ever sees their own row, and only to know they
-- are waiting. Matching itself happens in the definer function.
create policy random_queue_select_own on public.random_queue
  for select to authenticated using (user_id = public.current_profile_id());
create policy random_queue_delete_own on public.random_queue
  for delete to authenticated using (user_id = public.current_profile_id());
create policy random_queue_select_staff on public.random_queue
  for select to authenticated using (public.has_permission('moderate_random'));

-- random_sessions: identity mapping. Staff only, and only with the explicit
-- view_random_sessions permission (the application writes an audit entry on
-- every unmasking).
create policy random_sessions_select_privileged on public.random_sessions
  for select to authenticated using (public.has_permission('view_random_sessions'));
create policy random_sessions_update_staff on public.random_sessions
  for update to authenticated
  using (public.has_permission('moderate_random'))
  with check (public.has_permission('moderate_random'));
-- No participant policies on purpose: participants read `random_session_state()`
-- and `random_session_view`, which contain no identities.

create policy random_participants_select_self on public.random_session_participants
  for select to authenticated using (user_id = public.current_profile_id());
create policy random_participants_select_privileged on public.random_session_participants
  for select to authenticated using (public.has_permission('view_random_sessions'));

-- random_messages: participants read their own session through the view below.
create policy random_messages_select_privileged on public.random_messages
  for select to authenticated using (public.has_permission('view_random_sessions'));

create policy random_reports_select_reporter on public.random_reports
  for select to authenticated using (reporter_user_id = public.current_profile_id());
create policy random_reports_select_staff on public.random_reports
  for select to authenticated
  using (public.has_permission('moderate_random') or public.has_permission('moderate_all'));
create policy random_reports_update_staff on public.random_reports
  for update to authenticated
  using (public.has_permission('moderate_random') or public.has_permission('moderate_all'))
  with check (public.has_permission('moderate_random') or public.has_permission('moderate_all'));

-- ----------------------------------------------------------------------------
-- Participant-facing projections (definer views: they intentionally read the
-- identity tables, but whitelist columns so no identity can escape)
-- ----------------------------------------------------------------------------

create view public.random_session_view
as
select
  s.id,
  s.status,
  s.started_at,
  s.ended_at,
  s.end_reason,
  s.message_count,
  s.expires_at,
  p.side as my_side
from public.random_sessions s
join public.random_session_participants p
  on p.session_id = s.id
 and p.user_id = public.current_profile_id()
where p.left_at is null;

comment on view public.random_session_view is
  'Participant-safe session projection: no participant ids, no usernames, no profile data.';

create view public.random_messages_view
as
select
  m.id,
  m.session_id,
  (m.sender_user_id = public.current_profile_id()) as mine,
  m.content,
  m.gif,
  m.created_at,
  m.status
from public.random_messages m
where exists (
  select 1 from public.random_session_participants p
  where p.session_id = m.session_id
    and p.user_id = public.current_profile_id()
);

comment on view public.random_messages_view is
  'Participant-safe message stream. `sender_user_id` is mapped to a boolean `mine` flag so the other student cannot be identified.';

-- ----------------------------------------------------------------------------
-- Session housekeeping: expire queue entries and long-running sessions
-- ----------------------------------------------------------------------------

create or replace function public.sweep_random_state()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_queue integer;
  v_sessions integer;
begin
  with gone as (
    delete from public.random_queue
    where status = 'waiting' and expires_at <= now()
    returning 1
  )
  select count(*) into v_queue from gone;

  with closed as (
    update public.random_sessions
       set status = 'expired', ended_at = now(), end_reason = 'timeout'
     where status = 'active'
       and (expires_at <= now() or now() - started_at > make_interval(mins => 60))
    returning 1
  )
  select count(*) into v_sessions from closed;

  return jsonb_build_object('queue_expired', coalesce(v_queue, 0), 'sessions_expired', coalesce(v_sessions, 0));
end;
$$;

comment on function public.sweep_random_state() is
  'Callable by any authenticated user (it only expires stale rows) and by the scheduled maintenance script.';
