-- Campus+ migration 002 — identity roles
-- Supabase CLI filename: 20261005000002_002_identity_roles.sql
-- This file is part of the single authoritative migration history in supabase/migrations/.
-- =============================================================================
-- Campus+ 002 — identity, colleges, roles, permissions
-- =============================================================================
-- No passwords, no PRN. Identity comes from Supabase Auth (institutional email
-- OTP). This migration creates:
--
--   * colleges                    — the institution boundary + email allow-list
--   * profiles                    — PUBLIC identity (readable by members)
--   * profile_private             — private identity + account state (self/staff)
--   * roles/permissions/user_roles — the configurable authority model
--   * authorization helpers       — reused by every RLS policy in this schema
--
-- Splitting public and private identity at the table level (rather than relying
-- on column discipline in application code) is what makes "institutional email
-- must remain private" a database guarantee instead of a convention.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- colleges
-- ----------------------------------------------------------------------------

create table public.colleges (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(btrim(name)) between 2 and 120),
  short_name    text not null check (length(btrim(short_name)) between 2 and 40),
  slug          text not null unique check (slug ~ '^[a-z0-9-]{2,60}$'),
  email_domains text[] not null default '{}',
  city          text,
  is_active     boolean not null default true,
  settings      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger colleges_touch before update on public.colleges
  for each row execute function public.touch_updated_at();

comment on table public.colleges is
  'Institutions served by this deployment. The initial deployment has exactly one (PCCOE); adding another college is a data change, not a code change.';

-- ----------------------------------------------------------------------------
-- Trusted-writer detection
-- ----------------------------------------------------------------------------
-- Maintenance scripts and definer functions legitimately bypass interactive
-- guards (bootstrapping the first Super Admin, system counters). PostgREST
-- exposes the JWT role as a request setting, and definer functions owned by
-- `postgres` see current_user = postgres.

-- The request's JWT context, as exposed by PostgREST. `current_user` is NOT
-- usable for this purpose: inside a SECURITY DEFINER function it is the function
-- owner, so it would make every guard think it was running as postgres.
create or replace function public.request_claims()
returns jsonb
language plpgsql
stable
as $$
begin
  return coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
exception when others then
  return '{}'::jsonb;
end;
$$;

create or replace function public.jwt_role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(public.request_claims()->>'role', '')
  );
$$;

create or replace function public.jwt_sub()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(public.request_claims()->>'sub', '')
  );
$$;

-- Trusted writers are: requests made with the secret (service_role) key, and
-- direct privileged connections (maintenance scripts, migrations) that carry no
-- request claims at all. An interactive student request always carries claims.
create or replace function public.is_trusted_writer()
returns boolean
language sql
stable
as $$
  select public.jwt_role() = 'service_role'
      or (
        public.jwt_role() is null
        and public.jwt_sub() is null
        and session_user in ('postgres', 'service_role', 'supabase_admin', 'supabase_auth_admin')
      );
$$;

comment on function public.is_trusted_writer() is
  'True for secret-key requests and direct privileged connections. Used only to skip interactive guards, never to grant data access.';

-- ----------------------------------------------------------------------------
-- System-context marker
-- ----------------------------------------------------------------------------
-- SECURITY DEFINER functions that perform provisioning (creating the baseline
-- profile, for example) run with *user* claims present, so `is_trusted_writer()`
-- cannot recognise them. They set this transaction-local marker instead. It is
-- set only inside functions this repository owns — a client cannot set a GUC
-- through PostgREST — and `set_config(..., true)` means it never leaks past the
-- current transaction.

create or replace function public.in_system_context()
returns boolean
language sql
stable
as $$
  select coalesce(current_setting('campus.system_context', true), '') = 'on';
$$;

comment on function public.in_system_context() is
  'True while a Campus+ definer function is performing provisioning work.';

-- ----------------------------------------------------------------------------
-- profiles — public identity
-- ----------------------------------------------------------------------------

create table public.profiles (
  id                          uuid primary key default gen_random_uuid(),
  username                    text unique check (username ~ '^[a-z0-9_]{3,24}$'),
  display_name                text not null default '' check (length(display_name) <= 60),
  bio                         text check (bio is null or length(bio) <= 280),
  branch                      text check (branch is null or length(branch) <= 80),
  year                        text check (year is null or length(year) <= 40),
  division                    text check (division is null or length(division) <= 20),
  show_branch_year            boolean not null default true,
  allow_dms_from_everyone     boolean not null default true,
  reputation_score            numeric(4,2) not null default 0 check (reputation_score between 0 and 5),
  reputation_count            integer not null default 0 check (reputation_count >= 0),
  marketplace_completed_count integer not null default 0 check (marketplace_completed_count >= 0),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create unique index profiles_username_lower_idx on public.profiles (lower(username));
create index profiles_username_trgm_idx on public.profiles using gin (username gin_trgm_ops);
create index profiles_display_name_trgm_idx on public.profiles using gin (display_name gin_trgm_ops);

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

comment on table public.profiles is
  'Public identity. Only these columns are ever returned to other students; username is the primary public identifier.';

-- ----------------------------------------------------------------------------
-- profile_private — private identity and account lifecycle
-- ----------------------------------------------------------------------------

create table public.profile_private (
  profile_id            uuid primary key references public.profiles (id) on delete cascade,
  auth_user_id          uuid not null unique references auth.users (id) on delete cascade,
  college_id            uuid not null references public.colleges (id) on delete restrict,
  -- The institutional email is deliberately NOT duplicated here. Supabase Auth
  -- (auth.users) is the only place it is stored: one copy, one blast radius.
  -- Duplicate-account prevention comes from auth.users.email being unique plus
  -- the one-profile-per-auth-user trigger on that table.
  account_status        public.account_status not null default 'active',
  status_reason         text,
  suspended_until       timestamptz,
  profile_completed     boolean not null default false,
  username_changed_at   timestamptz,
  last_seen             timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint profile_private_suspension_valid check (
    suspended_until is null or account_status in ('suspended', 'banned')
  )
);

create index profile_private_college_idx on public.profile_private (college_id);
create index profile_private_status_idx on public.profile_private (account_status);

create trigger profile_private_touch before update on public.profile_private
  for each row execute function public.touch_updated_at();

comment on table public.profile_private is
  'Private account state: college, status, suspension window, onboarding flags. Readable by the owner and by staff only. No email is stored here (spec §81, §86).';

-- ----------------------------------------------------------------------------
-- Username history — powers the configurable change cooldown
-- ----------------------------------------------------------------------------

create table public.username_history (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  old_username text,
  new_username text not null,
  changed_by   uuid references public.profiles (id) on delete set null,
  changed_at   timestamptz not null default now()
);

create index username_history_user_idx on public.username_history (user_id, changed_at desc);
create unique index username_history_new_username_idx on public.username_history (lower(new_username));

-- ----------------------------------------------------------------------------
-- roles / permissions / role_permissions / user_roles
-- ----------------------------------------------------------------------------

create table public.roles (
  key         text primary key check (key ~ '^[a-z0-9_]{2,40}$'),
  label       text not null check (length(btrim(label)) between 2 and 60),
  description text,
  rank        integer not null default 0 check (rank between 0 and 1000),
  is_system   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger roles_touch before update on public.roles
  for each row execute function public.touch_updated_at();

create table public.permissions (
  key         text primary key check (key ~ '^[a-z0-9_]{2,60}$'),
  label       text not null check (length(btrim(label)) between 2 and 80),
  description text,
  group_name  text not null default 'General',
  created_at  timestamptz not null default now()
);

create table public.role_permissions (
  role_key       text not null references public.roles (key) on delete cascade,
  permission_key text not null references public.permissions (key) on delete cascade,
  granted_at     timestamptz not null default now(),
  granted_by     uuid references public.profiles (id) on delete set null,
  primary key (role_key, permission_key)
);

create table public.user_roles (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  role_key   text not null references public.roles (key) on delete cascade,
  granted_by uuid references public.profiles (id) on delete set null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  unique (user_id, role_key)
);

create index user_roles_user_idx on public.user_roles (user_id);
-- Reverse lookups: "which students hold this role" (admin UI, audits) and
-- "which roles grant this permission" (permission editor).
create index user_roles_role_idx on public.user_roles (role_key);
create index role_permissions_role_idx on public.role_permissions (role_key);
create index role_permissions_permission_idx on public.role_permissions (permission_key);

-- ----------------------------------------------------------------------------
-- Authorization helpers
-- ----------------------------------------------------------------------------

create or replace function public.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select pp.profile_id from public.profile_private pp where pp.auth_user_id = auth.uid();
$$;

comment on function public.current_profile_id() is
  'profiles.id of the signed-in user, or null. Used by nearly every RLS policy.';

create or replace function public.account_status_of(p_profile uuid)
returns public.account_status
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select pp.account_status from public.profile_private pp where pp.profile_id = p_profile;
$$;

create or replace function public.current_account_status()
returns public.account_status
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.account_status_of(public.current_profile_id());
$$;

create or replace function public.is_active_profile(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.account_status_of(p_profile) in ('active', 'pending'), false);
$$;

comment on function public.is_active_profile(uuid) is
  'Content visibility gate: suspended/banned/deactivated content stops being readable through RLS policies.';

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_active_profile(public.current_profile_id());
$$;

comment on function public.is_active_user() is
  'FALSE for suspended/banned/deactivated/deleted accounts — enforced by RLS, not by hiding UI.';

create or replace function public.has_role(p_role text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = public.current_profile_id()
      and ur.role_key = p_role
      and (ur.expires_at is null or ur.expires_at > now())
  );
$$;

create or replace function public.has_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_active_user()
     and exists (
       select 1
       from public.user_roles ur
       join public.role_permissions rp on rp.role_key = ur.role_key
       where ur.user_id = public.current_profile_id()
         and rp.permission_key = p_permission
         and (ur.expires_at is null or ur.expires_at > now())
     );
$$;

comment on function public.has_permission(text) is
  'Central permission check. Mirrored in JavaScript by lib/permissions/authorization.js#can().';

create or replace function public.role_rank(p_profile uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(max(r.rank), 0)
  from public.user_roles ur
  join public.roles r on r.key = ur.role_key
  where ur.user_id = p_profile
    and (ur.expires_at is null or ur.expires_at > now());
$$;

create or replace function public.current_role_rank()
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.role_rank(public.current_profile_id());
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.current_role_rank() >= 10, false);
$$;

comment on function public.is_staff() is
  'True for Moderator (rank 10) and above. Students hold rank 0 and never display a role badge.';

create or replace function public.college_for_domain(p_domain text)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.id
  from public.colleges c
  where c.is_active
    and exists (select 1 from unnest(c.email_domains) d where lower(d) = lower(p_domain))
  order by c.created_at
  limit 1;
$$;

-- ----------------------------------------------------------------------------
-- RLS — identity tables
-- ----------------------------------------------------------------------------

alter table public.colleges enable row level security;
alter table public.profiles enable row level security;
alter table public.profile_private enable row level security;
alter table public.username_history enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_roles enable row level security;

-- colleges ------------------------------------------------------------------
create policy colleges_select_member on public.colleges
  for select to authenticated
  using (public.current_profile_id() is not null or public.has_permission('manage_colleges'));
create policy colleges_insert_owner on public.colleges
  for insert to authenticated with check (public.has_permission('manage_colleges'));
create policy colleges_update_owner on public.colleges
  for update to authenticated
  using (public.has_permission('manage_colleges'))
  with check (public.has_permission('manage_colleges'));
create policy colleges_delete_owner on public.colleges
  for delete to authenticated using (public.has_role('super_admin'));

-- profiles (public identity) -----------------------------------------------
-- Readable by every signed-in member: this is the public face of a student and
-- contains no private data.
create policy profiles_select_authenticated on public.profiles
  for select to authenticated using (true);
create policy profiles_insert_self on public.profiles
  for insert to authenticated with check (id = public.current_profile_id());
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = public.current_profile_id())
  with check (id = public.current_profile_id());
create policy profiles_delete_admin on public.profiles
  for delete to authenticated using (public.has_permission('manage_users'));

-- profile_private -----------------------------------------------------------
create policy profile_private_select_self on public.profile_private
  for select to authenticated using (auth_user_id = auth.uid());
create policy profile_private_select_staff on public.profile_private
  for select to authenticated
  using (public.has_permission('manage_users') or public.has_permission('review_reports'));
create policy profile_private_insert_self on public.profile_private
  for insert to authenticated with check (auth_user_id = auth.uid());
create policy profile_private_update_self on public.profile_private
  for update to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());
create policy profile_private_delete_admin on public.profile_private
  for delete to authenticated using (public.has_permission('manage_users'));

-- Field-level write control
-- ----------------------------------------------------------------------------
-- Which columns a client may write is decided by COLUMN PRIVILEGES, not by
-- triggers that undo values (see migration 015 for the full matrix):
--
--   profiles         → display_name, bio, branch, year, division, show_branch_year
--   profile_private  → allow_dms_from_everyone
--
-- Everything else — account status, moderation fields, counters, official flags —
-- is written only by SECURITY DEFINER functions that check permissions, rank and
-- legality first (migration 016). A student PATCH-ing `account_status` receives a
-- permission error from PostgreSQL, before any policy or trigger is consulted.

-- username_history ----------------------------------------------------------
create policy username_history_select_self on public.username_history
  for select to authenticated
  using (user_id = public.current_profile_id() or public.has_permission('manage_users'));
create policy username_history_insert_self on public.username_history
  for insert to authenticated with check (user_id = public.current_profile_id());

-- roles / permissions -------------------------------------------------------
create policy roles_select_all on public.roles
  for select to authenticated using (true);
create policy roles_manage on public.roles
  for all to authenticated
  using (public.has_permission('manage_roles'))
  with check (public.has_permission('manage_roles'));

create policy permissions_select_all on public.permissions
  for select to authenticated using (true);
create policy permissions_manage on public.permissions
  for all to authenticated
  using (public.has_permission('manage_permissions'))
  with check (public.has_permission('manage_permissions'));

create policy role_permissions_select_all on public.role_permissions
  for select to authenticated using (true);
create policy role_permissions_manage on public.role_permissions
  for all to authenticated
  using (public.has_permission('manage_permissions'))
  with check (public.has_permission('manage_permissions'));

-- user_roles ----------------------------------------------------------------
create policy user_roles_select_self on public.user_roles
  for select to authenticated using (user_id = public.current_profile_id());
create policy user_roles_select_staff on public.user_roles
  for select to authenticated
  using (public.has_permission('manage_users') or public.has_permission('assign_roles'));
create policy user_roles_insert_admin on public.user_roles
  for insert to authenticated with check (public.has_permission('assign_roles'));
create policy user_roles_update_admin on public.user_roles
  for update to authenticated
  using (public.has_permission('assign_roles'))
  with check (public.has_permission('assign_roles'));
create policy user_roles_delete_admin on public.user_roles
  for delete to authenticated using (public.has_permission('assign_roles'));

-- Privilege-escalation guard: nobody may grant or revoke at or above their own
-- rank, and the automatic student role cannot be touched by hand.
create or replace function public.prevent_privilege_escalation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role_key text := coalesce(new.role_key, old.role_key);
  v_target_rank integer;
begin
  if public.is_trusted_writer() or public.in_system_context() then
    return coalesce(new, old);
  end if;

  -- A cascade from an account deletion is not an interactive role change: by the
  -- time this fires the profile is already gone, so there is no privilege left to
  -- escalate. Without this, deleting an account (or any cascade into user_roles)
  -- would fail on the automatic student row.
  if tg_op = 'DELETE' and not exists (select 1 from public.profiles p where p.id = old.user_id) then
    return old;
  end if;

  if v_role_key = 'student' then
    raise exception 'The student role is assigned automatically and cannot be changed here.'
      using errcode = '42501';
  end if;

  select r.rank into v_target_rank from public.roles r where r.key = v_role_key;

  if coalesce(v_target_rank, 1000) >= public.current_role_rank() then
    raise exception 'You cannot grant or revoke a role at or above your own level.'
      using errcode = '42501';
  end if;

  if not public.has_permission('assign_roles') then
    raise exception 'You do not have permission to assign roles.' using errcode = '42501';
  end if;

  -- Every role change is audited, whether it came through grant_role()/revoke_role()
  -- or a direct write by an administrator (spec §59).
  if public.current_profile_id() is not null then
    perform public.log_audit(
      case when tg_op = 'DELETE' then 'admin.role_revoked' else 'admin.role_granted' end,
      'user', coalesce(new.user_id, old.user_id)::text,
      jsonb_build_object('role', v_role_key, 'direct', true),
      false, null, 'admin');
  end if;

  return coalesce(new, old);
end;
$$;

create trigger user_roles_no_escalation
  before insert or update or delete on public.user_roles
  for each row execute function public.prevent_privilege_escalation();

-- ----------------------------------------------------------------------------
-- Public profile projection
-- ----------------------------------------------------------------------------
-- `public_profiles` lives in migration 003 next to the block helpers it needs
-- (`is_blocked_with_current`), so that discovery can respect blocks from the
-- very first version of the view.

