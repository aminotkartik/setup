-- Campus+ migration 025 — dedicated gigs and clubs
-- Supabase CLI filename: 20261005000025_025_gigs_and_clubs.sql
-- This file is part of the single authoritative migration history in supabase/migrations/.
-- =============================================================================
-- Campus+ 025 — the Gigs and Clubs sections get the fields their screens need
-- =============================================================================
-- Additive only. No table is rebuilt, no row is rewritten and no existing
-- policy is narrowed:
--
--   Gigs — a lifecycle (`gig_state`: open / closed / completed) that is
--     independent of moderation (`content_status`), the fields the dedicated
--     posting form collects (skills, paid or unpaid, deadline, application
--     contact), and one `gig_applications` table so "apply" is a real,
--     auditable interaction instead of an off-platform DM.
--     `content_status` keeps its meaning: published / hidden / removed /
--     deleted is what moderators control. `state` is what the poster controls.
--
--   Clubs — a nullable `club_category` on `communities` (Technical, Cultural,
--     Sports, Arts, Entrepreneurship, Social). Clubs stay rows in
--     `communities` (kind = 'club'); membership, joins, chat, join requests and
--     posts are reused unchanged. One guard is added so a non-staff writer can
--     never mint an "Official" club, and staff-created clubs record who
--     approved them.
--
-- Existing gigs default to state = 'open', payment_type = 'unpaid' and an empty
-- skills array, which is exactly how they behaved before this migration.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- Gigs — lifecycle and the fields the gig form collects
-- ----------------------------------------------------------------------------

create type public.gig_state as enum ('open', 'closed', 'completed');

alter table public.gigs
  add column state           public.gig_state not null default 'open',
  add column skills          text[] not null default '{}'::text[],
  add column payment_type    text not null default 'unpaid',
  add column deadline        date,
  add column contact_details text;

alter table public.gigs
  add constraint gigs_payment_type_check
    check (payment_type in ('paid', 'unpaid')),
  add constraint gigs_skills_count_check
    check (cardinality(skills) <= 12),
  add constraint gigs_skills_text_check
    check (length(array_to_string(skills, ' ')) <= 480),
  add constraint gigs_contact_details_check
    check (contact_details is null or length(btrim(contact_details)) <= 300);

comment on column public.gigs.state is
  'Poster-controlled lifecycle: open (accepting applications), closed (no longer accepting) or completed. Moderation stays in status.';
comment on column public.gigs.payment_type is
  'paid or unpaid. compensation carries the human-readable amount/rate.';
comment on column public.gigs.skills is
  'Up to 12 required-skill labels; filtered with the array containment operator.';

create index gigs_state_idx on public.gigs (state, created_at desc);
create index gigs_skills_idx on public.gigs using gin (skills);

-- A gig past its deadline is no longer accepting applications. The row keeps
-- state = 'open' until its owner closes it; this index makes the "closing soon"
-- ordering on /gigs cheap.
create index gigs_deadline_idx on public.gigs (deadline) where deadline is not null;

-- ----------------------------------------------------------------------------
-- gig_applications — one row per student per gig
-- ----------------------------------------------------------------------------

create type public.gig_application_status as enum ('pending', 'accepted', 'declined', 'withdrawn');

create table public.gig_applications (
  id           uuid primary key default gen_random_uuid(),
  gig_id       uuid not null references public.gigs (id) on delete cascade,
  applicant_id uuid not null references public.profiles (id) on delete cascade,
  message      text not null check (length(btrim(message)) between 5 and 1000),
  status       public.gig_application_status not null default 'pending',
  decided_by   uuid references public.profiles (id) on delete set null,
  decided_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (gig_id, applicant_id)
);

create index gig_applications_gig_idx on public.gig_applications (gig_id, created_at desc);
create index gig_applications_applicant_idx on public.gig_applications (applicant_id, created_at desc);

comment on table public.gig_applications is
  'Applications to a student gig. A student applies once; the gig owner accepts or declines; the applicant can withdraw. Contact still happens through DMs.';

create trigger gig_applications_touch before update on public.gig_applications
  for each row execute function public.touch_updated_at();

-- Defence in depth: RLS already limits who may update a row, but a gig owner
-- must not be able to rewrite the applicant's words, and an applicant must not
-- be able to accept themselves.
create or replace function public.guard_gig_application_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
begin
  if public.is_trusted_writer() then
    return new;
  end if;

  select g.creator_id into v_owner from public.gigs g where g.id = old.gig_id;

  new.gig_id := old.gig_id;
  new.applicant_id := old.applicant_id;
  new.message := old.message;
  new.created_at := old.created_at;

  if v_owner = public.current_profile_id() then
    -- The owner only decides, from pending, and only for themselves.
    if new.status not in ('accepted', 'declined') then
      raise exception 'A gig owner can only accept or decline an application.'
        using errcode = '42501';
    end if;
    if old.status <> 'pending' then
      raise exception 'That application has already been decided.' using errcode = '42501';
    end if;
    new.decided_by := public.current_profile_id();
    new.decided_at := coalesce(new.decided_at, now());
  else
    -- Everyone else is the applicant: the only allowed change is withdrawing.
    if new.status <> 'withdrawn' then
      raise exception 'An applicant can only withdraw an application.' using errcode = '42501';
    end if;
    if old.status not in ('pending', 'accepted') then
      raise exception 'That application can no longer be withdrawn.' using errcode = '42501';
    end if;
    new.decided_by := old.decided_by;
    new.decided_at := old.decided_at;
  end if;

  return new;
end;
$$;

create trigger gig_applications_guard
  before update on public.gig_applications
  for each row execute function public.guard_gig_application_update();

alter table public.gig_applications enable row level security;

-- The applicant always sees their own application; the gig owner sees the
-- applications for their gigs; staff see everything.
create policy gig_applications_select_own on public.gig_applications
  for select to authenticated
  using (applicant_id = public.current_profile_id());

create policy gig_applications_select_owner on public.gig_applications
  for select to authenticated
  using (
    exists (
      select 1 from public.gigs g
      where g.id = gig_id and g.creator_id = public.current_profile_id()
    )
  );

create policy gig_applications_select_staff on public.gig_applications
  for select to authenticated
  using (public.has_permission('moderate_marketplace') or public.has_permission('moderate_all'));

-- Apply: an active student, once, to a published and open gig that is not
-- their own and whose owner has not blocked them.
create policy gig_applications_insert_own on public.gig_applications
  for insert to authenticated
  with check (
    applicant_id = public.current_profile_id()
    and public.is_active_user()
    and status = 'pending'
    and exists (
      select 1 from public.gigs g
      where g.id = gig_id
        and g.status = 'published'
        and g.state = 'open'
        and g.creator_id <> public.current_profile_id()
        and not public.is_blocked_with_current(g.creator_id)
    )
  );

create policy gig_applications_withdraw_own on public.gig_applications
  for update to authenticated
  using (applicant_id = public.current_profile_id() and status in ('pending', 'accepted'))
  with check (applicant_id = public.current_profile_id() and status = 'withdrawn');

create policy gig_applications_decide_owner on public.gig_applications
  for update to authenticated
  using (
    status = 'pending'
    and exists (
      select 1 from public.gigs g
      where g.id = gig_id and g.creator_id = public.current_profile_id()
    )
  )
  with check (
    status in ('accepted', 'declined')
    and decided_by = public.current_profile_id()
  );

create policy gig_applications_update_staff on public.gig_applications
  for update to authenticated
  using (public.has_permission('moderate_marketplace') or public.has_permission('moderate_all'))
  with check (public.has_permission('moderate_marketplace') or public.has_permission('moderate_all'));

-- A student may delete their own application (an alternative to withdrawing).
create policy gig_applications_delete_own on public.gig_applications
  for delete to authenticated using (applicant_id = public.current_profile_id());

-- ----------------------------------------------------------------------------
-- Clubs — category on the shared communities table
-- ----------------------------------------------------------------------------

alter table public.communities
  add column club_category text;

alter table public.communities
  add constraint communities_club_category_check
  check (
    club_category is null
    or (kind = 'club' and club_category in ('Technical', 'Cultural', 'Sports', 'Arts', 'Entrepreneurship', 'Social'))
  );

comment on column public.communities.club_category is
  'Discovery category for kind = club. Null for communities and study groups.';

create index communities_club_category_idx
  on public.communities (club_category)
  where kind = 'club';

-- ----------------------------------------------------------------------------
-- Official clubs are staff-created, and say who approved them
-- ----------------------------------------------------------------------------
-- `communities_insert_own` lets a writer with the right kind permission create
-- a row, but nothing used to stop a non-staff writer from setting
-- is_official = true on that insert. This guard closes that hole for every
-- kind without changing any existing policy.
create or replace function public.guard_community_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.is_trusted_writer() then
    return new;
  end if;

  if new.is_official then
    if not (
      public.has_permission('manage_clubs')
      or public.has_permission('manage_official_content')
      or public.has_permission('moderate_all')
    ) then
      raise exception 'Only campus staff can publish official content.'
        using errcode = '42501';
    end if;
    new.approved_by := coalesce(new.approved_by, public.current_profile_id());
    new.approved_at := coalesce(new.approved_at, now());
  else
    new.approved_by := null;
    new.approved_at := null;
  end if;

  return new;
end;
$$;

create trigger communities_guard_insert
  before insert on public.communities
  for each row execute function public.guard_community_insert();

-- ----------------------------------------------------------------------------
-- Column privileges for the new fields
-- ----------------------------------------------------------------------------
-- Migration 015 restricts which columns an authenticated writer may update.
-- The gig lifecycle fields and the club category are owner-managed, so they
-- join that allow-list; everything else on `gigs` stays readonly to clients.
grant update (state, skills, payment_type, deadline, contact_details)
  on public.gigs to authenticated;

grant update (club_category)
  on public.communities to authenticated;
