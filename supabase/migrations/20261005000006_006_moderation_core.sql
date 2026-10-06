-- Campus+ migration 006 — moderation core
-- Supabase CLI filename: 20261005000006_006_moderation_core.sql
-- This file is part of the single authoritative migration history in supabase/migrations/.
-- =============================================================================
-- Campus+ 006 — reporting, moderation trail, audit logs, notifications
-- =============================================================================
-- Built before the product modules on purpose: every feature reports through
-- this one system, moderates through this one trail and notifies through this
-- one table (spec §53, §57, §59, §133).
--
-- Write paths for notifications and audit logs are SECURITY DEFINER functions,
-- so a client cannot forge an audit record, spoof the actor, or push a
-- notification to an arbitrary user.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- reports
-- ----------------------------------------------------------------------------

create table public.reports (
  id                 uuid primary key default gen_random_uuid(),
  reporter_id        uuid not null references public.profiles (id) on delete cascade,
  target_type        public.report_target_type not null,
  target_id          uuid not null,
  reason             text not null check (reason in (
                       'spam', 'harassment', 'hate', 'nudity', 'violence', 'scam',
                       'misinformation', 'impersonation', 'academic_dishonesty',
                       'privacy', 'other')),
  details            text check (details is null or length(details) <= 1000),
  status             public.report_status not null default 'pending',
  assigned_to        uuid references public.profiles (id) on delete set null,
  reviewed_by        uuid references public.profiles (id) on delete set null,
  reviewed_at        timestamptz,
  resolution         text check (resolution is null or length(resolution) <= 1000),
  random_session_id  uuid,  -- FK added in 010 once random_sessions exists
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index reports_status_idx on public.reports (status, created_at desc);
create index reports_target_idx on public.reports (target_type, target_id);
create index reports_reporter_idx on public.reports (reporter_id, created_at desc);
create index reports_random_session_idx on public.reports (random_session_id) where random_session_id is not null;
create index reports_open_idx on public.reports (status) where status in ('pending', 'reviewing');

-- One open report per reporter per item: stops report spam without preventing a
-- fresh report after a previous one was resolved or dismissed.
create unique index reports_one_open_per_reporter
  on public.reports (reporter_id, target_type, target_id)
  where status in ('pending', 'reviewing');

create trigger reports_touch before update on public.reports
  for each row execute function public.touch_updated_at();

comment on table public.reports is
  'Central report queue for every reportable entity. Moderators work from this table only.';

-- Does the referenced entity exist, and may the reporter see it? Kept in one
-- plpgsql function so the policy stays readable as modules are added.
create or replace function public.report_target_exists(p_type public.report_target_type, p_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_exists boolean := false;
begin
  if p_id is null then
    return false;
  end if;

  case p_type
    when 'user' then
      v_exists := exists (select 1 from public.profiles p where p.id = p_id and p.username is not null);
    when 'post', 'poll' then
      v_exists := exists (select 1 from public.posts p where p.id = p_id);
    when 'comment' then
      v_exists := exists (select 1 from public.comments c where c.id = p_id);
    when 'community', 'club' then
      v_exists := exists (select 1 from public.communities c where c.id = p_id);
    when 'conversation' then
      v_exists := exists (select 1 from public.conversations c where c.id = p_id);
    when 'message' then
      v_exists := exists (select 1 from public.messages m where m.id = p_id);
    when 'marketplace_listing' then
      v_exists := exists (select 1 from public.marketplace_listings l where l.id = p_id);
    when 'gig' then
      v_exists := exists (select 1 from public.gigs g where g.id = p_id);
    when 'deal' then
      v_exists := exists (select 1 from public.campus_deals d where d.id = p_id);
    when 'event' then
      v_exists := exists (select 1 from public.events e where e.id = p_id);
    when 'resource' then
      v_exists := exists (select 1 from public.official_resources r where r.id = p_id);
    when 'opportunity' then
      v_exists := exists (select 1 from public.opportunities o where o.id = p_id);
    when 'project' then
      v_exists := exists (select 1 from public.projects pr where pr.id = p_id);
    when 'lost_found' then
      v_exists := exists (select 1 from public.lost_found lf where lf.id = p_id);
    when 'housing_post' then
      v_exists := exists (select 1 from public.housing_posts h where h.id = p_id);
    when 'ride_post' then
      v_exists := exists (select 1 from public.ride_posts rp where rp.id = p_id);
    when 'random_session' then
      v_exists := exists (select 1 from public.random_sessions rs where rs.id = p_id);
    else
      v_exists := false;
  end case;

  return v_exists;
end;
$$;

-- ----------------------------------------------------------------------------
-- moderation_actions — one row per explicit staff action (spec §105)
-- ----------------------------------------------------------------------------

create table public.moderation_actions (
  id              uuid primary key default gen_random_uuid(),
  -- Nullable + ON DELETE SET NULL: removing a staff account must not destroy
  -- the moderation history it produced (spec §120).
  moderator_id    uuid references public.profiles (id) on delete set null,
  report_id       uuid references public.reports (id) on delete set null,
  action          text not null check (length(btrim(action)) between 3 and 60),
  target_type     text,
  target_id       uuid,
  previous_status text,
  new_status      text,
  duration_days   integer check (duration_days is null or duration_days between 0 and 3650),
  note            text check (note is null or length(note) <= 1000),
  created_at      timestamptz not null default now()
);

create index moderation_actions_moderator_idx on public.moderation_actions (moderator_id, created_at desc);
create index moderation_actions_target_idx on public.moderation_actions (target_type, target_id);
create index moderation_actions_report_idx on public.moderation_actions (report_id);

-- ----------------------------------------------------------------------------
-- audit_logs — the administrative trail (spec §59)
-- ----------------------------------------------------------------------------

create table public.audit_logs (
  id            uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.profiles (id) on delete set null,
  action        text not null check (length(btrim(action)) between 3 and 80),
  target_type   text,
  target_id     uuid,
  metadata      jsonb,
  visibility    public.moderation_visibility not null default 'staff',
  created_at    timestamptz not null default now()
);

create index audit_logs_created_idx on public.audit_logs (created_at desc);
create index audit_logs_actor_idx on public.audit_logs (actor_user_id, created_at desc);
create index audit_logs_action_idx on public.audit_logs (action, created_at desc);
create index audit_logs_target_idx on public.audit_logs (target_type, target_id);

comment on table public.audit_logs is
  'Append-only administrative trail. Rows are written by log_audit() (definer) so the actor and timestamp cannot be forged.';

-- ----------------------------------------------------------------------------
-- notifications
-- ----------------------------------------------------------------------------

create table public.notifications (
  id             uuid primary key default gen_random_uuid(),
  recipient_id   uuid not null references public.profiles (id) on delete cascade,
  actor_id       uuid references public.profiles (id) on delete set null,
  type           public.notification_type not null,
  title          text not null check (length(btrim(title)) between 1 and 140),
  body           text check (body is null or length(body) <= 500),
  reference_type text check (reference_type is null or length(reference_type) <= 60),
  reference_id   text check (reference_id is null or length(reference_id) <= 80),
  url            text check (url is null or length(url) <= 300),
  read_at        timestamptz,
  created_at     timestamptz not null default now()
);

create index notifications_recipient_idx on public.notifications (recipient_id, created_at desc);
create index notifications_unread_idx on public.notifications (recipient_id) where read_at is null;
create index notifications_actor_idx on public.notifications (actor_id, created_at desc);

comment on table public.notifications is
  'One notification system for the whole product. Rows are created by notify_user(); clients never insert directly.';

-- ----------------------------------------------------------------------------
-- notify_user — the only way a notification row is created
-- ----------------------------------------------------------------------------

create or replace function public.notify_user(
  p_recipient uuid,
  p_type public.notification_type,
  p_title text,
  p_body text default null,
  p_reference_type text default null,
  p_reference_id text default null,
  p_url text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_id uuid;
  v_recent integer;
  v_trusted boolean := public.is_trusted_writer();
begin
  -- Trusted writers (maintenance scripts, scheduled jobs) may send system
  -- notifications without a signed-in actor.
  if v_actor is null and not v_trusted then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_recipient is null or p_recipient = v_actor then
    return null;  -- never notify yourself
  end if;
  if not public.is_active_profile(p_recipient) then
    return null;
  end if;
  if v_actor is not null and public.is_blocked(v_actor, p_recipient) then
    return null;  -- blocked relationships produce no notifications
  end if;
  if not v_trusted then
    -- Staff-only notification types cannot be forged by students.
    if p_type in ('moderation_notice', 'report_result', 'system')
       and not (public.is_staff() or public.has_permission('review_reports')) then
      raise exception 'This notification type is restricted to staff.' using errcode = '42501';
    end if;
    -- Basic flood control: 60 notifications per actor per hour.
    select count(*) into v_recent
    from public.notifications n
    where n.actor_id = v_actor and n.created_at > now() - interval '1 hour';
    if v_recent >= 60 then
      return null;
    end if;
  end if;

  insert into public.notifications (
    recipient_id, actor_id, type, title, body, reference_type, reference_id, url
  ) values (
    p_recipient, v_actor, p_type, left(p_title, 140), left(p_body, 500),
    left(p_reference_type, 60), left(p_reference_id, 80), left(p_url, 300)
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.notify_user is
  'Single entry point for notifications. Filters block relationships, self-notification, inactive recipients and staff-only types.';

-- Mark a notification read (own rows only; enforced by RLS too).
create or replace function public.mark_notification_read(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.notifications
     set read_at = now()
   where id = p_id
     and recipient_id = public.current_profile_id()
     and read_at is null;
  return found;
end;
$$;

create or replace function public.mark_all_notifications_read()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  update public.notifications
     set read_at = now()
   where recipient_id = public.current_profile_id()
     and read_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ----------------------------------------------------------------------------
-- log_audit — the single audit entry point
-- ----------------------------------------------------------------------------

create or replace function public.log_audit(
  p_action text,
  p_target_type text default null,
  p_target_id text default null,
  p_metadata jsonb default null,
  p_also_moderation boolean default false,
  p_reason text default null,
  p_visibility public.moderation_visibility default 'staff'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_id uuid;
  v_is_staff boolean;
begin
  if v_actor is null and not public.is_trusted_writer() then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  v_is_staff := public.is_staff() or public.is_trusted_writer();

  -- Non-staff may only record their own account-lifecycle events, never
  -- moderation or administration entries.
  if not v_is_staff
     and p_action not like 'account.%'
     and p_action not like 'user.%'
     and p_action not like 'content.self_%' then
    raise exception 'You do not have permission to write audit entries.' using errcode = '42501';
  end if;

  insert into public.audit_logs (actor_user_id, action, target_type, target_id, metadata, visibility)
  values (
    v_actor,
    left(p_action, 80),
    left(p_target_type, 60),
    case when p_target_id ~ '^[0-9a-f-]{36}$' then p_target_id::uuid else null end,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'reason', p_reason,
      'actor_username', (select username from public.profiles where id = v_actor)
    ),
    case when v_is_staff then p_visibility else 'private'::public.moderation_visibility end
  )
  returning id into v_id;

  if p_also_moderation and v_is_staff then
    insert into public.moderation_actions (
      moderator_id, report_id, action, target_type, target_id, note
    ) values (
      v_actor,
      nullif(p_metadata->>'report_id', '')::uuid,
      left(p_action, 60),
      left(p_target_type, 60),
      case when p_target_id ~ '^[0-9a-f-]{36}$' then p_target_id::uuid else null end,
      left(p_reason, 1000)
    );
  end if;

  return v_id;
end;
$$;

comment on function public.log_audit is
  'Append-only audit writer. Students are limited to their own account.* / user.* events; moderation entries require staff.';

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------

alter table public.reports enable row level security;
alter table public.moderation_actions enable row level security;
alter table public.audit_logs enable row level security;
alter table public.notifications enable row level security;

-- reports -------------------------------------------------------------------
create policy reports_select_reporter on public.reports
  for select to authenticated using (reporter_id = public.current_profile_id());
create policy reports_select_staff on public.reports
  for select to authenticated
  using (public.has_permission('review_reports') or public.has_permission('moderate_all'));

create policy reports_insert_own on public.reports
  for insert to authenticated
  with check (
    reporter_id = public.current_profile_id()
    and public.is_active_user()
    and public.has_permission('report_content')
    and public.report_target_exists(target_type, target_id)
    -- Nobody may report an entity they cannot see (prevents probing private ids)
    and (
      target_type not in ('post', 'comment', 'user', 'community', 'club')
      or (
        case target_type
          when 'post' then exists (
            select 1 from public.posts p where p.id = target_id
              and p.status = 'published' and not public.is_blocked_with_current(p.author_id))
          when 'comment' then exists (
            select 1 from public.comments c where c.id = target_id
              and c.status = 'published' and not public.is_blocked_with_current(c.author_id))
          when 'user' then exists (
            select 1 from public.profiles p where p.id = target_id and p.username is not null)
          when 'community' then public.can_view_community(target_id)
          when 'club' then public.can_view_community(target_id)
          else true
        end
      )
    )
  );

create policy reports_update_staff on public.reports
  for update to authenticated
  using (public.has_permission('review_reports') or public.has_permission('moderate_all'))
  with check (public.has_permission('review_reports') or public.has_permission('moderate_all'));

create policy reports_delete_admin on public.reports
  for delete to authenticated using (public.has_permission('manage_platform_settings'));

-- moderation_actions --------------------------------------------------------
create policy moderation_actions_select_staff on public.moderation_actions
  for select to authenticated
  using (public.has_permission('view_moderation_logs') or public.has_permission('moderate_all'));
create policy moderation_actions_insert_staff on public.moderation_actions
  for insert to authenticated
  with check (public.has_permission('review_reports') or public.is_staff());

-- audit_logs -----------------------------------------------------------------
create policy audit_logs_select_admin on public.audit_logs
  for select to authenticated
  using (public.has_permission('view_audit_logs') or public.has_permission('moderate_all'));
-- No INSERT/UPDATE/DELETE policies: audit rows are written by log_audit() only,
-- and they are immutable.

-- notifications -------------------------------------------------------------
create policy notifications_select_own on public.notifications
  for select to authenticated using (recipient_id = public.current_profile_id());

-- A user may only toggle `read_at`; the content columns are protected below.
create policy notifications_update_own on public.notifications
  for update to authenticated
  using (recipient_id = public.current_profile_id())
  with check (recipient_id = public.current_profile_id());

create policy notifications_delete_own on public.notifications
  for delete to authenticated using (recipient_id = public.current_profile_id());
-- No INSERT policy: use notify_user().

create or replace function public.guard_notification_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.is_trusted_writer() then
    return new;
  end if;
  new.recipient_id   := old.recipient_id;
  new.actor_id       := old.actor_id;
  new.type           := old.type;
  new.title          := old.title;
  new.body           := old.body;
  new.reference_type := old.reference_type;
  new.reference_id   := old.reference_id;
  new.url            := old.url;
  new.created_at     := old.created_at;
  return new;
end;
$$;

create trigger notifications_guard_update
  before update on public.notifications
  for each row execute function public.guard_notification_update();
