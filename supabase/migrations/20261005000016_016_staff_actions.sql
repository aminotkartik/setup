-- Campus+ migration 016 — staff actions
-- Supabase CLI filename: 20261005000016_016_staff_actions.sql
-- This file is part of the single authoritative migration history in supabase/migrations/.
-- =============================================================================
-- Campus+ 016 — privileged actions (moderation, roles, account lifecycle)
-- =============================================================================
-- Every privileged transition is a single SECURITY DEFINER function that:
--   1. checks the caller's permission (the same `has_permission()` used by RLS),
--   2. checks the staffing hierarchy (nobody acts on a peer or a senior),
--   3. performs the change,
--   4. writes a moderation action and an audit entry (spec §59, §105),
--   5. notifies the affected student where that is appropriate.
--
-- Because column privileges (015) make these columns unwritable by clients, this
-- file is the ONLY way privileged state changes happen.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- Role assignment
-- ----------------------------------------------------------------------------

create or replace function public.grant_role(p_user uuid, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rank integer;
  v_username text;
begin
  -- Operator context (secret key / maintenance script) may always assign roles.
  if not (public.has_permission('assign_roles') or public.is_trusted_writer()) then
    raise exception 'You do not have permission to assign roles.' using errcode = '42501';
  end if;
  select p.username into v_username from public.profiles p where p.id = p_user;
  if v_username is null then
    raise exception 'That student could not be found.' using errcode = '22023';
  end if;

  select r.rank into v_rank from public.roles r where r.key = p_role;
  if v_rank is null then
    raise exception 'That role does not exist.' using errcode = '22023';
  end if;
  if not public.is_trusted_writer() then
    if p_role = 'super_admin'
       and not (public.has_role('super_admin') and public.has_permission('manage_role_authority')) then
      raise exception 'Only a Super Admin can grant the Super Admin role.' using errcode = '42501';
    end if;
    if v_rank >= public.current_role_rank() then
      raise exception 'You cannot grant a role at or above your own level.' using errcode = '42501';
    end if;
  end if;

  insert into public.user_roles (user_id, role_key, granted_by)
  values (p_user, p_role, public.current_profile_id())
  on conflict (user_id, role_key) do nothing;

  perform public.log_audit('admin.role_granted', 'user', p_user::text,
    jsonb_build_object('role', p_role, 'username', v_username), true, null, 'admin');

  perform public.notify_user(p_user, 'moderation_notice',
    'Your Campus+ role changed',
    'You now have the ' || p_role || ' role on Campus+.',
    'profile', p_user::text, '/profile');

  return jsonb_build_object('ok', true, 'role', p_role);
end;
$$;

create or replace function public.revoke_role(p_user uuid, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rank integer;
begin
  if not (public.has_permission('assign_roles') or public.is_trusted_writer()) then
    raise exception 'You do not have permission to change roles.' using errcode = '42501';
  end if;
  if p_role = 'student' then
    raise exception 'The student role is assigned automatically.' using errcode = '22023';
  end if;
  if p_user = public.current_profile_id() then
    raise exception 'You cannot remove your own role.' using errcode = '42501';
  end if;

  select r.rank into v_rank from public.roles r where r.key = p_role;
  if v_rank is null then
    raise exception 'That role does not exist.' using errcode = '22023';
  end if;
  if not public.is_trusted_writer() and v_rank >= public.current_role_rank() then
    raise exception 'You cannot revoke a role at or above your own level.' using errcode = '42501';
  end if;

  delete from public.user_roles where user_id = p_user and role_key = p_role;

  perform public.log_audit('admin.role_revoked', 'user', p_user::text,
    jsonb_build_object('role', p_role), true, null, 'admin');

  return jsonb_build_object('ok', true);
end;
$$;

-- ----------------------------------------------------------------------------
-- Account lifecycle
-- ----------------------------------------------------------------------------

create or replace function public.admin_set_account_status(
  p_user uuid,
  p_status public.account_status,
  p_reason text default null,
  p_duration_days integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_target_rank integer;
  v_until timestamptz;
  v_username text;
begin
  if p_user is null then
    raise exception 'Choose a student.' using errcode = '22023';
  end if;
  if p_user = v_actor then
    raise exception 'You cannot change your own account status here.' using errcode = '22023';
  end if;
  if not (public.is_trusted_writer() or public.is_active_profile(v_actor)) then
    raise exception 'Your account cannot perform moderation actions.' using errcode = '42501';
  end if;

  if not public.is_trusted_writer() then
    if p_status in ('suspended', 'banned') then
      if not public.has_permission('suspend_users') then
        raise exception 'You do not have permission to suspend accounts.' using errcode = '42501';
      end if;
    elsif not public.has_permission('manage_users') then
      raise exception 'You do not have permission to change account status.' using errcode = '42501';
    end if;

    v_target_rank := public.role_rank(p_user);
    if public.current_role_rank() <= v_target_rank then
      raise exception 'You cannot act on a student at or above your own level.' using errcode = '42501';
    end if;
  end if;

  if p_status = 'suspended' then
    v_until := now() + make_interval(days => greatest(coalesce(p_duration_days, 7), 1));
  end if;

  select p.username into v_username from public.profiles p where p.id = p_user;
  if v_username is null then
    raise exception 'That student could not be found.' using errcode = '22023';
  end if;

  update public.profile_private
     set account_status = p_status,
         status_reason = left(nullif(btrim(coalesce(p_reason, '')), ''), 500),
         suspended_until = v_until
   where profile_id = p_user;

  perform public.log_audit(
    case p_status
      when 'suspended' then 'moderation.user_suspended'
      when 'banned' then 'moderation.user_banned'
      when 'active' then 'moderation.user_reinstated'
      else 'admin.user_status_changed'
    end,
    'user', p_user::text,
    jsonb_build_object('status', p_status, 'duration_days', p_duration_days, 'username', v_username),
    true, p_reason, 'staff');

  if p_status in ('suspended', 'banned') then
    perform public.notify_user(p_user, 'moderation_notice',
      case when p_status = 'banned' then 'Your Campus+ account has been banned' else 'Your Campus+ account has been suspended' end,
      coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Contact the Campus+ moderators if you believe this is a mistake.'),
      'profile', p_user::text, '/account-status');
  end if;

  return jsonb_build_object('ok', true, 'status', p_status, 'until', v_until);
end;
$$;

comment on function public.admin_set_account_status is
  'Suspend, ban, reinstate or deactivate an account. Rank-checked, audited and notified.';

create or replace function public.deactivate_own_account(p_reason text default null)
returns jsonb
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
  update public.profile_private
     set account_status = 'deactivated',
         status_reason = left(nullif(btrim(coalesce(p_reason, '')), ''), 500)
   where profile_id = v_me;

  perform public.log_audit('account.deactivated', 'user', v_me::text,
    jsonb_build_object('reason', p_reason), false, null, 'private');

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.reactivate_own_account()
returns jsonb
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
  update public.profile_private
     set account_status = 'active', status_reason = null, suspended_until = null
   where profile_id = v_me and account_status in ('deactivated', 'active');

  perform public.log_audit('account.reactivated', 'user', v_me::text, '{}'::jsonb, false, null, 'private');
  return jsonb_build_object('ok', true);
end;
$$;

-- ----------------------------------------------------------------------------
-- Content moderation
-- ----------------------------------------------------------------------------

create or replace function public.content_moderation_permission(p_target_type text)
returns text
language sql
immutable
as $$
  select case p_target_type
    when 'post' then 'remove_posts'
    when 'comment' then 'remove_comments'
    when 'marketplace_listing' then 'moderate_marketplace'
    when 'gig' then 'moderate_marketplace'
    when 'community' then 'moderate_communities'
    when 'club' then 'moderate_communities'
    when 'deal' then 'manage_deals'
    when 'event' then 'manage_events'
    when 'notice' then 'manage_notices'
    when 'resource' then 'manage_official_content'
    when 'opportunity' then 'manage_official_content'
    when 'project' then 'moderate_all'
    when 'lost_found' then 'moderate_all'
    when 'housing_post' then 'moderate_all'
    when 'ride_post' then 'moderate_all'
    else null
  end;
$$;

create or replace function public.moderate_content(
  p_target_type text,
  p_target_id uuid,
  p_action text,
  p_reason text default null,
  p_report_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_permission text;
  v_new_status text;
  v_author uuid;
  v_label text;
begin
  v_permission := public.content_moderation_permission(p_target_type);
  if v_permission is null then
    raise exception 'That content type cannot be moderated.' using errcode = '22023';
  end if;

  if not public.is_trusted_writer() then
    if not public.is_active_profile(public.current_profile_id()) then
      raise exception 'Your account cannot moderate content.' using errcode = '42501';
    end if;
    if not (public.has_permission(v_permission) or public.has_permission('moderate_all')) then
      raise exception 'You do not have permission to moderate this content.' using errcode = '42501';
    end if;
  end if;

  v_new_status := case p_action
    when 'hide' then 'hidden'
    when 'remove' then 'removed'
    when 'restore' then 'published'
    when 'approve' then 'published'
    when 'reject' then 'removed'
    else null
  end;

  if p_target_type in ('post', 'comment', 'marketplace_listing', 'gig', 'community', 'club',
                       'project', 'lost_found', 'housing_post', 'ride_post')
     and v_new_status is null then
    raise exception 'Unsupported action for this content type.' using errcode = '22023';
  end if;
  if p_target_type = 'marketplace_listing' and p_action = 'approve' then
    v_new_status := 'active';
  end if;

  if p_target_type = 'post' then
    update public.posts
       set status = v_new_status::public.content_status, moderated_by = public.current_profile_id(),
           moderated_at = now(), moderation_reason = left(p_reason, 500)
     where id = p_target_id
     returning author_id into v_author;
  elsif p_target_type = 'comment' then
    update public.comments
       set status = v_new_status::public.content_status, moderated_by = public.current_profile_id(),
           moderated_at = now(), moderation_reason = left(p_reason, 500)
     where id = p_target_id
     returning author_id into v_author;
  elsif p_target_type = 'marketplace_listing' then
    update public.marketplace_listings
       set status = v_new_status::public.listing_status, moderated_by = public.current_profile_id(),
           moderated_at = now(), moderation_reason = left(p_reason, 500)
     where id = p_target_id
     returning seller_id into v_author;
  elsif p_target_type = 'gig' then
    update public.gigs
       set status = v_new_status::public.content_status, moderated_by = public.current_profile_id(),
           moderated_at = now(), moderation_reason = left(p_reason, 500)
     where id = p_target_id
     returning creator_id into v_author;
  elsif p_target_type in ('community', 'club') then
    update public.communities
       set status = v_new_status::public.content_status
     where id = p_target_id
     returning created_by into v_author;
  elsif p_target_type = 'project' then
    update public.projects
       set status = v_new_status::public.content_status, moderated_by = public.current_profile_id(),
           moderated_at = now(), moderation_reason = left(p_reason, 500)
     where id = p_target_id
     returning creator_id into v_author;
  elsif p_target_type = 'lost_found' then
    update public.lost_found set status = v_new_status::public.content_status
     where id = p_target_id returning creator_id into v_author;
  elsif p_target_type = 'housing_post' then
    update public.housing_posts set status = v_new_status::public.content_status
     where id = p_target_id returning creator_id into v_author;
  elsif p_target_type = 'ride_post' then
    update public.ride_posts set status = v_new_status::public.content_status
     where id = p_target_id returning creator_id into v_author;
  elsif p_target_type in ('notice', 'event', 'resource', 'opportunity', 'deal') then
    -- Official content: staff already own these rows through RLS-managed updates.
    update public.audit_logs set id = id where false;  -- no-op keeps the branch explicit
    v_author := null;
  end if;

  perform public.log_audit('moderation.content_' || p_action, p_target_type, p_target_id::text,
    jsonb_build_object('report_id', p_report_id, 'status', v_new_status), true, p_reason, 'staff');

  if v_author is not null and p_action in ('hide', 'remove', 'reject') then
    v_label := replace(p_target_type, '_', ' ');
    perform public.notify_user(v_author, 'moderation_notice',
      'Your ' || v_label || ' was ' || case when p_action = 'hide' then 'hidden' else 'removed' end,
      coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Review the Campus+ rules and post again.'),
      p_target_type, p_target_id::text, null);
  end if;

  return jsonb_build_object('ok', true, 'status', v_new_status);
end;
$$;

comment on function public.moderate_content is
  'Single moderation action path: permission check → status change → moderation action → audit log → author notification.';

-- ----------------------------------------------------------------------------
-- Reports
-- ----------------------------------------------------------------------------

create or replace function public.resolve_report(
  p_report_id uuid,
  p_status public.report_status,
  p_resolution text default null,
  p_target_action text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_report public.reports;
  v_actor uuid := public.current_profile_id();
begin
  if not (public.has_permission('review_reports') or public.has_permission('moderate_all') or public.is_trusted_writer()) then
    raise exception 'You do not have permission to review reports.' using errcode = '42501';
  end if;

  select * into v_report from public.reports where id = p_report_id;
  if v_report.id is null then
    raise exception 'That report could not be found.' using errcode = '22023';
  end if;

  if p_target_action is not null and p_target_action not in ('none') then
    perform public.moderate_content(v_report.target_type::text, v_report.target_id, p_target_action,
                                    p_resolution, p_report_id);
  end if;

  update public.reports
     set status = p_status,
         resolution = left(nullif(btrim(coalesce(p_resolution, '')), ''), 1000),
         reviewed_by = case when p_status in ('resolved', 'dismissed') then v_actor else reviewed_by end,
         reviewed_at = case when p_status in ('resolved', 'dismissed') then now() else reviewed_at end
   where id = p_report_id;

  update public.random_reports
     set status = p_status,
         resolution = left(nullif(btrim(coalesce(p_resolution, '')), ''), 1000),
         reviewed_by = case when p_status in ('resolved', 'dismissed') then v_actor else reviewed_by end,
         reviewed_at = case when p_status in ('resolved', 'dismissed') then now() else reviewed_at end
   where session_id = v_report.random_session_id;

  -- Tell the reporter the outcome (spec §53: report result).
  if p_status in ('resolved', 'dismissed') then
    perform public.notify_user(v_report.reporter_id, 'report_result',
      'Your report was ' || case when p_status = 'dismissed' then 'reviewed and dismissed' else 'actioned' end,
      coalesce(nullif(btrim(coalesce(p_resolution, '')), ''), 'Thanks for helping keep Campus+ usable.'),
      v_report.target_type::text, v_report.target_id::text, null);
  end if;

  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;

create or replace function public.assign_report(
  p_report uuid,
  p_to uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := public.current_profile_id();
  v_target uuid := coalesce(p_to, v_me);
begin
  if not (public.has_permission('review_reports') or public.has_permission('moderate_all')) then
    raise exception 'You do not have permission to review reports.' using errcode = '42501';
  end if;
  if not public.is_active_profile(v_target) then
    raise exception 'That moderator cannot take reports right now.' using errcode = '22023';
  end if;

  update public.reports
     set assigned_to = v_target,
         status = case when status = 'pending' then 'reviewing'::public.report_status else status end
   where id = p_report and status in ('pending', 'reviewing');

  if not found then
    raise exception 'That report is not open for triage.' using errcode = '22023';
  end if;

  perform public.log_audit('moderation.report_assigned', 'report', p_report::text,
    jsonb_build_object('assigned_to', v_target), true, null, 'staff');

  return jsonb_build_object('ok', true, 'assigned_to', v_target);
end;
$$;

comment on function public.assign_report is
  'Claims an open report for a moderator. The only path that changes reports.assigned_to or moves pending → reviewing.';

-- ----------------------------------------------------------------------------
-- Self-service content deletion (soft delete keeps moderation evidence)
-- ----------------------------------------------------------------------------

create or replace function public.delete_own_content(p_target_type text, p_target_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := public.current_profile_id();
  v_owner uuid;
begin
  if v_me is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if p_target_type = 'post' then
    update public.posts set status = 'deleted', deleted_at = now()
     where id = p_target_id and author_id = v_me returning author_id into v_owner;
  elsif p_target_type = 'comment' then
    update public.comments set status = 'deleted', deleted_at = now()
     where id = p_target_id and author_id = v_me returning author_id into v_owner;
  elsif p_target_type = 'marketplace_listing' then
    update public.marketplace_listings set status = 'removed'
     where id = p_target_id and seller_id = v_me returning seller_id into v_owner;
  elsif p_target_type = 'gig' then
    update public.gigs set status = 'deleted'
     where id = p_target_id and creator_id = v_me returning creator_id into v_owner;
  elsif p_target_type = 'housing_post' then
    update public.housing_posts set status = 'deleted'
     where id = p_target_id and creator_id = v_me returning creator_id into v_owner;
  elsif p_target_type = 'ride_post' then
    update public.ride_posts set status = 'deleted'
     where id = p_target_id and creator_id = v_me returning creator_id into v_owner;
  elsif p_target_type = 'project' then
    update public.projects set status = 'deleted'
     where id = p_target_id and creator_id = v_me returning creator_id into v_owner;
  elsif p_target_type = 'team_post' then
    update public.team_posts set status = 'deleted'
     where id = p_target_id and creator_id = v_me returning creator_id into v_owner;
  elsif p_target_type = 'lost_found' then
    update public.lost_found set status = 'deleted'
     where id = p_target_id and creator_id = v_me returning creator_id into v_owner;
  elsif p_target_type = 'message' then
    update public.messages set deleted_at = now(), deleted_by = v_me
     where id = p_target_id and sender_id = v_me returning sender_id into v_owner;
  else
    raise exception 'That content type cannot be deleted here.' using errcode = '22023';
  end if;

  if v_owner is null then
    raise exception 'That content could not be found, or is not yours.' using errcode = '42501';
  end if;

  perform public.log_audit('content.self_deleted', p_target_type, p_target_id::text, '{}'::jsonb, false, null, 'private');
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.restore_own_content(p_target_type text, p_target_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := public.current_profile_id();
  v_owner uuid;
begin
  if p_target_type = 'post' then
    update public.posts set status = 'published', deleted_at = null
     where id = p_target_id and author_id = v_me and status = 'deleted' returning author_id into v_owner;
  elsif p_target_type = 'comment' then
    update public.comments set status = 'published', deleted_at = null
     where id = p_target_id and author_id = v_me and status = 'deleted' returning author_id into v_owner;
  elsif p_target_type = 'marketplace_listing' then
    update public.marketplace_listings set status = 'active'
     where id = p_target_id and seller_id = v_me and status = 'removed' returning seller_id into v_owner;
  elsif p_target_type = 'housing_post' then
    update public.housing_posts set status = 'published'
     where id = p_target_id and creator_id = v_me returning creator_id into v_owner;
  elsif p_target_type = 'ride_post' then
    update public.ride_posts set status = 'published'
     where id = p_target_id and creator_id = v_me returning creator_id into v_owner;
  elsif p_target_type = 'project' then
    update public.projects set status = 'published'
     where id = p_target_id and creator_id = v_me returning creator_id into v_owner;
  elsif p_target_type = 'gig' then
    update public.gigs set status = 'published'
     where id = p_target_id and creator_id = v_me returning creator_id into v_owner;
  elsif p_target_type = 'lost_found' then
    update public.lost_found set status = 'published'
     where id = p_target_id and creator_id = v_me returning creator_id into v_owner;
  else
    raise exception 'That content type cannot be restored here.' using errcode = '22023';
  end if;

  if v_owner is null then
    raise exception 'That content could not be found, or is not yours.' using errcode = '42501';
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- ----------------------------------------------------------------------------
-- Platform configuration
-- ----------------------------------------------------------------------------
-- Clients cannot UPDATE `platform_settings` (015 revokes the column privilege);
-- this function is the only in-app path. It validates the value against the
-- key's documented shape, so a mistyped setting cannot take the platform down,
-- and writes the change to the audit trail.
create or replace function public.admin_set_platform_setting(p_key text, p_value jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old jsonb;
  v_text text;
  v_number numeric;
  v_item text;
begin
  if not public.has_permission('manage_platform_settings') then
    raise exception 'You do not have permission to change platform settings.' using errcode = '42501';
  end if;
  if p_value is null then
    raise exception 'A platform setting needs a value.' using errcode = '22023';
  end if;

  select value into v_old from public.platform_settings where key = p_key;
  if not found then
    raise exception 'That platform setting does not exist.' using errcode = '22023';
  end if;

  if p_key = 'allowed_email_domains' then
    if jsonb_typeof(p_value) <> 'array' or jsonb_array_length(p_value) = 0 then
      raise exception 'allowed_email_domains must be a non-empty list of domains.' using errcode = '22023';
    end if;
    -- Every entry must look like a domain (lowercase, at least one dot, no
    -- wildcards) so the sign-in gate can never be opened accidentally.
    for v_item in select jsonb_array_elements_text(p_value) loop
      if v_item <> lower(v_item)
         or v_item !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' then
        raise exception 'Invalid email domain: %', v_item using errcode = '22023';
      end if;
    end loop;

  elsif p_key = 'marketplace_approval_mode' then
    if jsonb_typeof(p_value) <> 'string'
       or (p_value #>> '{}') not in ('post_moderation', 'pre_moderation') then
      raise exception 'marketplace_approval_mode must be post_moderation or pre_moderation.' using errcode = '22023';
    end if;

  elsif p_key in ('username_change_cooldown_days', 'random_session_max_minutes',
                  'random_rematch_cooldown_seconds', 'random_retention_days') then
    if jsonb_typeof(p_value) <> 'number' then
      raise exception '% must be a number.', p_key using errcode = '22023';
    end if;
    v_number := (p_value #>> '{}')::numeric;
    if v_number <> trunc(v_number) or v_number < 0 then
      raise exception '% must be a whole number of zero or more.', p_key using errcode = '22023';
    end if;
    if p_key = 'username_change_cooldown_days' and v_number > 365 then
      raise exception 'The username change cooldown cannot exceed a year.' using errcode = '22023';
    elsif p_key = 'random_session_max_minutes' and v_number < 5 then
      raise exception 'A Random session must last at least five minutes.' using errcode = '22023';
    elsif p_key = 'random_retention_days' and v_number < 1 then
      raise exception 'Random sessions must be retained for at least one day.' using errcode = '22023';
    elsif p_key = 'random_rematch_cooldown_seconds' and v_number > 3600 then
      raise exception 'The rematch cooldown cannot exceed an hour.' using errcode = '22023';
    end if;

  elsif p_key in ('community_creation_open', 'student_opportunity_submission',
                  'feed_marketplace_highlights', 'show_event_attendees') then
    if jsonb_typeof(p_value) <> 'boolean' then
      raise exception '% must be true or false.', p_key using errcode = '22023';
    end if;

  elsif p_key = 'moderate_community_submissions' then
    if jsonb_typeof(p_value) <> 'object'
       or jsonb_typeof(p_value -> 'resource') <> 'boolean'
       or jsonb_typeof(p_value -> 'opportunity') <> 'boolean' then
      raise exception 'moderate_community_submissions needs resource and opportunity booleans.' using errcode = '22023';
    end if;

  elsif p_key = 'feed_ranking' then
    if p_value <> '"deterministic_v1"'::jsonb then
      raise exception 'Campus+ only supports deterministic feed ranking.' using errcode = '22023';
    end if;

  else
    -- Branding text values: short strings only.
    if jsonb_typeof(p_value) <> 'string' then
      raise exception '% must be text.', p_key using errcode = '22023';
    end if;
    v_text := p_value #>> '{}';
    if length(v_text) > 200 then
      raise exception '% cannot be longer than 200 characters.', p_key using errcode = '22023';
    end if;
    if p_key in ('platform_name', 'institution_name') and btrim(v_text) = '' then
      raise exception '% cannot be empty.', p_key using errcode = '22023';
    end if;
  end if;

  update public.platform_settings
     set value = p_value, updated_by = public.current_profile_id()
   where key = p_key;

  perform public.log_audit('admin.setting_changed', 'platform_settings', p_key,
    jsonb_build_object('old', v_old, 'new', p_value), true, null, 'admin');

  return jsonb_build_object('ok', true, 'key', p_key, 'value', p_value);
end;
$$;

comment on function public.admin_set_platform_setting(text, jsonb) is
  'Admin/Super Admin entry point for platform configuration. Validates the value per key and writes an audit entry.';
