-- Campus+ migration 012 — auth hooks
-- Supabase CLI filename: 20261005000012_012_auth_hooks.sql
-- This file is part of the single authoritative migration history in supabase/migrations/.
-- =============================================================================
-- Campus+ 012 — auth hooks, onboarding, username rules
-- =============================================================================
-- The institutional domain restriction is enforced HERE, in the database, at
-- the moment an auth user is created (spec §8). A caller cannot bypass it with a
-- crafted request to the Auth API, because the trigger raises and the insert
-- rolls back.
--
-- Onboarding (username + display name + optional details) also happens through
-- definer functions so that username uniqueness, the reserved list and the
-- change cooldown cannot be dodged by writing to the tables directly.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- reserved_usernames — mirrored from lib/constants.js RESERVED_USERNAMES
-- ----------------------------------------------------------------------------

create table public.reserved_usernames (
  username text primary key check (username ~ '^[a-z0-9_]{2,30}$'),
  reason   text,
  created_at timestamptz not null default now()
);

create or replace function public.is_reserved_username(p_username text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.reserved_usernames r where r.username = lower(coalesce(p_username, '')));
$$;

-- ----------------------------------------------------------------------------
-- Domain gate
-- ----------------------------------------------------------------------------

create or replace function public.allowed_email_domain(p_email text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_domain text;
  v_setting jsonb;
begin
  v_domain := lower(split_part(coalesce(p_email, ''), '@', 2));
  if v_domain = '' then
    return false;
  end if;

  -- Database configuration wins…
  begin
    select value into v_setting from public.platform_settings where key = 'allowed_email_domains';
  exception when undefined_table then
    v_setting := null;
  end;

  if v_setting is not null and jsonb_typeof(v_setting) = 'array' then
    if exists (
      select 1 from jsonb_array_elements_text(v_setting) d
      where lower(d) = v_domain
    ) then
      return true;
    end if;
  end if;

  -- …then the college row…
  if public.college_for_domain(v_domain) is not null then
    return true;
  end if;

  -- …and finally the deployment default stored on the college row itself.
  return false;
end;
$$;

comment on function public.allowed_email_domain(text) is
  'Server-side institutional domain check. Used by the auth trigger, so it cannot be bypassed from the client.';

create or replace function public.enforce_institutional_domain()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := coalesce(new.email, '');
begin
  -- Only enforce when an email is present (phone-only or OAuth sign-ups are not
  -- part of Campus+ and are rejected by configuration anyway).
  if v_email = '' then
    raise exception 'Campus+ requires an institutional email address.'
      using errcode = '42501';
  end if;

  if not public.allowed_email_domain(v_email) then
    raise exception 'Campus+ is limited to approved institutional email addresses (%).',
      coalesce((select string_agg('@' || d, ', ') from public.colleges c, unnest(c.email_domains) d where c.is_active), '@pccoepune.org')
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_institutional_domain_trigger on auth.users;
create trigger enforce_institutional_domain_trigger
  before insert on auth.users
  for each row execute function public.enforce_institutional_domain();

-- ----------------------------------------------------------------------------
-- Profile provisioning
-- ----------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(coalesce(new.email, ''));
  v_domain text := lower(split_part(coalesce(new.email, ''), '@', 2));
  v_college uuid;
  v_profile uuid;
  v_display text;
begin
  v_college := public.college_for_domain(v_domain);
  if v_college is null then
    raise exception 'No Campus+ college is configured for @%.', v_domain using errcode = '42501';
  end if;

  v_display := coalesce(
    nullif(btrim(coalesce(new.raw_user_meta_data->>'display_name', '')), ''),
    initcap(replace(split_part(v_email, '@', 1), '.', ' '))
  );

  -- Mark the provisioning work so guards such as prevent_privilege_escalation()
  -- know this is the database's own baseline setup, not a client asking for a
  -- role. Transaction-local: it disappears when this trigger's transaction ends.
  perform set_config('campus.system_context', 'on', true);

  insert into public.profiles (display_name)
  values (left(v_display, 60))
  returning id into v_profile;

  insert into public.profile_private (
    profile_id, auth_user_id, college_id, account_status, profile_completed
  ) values (
    v_profile, new.id, v_college, 'active', false
  );

  -- Baseline role. Additional roles are granted deliberately and audited.
  insert into public.user_roles (user_id, role_key)
  values (v_profile, 'student')
  on conflict do nothing;

  -- The first username_history row is written by complete_profile() once the
  -- student actually claims a handle.

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

comment on function public.handle_new_user() is
  'Creates profiles + profile_private + the student role for each new auth user. Username is chosen during onboarding.';
-- ----------------------------------------------------------------------------
-- Hard-delete cleanup
-- ----------------------------------------------------------------------------
-- Deleting an auth user cascades into profile_private but cannot reach
-- `profiles` (that FK points the other way), which used to leave an orphaned
-- public identity behind. Removing the profile here lets the rest of the
-- cascade chain run: content, memberships and reports follow the profile.

create or replace function public.cleanup_deleted_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.profiles where id = old.profile_id;
  return old;
end;
$$;

comment on function public.cleanup_deleted_profile() is
  'Keeps the public identity in step with the auth record when an account is hard-deleted.';

drop trigger if exists profile_private_cleanup on public.profile_private;
create trigger profile_private_cleanup
  after delete on public.profile_private
  for each row execute function public.cleanup_deleted_profile();



-- ----------------------------------------------------------------------------
-- Onboarding: complete_profile
-- ----------------------------------------------------------------------------

create or replace function public.complete_profile(
  p_username text,
  p_display_name text,
  p_bio text default null,
  p_branch text default null,
  p_year text default null,
  p_division text default null,
  p_show_branch_year boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := public.current_profile_id();
  v_username text := lower(btrim(coalesce(p_username, '')));
  v_display text := btrim(coalesce(p_display_name, ''));
  v_existing text;
begin
  if v_me is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  -- Validation mirrors lib/validation/schemas.js#vUsername (defence in depth:
  -- the database is the last word).
  if v_username !~ '^[a-z0-9_]{3,24}$' then
    raise exception 'Usernames must be 3-24 characters using lowercase letters, numbers and underscores.'
      using errcode = '22023';
  end if;
  if v_username ~ '^_|_$' or v_username ~ '__' then
    raise exception 'Usernames cannot start or end with an underscore, or repeat one.'
      using errcode = '22023';
  end if;
  if v_username ~ '^[0-9]+$' then
    raise exception 'Usernames cannot be only numbers.' using errcode = '22023';
  end if;
  if public.is_reserved_username(v_username) then
    raise exception 'That username is reserved by the platform.' using errcode = '22023';
  end if;
  if length(v_display) < 2 or length(v_display) > 60 then
    raise exception 'Display name must be between 2 and 60 characters.' using errcode = '22023';
  end if;
  if length(coalesce(p_bio, '')) > 280 then
    raise exception 'Bio must be at most 280 characters.' using errcode = '22023';
  end if;

  select username into v_existing from public.profiles where id = v_me;
  if v_existing is not null and v_existing <> v_username then
    raise exception 'Your username can be changed from Settings once the cooldown passes.'
      using errcode = '22023';
  end if;

  if exists (select 1 from public.profiles p where lower(p.username) = v_username and p.id <> v_me) then
    raise exception 'That username is already taken.' using errcode = '23505';
  end if;

  update public.profiles
     set username = v_username,
         display_name = v_display,
         bio = nullif(btrim(coalesce(p_bio, '')), ''),
         branch = nullif(btrim(coalesce(p_branch, '')), ''),
         year = nullif(btrim(coalesce(p_year, '')), ''),
         division = nullif(btrim(coalesce(p_division, '')), ''),
         show_branch_year = coalesce(p_show_branch_year, true)
   where id = v_me;

  update public.profile_private
     set profile_completed = true,
         username_changed_at = coalesce(username_changed_at, now()),
         last_seen = now()
   where profile_id = v_me;

  insert into public.username_history (user_id, old_username, new_username, changed_by)
  values (v_me, v_existing, v_username, v_me);

  perform public.evaluate_achievements(v_me);

  insert into public.audit_logs (actor_user_id, action, target_type, target_id, metadata, visibility)
  values (v_me, 'account.profile_created', 'user', v_me, jsonb_build_object('username', v_username), 'private');

  return jsonb_build_object('ok', true, 'username', v_username);
exception
  when unique_violation then
    raise exception 'That username is already taken.' using errcode = '23505';
end;
$$;

comment on function public.complete_profile is
  'First-login onboarding: claims a unique username and completes the profile.';

-- ----------------------------------------------------------------------------
-- Username changes with a configurable cooldown
-- ----------------------------------------------------------------------------

create or replace function public.change_username(p_new_username text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := public.current_profile_id();
  v_username text := lower(btrim(coalesce(p_new_username, '')));
  v_old text;
  v_changed_at timestamptz;
  v_cooldown integer;
  v_days_left integer;
begin
  if v_me is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not public.is_active_user() then
    raise exception 'Your account cannot change its username.' using errcode = '42501';
  end if;
  if v_username !~ '^[a-z0-9_]{3,24}$' or v_username ~ '^_|_$' or v_username ~ '__' or v_username ~ '^[0-9]+$' then
    raise exception 'Usernames must be 3-24 characters: lowercase letters, numbers and single underscores.'
      using errcode = '22023';
  end if;
  if public.is_reserved_username(v_username) then
    raise exception 'That username is reserved by the platform.' using errcode = '22023';
  end if;

  select p.username, pp.username_changed_at into v_old, v_changed_at
  from public.profiles p
  join public.profile_private pp on pp.profile_id = p.id
  where p.id = v_me;

  if v_old = v_username then
    raise exception 'That is already your username.' using errcode = '22023';
  end if;

  v_cooldown := coalesce(public.setting_int('username_change_cooldown_days', 30), 30);
  if v_changed_at is not null and now() < v_changed_at + make_interval(days => greatest(v_cooldown, 0)) then
    v_days_left := ceil(extract(epoch from (v_changed_at + make_interval(days => v_cooldown) - now())) / 86400.0)::integer;
    raise exception 'You can change your username again in % day(s).', greatest(v_days_left, 1)
      using errcode = '22023';
  end if;

  if exists (select 1 from public.profiles p where lower(p.username) = v_username and p.id <> v_me) then
    raise exception 'That username is already taken.' using errcode = '23505';
  end if;

  update public.profiles set username = v_username where id = v_me;
  update public.profile_private set username_changed_at = now() where profile_id = v_me;

  insert into public.username_history (user_id, old_username, new_username, changed_by)
  values (v_me, v_old, v_username, v_me);

  perform public.log_audit('account.username_changed', 'user', v_me::text,
    jsonb_build_object('old_username', v_old, 'new_username', v_username), false, null, 'private');

  return jsonb_build_object('ok', true, 'username', v_username);
exception
  when unique_violation then
    raise exception 'That username is already taken.' using errcode = '23505';
end;
$$;

create or replace function public.username_change_available_at()
returns timestamptz
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_changed_at timestamptz;
  v_cooldown integer;
begin
  select username_changed_at into v_changed_at
  from public.profile_private where profile_id = public.current_profile_id();
  v_cooldown := coalesce(public.setting_int('username_change_cooldown_days', 30), 30);
  if v_changed_at is null then
    return now();
  end if;
  return v_changed_at + make_interval(days => greatest(v_cooldown, 0));
end;
$$;

-- ----------------------------------------------------------------------------
-- Presence-free activity marker (spec §102: never displayed, retention only)
-- ----------------------------------------------------------------------------

create or replace function public.touch_last_seen()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.profile_private
     set last_seen = now()
   where profile_id = public.current_profile_id();
end;
$$;

comment on function public.touch_last_seen() is
  'Records coarse retention/last activity for the owner only. There is no online/offline indicator anywhere in the product.';

-- ----------------------------------------------------------------------------
-- Suspension lifecycle: lift expired suspensions automatically
-- ----------------------------------------------------------------------------

create or replace function public.lift_expired_suspensions()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  with lifted as (
    update public.profile_private
       set account_status = 'active', suspended_until = null, status_reason = null
     where account_status = 'suspended'
       and suspended_until is not null
       and suspended_until <= now()
    returning 1
  )
  select count(*) into v_count from lifted;
  return coalesce(v_count, 0);
end;
$$;

comment on function public.lift_expired_suspensions() is
  'Marks temporary suspensions as over. Called on sign-in and by the maintenance script.';

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------

alter table public.reserved_usernames enable row level security;

create policy reserved_usernames_select on public.reserved_usernames
  for select to authenticated using (true);
create policy reserved_usernames_manage on public.reserved_usernames
  for all to authenticated
  using (public.has_permission('manage_platform_settings'))
  with check (public.has_permission('manage_platform_settings'));
