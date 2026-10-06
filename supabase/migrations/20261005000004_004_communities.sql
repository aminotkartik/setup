-- Campus+ migration 004 — communities
-- Supabase CLI filename: 20261005000004_004_communities.sql
-- This file is part of the single authoritative migration history in supabase/migrations/.
-- =============================================================================
-- Campus+ 004 — communities, study groups and clubs
-- =============================================================================
-- One membership + discussion + chat infrastructure serves three product
-- surfaces (spec §133, "Study Group → existing Community/Chat system"):
--
--   kind = 'community'    → Explore → Communities
--   kind = 'study_group'  → Explore → Study groups
--   kind = 'club'         → Campus → Clubs
--
-- Members can post discussions and chat; chat rooms are ordinary conversations
-- (migration 006) linked through `conversations.community_id`, so there is
-- exactly one messaging system.
-- =============================================================================

create table public.communities (
  id               uuid primary key default gen_random_uuid(),
  kind             public.community_kind not null default 'community',
  name             text not null check (length(btrim(name)) between 3 and 80),
  slug             text not null unique check (slug ~ '^[a-z0-9-]{3,60}$'),
  description      text not null check (length(description) between 10 and 1000),
  -- study-group specifics
  subject          text check (subject is null or length(subject) <= 120),
  branch           text check (branch is null or length(branch) <= 80),
  year             text check (year is null or length(year) <= 40),
  meeting_info     text check (meeting_info is null or length(meeting_info) <= 200),
  -- club specifics
  recruitment_info text check (recruitment_info is null or length(recruitment_info) <= 1000),
  contact_info     text check (contact_info is null or length(contact_info) <= 200),
  external_url     text check (external_url is null or external_url ~ '^https?://'),
  -- shared
  visibility       public.visibility_level not null default 'public',
  join_policy      text not null default 'open' check (join_policy in ('open', 'request', 'invite')),
  status           public.content_status not null default 'published',
  is_official      boolean not null default false,
  created_by       uuid not null references public.profiles (id) on delete restrict,
  approved_by      uuid references public.profiles (id) on delete set null,
  approved_at      timestamptz,
  member_count     integer not null default 1 check (member_count >= 0),
  post_count       integer not null default 0 check (post_count >= 0),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index communities_kind_idx on public.communities (kind, status);
create index communities_visibility_idx on public.communities (visibility);
create index communities_name_trgm_idx on public.communities using gin (name gin_trgm_ops);
create index communities_created_by_idx on public.communities (created_by);

create trigger communities_touch before update on public.communities
  for each row execute function public.touch_updated_at();

comment on table public.communities is
  'Communities, study groups and clubs share this table (kind discriminator) so membership, discussions and chat are one system.';

create table public.community_members (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  role         public.community_role not null default 'member',
  status       text not null default 'active' check (status in ('active', 'pending', 'banned')),
  joined_at    timestamptz not null default now(),
  invited_by   uuid references public.profiles (id) on delete set null,
  unique (community_id, user_id)
);

create index community_members_user_idx on public.community_members (user_id, status);
create index community_members_community_idx on public.community_members (community_id, role);

comment on column public.community_members.role is
  'Community-level role only. It never implies platform authority (spec §21, §33).';

create table public.community_join_requests (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  message      text check (message is null or length(message) <= 300),
  status       public.join_request_status not null default 'pending',
  decided_by   uuid references public.profiles (id) on delete set null,
  decided_at   timestamptz,
  created_at   timestamptz not null default now(),
  unique (community_id, user_id)
);

create index community_join_requests_community_idx on public.community_join_requests (community_id, status);
create index community_join_requests_user_idx on public.community_join_requests (user_id, created_at desc);

-- ----------------------------------------------------------------------------
-- Helpers
-- ----------------------------------------------------------------------------

create or replace function public.community_kind_of(p_community uuid)
returns public.community_kind
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.kind from public.communities c where c.id = p_community;
$$;

create or replace function public.is_community_member(p_community uuid, p_user uuid default null)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.community_members m
    join public.communities c on c.id = m.community_id
    where m.community_id = p_community
      and m.user_id = coalesce(p_user, public.current_profile_id())
      and m.status = 'active'
      and c.status = 'published'
  );
$$;

create or replace function public.is_community_moderator(p_community uuid, p_user uuid default null)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.community_members m
    where m.community_id = p_community
      and m.user_id = coalesce(p_user, public.current_profile_id())
      and m.status = 'active'
      and m.role in ('owner', 'moderator')
  );
$$;

create or replace function public.can_view_community(p_community uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.communities c
    where c.id = p_community
      and c.status = 'published'
      and (
        c.visibility in ('public', 'campus')
        or public.is_community_member(c.id)
        or public.has_permission('moderate_communities')
        or public.has_permission('moderate_all')
      )
  );
$$;

comment on function public.can_view_community(uuid) is
  'Visibility gate reused by community, post, discussion and chat policies.';

create or replace function public.can_post_in_community(p_community uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.can_view_community(p_community)
     and (
       public.is_community_member(p_community)
       or public.has_permission('moderate_communities')
       or public.has_permission('moderate_all')
     );
$$;

-- ----------------------------------------------------------------------------
-- Counters (definer triggers: the caller cannot inflate them directly)
-- ----------------------------------------------------------------------------

-- The creator becomes the owner automatically. Done in a definer trigger so the
-- client cannot forget it, and so a student never needs an elevated policy to
-- create their own membership row.
create or replace function public.add_community_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.community_members (community_id, user_id, role, status)
  values (new.id, new.created_by, 'owner', 'active')
  on conflict (community_id, user_id) do update set role = 'owner', status = 'active';
  return new;
end;
$$;

create trigger communities_add_owner
  after insert on public.communities
  for each row execute function public.add_community_owner();

-- Community counters are derived truth. The owner may edit the public
-- presentation of their space; ownership, official status and counters are
-- recomputed or protected instead of trusted.
create or replace function public.guard_community_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_trusted_writer() then
    new.member_count := (
      select count(*) from public.community_members m
      where m.community_id = old.id and m.status = 'active'
    );
    new.post_count := (
      select count(*) from public.posts p
      where p.community_id = old.id and p.status = 'published' and p.deleted_at is null
    );
    new.created_by := old.created_by;
    new.kind := old.kind;
    new.is_official := old.is_official;
    new.approved_by := old.approved_by;
    new.approved_at := old.approved_at;
  end if;
  return new;
end;
$$;

create trigger communities_guard_update
  before update on public.communities
  for each row execute function public.guard_community_update();

create or replace function public.sync_community_member_count()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_community uuid := coalesce(new.community_id, old.community_id);
begin
  update public.communities c
     set member_count = (
       select count(*) from public.community_members m
       where m.community_id = v_community and m.status = 'active'
     )
   where c.id = v_community;
  return coalesce(new, old);
end;
$$;

create trigger community_members_count
  after insert or update or delete on public.community_members
  for each row execute function public.sync_community_member_count();

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------

alter table public.communities enable row level security;
alter table public.community_members enable row level security;
alter table public.community_join_requests enable row level security;

-- communities ---------------------------------------------------------------
-- `created_by = current_profile_id()` matters for two reasons:
--   1. a creator must always see the space they just made, even if it is private;
--   2. PostgreSQL applies the SELECT policy to rows returned by INSERT ... RETURNING
--      (PostgREST does this on every insert), and `can_view_community(id)` reads
--      this same table, so the newly inserted row is not yet visible to it.
create policy communities_select_visible on public.communities
  for select to authenticated
  using (public.can_view_community(id) or created_by = public.current_profile_id());

create policy communities_insert_own on public.communities
  for insert to authenticated
  with check (
    public.is_active_user()
    and created_by = public.current_profile_id()
    and (
      (kind = 'community' and public.has_permission('create_communities'))
      or (kind = 'study_group' and public.has_permission('create_communities'))
      or (kind = 'club' and public.has_permission('manage_clubs'))
    )
  );

-- Owner may edit the public presentation of their space; staff may moderate it.
create policy communities_update_owner on public.communities
  for update to authenticated
  using (public.is_community_moderator(id) and public.is_active_user())
  with check (public.is_community_moderator(id));
create policy communities_update_staff on public.communities
  for update to authenticated
  using (public.has_permission('moderate_communities') or public.has_permission('moderate_all'))
  with check (public.has_permission('moderate_communities') or public.has_permission('moderate_all'));

create policy communities_delete_owner on public.communities
  for delete to authenticated
  using (created_by = public.current_profile_id() or public.has_permission('moderate_all'));

-- community_members ---------------------------------------------------------
create policy community_members_select_member on public.community_members
  for select to authenticated
  using (
    user_id = public.current_profile_id()
    or public.is_community_member(community_id)
    or public.has_permission('moderate_communities')
  );

create policy community_members_insert_self on public.community_members
  for insert to authenticated
  with check (
    user_id = public.current_profile_id()
    and public.is_active_user()
    and exists (
      select 1 from public.communities c
      where c.id = community_id
        and c.status = 'published'
        and c.join_policy = 'open'
        and c.visibility in ('public', 'campus')
    )
  );

-- Owners/moderators of a space may add members (invite flows) within their own
-- space only.
create policy community_members_insert_managers on public.community_members
  for insert to authenticated
  with check (public.is_community_moderator(community_id));

create policy community_members_update_managers on public.community_members
  for update to authenticated
  using (public.is_community_moderator(community_id) or public.has_permission('moderate_communities'))
  with check (public.is_community_moderator(community_id) or public.has_permission('moderate_communities'));

create policy community_members_delete_self on public.community_members
  for delete to authenticated using (user_id = public.current_profile_id());
create policy community_members_delete_managers on public.community_members
  for delete to authenticated
  using (public.is_community_moderator(community_id) or public.has_permission('moderate_communities'));

-- A member may not promote themselves: role changes are restricted to managers
-- and to owners for the owner role.
create or replace function public.guard_community_role_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.is_trusted_writer() then
    return new;
  end if;
  if new.role is distinct from old.role then
    if not public.is_community_moderator(new.community_id) then
      raise exception 'Only community owners and moderators can change member roles.'
        using errcode = '42501';
    end if;
    if new.role = 'owner' and not exists (
      select 1 from public.community_members m
      where m.community_id = new.community_id
        and m.user_id = public.current_profile_id()
        and m.role = 'owner'
    ) then
      raise exception 'Only an owner can transfer ownership.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger community_members_guard_role
  before update on public.community_members
  for each row execute function public.guard_community_role_change();

-- community_join_requests --------------------------------------------------
create policy community_join_requests_select on public.community_join_requests
  for select to authenticated
  using (
    user_id = public.current_profile_id()
    or public.is_community_moderator(community_id)
    or public.has_permission('moderate_communities')
  );

create policy community_join_requests_insert_self on public.community_join_requests
  for insert to authenticated
  with check (
    user_id = public.current_profile_id()
    and public.is_active_user()
    and exists (
      select 1 from public.communities c
      where c.id = community_id and c.status = 'published' and c.join_policy = 'request'
    )
  );

create policy community_join_requests_decide on public.community_join_requests
  for update to authenticated
  using (public.is_community_moderator(community_id))
  with check (public.is_community_moderator(community_id));

create policy community_join_requests_cancel on public.community_join_requests
  for delete to authenticated using (user_id = public.current_profile_id());
