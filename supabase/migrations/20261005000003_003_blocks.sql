-- Campus+ migration 003 — blocks
-- Supabase CLI filename: 20261005000003_003_blocks.sql
-- This file is part of the single authoritative migration history in supabase/migrations/.
-- =============================================================================
-- Campus+ 003 — blocking and muting
-- =============================================================================
-- Blocking is a platform-wide primitive, so it lives before every content table
-- and its checks are reused by all of them (spec §60). A block is directional
-- in storage but symmetric in effect: either direction prevents interaction.
-- =============================================================================

create table public.blocks (
  id         uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  reason     text check (reason is null or length(reason) <= 300),
  created_at timestamptz not null default now(),
  constraint blocks_no_self check (blocker_id <> blocked_id),
  unique (blocker_id, blocked_id)
);

create index blocks_blocker_idx on public.blocks (blocker_id);
create index blocks_blocked_idx on public.blocks (blocked_id);

comment on table public.blocks is
  'Central block list. is_blocked() is used inside RLS policies so a blocked user cannot message, mention or interact even through a direct API call.';

create table public.mutes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  muted_user_id uuid not null references public.profiles (id) on delete cascade,
  created_at    timestamptz not null default now(),
  constraint mutes_no_self check (user_id <> muted_user_id),
  unique (user_id, muted_user_id)
);

comment on table public.mutes is
  'Feed-level mute: hides a user''s posts from your feed without blocking direct messages.';

-- Both directions are queried: "who did I mute" and "who muted me".
create index mutes_user_idx on public.mutes (user_id);
create index mutes_muted_idx on public.mutes (muted_user_id);

-- ----------------------------------------------------------------------------
-- Helpers
-- ----------------------------------------------------------------------------

create or replace function public.is_blocked(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a is not null
     and b is not null
     and a <> b
     and exists (
       select 1 from public.blocks bl
       where (bl.blocker_id = a and bl.blocked_id = b)
          or (bl.blocker_id = b and bl.blocked_id = a)
     );
$$;

comment on function public.is_blocked(uuid, uuid) is
  'TRUE when either party has blocked the other. Used inside RLS policies for discovery, messaging and mentions.';

create or replace function public.is_blocked_with_current(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_blocked(public.current_profile_id(), p_profile);
$$;

create or replace function public.is_muted_by_current(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.mutes m
    where m.user_id = public.current_profile_id() and m.muted_user_id = p_profile
  );
$$;

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------

alter table public.blocks enable row level security;
alter table public.mutes enable row level security;

-- A user sees and manages their own block list. Staff with moderation
-- permission may read blocks (they explain report context) but never edit them.
create policy blocks_select_own on public.blocks
  for select to authenticated using (blocker_id = public.current_profile_id());
create policy blocks_select_staff on public.blocks
  for select to authenticated using (public.has_permission('review_reports'));
create policy blocks_insert_own on public.blocks
  for insert to authenticated with check (blocker_id = public.current_profile_id() and public.is_active_user());
create policy blocks_delete_own on public.blocks
  for delete to authenticated using (blocker_id = public.current_profile_id());

create policy mutes_select_own on public.mutes
  for select to authenticated using (user_id = public.current_profile_id());
create policy mutes_insert_own on public.mutes
  for insert to authenticated with check (user_id = public.current_profile_id() and public.is_active_user());
create policy mutes_delete_own on public.mutes
  for delete to authenticated using (user_id = public.current_profile_id());

-- ----------------------------------------------------------------------------
-- Public profile projection
-- ----------------------------------------------------------------------------
create view public.public_profiles
with (security_invoker = true)
as
select
  p.id,
  p.username,
  p.display_name,
  p.bio,
  case when p.show_branch_year then p.branch else null end as branch,
  case when p.show_branch_year then p.year else null end as year,
  p.reputation_score,
  p.reputation_count,
  p.marketplace_completed_count,
  public.is_active_profile(p.id) as is_active,
  p.created_at
from public.profiles p
where p.username is not null
  -- Discovery respects blocks in both directions (spec §14, §60). The raw
  -- `profiles` table stays available so blocking, unblocking and moderation can
  -- still resolve the person involved.
  and not public.is_blocked_with_current(p.id);

comment on view public.public_profiles is
  'Public projection of profiles. Institutional email, auth ids and moderation state are structurally absent.';
