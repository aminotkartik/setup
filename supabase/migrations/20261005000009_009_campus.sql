-- Campus+ migration 009 — campus
-- Supabase CLI filename: 20261005000009_009_campus.sql
-- This file is part of the single authoritative migration history in supabase/migrations/.
-- =============================================================================
-- Campus+ 009 — campus information, official content, student boards
-- =============================================================================
-- Two clearly separated authorities (spec §74):
--
--   OFFICIAL  — notices, events, deals, directory, services, calendar,
--               transport, cafeteria, forms/links, emergency help, locations.
--               Written only by roles holding the matching permission.
--   COMMUNITY — lost & found, housing, rides, team finder, projects,
--               resource submissions, community opportunities.
--
-- Every official row records created_by / updated_by / published_at / status so
-- accountability is structural (spec §103).
--
-- Discussion reuse: entities that support comments link to an ordinary `posts`
-- row (`discussion_post_id`), so comments, reactions and mentions all flow
-- through the one social system instead of a parallel comment table (spec §133).
-- =============================================================================

-- Extend reactions to cover projects (spec §39) through the existing table.
alter table public.reactions drop constraint reactions_target_type_check;
alter table public.reactions add constraint reactions_target_type_check
  check (target_type in ('post', 'comment', 'project'));

alter table public.reactions drop constraint reactions_user_id_target_type_target_id_key;
alter table public.reactions add constraint reactions_unique_per_item
  unique (user_id, target_type, target_id);

-- Same for mentions, so a mention inside a discussion post always resolves.
alter table public.mentions drop constraint mentions_source_type_check;
alter table public.mentions add constraint mentions_source_type_check
  check (source_type in ('post', 'comment', 'message', 'project', 'lost_found', 'opportunity', 'event', 'resource', 'community_post'));

-- ----------------------------------------------------------------------------
-- Helper: should community submissions land in the moderation queue?
-- ----------------------------------------------------------------------------

create or replace function public.community_submissions_require_review(p_kind text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_value jsonb;
begin
  begin
    select value into v_value from public.platform_settings where key = 'moderate_community_submissions';
  exception when undefined_table then
    return false;
  end;
  if v_value is null then
    return false;  -- default: immediate publishing + post-publication moderation
  end if;
  if jsonb_typeof(v_value) = 'boolean' then
    return v_value = 'true'::jsonb;
  end if;
  return coalesce(v_value->>p_kind, 'false') = 'true';
end;
$$;

-- ----------------------------------------------------------------------------
-- events
-- ----------------------------------------------------------------------------

create table public.events (
  id                uuid primary key default gen_random_uuid(),
  title             text not null check (length(btrim(title)) between 3 and 140),
  description       text not null check (length(btrim(description)) between 5 and 2000),
  starts_on         date not null,
  ends_on           date,
  start_time        time,
  end_time          time,
  location          text not null check (length(btrim(location)) between 2 and 140),
  organizer         text check (organizer is null or length(organizer) <= 120),
  registration_info text check (registration_info is null or length(registration_info) <= 500),
  registration_url  text check (registration_url is null or registration_url ~ '^https?://'),
  club_id           uuid references public.communities (id) on delete set null,
  capacity          integer check (capacity is null or capacity > 0),
  show_attendees    boolean not null default true,
  discussion_post_id uuid references public.posts (id) on delete set null,
  status            public.event_status not null default 'draft',
  is_official       boolean not null default true,
  created_by        uuid not null references public.profiles (id) on delete restrict,
  updated_by        uuid references public.profiles (id) on delete set null,
  published_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  search_vector     tsvector generated always as (
    to_tsvector('english'::regconfig, coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(location, ''))
  ) stored,
  constraint events_date_order check (ends_on is null or ends_on >= starts_on),
  constraint events_time_order check (end_time is null or start_time is null or end_time > start_time)
);

create index events_status_idx on public.events (status, starts_on);
create index events_upcoming_idx on public.events (starts_on) where status = 'published';
create index events_club_idx on public.events (club_id);
create index events_search_idx on public.events using gin (search_vector);

create trigger events_touch before update on public.events
  for each row execute function public.touch_updated_at();

create table public.event_registrations (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  status     public.rsvp_status not null default 'going',
  note       text check (note is null or length(note) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, user_id)
);

create index event_registrations_event_idx on public.event_registrations (event_id, status);
create index event_registrations_user_idx on public.event_registrations (user_id, created_at desc);

create trigger event_registrations_touch before update on public.event_registrations
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- notices (official noticeboard, spec §34)
-- ----------------------------------------------------------------------------

create table public.notices (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (length(btrim(title)) between 3 and 140),
  body         text not null check (length(btrim(body)) between 5 and 4000),
  category     public.notice_category not null default 'general',
  importance   text not null default 'normal' check (importance in ('low', 'normal', 'high', 'critical')),
  pinned       boolean not null default false,
  expires_at   timestamptz,
  status       public.content_status not null default 'draft',
  created_by   uuid not null references public.profiles (id) on delete restrict,
  updated_by   uuid references public.profiles (id) on delete set null,
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  search_vector tsvector generated always as (
    to_tsvector('english'::regconfig, coalesce(title, '') || ' ' || coalesce(body, ''))
  ) stored
);

create index notices_status_idx on public.notices (status, pinned desc, published_at desc);
create index notices_search_idx on public.notices using gin (search_vector);

create trigger notices_touch before update on public.notices
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- campus directory: locations, services, transport, cafeteria, calendar
-- ----------------------------------------------------------------------------

create table public.campus_locations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(btrim(name)) between 2 and 120),
  description   text check (description is null or length(description) <= 600),
  block         text check (block is null or length(block) <= 80),
  category      text not null default 'general' check (length(category) <= 60),
  external_map_url text check (external_map_url is null or external_map_url ~ '^https?://'),
  sort_order    integer not null default 0,
  status        public.content_status not null default 'published',
  created_by    uuid references public.profiles (id) on delete set null,
  updated_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index campus_locations_status_idx on public.campus_locations (status, sort_order);

create trigger campus_locations_touch before update on public.campus_locations
  for each row execute function public.touch_updated_at();

create table public.campus_services (
  id            uuid primary key default gen_random_uuid(),
  title         text not null check (length(btrim(title)) between 2 and 140),
  description   text check (description is null or length(description) <= 1000),
  category      text not null default 'general' check (length(category) <= 60),
  location      text check (location is null or length(location) <= 200),
  hours         text check (hours is null or length(hours) <= 200),
  contact_info  text check (contact_info is null or length(contact_info) <= 300),
  external_url  text check (external_url is null or external_url ~ '^https?://'),
  status        public.content_status not null default 'published',
  created_by    uuid references public.profiles (id) on delete set null,
  updated_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index campus_services_status_idx on public.campus_services (status, category);

create trigger campus_services_touch before update on public.campus_services
  for each row execute function public.touch_updated_at();

create table public.transport_information (
  id               uuid primary key default gen_random_uuid(),
  route_name       text not null check (length(btrim(route_name)) between 2 and 120),
  description      text check (description is null or length(description) <= 1000),
  timings          text check (timings is null or length(timings) <= 600),
  pickup_locations text check (pickup_locations is null or length(pickup_locations) <= 600),
  service_status   text not null default 'running' check (service_status in ('running', 'delayed', 'suspended', 'holiday', 'unknown')),
  contact_info     text check (contact_info is null or length(contact_info) <= 300),
  status           public.content_status not null default 'published',
  created_by       uuid references public.profiles (id) on delete set null,
  updated_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create trigger transport_information_touch before update on public.transport_information
  for each row execute function public.touch_updated_at();

create table public.cafeteria_information (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (length(btrim(title)) between 2 and 140),
  description  text check (description is null or length(description) <= 2000),
  menu_text    text check (menu_text is null or length(menu_text) <= 4000),
  offers       text check (offers is null or length(offers) <= 1000),
  hours        text check (hours is null or length(hours) <= 200),
  location     text check (location is null or length(location) <= 200),
  contact_info text check (contact_info is null or length(contact_info) <= 300),
  status       public.content_status not null default 'published',
  created_by   uuid references public.profiles (id) on delete set null,
  updated_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger cafeteria_information_touch before update on public.cafeteria_information
  for each row execute function public.touch_updated_at();

create table public.academic_calendar (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (length(btrim(title)) between 2 and 140),
  description text check (description is null or length(description) <= 1000),
  entry_type  text not null default 'academic_event'
              check (entry_type in ('exam', 'semester_start', 'semester_end', 'holiday', 'deadline', 'academic_event', 'other')),
  starts_on   date not null,
  ends_on     date,
  audience    text check (audience is null or length(audience) <= 120),
  status      public.content_status not null default 'published',
  created_by  uuid references public.profiles (id) on delete set null,
  updated_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint academic_calendar_date_order check (ends_on is null or ends_on >= starts_on)
);

create index academic_calendar_dates_idx on public.academic_calendar (starts_on);

create trigger academic_calendar_touch before update on public.academic_calendar
  for each row execute function public.touch_updated_at();

create table public.official_links (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (length(btrim(title)) between 3 and 140),
  description text check (description is null or length(description) <= 1000),
  purpose     text check (purpose is null or length(purpose) <= 300),
  audience    text check (audience is null or length(audience) <= 120),
  url         text not null check (url ~ '^https?://'),
  deadline    date,
  status      public.content_status not null default 'published',
  created_by  uuid references public.profiles (id) on delete set null,
  updated_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index official_links_status_idx on public.official_links (status, deadline);

create trigger official_links_touch before update on public.official_links
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- emergency / help hub — informational only, never a discussion area (spec §50)
-- ----------------------------------------------------------------------------

create table public.help_contacts (
  id            uuid primary key default gen_random_uuid(),
  title         text not null check (length(btrim(title)) between 2 and 140),
  category      text not null default 'emergency'
                check (category in ('emergency', 'medical', 'security', 'counselling', 'anti_ragging', 'other')),
  description   text check (description is null or length(description) <= 1000),
  contact_info  text not null check (length(btrim(contact_info)) between 2 and 300),
  location      text check (location is null or length(location) <= 200),
  availability  text check (availability is null or length(availability) <= 120),
  sort_order    integer not null default 0,
  status        public.content_status not null default 'published',
  created_by    uuid references public.profiles (id) on delete set null,
  updated_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index help_contacts_status_idx on public.help_contacts (status, sort_order);

create trigger help_contacts_touch before update on public.help_contacts
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- resource hub — links and text only, no file storage (spec §36)
-- ----------------------------------------------------------------------------

create table public.official_resources (
  id                uuid primary key default gen_random_uuid(),
  title             text not null check (length(btrim(title)) between 3 and 140),
  description       text not null check (length(btrim(description)) between 10 and 1000),
  url               text not null check (url ~ '^https?://'),
  branch            text check (branch is null or length(branch) <= 80),
  year              text check (year is null or length(year) <= 40),
  semester          text check (semester is null or length(semester) <= 10),
  subject           text check (subject is null or length(subject) <= 120),
  type              text not null default 'notes' check (type in ('notes', 'reference', 'video', 'paper', 'tool', 'other')),
  is_official       boolean not null default false,
  status            public.content_status not null default 'published',
  submitted_by      uuid references public.profiles (id) on delete set null,
  created_by        uuid references public.profiles (id) on delete set null,
  updated_by        uuid references public.profiles (id) on delete set null,
  approved_by       uuid references public.profiles (id) on delete set null,
  approved_at       timestamptz,
  published_at      timestamptz,
  discussion_post_id uuid references public.posts (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  search_vector     tsvector generated always as (
    to_tsvector('english'::regconfig, coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(subject, ''))
  ) stored
);

create index official_resources_status_idx on public.official_resources (status, created_at desc);
create index official_resources_filters_idx on public.official_resources (branch, year, semester);
create index official_resources_search_idx on public.official_resources using gin (search_vector);

create trigger official_resources_touch before update on public.official_resources
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- opportunities (official and community-submitted, clearly distinguished)
-- ----------------------------------------------------------------------------

create table public.opportunities (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null check (length(btrim(title)) between 3 and 140),
  organization       text not null check (length(btrim(organization)) between 2 and 140),
  description        text not null check (length(btrim(description)) between 10 and 2000),
  eligibility        text check (eligibility is null or length(eligibility) <= 500),
  deadline           date,
  url                text check (url is null or url ~ '^https?://'),
  location           text check (location is null or length(location) <= 120),
  mode               text not null default 'onsite' check (mode in ('onsite', 'remote', 'hybrid')),
  source             public.opportunity_source not null default 'official',
  status             public.content_status not null default 'published',
  created_by         uuid not null references public.profiles (id) on delete restrict,
  updated_by         uuid references public.profiles (id) on delete set null,
  approved_by        uuid references public.profiles (id) on delete set null,
  published_at       timestamptz,
  discussion_post_id uuid references public.posts (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  search_vector      tsvector generated always as (
    to_tsvector('english'::regconfig, coalesce(title, '') || ' ' || coalesce(organization, '') || ' ' || coalesce(description, ''))
  ) stored
);

create index opportunities_status_idx on public.opportunities (status, deadline);
create index opportunities_source_idx on public.opportunities (source, created_at desc);
create index opportunities_search_idx on public.opportunities using gin (search_vector);

create trigger opportunities_touch before update on public.opportunities
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- lost & found
-- ----------------------------------------------------------------------------

create table public.lost_found (
  id                 uuid primary key default gen_random_uuid(),
  kind               public.lost_found_kind not null,
  title              text not null check (length(btrim(title)) between 3 and 140),
  description        text not null check (length(btrim(description)) between 5 and 1000),
  location           text check (location is null or length(location) <= 120),
  occurred_on        date,
  status             public.content_status not null default 'published',
  resolved_at        timestamptz,
  resolved_by        uuid references public.profiles (id) on delete set null,
  creator_id         uuid not null references public.profiles (id) on delete cascade,
  discussion_post_id uuid references public.posts (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  search_vector      tsvector generated always as (
    to_tsvector('english'::regconfig, coalesce(title, '') || ' ' || coalesce(description, ''))
  ) stored
);

create index lost_found_status_idx on public.lost_found (status, created_at desc);
create index lost_found_creator_idx on public.lost_found (creator_id, created_at desc);
create index lost_found_kind_idx on public.lost_found (kind, status);
create index lost_found_search_idx on public.lost_found using gin (search_vector);

create trigger lost_found_touch before update on public.lost_found
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- housing and rides (coordination boards, no payments — spec §41, §42, §124)
-- ----------------------------------------------------------------------------

create table public.housing_posts (
  id             uuid primary key default gen_random_uuid(),
  title          text not null check (length(btrim(title)) between 3 and 140),
  description    text not null check (length(btrim(description)) between 5 and 1000),
  area           text not null check (length(btrim(area)) between 2 and 120),
  budget         text check (budget is null or length(budget) <= 80),
  room_type      public.room_type not null default 'shared',
  available_from date,
  status         public.content_status not null default 'published',
  creator_id     uuid not null references public.profiles (id) on delete cascade,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index housing_posts_status_idx on public.housing_posts (status, created_at desc);
create index housing_posts_creator_idx on public.housing_posts (creator_id, created_at desc);

create trigger housing_posts_touch before update on public.housing_posts
  for each row execute function public.touch_updated_at();

create table public.ride_posts (
  id          uuid primary key default gen_random_uuid(),
  origin      text not null check (length(btrim(origin)) between 2 and 120),
  destination text not null check (length(btrim(destination)) between 2 and 120),
  ride_date   date not null,
  ride_time   time,
  description text not null check (length(btrim(description)) between 5 and 800),
  seats       integer check (seats is null or seats between 1 and 10),
  status      public.content_status not null default 'published',
  creator_id  uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ride_posts_status_idx on public.ride_posts (status, ride_date);
create index ride_posts_creator_idx on public.ride_posts (creator_id, created_at desc);

create trigger ride_posts_touch before update on public.ride_posts
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- projects showcase
-- ----------------------------------------------------------------------------

create table public.projects (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null check (length(btrim(title)) between 3 and 140),
  description        text not null check (length(btrim(description)) between 10 and 2000),
  technologies       text not null check (length(btrim(technologies)) between 1 and 300),
  repo_url           text check (repo_url is null or repo_url ~ '^https://'),
  live_url           text check (live_url is null or live_url ~ '^https?://'),
  team_members       text check (team_members is null or length(team_members) <= 300),
  creator_id         uuid not null references public.profiles (id) on delete cascade,
  status             public.content_status not null default 'published',
  reaction_count     integer not null default 0 check (reaction_count >= 0),
  moderated_by       uuid references public.profiles (id) on delete set null,
  moderated_at       timestamptz,
  moderation_reason  text,
  discussion_post_id uuid references public.posts (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  search_vector      tsvector generated always as (
    to_tsvector('english'::regconfig, coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(technologies, ''))
  ) stored
);

create index projects_status_idx on public.projects (status, created_at desc);
create index projects_creator_idx on public.projects (creator_id);
create index projects_search_idx on public.projects using gin (search_vector);

create trigger projects_touch before update on public.projects
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- team finder
-- ----------------------------------------------------------------------------

create table public.team_posts (
  id              uuid primary key default gen_random_uuid(),
  project_name    text not null check (length(btrim(project_name)) between 3 and 140),
  description     text not null check (length(btrim(description)) between 10 and 1500),
  required_skills text not null check (length(btrim(required_skills)) between 2 and 300),
  team_size       integer check (team_size is null or team_size between 1 and 50),
  deadline        date,
  status          public.content_status not null default 'published',
  creator_id      uuid not null references public.profiles (id) on delete cascade,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  search_vector   tsvector generated always as (
    to_tsvector('english'::regconfig, coalesce(project_name, '') || ' ' || coalesce(description, '') || ' ' || coalesce(required_skills, ''))
  ) stored
);

create index team_posts_status_idx on public.team_posts (status, created_at desc);
create index team_posts_creator_idx on public.team_posts (creator_id, created_at desc);
create index team_posts_search_idx on public.team_posts using gin (search_vector);

create trigger team_posts_touch before update on public.team_posts
  for each row execute function public.touch_updated_at();

create table public.team_post_requests (
  id           uuid primary key default gen_random_uuid(),
  team_post_id uuid not null references public.team_posts (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  message      text check (message is null or length(message) <= 500),
  status       text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'withdrawn')),
  decided_at   timestamptz,
  created_at   timestamptz not null default now(),
  unique (team_post_id, user_id)
);

create index team_post_requests_post_idx on public.team_post_requests (team_post_id, status);
create index team_post_requests_user_idx on public.team_post_requests (user_id, created_at desc);

-- ----------------------------------------------------------------------------
-- achievements (deterministic rules only, spec §51)
-- ----------------------------------------------------------------------------

create table public.achievements (
  key         text primary key check (key ~ '^[a-z0-9_]{3,60}$'),
  label       text not null check (length(btrim(label)) between 2 and 80),
  description text not null check (length(btrim(description)) between 5 and 300),
  rule        text not null check (length(btrim(rule)) between 3 and 200),
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table public.user_achievements (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  achievement_key text not null references public.achievements (key) on delete cascade,
  awarded_at     timestamptz not null default now(),
  unique (user_id, achievement_key)
);

create index user_achievements_user_idx on public.user_achievements (user_id);
create index user_achievements_key_idx on public.user_achievements (achievement_key);

-- ----------------------------------------------------------------------------
-- Counters
-- ----------------------------------------------------------------------------

create or replace function public.sync_project_reaction_counts()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(new.target_type, old.target_type) = 'project' then
    update public.projects p
       set reaction_count = (
         select count(*) from public.reactions r
         where r.target_type = 'project' and r.target_id = p.id
       )
     where p.id = coalesce(new.target_id, old.target_id);
  end if;
  return coalesce(new, old);
end;
$$;

create trigger reactions_sync_project_counts
  after insert or update or delete on public.reactions
  for each row execute function public.sync_project_reaction_counts();

create or replace function public.sync_community_post_counts()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_community uuid := coalesce(new.community_id, old.community_id);
begin
  if v_community is null then
    return coalesce(new, old);
  end if;
  update public.communities c
     set post_count = (
       select count(*) from public.posts p
       where p.community_id = v_community and p.status = 'published' and p.deleted_at is null
     )
   where c.id = v_community;
  return coalesce(new, old);
end;
$$;

create trigger posts_sync_community_counts
  after insert or update or delete on public.posts
  for each row execute function public.sync_community_post_counts();

-- ----------------------------------------------------------------------------
-- RLS — official content
-- ----------------------------------------------------------------------------
-- Read: published rows only (or the creator, or staff with the matching
-- permission). Write: the single permission that owns the module.

alter table public.events enable row level security;
alter table public.event_registrations enable row level security;
alter table public.notices enable row level security;
alter table public.campus_locations enable row level security;
alter table public.campus_services enable row level security;
alter table public.transport_information enable row level security;
alter table public.cafeteria_information enable row level security;
alter table public.academic_calendar enable row level security;
alter table public.official_links enable row level security;
alter table public.help_contacts enable row level security;
alter table public.official_resources enable row level security;
alter table public.opportunities enable row level security;
alter table public.lost_found enable row level security;
alter table public.housing_posts enable row level security;
alter table public.ride_posts enable row level security;
alter table public.projects enable row level security;
alter table public.team_posts enable row level security;
alter table public.team_post_requests enable row level security;
alter table public.achievements enable row level security;
alter table public.user_achievements enable row level security;

-- events --------------------------------------------------------------------
create policy events_select_published on public.events
  for select to authenticated using (status in ('published', 'completed'));
create policy events_select_staff on public.events
  for select to authenticated
  using (public.has_permission('manage_events') or public.has_permission('moderate_all'));
create policy events_insert_staff on public.events
  for insert to authenticated
  with check (public.has_permission('manage_events') and created_by = public.current_profile_id());
create policy events_update_staff on public.events
  for update to authenticated
  using (public.has_permission('manage_events') or public.has_permission('moderate_all'))
  with check (public.has_permission('manage_events') or public.has_permission('moderate_all'));
create policy events_delete_staff on public.events
  for delete to authenticated
  using (public.has_permission('manage_events') or public.has_permission('moderate_all'));

-- event_registrations -------------------------------------------------------
create policy event_registrations_select_own on public.event_registrations
  for select to authenticated using (user_id = public.current_profile_id());
create policy event_registrations_select_attendees on public.event_registrations
  for select to authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = event_id and e.show_attendees and e.status in ('published', 'completed')
    )
  );
create policy event_registrations_select_staff on public.event_registrations
  for select to authenticated
  using (public.has_permission('manage_events') or public.has_permission('moderate_all'));

create policy event_registrations_insert_own on public.event_registrations
  for insert to authenticated
  with check (
    user_id = public.current_profile_id()
    and public.is_active_user()
    and public.has_permission('rsvp_events')
    and exists (select 1 from public.events e where e.id = event_id and e.status = 'published')
  );
create policy event_registrations_update_own on public.event_registrations
  for update to authenticated
  using (user_id = public.current_profile_id())
  with check (user_id = public.current_profile_id());
create policy event_registrations_delete_own on public.event_registrations
  for delete to authenticated using (user_id = public.current_profile_id());

-- notices -------------------------------------------------------------------
create policy notices_select_published on public.notices
  for select to authenticated
  using (status = 'published' and (expires_at is null or expires_at > now()));
create policy notices_select_staff on public.notices
  for select to authenticated using (public.has_permission('manage_notices'));
create policy notices_insert_staff on public.notices
  for insert to authenticated
  with check (public.has_permission('manage_notices') and created_by = public.current_profile_id());
create policy notices_update_staff on public.notices
  for update to authenticated
  using (public.has_permission('manage_notices') or public.has_permission('moderate_all'))
  with check (public.has_permission('manage_notices') or public.has_permission('moderate_all'));
create policy notices_delete_staff on public.notices
  for delete to authenticated using (public.has_permission('manage_notices'));

-- campus_locations ----------------------------------------------------------
create policy campus_locations_select on public.campus_locations
  for select to authenticated using (status = 'published' or public.has_permission('manage_official_content'));
create policy campus_locations_manage on public.campus_locations
  for all to authenticated
  using (public.has_permission('manage_official_content'))
  with check (public.has_permission('manage_official_content'));

-- campus_services -----------------------------------------------------------
create policy campus_services_select on public.campus_services
  for select to authenticated using (status = 'published' or public.has_permission('manage_official_content'));
create policy campus_services_manage on public.campus_services
  for all to authenticated
  using (public.has_permission('manage_official_content'))
  with check (public.has_permission('manage_official_content'));

-- transport_information -----------------------------------------------------
create policy transport_select on public.transport_information
  for select to authenticated using (status = 'published' or public.has_permission('manage_official_content'));
create policy transport_manage on public.transport_information
  for all to authenticated
  using (public.has_permission('manage_official_content'))
  with check (public.has_permission('manage_official_content'));

-- cafeteria_information -----------------------------------------------------
create policy cafeteria_select on public.cafeteria_information
  for select to authenticated using (status = 'published' or public.has_permission('manage_official_content'));
create policy cafeteria_manage on public.cafeteria_information
  for all to authenticated
  using (public.has_permission('manage_official_content'))
  with check (public.has_permission('manage_official_content'));

-- academic_calendar ---------------------------------------------------------
create policy calendar_select on public.academic_calendar
  for select to authenticated using (status = 'published' or public.has_permission('manage_official_content'));
create policy calendar_manage on public.academic_calendar
  for all to authenticated
  using (public.has_permission('manage_official_content'))
  with check (public.has_permission('manage_official_content'));

-- official_links ------------------------------------------------------------
create policy official_links_select on public.official_links
  for select to authenticated using (status = 'published' or public.has_permission('manage_official_content'));
create policy official_links_manage on public.official_links
  for all to authenticated
  using (public.has_permission('manage_official_content'))
  with check (public.has_permission('manage_official_content'));

-- help_contacts -------------------------------------------------------------
create policy help_contacts_select on public.help_contacts
  for select to authenticated using (status = 'published' or public.has_permission('manage_official_content'));
create policy help_contacts_manage on public.help_contacts
  for all to authenticated
  using (public.has_permission('manage_official_content'))
  with check (public.has_permission('manage_official_content'));

-- official_resources --------------------------------------------------------
create policy resources_select_visible on public.official_resources
  for select to authenticated
  using (status = 'published' or submitted_by = public.current_profile_id());
create policy resources_select_staff on public.official_resources
  for select to authenticated using (public.has_permission('manage_official_content'));
create policy resources_insert_staff on public.official_resources
  for insert to authenticated
  with check (
    public.has_permission('manage_official_content')
    and is_official and status in ('published', 'draft')
    and created_by = public.current_profile_id()
  );
create policy resources_insert_student on public.official_resources
  for insert to authenticated
  with check (
    public.has_permission('submit_resources')
    and public.is_active_user()
    and is_official = false
    and status = (case when public.community_submissions_require_review('resource')
                       then 'pending' else 'published' end)::public.content_status
    and submitted_by = public.current_profile_id()
  );
create policy resources_update_submitter on public.official_resources
  for update to authenticated
  using (submitted_by = public.current_profile_id() and status in ('pending', 'published') and is_official = false)
  with check (submitted_by = public.current_profile_id() and is_official = false);
create policy resources_update_staff on public.official_resources
  for update to authenticated
  using (public.has_permission('manage_official_content') or public.has_permission('moderate_all'))
  with check (public.has_permission('manage_official_content') or public.has_permission('moderate_all'));

-- opportunities -------------------------------------------------------------
create policy opportunities_select_visible on public.opportunities
  for select to authenticated
  using (status = 'published' or created_by = public.current_profile_id());
create policy opportunities_select_staff on public.opportunities
  for select to authenticated
  using (public.has_permission('manage_official_content') or public.has_permission('moderate_all'));
create policy opportunities_insert_official on public.opportunities
  for insert to authenticated
  with check (
    public.has_permission('manage_official_content')
    and source = 'official'
    and created_by = public.current_profile_id()
  );
create policy opportunities_insert_community on public.opportunities
  for insert to authenticated
  with check (
    public.has_permission('submit_opportunities')
    and public.is_active_user()
    and source = 'community'
    and status = (case when public.community_submissions_require_review('opportunity')
                       then 'pending' else 'published' end)::public.content_status
    and created_by = public.current_profile_id()
  );
create policy opportunities_update_author on public.opportunities
  for update to authenticated
  using (created_by = public.current_profile_id() and source = 'community')
  with check (created_by = public.current_profile_id() and source = 'community');
create policy opportunities_update_staff on public.opportunities
  for update to authenticated
  using (public.has_permission('manage_official_content') or public.has_permission('moderate_all'))
  with check (public.has_permission('manage_official_content') or public.has_permission('moderate_all'));
create policy opportunities_delete_author on public.opportunities
  for delete to authenticated using (created_by = public.current_profile_id() and source = 'community');

-- lost_found ----------------------------------------------------------------
create policy lost_found_select_visible on public.lost_found
  for select to authenticated
  using (
    status = 'published'
    and public.is_active_profile(creator_id)
    and not public.is_blocked_with_current(creator_id)
  );
create policy lost_found_select_own on public.lost_found
  for select to authenticated using (creator_id = public.current_profile_id());
create policy lost_found_select_staff on public.lost_found
  for select to authenticated using (public.has_permission('moderate_all'));

create policy lost_found_insert_own on public.lost_found
  for insert to authenticated
  with check (
    creator_id = public.current_profile_id()
    and public.is_active_user()
    and public.has_permission('create_lost_found')
    and status = 'published'
  );
create policy lost_found_update_own on public.lost_found
  for update to authenticated
  using (creator_id = public.current_profile_id())
  with check (creator_id = public.current_profile_id());
create policy lost_found_update_staff on public.lost_found
  for update to authenticated
  using (public.has_permission('moderate_all'))
  with check (public.has_permission('moderate_all'));
create policy lost_found_delete_own on public.lost_found
  for delete to authenticated using (creator_id = public.current_profile_id());

-- housing_posts -------------------------------------------------------------
create policy housing_select_visible on public.housing_posts
  for select to authenticated
  using (
    status = 'published'
    and public.is_active_profile(creator_id)
    and not public.is_blocked_with_current(creator_id)
  );
create policy housing_select_own on public.housing_posts
  for select to authenticated using (creator_id = public.current_profile_id());
create policy housing_insert_own on public.housing_posts
  for insert to authenticated
  with check (
    creator_id = public.current_profile_id()
    and public.is_active_user()
    and public.has_permission('create_housing_post')
    and status = 'published'
  );
create policy housing_update_own on public.housing_posts
  for update to authenticated
  using (creator_id = public.current_profile_id())
  with check (creator_id = public.current_profile_id());
create policy housing_delete_own on public.housing_posts
  for delete to authenticated using (creator_id = public.current_profile_id());
create policy housing_update_staff on public.housing_posts
  for update to authenticated
  using (public.has_permission('moderate_all'))
  with check (public.has_permission('moderate_all'));

-- ride_posts ----------------------------------------------------------------
create policy rides_select_visible on public.ride_posts
  for select to authenticated
  using (
    status = 'published'
    and public.is_active_profile(creator_id)
    and not public.is_blocked_with_current(creator_id)
  );
create policy rides_select_own on public.ride_posts
  for select to authenticated using (creator_id = public.current_profile_id());
create policy rides_insert_own on public.ride_posts
  for insert to authenticated
  with check (
    creator_id = public.current_profile_id()
    and public.is_active_user()
    and public.has_permission('create_ride_post')
    and status = 'published'
  );
create policy rides_update_own on public.ride_posts
  for update to authenticated
  using (creator_id = public.current_profile_id())
  with check (creator_id = public.current_profile_id());
create policy rides_delete_own on public.ride_posts
  for delete to authenticated using (creator_id = public.current_profile_id());
create policy rides_update_staff on public.ride_posts
  for update to authenticated
  using (public.has_permission('moderate_all'))
  with check (public.has_permission('moderate_all'));

-- projects ------------------------------------------------------------------
create policy projects_select_visible on public.projects
  for select to authenticated
  using (
    status = 'published'
    and public.is_active_profile(creator_id)
    and not public.is_blocked_with_current(creator_id)
  );
create policy projects_select_own on public.projects
  for select to authenticated using (creator_id = public.current_profile_id());
create policy projects_select_staff on public.projects
  for select to authenticated using (public.has_permission('moderate_all'));

create policy projects_insert_own on public.projects
  for insert to authenticated
  with check (
    creator_id = public.current_profile_id()
    and public.is_active_user()
    and public.has_permission('create_projects')
    and status = 'published'
  );
create policy projects_update_own on public.projects
  for update to authenticated
  using (creator_id = public.current_profile_id())
  with check (creator_id = public.current_profile_id());
create policy projects_update_staff on public.projects
  for update to authenticated
  using (public.has_permission('moderate_all'))
  with check (public.has_permission('moderate_all'));
create policy projects_delete_own on public.projects
  for delete to authenticated using (creator_id = public.current_profile_id());

create policy project_reactions_select on public.reactions
  for select to authenticated
  using (target_type <> 'project' or exists (select 1 from public.projects p where p.id = target_id));
create policy project_reactions_insert on public.reactions
  for insert to authenticated
  with check (
    target_type <> 'project'
    or (
      user_id = public.current_profile_id()
      and public.is_active_user()
      and public.has_permission('react_content')
      and exists (
        select 1 from public.projects p
        where p.id = target_id and p.status = 'published'
          and not public.is_blocked_with_current(p.creator_id)
      )
    )
  );

-- team_posts ----------------------------------------------------------------
create policy team_posts_select_visible on public.team_posts
  for select to authenticated
  using (
    status = 'published'
    and public.is_active_profile(creator_id)
    and not public.is_blocked_with_current(creator_id)
  );
create policy team_posts_select_own on public.team_posts
  for select to authenticated using (creator_id = public.current_profile_id());
create policy team_posts_insert_own on public.team_posts
  for insert to authenticated
  with check (
    creator_id = public.current_profile_id()
    and public.is_active_user()
    and public.has_permission('create_team_posts')
    and status = 'published'
  );
create policy team_posts_update_own on public.team_posts
  for update to authenticated
  using (creator_id = public.current_profile_id())
  with check (creator_id = public.current_profile_id());
create policy team_posts_delete_own on public.team_posts
  for delete to authenticated using (creator_id = public.current_profile_id());
create policy team_posts_update_staff on public.team_posts
  for update to authenticated
  using (public.has_permission('moderate_all'))
  with check (public.has_permission('moderate_all'));

-- team_post_requests --------------------------------------------------------
create policy team_post_requests_select_involved on public.team_post_requests
  for select to authenticated
  using (
    user_id = public.current_profile_id()
    or exists (select 1 from public.team_posts t
               where t.id = team_post_id and t.creator_id = public.current_profile_id())
  );
create policy team_post_requests_insert_self on public.team_post_requests
  for insert to authenticated
  with check (
    user_id = public.current_profile_id()
    and public.is_active_user()
    and exists (
      select 1 from public.team_posts t
      where t.id = team_post_id and t.status = 'published'
        and t.creator_id <> public.current_profile_id()
        and not public.is_blocked_with_current(t.creator_id)
    )
  );
create policy team_post_requests_decide_owner on public.team_post_requests
  for update to authenticated
  using (
    exists (select 1 from public.team_posts t
            where t.id = team_post_id and t.creator_id = public.current_profile_id())
  )
  with check (
    exists (select 1 from public.team_posts t
            where t.id = team_post_id and t.creator_id = public.current_profile_id())
  );
create policy team_post_requests_withdraw on public.team_post_requests
  for delete to authenticated using (user_id = public.current_profile_id());

-- achievements --------------------------------------------------------------
create policy achievements_select on public.achievements
  for select to authenticated using (is_active);
create policy achievements_manage on public.achievements
  for all to authenticated
  using (public.has_permission('manage_platform_settings'))
  with check (public.has_permission('manage_platform_settings'));

create policy user_achievements_select on public.user_achievements
  for select to authenticated using (true);
-- Awarded rows are written by evaluate_achievements() only.
