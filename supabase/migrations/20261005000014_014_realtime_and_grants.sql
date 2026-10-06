-- Campus+ migration 014 — realtime and grants
-- Supabase CLI filename: 20261005000014_014_realtime_and_grants.sql
-- This file is part of the single authoritative migration history in supabase/migrations/.
-- =============================================================================
-- Campus+ 014 — realtime authorization and API grants
-- =============================================================================
-- Messaging strategy (spec §23):
--
--   DMs / group chat → Postgres Changes on `messages`, `conversations` and
--     `message_reads`. Realtime applies the table's RLS policies per subscriber,
--     so a student can only ever receive rows they are allowed to SELECT.
--
--   Random → Private Broadcast channels, because the `random_messages` table is
--     deliberately NOT readable by participants. Channel authorization is the
--     `realtime.messages` policy below, which requires session membership.
--
--   Notifications → Postgres Changes on `notifications` (own rows only).
--
-- No Socket.io, no custom WebSocket server, no presence (spec §90, §102).
-- =============================================================================

-- ----------------------------------------------------------------------------
-- Safe uuid parsing for channel topics
-- ----------------------------------------------------------------------------

create or replace function public.safe_uuid(p_value text)
returns uuid
language plpgsql
immutable
as $$
begin
  return p_value::uuid;
exception when others then
  return null;
end;
$$;

comment on function public.safe_uuid(text) is
  'Casts a topic fragment to uuid without raising. Used by realtime channel authorization.';

-- ----------------------------------------------------------------------------
-- Realtime publication
-- ----------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.messages;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.conversations;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.message_reads;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.notifications;
    exception when duplicate_object then null;
    end;
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- Private channel authorization (realtime.messages policies)
-- ----------------------------------------------------------------------------
-- Topics used by the application:
--   conversation:<conversation uuid>  — DM / group chat rooms
--   random:<session uuid>             — anonymous Random rooms
--   user:<profile uuid>               — per-user fan-out (notification badges)

do $$
begin
  if to_regclass('realtime.messages') is null then
    raise notice 'realtime.messages not present (plain Postgres). Skipping channel policies.';
    return;
  end if;

  -- Read (subscribe/receive)
  execute $policy$
    drop policy if exists campus_channels_read on realtime.messages;
  $policy$;
  execute $policy$
    create policy campus_channels_read on realtime.messages
      for select to authenticated
      using (
        case split_part(realtime.topic(), ':', 1)
          when 'conversation' then
            public.can_access_conversation(public.safe_uuid(split_part(realtime.topic(), ':', 2)))
          when 'random' then
            public.can_access_random_session(public.safe_uuid(split_part(realtime.topic(), ':', 2)))
          when 'user' then
            public.safe_uuid(split_part(realtime.topic(), ':', 2)) = public.current_profile_id()
          else false
        end
      );
  $policy$;

  -- Write (broadcast/send)
  execute $policy$
    drop policy if exists campus_channels_write on realtime.messages;
  $policy$;
  execute $policy$
    create policy campus_channels_write on realtime.messages
      for insert to authenticated
      with check (
        case split_part(realtime.topic(), ':', 1)
          when 'conversation' then
            public.can_access_conversation(public.safe_uuid(split_part(realtime.topic(), ':', 2)))
          when 'random' then
            public.can_access_random_session(public.safe_uuid(split_part(realtime.topic(), ':', 2)))
          when 'user' then
            public.safe_uuid(split_part(realtime.topic(), ':', 2)) = public.current_profile_id()
          else false
        end
      );
  $policy$;
end;
$$;

-- ----------------------------------------------------------------------------
-- Grants — least privilege for the two API roles
-- ----------------------------------------------------------------------------
-- `anon` keeps no access to Campus+ data: every policy in this schema targets
-- `authenticated`. These statements are belt-and-braces on top of that.

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'colleges', 'profiles', 'profile_private', 'username_history', 'roles', 'permissions',
    'role_permissions', 'user_roles', 'blocks', 'mutes', 'communities', 'community_members',
    'community_join_requests', 'posts', 'comments', 'reactions', 'mentions', 'poll_options',
    'poll_votes', 'conversations', 'conversation_members', 'messages', 'message_edits',
    'message_reads', 'marketplace_categories', 'marketplace_listings', 'marketplace_interactions',
    'gigs', 'campus_deals', 'ratings', 'events', 'event_registrations', 'notices',
    'campus_locations', 'campus_services', 'transport_information', 'cafeteria_information',
    'academic_calendar', 'official_links', 'help_contacts', 'official_resources',
    'opportunities', 'lost_found', 'housing_posts', 'ride_posts', 'projects', 'team_posts',
    'team_post_requests', 'achievements', 'user_achievements', 'random_queue', 'random_sessions',
    'random_session_participants', 'random_messages', 'random_reports', 'reports',
    'moderation_actions', 'audit_logs', 'notifications', 'platform_settings', 'feature_flags',
    'reserved_usernames'
  ]
  loop
    execute format('revoke all on public.%I from anon', v_table);
  end loop;
end;
$$;

grant select on public.public_profiles to authenticated;
grant select on public.random_session_view to authenticated;
grant select on public.random_messages_view to authenticated;

-- ----------------------------------------------------------------------------
-- RPC surface — explicitly granted, explicitly revoked from anon
-- ----------------------------------------------------------------------------

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.consume_rate_limit(text, text, integer, integer)',
    'public.notify_user(uuid, public.notification_type, text, text, text, text, text)',
    'public.mark_notification_read(uuid)',
    'public.mark_all_notifications_read()',
    'public.log_audit(text, text, text, jsonb, boolean, text, public.moderation_visibility)',
    'public.record_mentions(text, uuid, text[])',
    'public.global_search(text, text, integer, integer)',
    'public.trending_posts(integer, integer)',
    'public.campus_feed(integer, integer, text)',
    'public.evaluate_achievements(uuid)',
    'public.get_or_create_direct_conversation(uuid)',
    'public.mark_conversation_read(uuid)',
    'public.can_access_conversation(uuid, uuid)',
    'public.conversation_member_ids(uuid)',
    'public.open_community_chat(uuid)',
    'public.join_random_queue()',
    'public.leave_random_queue()',
    'public.random_queue_state()',
    'public.random_session_state(uuid)',
    'public.send_random_message(uuid, text, jsonb)',
    'public.report_random_session(uuid, text, text)',
    'public.end_random_session(uuid, text)',
    'public.sweep_random_state()',
    'public.purge_random_data(integer)',
    'public.complete_profile(text, text, text, text, text, text, boolean)',
    'public.change_username(text)',
    'public.username_change_available_at()',
    'public.touch_last_seen()',
    'public.lift_expired_suspensions()',
    'public.is_blocked(uuid, uuid)',
    'public.feature_enabled(text)',
    'public.setting(text, jsonb)',
    'public.setting_int(text, integer)'
  ]
  loop
    execute format('grant execute on function %s to authenticated', v_fn);
    execute format('revoke execute on function %s from anon', v_fn);
  end loop;
end;
$$;
