-- =============================================================================
-- Campus+ database tests — 08 marketplace contact details
-- =============================================================================
-- The marketplace funnel (spec §28, §60, §71):
--
--   browse (no contact details anywhere) → "I'm interested" → contact note + DM
--
-- A seller's contact note is the one piece of contact information the product
-- ever stores, so it gets its own suite: it must not be selectable from the
-- base table by other students, it must be released exactly once per student
-- through record_listing_interest(), the seller must be notified once, and the
-- seller/moderators must still be able to read and edit it.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Fixtures: a seller (Meera), a buyer (Naveen) and a moderator (Pravin)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);

insert into auth.users (id, email) values
  ('94000000-0000-4000-a000-000000000001', 'meera.kulkarni@pccoepune.org'),
  ('94000000-0000-4000-a000-000000000002', 'naveen.shah@pccoepune.org'),
  ('94000000-0000-4000-a000-000000000003', 'pravin_mod@pccoepune.org')
on conflict (id) do nothing;

do $$
declare
  r record;
begin
  for r in select * from (values
    ('94000000-0000-4000-a000-000000000001', 'meera_mkt', 'Meera Kulkarni'),
    ('94000000-0000-4000-a000-000000000002', 'naveen_mkt', 'Naveen Shah'),
    ('94000000-0000-4000-a000-000000000003', 'pravin_mod', 'Pravin Deshmukh')
  ) as t(id, username, name)
  loop
    perform set_config('request.jwt.claim.sub', r.id, false);
    perform public.complete_profile(p_username => r.username, p_display_name => r.name,
      p_branch => 'Mechanical Engineering', p_year => 'Second Year');
  end loop;
end;
$$;

select set_config('request.jwt.claim.sub', '', false);
select public.grant_role((select id from public.profiles where username = 'pravin_mod'), 'moderator');

-- ---------------------------------------------------------------------------
-- 1. The seller publishes a listing with a contact note
-- ---------------------------------------------------------------------------
reset role;
set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', '94000000-0000-4000-a000-000000000001', false);

do $$
declare
  v_category uuid;
begin
  select id into v_category from public.marketplace_categories where is_active order by sort_order limit 1;
  insert into public.marketplace_listings
    (seller_id, title, description, price, condition, category_id, status, contact_note)
  values
    (public.current_profile_id(), 'Graphing calculator', 'Casio FX-991, two years old, works perfectly.',
     900, 'good', v_category, 'active', 'WhatsApp me at 90000 00000 after 6pm.');
  perform public.test_assert(
    (select count(*) from public.marketplace_listings
      where seller_id = public.current_profile_id() and title = 'Graphing calculator') = 1,
    '1. the seller must be able to publish a listing with a contact note'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. The contact note is not readable from the base table
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '94000000-0000-4000-a000-000000000002', false);

do $$
begin
  -- Column privileges, not RLS: even a full-table read must fail outright.
  perform public.test_assert_denied(
    $sql$select contact_note from public.marketplace_listings limit 1$sql$,
    '2. a student must not be able to read a listing contact note directly'
  );
  perform public.test_assert_denied(
    $sql$select * from public.marketplace_listings limit 1$sql$,
    '2. a wildcard read must not leak the contact note either'
  );
  perform public.test_assert(
    (select count(*) from public.marketplace_listings
      where title = 'Graphing calculator') = 1,
    '2. the listing itself must still be discoverable without the contact note'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Expressing interest is the only release path
-- ---------------------------------------------------------------------------
do $$
declare
  v_listing uuid;
  v_interest jsonb;
begin
  select id into v_listing from public.marketplace_listings where title = 'Graphing calculator' limit 1;

  v_interest := public.record_listing_interest(v_listing);
  perform public.test_assert(
    v_interest->>'contact_note' = 'WhatsApp me at 90000 00000 after 6pm.',
    '3. expressing interest must release the contact note to the buyer'
  );
  perform public.test_assert(
    (select count(*) from public.marketplace_interactions
      where listing_id = v_listing and user_id = public.current_profile_id() and kind = 'contact') = 1,
    '3. the interest must be recorded as an interaction'
  );
  perform public.test_assert(
    (select contact_count from public.marketplace_listings where id = v_listing) = 1,
    '3. the listing must record the contact'
  );
end;
$$;

-- A repeated tap is idempotent: same note, one interaction row, one notification.
do $$
declare
  v_listing uuid;
  v_interest jsonb;
begin
  select id into v_listing from public.marketplace_listings where title = 'Graphing calculator' limit 1;

  v_interest := public.record_listing_interest(v_listing);
  perform public.test_assert(
    v_interest->>'contact_note' = 'WhatsApp me at 90000 00000 after 6pm.',
    '3. a repeated interest must still return the contact note'
  );
  perform public.test_assert(
    (select count(*) from public.marketplace_interactions
      where listing_id = v_listing and user_id = public.current_profile_id() and kind = 'contact') = 1,
    '3. a repeated interest must not create a second interaction row'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. The seller is notified once, and can read the note they wrote
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '94000000-0000-4000-a000-000000000001', false);

do $$
declare
  v_listing uuid;
begin
  select id into v_listing from public.marketplace_listings where title = 'Graphing calculator' limit 1;

  perform public.test_assert(
    (select count(*) from public.notifications
      where recipient_id = public.current_profile_id()
        and title = 'Someone is interested in your listing') = 1,
    '4. the seller must be notified exactly once about the interest'
  );
  perform public.test_assert(
    public.get_listing_contact_note(v_listing) = 'WhatsApp me at 90000 00000 after 6pm.',
    '4. the seller must be able to read their own contact note'
  );
end;
$$;

-- A different student gets nothing, and a moderator can read it for moderation.
select set_config('request.jwt.claim.sub', '94000000-0000-4000-a000-000000000003', false);

do $$
declare
  v_listing uuid;
begin
  select id into v_listing from public.marketplace_listings where title = 'Graphing calculator' limit 1;
  perform public.test_assert(
    public.get_listing_contact_note(v_listing) = 'WhatsApp me at 90000 00000 after 6pm.',
    '4. a moderator must be able to read a contact note for moderation'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Blocking closes the funnel: no interest, no note
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '94000000-0000-4000-a000-000000000002', false);

do $$
declare
  v_seller uuid;
  v_listing uuid;
begin
  select id into v_seller from public.profiles where username = 'meera_mkt';
  select id into v_listing from public.marketplace_listings where title = 'Graphing calculator' limit 1;

  insert into public.blocks (blocker_id, blocked_id, reason)
  values (public.current_profile_id(), v_seller, 'Test fixture');

  perform public.test_assert_denied(
    $sql$select public.record_listing_interest((select id from public.marketplace_listings where title = 'Graphing calculator' limit 1))$sql$,
    '5. a blocked student must not be able to express interest'
  );
  perform public.test_assert_denied(
    $sql$select public.get_listing_contact_note((select id from public.marketplace_listings where title = 'Graphing calculator' limit 1))$sql$,
    '5. a blocked student must not be able to read the contact note through the RPC either'
  );
  perform public.test_assert(
    (select count(*) from public.marketplace_interactions
      where listing_id = v_listing and user_id = public.current_profile_id() and kind = 'contact') = 1,
    '5. blocking must not remove the interest recorded before the block'
  );
end;
$$;
