-- Campus+ migration 008 — marketplace
-- Supabase CLI filename: 20261005000008_008_marketplace.sql
-- This file is part of the single authoritative migration history in supabase/migrations/.
-- =============================================================================
-- Campus+ 008 — marketplace, gigs, free stuff, deals, ratings
-- =============================================================================
-- Listings are text-only. "Free stuff" is the same table with is_free = true
-- (spec §30: do not build duplicate infrastructure). Deals are the official,
-- staff-managed counterpart (spec §31).
--
-- Seller contact always reuses the DM system: there is no marketplace messaging
-- table anywhere in this schema (spec §26, §134).
-- =============================================================================

-- ----------------------------------------------------------------------------
-- categories — editable by Admin/Super Admin (spec §28)
-- ----------------------------------------------------------------------------

create table public.marketplace_categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 2 and 60),
  slug        text not null unique check (slug ~ '^[a-z0-9-]{2,60}$'),
  description text check (description is null or length(description) <= 200),
  -- which board the category belongs to
  scope       text not null default 'marketplace' check (scope in ('marketplace', 'gig', 'deal')),
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index marketplace_categories_scope_idx on public.marketplace_categories (scope, sort_order);

create trigger marketplace_categories_touch before update on public.marketplace_categories
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- listings
-- ----------------------------------------------------------------------------

create table public.marketplace_listings (
  id                uuid primary key default gen_random_uuid(),
  seller_id         uuid not null references public.profiles (id) on delete cascade,
  category_id       uuid not null references public.marketplace_categories (id) on delete restrict,
  title             text not null check (length(btrim(title)) between 3 and 120),
  description       text not null check (length(btrim(description)) between 5 and 1500),
  price             numeric(12, 2) check (price is null or price >= 0),
  is_free           boolean not null default false,
  is_negotiable     boolean not null default true,
  condition         public.item_condition not null default 'not_applicable',
  location          text check (location is null or length(location) <= 120),
  contact_note      text check (contact_note is null or length(contact_note) <= 200),
  status            public.listing_status not null default 'active',
  reserved_for      uuid references public.profiles (id) on delete set null,
  sold_at           timestamptz,
  sold_to           uuid references public.profiles (id) on delete set null,
  view_count        integer not null default 0 check (view_count >= 0),
  contact_count     integer not null default 0 check (contact_count >= 0),
  is_official       boolean not null default false,
  moderated_by      uuid references public.profiles (id) on delete set null,
  moderated_at      timestamptz,
  moderation_reason text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  search_vector     tsvector generated always as (
    to_tsvector('english'::regconfig, coalesce(title, '') || ' ' || coalesce(description, ''))
  ) stored,
  constraint listings_free_price check (not is_free or price is null or price = 0)
);

create index marketplace_listings_status_idx on public.marketplace_listings (status, created_at desc);
create index listings_reserved_idx on public.marketplace_listings (reserved_for) where reserved_for is not null;
create index listings_sold_idx on public.marketplace_listings (sold_to) where sold_to is not null;
create index marketplace_listings_category_idx on public.marketplace_listings (category_id, status);
create index marketplace_listings_seller_idx on public.marketplace_listings (seller_id, created_at desc);
create index marketplace_listings_free_idx on public.marketplace_listings (created_at desc) where is_free;
create index marketplace_listings_search_idx on public.marketplace_listings using gin (search_vector);

create trigger marketplace_listings_touch before update on public.marketplace_listings
  for each row execute function public.touch_updated_at();

comment on table public.marketplace_listings is
  'Student listings, gig board is separate. No image, file or video columns exist by design.';

-- Seller-editable columns only; moderation state and counters are protected.
create or replace function public.guard_listing_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_trusted_writer() then
    new.view_count := (
      select count(*) from public.marketplace_interactions i
      where i.listing_id = old.id and i.kind = 'view'
    );
    new.contact_count := (
      select count(*) from public.marketplace_interactions i
      where i.listing_id = old.id and i.kind = 'contact'
    );
  end if;

  if public.is_trusted_writer() or public.has_permission('moderate_marketplace') or public.has_permission('moderate_all') then
    return new;
  end if;
  new.seller_id         := old.seller_id;
  new.category_id       := old.category_id;
  new.is_official       := old.is_official;
  new.moderated_by      := old.moderated_by;
  new.moderated_at      := old.moderated_at;
  new.moderation_reason := old.moderation_reason;
  new.sold_at           := old.sold_at;
  new.sold_to           := old.sold_to;
  -- A seller may only move a listing between the student-controlled states.
  if new.status is distinct from old.status
     and new.status not in ('active', 'reserved', 'sold', 'expired') then
    new.status := old.status;
  end if;
  return new;
end;
$$;

create trigger marketplace_listings_guard_update
  before update on public.marketplace_listings
  for each row execute function public.guard_listing_update();

-- Pre-publication moderation mode (spec §27): when the operator selects
-- "moderator approval before publishing", student listings start as `pending`.
create or replace function public.marketplace_requires_approval()
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
    select value into v_value from public.platform_settings where key = 'marketplace_approval_mode';
  exception when undefined_table then
    return false;  -- platform_settings not migrated yet: default to post-moderation
  end;
  return coalesce(v_value, '"post_moderation"'::jsonb) = '"pre_moderation"'::jsonb;
end;
$$;

create or replace function public.apply_listing_approval_mode()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.is_trusted_writer() or public.has_permission('moderate_marketplace') or public.is_staff() then
    return new;
  end if;
  if new.status = 'active' and public.marketplace_requires_approval() then
    new.status := 'pending';
  end if;
  return new;
end;
$$;

create trigger marketplace_listings_approval
  before insert on public.marketplace_listings
  for each row execute function public.apply_listing_approval_mode();

-- ----------------------------------------------------------------------------
-- marketplace_interactions — operational counters, not analytics (spec §123)
-- ----------------------------------------------------------------------------

create table public.marketplace_interactions (
  id         uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.marketplace_listings (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  kind       text not null check (kind in ('view', 'contact', 'save')),
  created_at timestamptz not null default now()
);

create index marketplace_interactions_listing_idx on public.marketplace_interactions (listing_id, kind);
create index marketplace_interactions_user_idx on public.marketplace_interactions (user_id, created_at desc);
-- One 'contact'/'save' row per student per listing. The table backs operational
-- counters and the "notify the seller once" rule, not an event log, so the
-- partial unique index is what makes `on conflict do nothing` meaningful.
create unique index marketplace_interactions_once_idx
  on public.marketplace_interactions (listing_id, user_id, kind)
  where kind in ('contact', 'save');

-- Keep the denormalised counters on the listing truthful: guard_listing_update()
-- recomputes them on every listing write, and this trigger does the same when an
-- interaction is the thing that changed.
create or replace function public.sync_listing_counters()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_listing uuid := coalesce(new.listing_id, old.listing_id);
begin
  update public.marketplace_listings l
     set view_count = (
           select count(*) from public.marketplace_interactions i
           where i.listing_id = v_listing and i.kind = 'view'
         ),
         contact_count = (
           select count(*) from public.marketplace_interactions i
           where i.listing_id = v_listing and i.kind = 'contact'
         )
   where l.id = v_listing;
  return null;
end;
$$;

create trigger marketplace_interactions_sync_counters
  after insert or delete on public.marketplace_interactions
  for each row execute function public.sync_listing_counters();

-- ----------------------------------------------------------------------------
-- gigs (student services board, spec §29)
-- ----------------------------------------------------------------------------

create table public.gigs (
  id                uuid primary key default gen_random_uuid(),
  creator_id        uuid not null references public.profiles (id) on delete cascade,
  category_id       uuid references public.marketplace_categories (id) on delete set null,
  title             text not null check (length(btrim(title)) between 3 and 120),
  description       text not null check (length(btrim(description)) between 5 and 1500),
  category          text not null check (length(btrim(category)) between 2 and 60),
  compensation      text check (compensation is null or length(compensation) <= 120),
  availability      text check (availability is null or length(availability) <= 200),
  status            public.content_status not null default 'published',
  moderated_by      uuid references public.profiles (id) on delete set null,
  moderated_at      timestamptz,
  moderation_reason text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  search_vector     tsvector generated always as (
    to_tsvector('english'::regconfig, coalesce(title, '') || ' ' || coalesce(description, ''))
  ) stored
);

create index gigs_status_idx on public.gigs (status, created_at desc);
create index gigs_creator_idx on public.gigs (creator_id, created_at desc);
create index gigs_category_idx on public.gigs (category_id, status);
create index gigs_search_idx on public.gigs using gin (search_vector);

create trigger gigs_touch before update on public.gigs
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- campus_deals (official, spec §31)
-- ----------------------------------------------------------------------------

create table public.campus_deals (
  id                uuid primary key default gen_random_uuid(),
  title             text not null check (length(btrim(title)) between 3 and 120),
  description       text not null check (length(btrim(description)) between 5 and 1000),
  merchant          text not null check (length(btrim(merchant)) between 2 and 120),
  discount_details  text not null check (length(btrim(discount_details)) between 2 and 300),
  valid_from        date,
  valid_until       date,
  contact_info      text check (contact_info is null or length(contact_info) <= 200),
  status            public.content_status not null default 'published',
  is_official       boolean not null default true,
  created_by        uuid not null references public.profiles (id) on delete restrict,
  updated_by        uuid references public.profiles (id) on delete set null,
  published_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  search_vector     tsvector generated always as (
    to_tsvector('english'::regconfig, coalesce(title, '') || ' ' || coalesce(merchant, '') || ' ' || coalesce(description, ''))
  ) stored,
  constraint deals_validity_order check (valid_until is null or valid_from is null or valid_until >= valid_from)
);

create index campus_deals_status_idx on public.campus_deals (status, created_at desc);
create index campus_deals_search_idx on public.campus_deals using gin (search_vector);

create trigger campus_deals_touch before update on public.campus_deals
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- ratings — simple buyer/seller reputation (spec §52)
-- ----------------------------------------------------------------------------

create table public.ratings (
  id         uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.marketplace_listings (id) on delete cascade,
  rater_id   uuid not null references public.profiles (id) on delete cascade,
  ratee_id   uuid not null references public.profiles (id) on delete cascade,
  role       public.rating_role not null default 'seller',
  score      integer not null check (score between 1 and 5),
  comment    text check (comment is null or length(comment) <= 300),
  created_at timestamptz not null default now(),
  constraint ratings_no_self check (rater_id <> ratee_id),
  unique (listing_id, rater_id, role)
);

create index ratings_ratee_idx on public.ratings (ratee_id, created_at desc);
create index ratings_rater_idx on public.ratings (rater_id);

comment on table public.ratings is
  'Marketplace reputation only: one rating per participant per listing. No popularity or engagement scoring.';

-- Recompute reputation deterministically from the ratings table.
create or replace function public.recompute_reputation(p_profile uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.profiles p
     set reputation_score = coalesce((select round(avg(r.score)::numeric, 2) from public.ratings r where r.ratee_id = p_profile), 0),
         reputation_count = coalesce((select count(*) from public.ratings r where r.ratee_id = p_profile), 0)
   where p.id = p_profile;
end;
$$;

create or replace function public.on_rating_changed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.recompute_reputation(coalesce(new.ratee_id, old.ratee_id));
  return coalesce(new, old);
end;
$$;

create trigger ratings_recompute
  after insert or update or delete on public.ratings
  for each row execute function public.on_rating_changed();

-- Completed marketplace interactions (used by the "Marketplace Seller" achievement
-- and the public trust indicator).
create or replace function public.on_listing_completed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'sold' and old.status <> 'sold' then
    update public.profiles
       set marketplace_completed_count = marketplace_completed_count + 1
     where id = new.seller_id;
  end if;
  return new;
end;
$$;

create trigger marketplace_listings_completed
  after update on public.marketplace_listings
  for each row execute function public.on_listing_completed();

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------

alter table public.marketplace_categories enable row level security;
alter table public.marketplace_listings enable row level security;
alter table public.marketplace_interactions enable row level security;
alter table public.gigs enable row level security;
alter table public.campus_deals enable row level security;
alter table public.ratings enable row level security;

-- categories ----------------------------------------------------------------
create policy marketplace_categories_select on public.marketplace_categories
  for select to authenticated using (true);
create policy marketplace_categories_manage on public.marketplace_categories
  for all to authenticated
  using (public.has_permission('manage_categories'))
  with check (public.has_permission('manage_categories'));

-- listings ------------------------------------------------------------------
create policy listings_select_visible on public.marketplace_listings
  for select to authenticated
  using (
    status in ('active', 'reserved', 'sold')
    and public.is_active_profile(seller_id)
    and not public.is_blocked_with_current(seller_id)
  );

create policy listings_select_own on public.marketplace_listings
  for select to authenticated using (seller_id = public.current_profile_id());

create policy listings_select_staff on public.marketplace_listings
  for select to authenticated
  using (public.has_permission('moderate_marketplace') or public.has_permission('moderate_all'));

create policy listings_insert_own on public.marketplace_listings
  for insert to authenticated
  with check (
    seller_id = public.current_profile_id()
    and public.is_active_user()
    and public.has_permission('create_marketplace_listing')
    and status in ('active', 'pending')
    and is_official = false
    and exists (select 1 from public.marketplace_categories c where c.id = category_id and c.is_active)
  );

create policy listings_update_own on public.marketplace_listings
  for update to authenticated
  using (seller_id = public.current_profile_id() and public.is_active_user())
  with check (seller_id = public.current_profile_id());

create policy listings_update_staff on public.marketplace_listings
  for update to authenticated
  using (public.has_permission('moderate_marketplace') or public.has_permission('moderate_all'))
  with check (public.has_permission('moderate_marketplace') or public.has_permission('moderate_all'));

create policy listings_delete_own on public.marketplace_listings
  for delete to authenticated using (seller_id = public.current_profile_id());
create policy listings_delete_staff on public.marketplace_listings
  for delete to authenticated
  using (public.has_permission('moderate_marketplace') or public.has_permission('moderate_all'));

-- interactions --------------------------------------------------------------
create policy marketplace_interactions_select_own on public.marketplace_interactions
  for select to authenticated using (user_id = public.current_profile_id());
create policy marketplace_interactions_select_seller on public.marketplace_interactions
  for select to authenticated
  using (exists (select 1 from public.marketplace_listings l
                 where l.id = listing_id and l.seller_id = public.current_profile_id()));

create policy marketplace_interactions_insert_self on public.marketplace_interactions
  for insert to authenticated
  with check (
    user_id = public.current_profile_id()
    and public.has_permission('block_users')  -- any signed-in student
    and exists (select 1 from public.marketplace_listings l
                where l.id = listing_id and l.status in ('active', 'reserved', 'sold'))
  );

-- gigs ----------------------------------------------------------------------
create policy gigs_select_visible on public.gigs
  for select to authenticated
  using (
    status = 'published'
    and public.is_active_profile(creator_id)
    and not public.is_blocked_with_current(creator_id)
  );
create policy gigs_select_own on public.gigs
  for select to authenticated using (creator_id = public.current_profile_id());
create policy gigs_select_staff on public.gigs
  for select to authenticated
  using (public.has_permission('moderate_marketplace') or public.has_permission('moderate_all'));

create policy gigs_insert_own on public.gigs
  for insert to authenticated
  with check (
    creator_id = public.current_profile_id()
    and public.is_active_user()
    and public.has_permission('create_gigs')
    and status = 'published'
  );

create policy gigs_update_own on public.gigs
  for update to authenticated
  using (creator_id = public.current_profile_id() and public.is_active_user())
  with check (creator_id = public.current_profile_id());
create policy gigs_update_staff on public.gigs
  for update to authenticated
  using (public.has_permission('moderate_marketplace') or public.has_permission('moderate_all'))
  with check (public.has_permission('moderate_marketplace') or public.has_permission('moderate_all'));
create policy gigs_delete_own on public.gigs
  for delete to authenticated using (creator_id = public.current_profile_id());

-- deals (official only) -----------------------------------------------------
create policy campus_deals_select_published on public.campus_deals
  for select to authenticated using (status = 'published' or public.has_permission('manage_deals'));
create policy campus_deals_manage on public.campus_deals
  for all to authenticated
  using (public.has_permission('manage_deals') or public.has_permission('moderate_all'))
  with check (public.has_permission('manage_deals') or public.has_permission('moderate_all'));

-- ratings -------------------------------------------------------------------
create policy ratings_select_public on public.ratings
  for select to authenticated using (true);

create policy ratings_insert_participant on public.ratings
  for insert to authenticated
  with check (
    rater_id = public.current_profile_id()
    and public.is_active_user()
    and public.has_permission('rate_users')
    -- A rating must reference a real listing where the two people actually dealt
    -- with each other: either the seller rating the recorded buyer, or a student
    -- who contacted the listing rating the seller.
    and exists (
      select 1
      from public.marketplace_listings l
      where l.id = listing_id
        and (
          (l.seller_id = rater_id and ratee_id = l.sold_to and role = 'buyer')
          or (l.seller_id = ratee_id
              and role = 'seller'
              and exists (
                select 1 from public.marketplace_interactions i
                where i.listing_id = l.id and i.user_id = rater_id and i.kind = 'contact'
              ))
        )
    )
  );

create policy ratings_update_own on public.ratings
  for update to authenticated
  using (rater_id = public.current_profile_id())
  with check (rater_id = public.current_profile_id());
create policy ratings_delete_own on public.ratings
  for delete to authenticated using (rater_id = public.current_profile_id());
