-- Campus+ migration 017 — marketplace hardening
-- Supabase CLI filename: 20261005000017_017_marketplace_hardening.sql
-- This file is part of the single authoritative migration history in supabase/migrations/.
-- =============================================================================
-- Campus+ 017 — marketplace: interest → contact → completion
-- =============================================================================
-- One explicit funnel, all of it server-side:
--
--   browse (no contact details) → "I'm interested"  → contact details + DM
--                               → seller marks the item sold → ratings allowed
--
-- Blocking is respected at every step, and the seller is notified once.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- Express interest: records the interaction, notifies the seller, and only then
-- hands back the contact note.
-- ----------------------------------------------------------------------------

create or replace function public.record_listing_interest(p_listing uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := public.current_profile_id();
  v_listing public.marketplace_listings;
  v_interaction uuid;
begin
  if v_me is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not public.is_active_user() then
    raise exception 'Your account cannot use the marketplace.' using errcode = '42501';
  end if;
  if not public.feature_enabled('marketplace') then
    raise exception 'The marketplace is disabled.' using errcode = '42501';
  end if;

  select * into v_listing from public.marketplace_listings where id = p_listing;
  if v_listing.id is null or v_listing.status not in ('active', 'reserved') then
    raise exception 'That listing is no longer available.' using errcode = '22023';
  end if;
  if v_listing.seller_id = v_me then
    raise exception 'That is your own listing.' using errcode = '22023';
  end if;
  if public.is_blocked(v_me, v_listing.seller_id) or public.is_blocked(v_listing.seller_id, v_me) then
    raise exception 'You cannot contact this seller.' using errcode = '42501';
  end if;

  -- One 'contact' row per student per listing. A repeated tap returns the
  -- contact note again but must not notify the seller twice.
  insert into public.marketplace_interactions (listing_id, user_id, kind)
  values (p_listing, v_me, 'contact')
  on conflict do nothing
  returning id into v_interaction;

  if v_interaction is not null then
    perform public.notify_user(
      v_listing.seller_id, 'marketplace_status',
      'Someone is interested in your listing',
      'A student asked about "' || left(v_listing.title, 80) || '".',
      'marketplace_listing', p_listing::text, '/market/listing/' || p_listing::text
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'seller_id', v_listing.seller_id,
    'contact_note', v_listing.contact_note
  );
end;
$$;

comment on function public.record_listing_interest(uuid) is
  'The only path that reveals a listing''s contact details. Records the interaction and notifies the seller.';

-- ----------------------------------------------------------------------------
-- The seller (and moderators) keep access to the contact note they own.
-- ----------------------------------------------------------------------------
-- Clients lost SELECT on `contact_note` in migration 015, so the seller's edit
-- form reads it through here instead of the base table.
create or replace function public.get_listing_contact_note(p_listing uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_note text;
  v_seller uuid;
begin
  select l.contact_note, l.seller_id into v_note, v_seller
  from public.marketplace_listings l
  where l.id = p_listing;
  if v_seller is null then
    raise exception 'That listing could not be found.' using errcode = '22023';
  end if;
  if not (v_seller = public.current_profile_id()
          or public.has_permission('moderate_marketplace')
          or public.is_trusted_writer()) then
    raise exception 'Contact details are released only through the interest flow.' using errcode = '42501';
  end if;
  return v_note;
end;
$$;

comment on function public.get_listing_contact_note(uuid) is
  'Owner/moderator read of a listing contact note; buyers get it from record_listing_interest().';

-- ----------------------------------------------------------------------------
-- The seller closes the loop. `sold_to` is what unlocks buyer ratings, so it is
-- set here rather than by the client.
-- ----------------------------------------------------------------------------

create or replace function public.mark_listing_completed(p_listing uuid, p_buyer uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := public.current_profile_id();
  v_buyer uuid := p_buyer;
  v_seller uuid;
begin
  if v_me is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select seller_id into v_seller from public.marketplace_listings where id = p_listing;
  if v_seller is null then
    raise exception 'That listing could not be found.' using errcode = '22023';
  end if;
  if v_seller <> v_me and not public.has_permission('moderate_marketplace') then
    raise exception 'Only the seller can mark a listing as sold.' using errcode = '42501';
  end if;

  if v_buyer is null then
    -- Default to the student who most recently showed interest.
    select i.user_id into v_buyer
    from public.marketplace_interactions i
    where i.listing_id = p_listing and i.kind = 'contact'
    order by i.created_at desc
    limit 1;
  end if;
  if v_buyer is null then
    raise exception 'Choose the student the item was handed to.' using errcode = '22023';
  end if;
  if v_buyer = v_seller then
    raise exception 'The buyer cannot be the seller.' using errcode = '22023';
  end if;

  update public.marketplace_listings
     set status = 'sold', sold_to = v_buyer, sold_at = now()
   where id = p_listing;

  perform public.notify_user(
    v_buyer, 'marketplace_rating',
    'You can now rate this trade',
    'The seller marked "' || left(coalesce((select title from public.marketplace_listings where id = p_listing), 'a listing'), 80)
      || '" as completed. Leave a rating to help other students.',
    'marketplace_listing', p_listing::text, '/market/listing/' || p_listing::text
  );

  perform public.log_audit('marketplace.completed', 'marketplace_listing', p_listing::text,
    jsonb_build_object('buyer_id', v_buyer), false, null, 'private');

  return jsonb_build_object('ok', true, 'buyer_id', v_buyer);
end;
$$;

-- ----------------------------------------------------------------------------
-- The seller's own view of who is interested (RLS already restricts this to the
-- seller and staff; this view adds the student's public identity in one read).
-- ----------------------------------------------------------------------------

create or replace view public.listing_interests_view
with (security_invoker = true) as
select
  i.id,
  i.listing_id,
  i.user_id,
  pr.username,
  pr.display_name,
  i.created_at
from public.marketplace_interactions i
join public.public_profiles pr on pr.id = i.user_id
where i.kind = 'contact';

comment on view public.listing_interests_view is
  'Students who expressed interest in a listing. Visible only to the seller and staff (security_invoker + base-table RLS).';
