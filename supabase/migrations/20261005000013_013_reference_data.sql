-- Campus+ migration 013 — reference data
-- Supabase CLI filename: 20261005000013_013_reference_data.sql
-- This file is part of the single authoritative migration history in supabase/migrations/.
-- =============================================================================
-- Campus+ 013 — reference data seeded by migrations
-- =============================================================================
-- This is NOT demo content. It is the configuration the platform needs to
-- function at all: the institution, the baseline roles and permissions, the
-- marketplace categories, the achievement catalogue, feature flags and default
-- settings. Example users/posts/listings live in `database/seed/dev_seed.sql`
-- and are development-only (spec §93).
-- =============================================================================

-- ----------------------------------------------------------------------------
-- College
-- ----------------------------------------------------------------------------

insert into public.colleges (name, short_name, slug, email_domains, city)
values (
  'Pimpri Chinchwad College of Engineering',
  'PCCOE',
  'pccoe',
  array['pccoepune.org'],
  'Pune'
)
on conflict (slug) do update
  set name = excluded.name,
      short_name = excluded.short_name,
      email_domains = excluded.email_domains;

-- ----------------------------------------------------------------------------
-- Roles
-- ----------------------------------------------------------------------------

insert into public.roles (key, label, description, rank, is_system) values
  ('student',     'Student',     'Verified campus member. Creates content and uses the platform.', 0,  true),
  ('moderator',   'Moderator',   'Reviews reports and moderates content within granted permissions.', 10, true),
  ('admin',       'Admin',       'Manages users, roles, official content and platform configuration.', 20, true),
  ('super_admin', 'Super Admin', 'Platform owner. Configures the platform itself.', 30, true)
on conflict (key) do update
  set label = excluded.label, description = excluded.description, rank = excluded.rank;

-- ----------------------------------------------------------------------------
-- Permission catalogue (mirrors lib/constants.js PERMISSIONS)
-- ----------------------------------------------------------------------------

insert into public.permissions (key, label, description, group_name) values
  -- student baseline
  ('create_posts', 'Create posts', 'Publish text posts and discussions.', 'Social'),
  ('create_comments', 'Create comments', 'Comment on posts and listings.', 'Social'),
  ('react_content', 'React to content', 'React to posts, comments and replies.', 'Social'),
  ('create_polls', 'Create polls', 'Publish text polls.', 'Social'),
  ('send_messages', 'Send messages', 'Start and reply to direct conversations.', 'Messaging'),
  ('use_random_chat', 'Use Random', 'Join the anonymous Random queue.', 'Messaging'),
  ('use_gifs', 'Use GIFs', 'Attach GIPHY GIFs to allowed surfaces.', 'Content'),
  ('create_communities', 'Create communities', 'Create communities, study groups and clubs.', 'Communities'),
  ('create_marketplace_listing', 'Create marketplace listings', 'Publish listings, gigs and free items.', 'Marketplace'),
  ('create_gigs', 'Create gigs', 'Publish student service gigs.', 'Marketplace'),
  ('create_housing_post', 'Create housing posts', 'Publish roommate/housing posts.', 'Marketplace'),
  ('create_ride_post', 'Create ride posts', 'Publish ride/carpool posts.', 'Marketplace'),
  ('submit_resources', 'Submit resources', 'Submit academic resource links and notes.', 'Campus'),
  ('submit_opportunities', 'Submit opportunities', 'Submit community opportunities (clearly marked as community-submitted).', 'Campus'),
  ('create_projects', 'Create projects', 'Publish project showcase entries.', 'Campus'),
  ('create_lost_found', 'Create lost & found posts', 'Report lost or found items.', 'Campus'),
  ('create_team_posts', 'Create team posts', 'Post team-finder requests.', 'Campus'),
  ('rsvp_events', 'RSVP to events', 'Register for campus events.', 'Campus'),
  ('join_clubs', 'Join clubs', 'Join club pages.', 'Campus'),
  ('report_content', 'Report content', 'Report users and content for review.', 'Safety'),
  ('block_users', 'Block users', 'Block other students.', 'Safety'),
  ('rate_users', 'Rate marketplace interactions', 'Leave buyer/seller ratings.', 'Marketplace'),
  ('manage_own_profile', 'Manage own profile', 'Edit profile, username and settings.', 'Account'),
  ('manage_own_content', 'Manage own content', 'Edit or delete content they authored.', 'Account'),
  -- moderator
  ('review_reports', 'Review reports', 'Open and triage the report queue.', 'Moderation'),
  ('remove_posts', 'Moderate posts', 'Hide or remove posts and discussions.', 'Moderation'),
  ('remove_comments', 'Moderate comments', 'Hide or remove comments.', 'Moderation'),
  ('moderate_marketplace', 'Moderate marketplace', 'Hide, remove or flag marketplace listings and gigs.', 'Moderation'),
  ('moderate_communities', 'Moderate communities', 'Moderate community content and membership.', 'Moderation'),
  ('moderate_random', 'Moderate Random reports', 'Review reported anonymous sessions.', 'Moderation'),
  ('view_random_sessions', 'View Random session identities', 'Sensitive: unmask participants of a reported Random session. Every access is audited.', 'Moderation'),
  ('suspend_users', 'Suspend users', 'Temporarily suspend or ban accounts.', 'Moderation'),
  ('warn_users', 'Warn users', 'Issue recorded warnings.', 'Moderation'),
  ('create_moderation_notes', 'Create moderation notes', 'Attach internal notes to reports and users.', 'Moderation'),
  ('manage_events', 'Manage official events', 'Create, edit and publish official campus events.', 'Official Content'),
  ('manage_notices', 'Manage noticeboard', 'Publish and edit official notices.', 'Official Content'),
  ('manage_official_content', 'Manage official campus content', 'Directory, services, calendar, transport, cafeteria, forms, help hub, locations.', 'Official Content'),
  ('manage_clubs', 'Manage clubs', 'Create and configure club pages.', 'Official Content'),
  ('manage_deals', 'Manage campus deals', 'Publish official campus deals.', 'Official Content'),
  ('view_moderation_logs', 'View moderation history', 'Read moderation actions and their outcomes.', 'Moderation'),
  ('approve_marketplace', 'Approve marketplace listings', 'Approve listings when pre-publication moderation is enabled.', 'Moderation'),
  -- admin
  ('manage_users', 'Manage users', 'Inspect and manage student accounts.', 'Administration'),
  ('manage_roles', 'Manage roles', 'Create roles and change role definitions.', 'Administration'),
  ('manage_permissions', 'Manage permissions', 'Assign permissions to roles.', 'Administration'),
  ('assign_roles', 'Assign roles to users', 'Grant or revoke moderator/admin roles.', 'Administration'),
  ('manage_categories', 'Manage categories', 'Edit marketplace and content categories.', 'Administration'),
  ('manage_platform_settings', 'Manage platform settings', 'Change platform-wide configuration values.', 'Administration'),
  ('manage_feature_flags', 'Manage feature flags', 'Enable or disable product modules.', 'Administration'),
  ('view_audit_logs', 'View audit logs', 'Read the administrative audit trail.', 'Administration'),
  ('moderate_all', 'Full moderation authority', 'Act on any content regardless of module.', 'Administration'),
  -- super admin
  ('manage_colleges', 'Manage colleges', 'Configure institutions and their email domains.', 'Platform'),
  ('manage_role_authority', 'Configure role authority', 'Grant administrative permissions to other roles.', 'Platform'),
  ('view_admin_overview', 'View admin overview', 'Read operational counters in the admin dashboard.', 'Platform')
on conflict (key) do update
  set label = excluded.label, description = excluded.description, group_name = excluded.group_name;

-- ----------------------------------------------------------------------------
-- Role → permission defaults
-- ----------------------------------------------------------------------------

-- Student: everything in the baseline list.
insert into public.role_permissions (role_key, permission_key)
select 'student', p.key
from public.permissions p
where p.key in (
  'create_posts', 'create_comments', 'react_content', 'create_polls',
  'send_messages', 'use_random_chat', 'use_gifs',
  'create_communities', 'create_marketplace_listing', 'create_gigs',
  'create_housing_post', 'create_ride_post',
  'submit_resources', 'submit_opportunities', 'create_projects',
  'create_lost_found', 'create_team_posts', 'rsvp_events', 'join_clubs',
  'report_content', 'block_users', 'rate_users',
  'manage_own_profile', 'manage_own_content'
)
on conflict do nothing;

-- Moderator: student baseline + moderation duties. Note the absence of
-- `view_random_sessions`: unmasking Random participants is an admin-level act.
insert into public.role_permissions (role_key, permission_key)
select 'moderator', p.key
from public.permissions p
where p.key in (select permission_key from public.role_permissions where role_key = 'student')
   or p.key in (
     'review_reports', 'remove_posts', 'remove_comments', 'moderate_marketplace',
     'moderate_communities', 'moderate_random', 'suspend_users', 'warn_users',
     'create_moderation_notes', 'manage_events', 'manage_notices',
     'view_moderation_logs', 'approve_marketplace'
   )
on conflict do nothing;

-- Admin: moderator baseline + administration.
insert into public.role_permissions (role_key, permission_key)
select 'admin', p.key
from public.permissions p
where p.key in (select permission_key from public.role_permissions where role_key = 'moderator')
   or p.key in (
     'view_random_sessions', 'manage_official_content', 'manage_clubs', 'manage_deals',
     'manage_users', 'manage_roles', 'manage_permissions', 'assign_roles',
     'manage_categories', 'manage_platform_settings', 'manage_feature_flags',
     'view_audit_logs', 'moderate_all', 'view_admin_overview'
   )
on conflict do nothing;

-- Super Admin: everything the platform defines.
insert into public.role_permissions (role_key, permission_key)
select 'super_admin', p.key from public.permissions p
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- Reserved usernames (mirrors lib/constants.js RESERVED_USERNAMES)
-- ----------------------------------------------------------------------------

insert into public.reserved_usernames (username, reason)
select u, 'Reserved platform identity'
from unnest(array[
  'admin', 'administrator', 'superadmin', 'super_admin', 'moderator', 'mod', 'staff',
  'root', 'system', 'support', 'help', 'campus', 'campusplus', 'campus_plus', 'official',
  'pccoe', 'college', 'security', 'billing', 'null', 'undefined', 'anonymous', 'anon',
  'you', 'me', 'everyone', 'here', 'random', 'bot', 'api', 'www', 'mail', 'smtp',
  'login', 'signup', 'signin', 'logout', 'register', 'settings', 'account', 'profile',
  'home', 'explore', 'market', 'communities', 'chat', 'admin_panel', 'moderator_panel'
]) as u
on conflict (username) do nothing;

-- ----------------------------------------------------------------------------
-- Marketplace categories (spec §28)
-- ----------------------------------------------------------------------------

insert into public.marketplace_categories (name, slug, scope, sort_order) values
  ('Books', 'books', 'marketplace', 10),
  ('Electronics', 'electronics', 'marketplace', 20),
  ('Calculators', 'calculators', 'marketplace', 30),
  ('College supplies', 'college-supplies', 'marketplace', 40),
  ('Furniture', 'furniture', 'marketplace', 50),
  ('Cycles', 'cycles', 'marketplace', 60),
  ('Project materials', 'project-materials', 'marketplace', 70),
  ('Accessories', 'accessories', 'marketplace', 80),
  ('Free items', 'free-items', 'marketplace', 90),
  ('Other', 'other', 'marketplace', 100),
  ('Tutoring', 'gig-tutoring', 'gig', 10),
  ('Coding help', 'gig-coding', 'gig', 20),
  ('Design help', 'gig-design', 'gig', 30),
  ('Editing', 'gig-editing', 'gig', 40),
  ('Photography', 'gig-photography', 'gig', 50),
  ('Project assistance', 'gig-project', 'gig', 60),
  ('Other services', 'gig-other', 'gig', 70)
on conflict (slug) do nothing;

-- ----------------------------------------------------------------------------
-- Achievements (spec §51) — rules are documented and deterministic
-- ----------------------------------------------------------------------------

insert into public.achievements (key, label, description, rule, sort_order) values
  ('early_contributor', 'Early Contributor', 'Published one of the first posts on Campus+.', 'posts_count >= 1', 10),
  ('community_builder', 'Community Builder', 'Created a community that has members.', 'communities_created >= 1', 20),
  ('helpful_member', 'Helpful Member', 'Received 10 reactions on comments.', 'comment_reactions_received >= 10', 30),
  ('event_participant', 'Event Participant', 'RSVPed to a campus event.', 'event_rsvps >= 1', 40),
  ('marketplace_seller', 'Marketplace Seller', 'Completed a marketplace listing as seller.', 'listings_sold >= 1', 50),
  ('project_showcase_contributor', 'Project Showcase Contributor', 'Published a project to the showcase.', 'projects_published >= 1', 60)
on conflict (key) do update
  set label = excluded.label, description = excluded.description, rule = excluded.rule;

-- ----------------------------------------------------------------------------
-- Feature flags (spec §77)
-- ----------------------------------------------------------------------------

insert into public.feature_flags (key, label, description, group_name, enabled) values
  ('feed', 'Campus feed', 'Home timeline, posts, comments and reactions.', 'social', true),
  ('discussions', 'Discussions', 'Question/answer style text discussions.', 'social', true),
  ('polls', 'Polls', 'Text polls with single-choice voting.', 'social', true),
  ('communities', 'Communities', 'Communities, membership and group discussions.', 'social', true),
  ('group_chat', 'Group chat', 'Community/study-group chat rooms.', 'social', true),
  ('direct_messages', 'Direct messages', 'One-to-one conversations.', 'messaging', true),
  ('gifs', 'GIFs', 'GIPHY-backed GIF search inside text surfaces.', 'messaging', true),
  ('random_chat', 'Random', 'Anonymous paired conversations between verified students.', 'messaging', true),
  ('marketplace', 'Marketplace', 'Student listings, categories and seller contact.', 'market', true),
  ('gigs', 'Campus gigs', 'Student service gig board.', 'market', true),
  ('free_stuff', 'Free stuff', 'Give-away listings.', 'market', true),
  ('deals', 'Campus deals', 'Official moderator-managed deals.', 'market', true),
  ('housing', 'Roommates & housing', 'Text housing board.', 'market', true),
  ('rides', 'Rides & carpool', 'Ride coordination board.', 'market', true),
  ('events', 'Events', 'Official events and RSVPs.', 'campus', true),
  ('clubs', 'Clubs', 'Club pages and membership.', 'campus', true),
  ('noticeboard', 'Noticeboard', 'Official notices.', 'campus', true),
  ('lost_found', 'Lost & found', 'Text lost/found reports.', 'campus', true),
  ('resources', 'Resource hub', 'Academic resource links and notes.', 'campus', true),
  ('study_groups', 'Study groups', 'Subject-based study groups.', 'campus', true),
  ('team_finder', 'Team finder', 'Looking-for-teammates posts.', 'campus', true),
  ('projects', 'Project showcase', 'Text project showcase.', 'campus', true),
  ('opportunities', 'Opportunities', 'Internships and opportunities.', 'campus', true),
  ('campus_info', 'Campus information', 'Directory, locations, services, transport, cafeteria, calendar, forms, help.', 'campus', true),
  ('achievements', 'Achievements', 'Deterministic profile achievements.', 'profile', true),
  ('reputation', 'Reputation & ratings', 'Marketplace trust indicators.', 'profile', true)
on conflict (key) do update
  set label = excluded.label, description = excluded.description, group_name = excluded.group_name;

-- ----------------------------------------------------------------------------
-- Platform settings (spec §76)
-- ----------------------------------------------------------------------------

insert into public.platform_settings (key, value, description, category, is_public) values
  ('platform_name', '"Campus+"'::jsonb, 'Displayed product name.', 'branding', true),
  ('institution_name', '"PCCOE"'::jsonb, 'Displayed institution name.', 'branding', true),
  ('allowed_email_domains', '["pccoepune.org"]'::jsonb, 'Institutional email domains permitted to sign in.', 'authentication', false),
  ('marketplace_approval_mode', '"post_moderation"'::jsonb, 'post_moderation (publish immediately, moderate by report) or pre_moderation (staff approval first).', 'marketplace', false),
  ('username_change_cooldown_days', '30'::jsonb, 'Days a student must wait between username changes.', 'usernames', false),
  ('community_creation_open', 'true'::jsonb, 'Whether students may create communities and study groups.', 'communities', false),
  ('student_opportunity_submission', 'true'::jsonb, 'Whether students may submit community opportunities.', 'opportunities', false),
  ('moderate_community_submissions', '{"resource": false, "opportunity": false}'::jsonb, 'Per-module switch that sends student submissions to the moderation queue before publishing.', 'moderation', false),
  ('random_session_max_minutes', '60'::jsonb, 'Hard cap on an anonymous Random session.', 'random', false),
  ('random_rematch_cooldown_seconds', '30'::jsonb, 'Minimum wait between Random rematches.', 'random', false),
  ('random_retention_days', '90'::jsonb, 'How long expired Random sessions are retained before purge (reported sessions are always kept).', 'random', false),
  ('feed_marketplace_highlights', 'true'::jsonb, 'Include active marketplace listings in the home feed.', 'feed', false),
  ('feed_ranking', '"deterministic_v1"'::jsonb, 'Feed ordering strategy. Deterministic only — there is no algorithmic ranking.', 'feed', true),
  ('show_event_attendees', 'true'::jsonb, 'Default for showing attendee lists on events.', 'events', false),
  ('announcement_banner', '""'::jsonb, 'Optional short banner shown at the top of Home.', 'branding', true),
  ('support_contact', '""'::jsonb, 'Where students can ask for help.', 'general', true)
on conflict (key) do nothing;
