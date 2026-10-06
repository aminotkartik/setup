-- Campus+ migration 015 — column privileges
-- Supabase CLI filename: 20261005000015_015_column_privileges.sql
-- This file is part of the single authoritative migration history in supabase/migrations/.
-- =============================================================================
-- Campus+ 015 — field-level write control (column privileges)
-- =============================================================================
-- Row Level Security answers "whose rows may I touch?". Column privileges answer
-- "which fields may I write?" — and PostgreSQL enforces them before RLS or any
-- trigger runs, so a student who PATCHes `account_status`, `is_official`,
-- `reputation_score`, `status` or a counter receives a permission error.
--
-- Privileged transitions (suspend an account, hide a post, mark a listing
-- removed, award achievements) are performed by SECURITY DEFINER functions in
-- migration 016 — one explicit, audited code path each.
--
-- The `authenticated` role keeps full INSERT/SELECT/DELETE where the policies
-- allow it; only UPDATE is narrowed here.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- identity
-- ---------------------------------------------------------------------------

revoke update on public.profiles from authenticated, anon;
grant update (display_name, bio, branch, year, division, show_branch_year, allow_dms_from_everyone)
  on public.profiles to authenticated;

-- Private identity is never client-writable: onboarding and account lifecycle
-- changes run through complete_profile() / admin_set_account_status().
revoke update on public.profile_private from authenticated, anon;

-- ---------------------------------------------------------------------------
-- social
-- ---------------------------------------------------------------------------

revoke update on public.posts from authenticated, anon;
grant update (body, title, gif, visibility) on public.posts to authenticated;

revoke update on public.comments from authenticated, anon;
grant update (body, gif) on public.comments to authenticated;

revoke update on public.reactions from authenticated, anon;
grant update (kind) on public.reactions to authenticated;

-- Poll options are immutable once published: a poll must not be rewritten after
-- students have voted (edit the poll by closing it and posting a new one).
revoke update on public.poll_options from authenticated, anon;

-- ---------------------------------------------------------------------------
-- communities
-- ---------------------------------------------------------------------------

revoke update on public.communities from authenticated, anon;
grant update (name, description, subject, branch, year, meeting_info,
              recruitment_info, contact_info, external_url, visibility, join_policy)
  on public.communities to authenticated;

revoke update on public.community_members from authenticated, anon;
grant update (role, status) on public.community_members to authenticated;

revoke update on public.community_join_requests from authenticated, anon;
grant update (status, decided_by, decided_at) on public.community_join_requests to authenticated;

-- ---------------------------------------------------------------------------
-- messaging
-- ---------------------------------------------------------------------------

-- A conversation's own fields (title, status, membership bookkeeping) are
-- maintained by the database; members never patch a thread directly.
revoke update on public.conversations from authenticated, anon;

revoke update on public.conversation_members from authenticated, anon;
grant update (last_read_at, last_read_message_id, is_muted) on public.conversation_members to authenticated;

revoke update on public.messages from authenticated, anon;
grant update (body, gif) on public.messages to authenticated;

revoke update on public.message_reads from authenticated, anon;
grant update (last_read_at, last_message_id) on public.message_reads to authenticated;

-- ---------------------------------------------------------------------------
-- marketplace
-- ---------------------------------------------------------------------------

revoke update on public.marketplace_listings from authenticated, anon;
grant update (title, description, price, is_free, is_negotiable, condition,
              location, contact_note, category_id, status, reserved_for)
  on public.marketplace_listings to authenticated;

-- Contact details are released only through record_listing_interest() (buyer)
-- and get_listing_contact_note() (seller/moderator). Without this column grant
-- list, a client could scrape every seller's phone number straight off the
-- base table and the interest funnel would be decoration.
revoke select on public.marketplace_listings from authenticated, anon;
grant select (id, seller_id, category_id, title, description, price, is_free,
              is_negotiable, condition, location, status, reserved_for, sold_at,
              sold_to, view_count, contact_count, is_official, moderated_by,
              moderated_at, moderation_reason, created_at, updated_at,
              search_vector)
  on public.marketplace_listings to authenticated;

revoke update on public.gigs from authenticated, anon;
grant update (title, description, category, compensation, availability, category_id)
  on public.gigs to authenticated;

revoke update on public.campus_deals from authenticated, anon;
-- Deals are official content: every change goes through the staff RPCs.

revoke update on public.ratings from authenticated, anon;
grant update (score, comment) on public.ratings to authenticated;

-- ---------------------------------------------------------------------------
-- campus
-- ---------------------------------------------------------------------------

revoke update on public.events from authenticated, anon;
-- Staff manage events through the official-content actions (migration 016).

revoke update on public.event_registrations from authenticated, anon;
grant update (status, note) on public.event_registrations to authenticated;

revoke update on public.notices from authenticated, anon;

revoke update on public.official_resources from authenticated, anon;
grant update (title, description, url, branch, year, semester, subject, type)
  on public.official_resources to authenticated;

revoke update on public.opportunities from authenticated, anon;
grant update (title, organization, description, eligibility, deadline, url, location, mode)
  on public.opportunities to authenticated;

revoke update on public.lost_found from authenticated, anon;
grant update (title, description, location, occurred_on, status, resolved_at, resolved_by)
  on public.lost_found to authenticated;

revoke update on public.housing_posts from authenticated, anon;
grant update (title, description, area, budget, room_type, available_from, status)
  on public.housing_posts to authenticated;

revoke update on public.ride_posts from authenticated, anon;
grant update (origin, destination, ride_date, ride_time, description, seats, status)
  on public.ride_posts to authenticated;

revoke update on public.projects from authenticated, anon;
grant update (title, description, technologies, repo_url, live_url, team_members, status)
  on public.projects to authenticated;

revoke update on public.team_posts from authenticated, anon;
grant update (project_name, description, required_skills, team_size, deadline, status)
  on public.team_posts to authenticated;

revoke update on public.team_post_requests from authenticated, anon;
grant update (status, decided_at) on public.team_post_requests to authenticated;

-- Official content: the RLS policy already requires the matching permission
-- (manage_notices / manage_events / manage_official_content / manage_deals), so
-- granting the write columns to `authenticated` is safe — the policy is what
-- restricts who may use them.
grant update (title, body, category, importance, pinned, expires_at, status,
              published_at, updated_by) on public.notices to authenticated;

grant update (title, description, starts_on, ends_on, start_time, end_time, location,
              organizer, registration_info, registration_url, club_id, capacity,
              show_attendees, status, published_at, discussion_post_id, updated_by)
  on public.events to authenticated;

grant update (title, description, merchant, discount_details, valid_from, valid_until,
              contact_info, status, published_at, updated_by)
  on public.campus_deals to authenticated;

grant update (name, description, block, category, external_map_url, sort_order, status, updated_by)
  on public.campus_locations to authenticated;

grant update (title, description, category, location, hours, contact_info, external_url, status, updated_by)
  on public.campus_services to authenticated;

grant update (route_name, description, timings, pickup_locations, service_status, status, updated_by)
  on public.transport_information to authenticated;

grant update (title, description, menu_text, offers, hours, location, contact_info, status, updated_by)
  on public.cafeteria_information to authenticated;

grant update (title, description, entry_type, starts_on, ends_on, audience, status, updated_by)
  on public.academic_calendar to authenticated;

grant update (title, description, purpose, audience, url, deadline, status, updated_by)
  on public.official_links to authenticated;

grant update (title, category, description, contact_info, location, availability, sort_order, status, updated_by)
  on public.help_contacts to authenticated;

-- ---------------------------------------------------------------------------
-- moderation & system
-- ---------------------------------------------------------------------------

-- A report is never UPDATEd by a client: status changes go through
-- resolve_report(), triage through assign_report() (migration 016). Both are
-- permission-checked, audited and notify the reporter.
revoke update on public.reports from authenticated, anon;

-- The moderation trail and the audit trail are append-only: they are written by
-- log_audit() (SECURITY DEFINER) and never edited or deleted by any client.
revoke insert, update, delete on public.audit_logs from authenticated, anon;
revoke insert, update, delete on public.moderation_actions from authenticated, anon;

revoke update on public.random_sessions from authenticated, anon;
revoke update on public.random_reports from authenticated, anon;
grant update (status, resolution, reviewed_by, reviewed_at) on public.random_reports to authenticated;

-- Notifications: a user may only set read_at (the guard trigger enforces the rest).
revoke update on public.notifications from authenticated, anon;
grant update (read_at) on public.notifications to authenticated;

-- Identity/config tables are never client-updatable; use the admin actions.
revoke update on public.user_roles from authenticated, anon;
revoke update on public.roles from authenticated, anon;
revoke update on public.role_permissions from authenticated, anon;
revoke update on public.platform_settings from authenticated, anon;
revoke update on public.feature_flags from authenticated, anon;
revoke update on public.reserved_usernames from authenticated, anon;

-- Service role and operators keep full access (they are the maintenance path).
grant all on all tables in schema public to service_role;
