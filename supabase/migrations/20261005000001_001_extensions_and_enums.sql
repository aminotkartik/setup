-- Campus+ migration 001 — extensions and enums
-- Supabase CLI filename: 20261005000001_001_extensions_and_enums.sql
-- This file is part of the single authoritative migration history in supabase/migrations/.
-- =============================================================================
-- Campus+ 001 — extensions, controlled vocabularies, shared conventions
-- =============================================================================
-- Conventions used by every later migration:
--   * uuid primary keys, `gen_random_uuid()` defaults
--   * `created_at` / `updated_at` timestamptz not null default now()
--   * `updated_at` maintained by the `public.touch_updated_at()` trigger
--   * every exposed table has RLS enabled with explicit policies
--   * helper functions live in `public`, are STABLE and set `search_path`
--   * authorization is expressed once (has_permission / has_role) and reused
-- =============================================================================

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- ----------------------------------------------------------------------------
-- Controlled vocabularies
-- ----------------------------------------------------------------------------

create type public.account_status as enum
  ('pending', 'active', 'suspended', 'banned', 'deactivated', 'deleted');

create type public.content_status as enum
  ('draft', 'pending', 'published', 'hidden', 'removed', 'archived', 'deleted');

create type public.visibility_level as enum
  ('public', 'campus', 'community', 'private');

create type public.community_kind as enum
  ('community', 'study_group', 'club');

create type public.community_role as enum
  ('owner', 'moderator', 'member');

create type public.join_request_status as enum
  ('pending', 'approved', 'rejected', 'cancelled');

create type public.conversation_kind as enum
  ('direct', 'group');

create type public.report_status as enum
  ('pending', 'reviewing', 'resolved', 'dismissed');

create type public.report_target_type as enum
  ('user', 'post', 'comment', 'message', 'conversation', 'community',
   'marketplace_listing', 'gig', 'deal', 'event', 'club', 'resource',
   'opportunity', 'project', 'lost_found', 'housing_post', 'ride_post',
   'random_session', 'poll');

create type public.moderation_visibility as enum
  ('staff', 'admin', 'private');

create type public.listing_status as enum
  ('pending', 'active', 'reserved', 'sold', 'hidden', 'removed', 'rejected', 'expired');

create type public.item_condition as enum
  ('new', 'like_new', 'good', 'fair', 'used', 'for_parts', 'not_applicable');

create type public.event_status as enum
  ('draft', 'published', 'cancelled', 'completed', 'archived');

create type public.rsvp_status as enum
  ('going', 'interested', 'not_going', 'waitlist');

create type public.random_queue_status as enum
  ('waiting', 'matched', 'cancelled', 'expired');

create type public.random_session_status as enum
  ('active', 'ended', 'reported', 'expired', 'cancelled');

create type public.opportunity_source as enum
  ('official', 'community');

create type public.notice_category as enum
  ('important', 'academic', 'event', 'opportunity', 'general');

create type public.lost_found_kind as enum
  ('lost', 'found');

create type public.rating_role as enum
  ('buyer', 'seller');

create type public.notification_type as enum
  ('dm_new', 'mention', 'comment', 'reply', 'reaction',
   'marketplace_message', 'marketplace_status', 'marketplace_rating',
   'event_update', 'event_reminder', 'community_activity', 'club_activity',
   'moderation_notice', 'report_result', 'system');

create type public.room_type as enum
  ('single', 'shared', 'pg', 'flat', 'hostel', 'other');

create type public.reaction_kind as enum
  ('like', 'helpful', 'insightful', 'celebrate', 'thanks');

create type public.post_kind as enum
  ('post', 'discussion', 'poll');

-- ----------------------------------------------------------------------------
-- Shared trigger: keep updated_at honest
-- ----------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.touch_updated_at() is
  'BEFORE UPDATE trigger that stamps updated_at. Attached to every mutable table.';
