-- =============================================================================
-- Campus+ database tests — 09 marketplace lifecycle (resolve / remove / delete)
-- =============================================================================
-- Regression coverage for three bugs fixed in migration 021:
--
--   1. mark_listing_completed() used to raise when nobody had tapped "I'm
--      interested" first, and even when a buyer could be inferred, its own
--      log_audit() call used to raise a second, different error for any
--      non-staff seller — "Mark as sold" could never finish successfully for
--      an ordinary student (spec: resolve must work, not just stop erroring).
--   2. guard_listing_update() silently dropped a transition to 'removed',
--      so "Remove listing" always reported success without changing anything.
--   3. A permanent delete is now reachable (lib/actions/marketplace.js
--      deleteListing()) and RLS must keep it owner-only.
-- =============================================================================

select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);

insert into auth.users (id, email) values
  ('95000000-0000-4000-a000-000000000001', 'asha.sold@pccoepune.org'),
  ('95000000-0000-4000-a000-000000000002', 'vikram.buyer@pccoepune.org'),
  ('95000000-0000-4000-a000-000000000003', 'outsider.lifecycle@pccoepune.org')
on conflict (id) do nothing;

do $$
declare
  r record;
begin
  for r in select * from (values
    ('95000000-0000-4000-a000-000000000001', 'asha_mkt2', 'Asha Patil'),
    ('95000000-0000-4000-a000-000000000002', 'vikram_mkt2', 'Vikram Rao'),
    ('95000000-0000-4000-a000-000000000003', 'outsider_mkt2', 'Outsider Student')
  ) as t(id, username, name)
  loop
    perform set_config('request.jwt.claim.sub', r.id, false);
    perform public.complete_profile(p_username => r.username, p_display_name => r.name,
      p_branch => 'Computer Engineering', p_year => 'Third Year');
  end loop;
end;
$$;

select set_config('request.jwt.claim.sub', '', false);

-- ---------------------------------------------------------------------------
-- 1. Resolving with no recorded interest completes instead of raising
-- ---------------------------------------------------------------------------
reset role;
set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', '95000000-0000-4000-a000-000000000001', false);

do $$
declare
  v_category uuid;
  v_listing uuid;
  v_result jsonb;
begin
  select id into v_category from public.marketplace_categories where is_active order by sort_order limit 1;
  insert into public.marketplace_listings
    (seller_id, title, description, price, condition, category_id, status)
  values
    (public.current_profile_id(), 'Lifecycle test item one', 'A listing nobody expressed interest in before resolving.',
     150, 'good', v_category, 'active')
  returning id into v_listing;

  v_result := public.mark_listing_completed(v_listing, null);
  perform public.test_assert(
    (v_result->>'ok')::boolean = true,
    '1. resolving a listing with no prior interest must succeed, not raise'
  );
  perform public.test_assert(
    v_result->'buyer_id' = 'null'::jsonb,
    '1. the result must say there was no buyer rather than inventing one'
  );
  perform public.test_assert(
    (select status from public.marketplace_listings where id = v_listing) = 'sold',
    '1. the listing must actually be marked sold'
  );
  perform public.test_assert(
    (select sold_to from public.marketplace_listings where id = v_listing) is null,
    '1. sold_to must stay null when no buyer could be inferred'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Resolving with a recorded "I'm interested" auto-assigns that buyer
-- ---------------------------------------------------------------------------
do $$
declare
  v_category uuid;
  v_listing uuid;
begin
  select id into v_category from public.marketplace_categories where is_active order by sort_order limit 1;
  insert into public.marketplace_listings
    (seller_id, title, description, price, condition, category_id, status, contact_note)
  values
    (public.current_profile_id(), 'Lifecycle test item two', 'A listing with a recorded interest before resolving.',
     200, 'good', v_category, 'active', 'DM me')
  returning id into v_listing;

  perform set_config('request.jwt.claim.sub', '95000000-0000-4000-a000-000000000002', true);
  perform public.record_listing_interest(v_listing);
  perform set_config('request.jwt.claim.sub', '95000000-0000-4000-a000-000000000001', true);

  perform public.test_assert(
    (public.mark_listing_completed(v_listing, null)->>'buyer_id')::uuid
      = (select id from public.profiles where username = 'vikram_mkt2'),
    '2. the most recent interested student must be auto-assigned as the buyer'
  );
  perform public.test_assert(
    (select sold_to from public.marketplace_listings where id = v_listing)
      = (select id from public.profiles where username = 'vikram_mkt2'),
    '2. sold_to on the listing must match the inferred buyer'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Only the seller (or staff) can resolve a listing
-- ---------------------------------------------------------------------------
do $$
declare
  v_category uuid;
  v_listing uuid;
begin
  select id into v_category from public.marketplace_categories where is_active order by sort_order limit 1;
  insert into public.marketplace_listings
    (seller_id, title, description, price, condition, category_id, status)
  values
    (public.current_profile_id(), 'Lifecycle test item three', 'A listing an outsider must not be able to resolve.',
     75, 'good', v_category, 'active')
  returning id into v_listing;

  perform set_config('request.jwt.claim.sub', '95000000-0000-4000-a000-000000000003', true);
  perform public.test_assert_denied(
    format($sql$select public.mark_listing_completed('%s'::uuid, null)$sql$, v_listing),
    '3. a non-seller, non-staff student must not be able to resolve someone else''s listing'
  );
  perform set_config('request.jwt.claim.sub', '95000000-0000-4000-a000-000000000001', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. "Remove listing" actually changes status and hides it from Browse
-- ---------------------------------------------------------------------------
do $$
declare
  v_category uuid;
  v_listing uuid;
begin
  select id into v_category from public.marketplace_categories where is_active order by sort_order limit 1;
  insert into public.marketplace_listings
    (seller_id, title, description, price, condition, category_id, status)
  values
    (public.current_profile_id(), 'Lifecycle test item four', 'A listing the seller removes from Browse.',
     40, 'good', v_category, 'active')
  returning id into v_listing;

  update public.marketplace_listings set status = 'removed' where id = v_listing;
  perform public.test_assert(
    (select status from public.marketplace_listings where id = v_listing) = 'removed',
    '4. the seller must be able to move their own listing to removed'
  );

  perform set_config('request.jwt.claim.sub', '95000000-0000-4000-a000-000000000002', true);
  perform public.test_assert(
    (select count(*) from public.marketplace_listings where id = v_listing) = 0,
    '4. a removed listing must not be visible to other students'
  );
  perform set_config('request.jwt.claim.sub', '95000000-0000-4000-a000-000000000001', true);
end;
$$;

-- Also exercise delete_own_content()/restore_own_content() for completeness —
-- the self-service remove/restore RPC pair the app can use instead of a raw
-- status update.
do $$
declare
  v_category uuid;
  v_listing uuid;
begin
  select id into v_category from public.marketplace_categories where is_active order by sort_order limit 1;
  insert into public.marketplace_listings
    (seller_id, title, description, price, condition, category_id, status)
  values
    (public.current_profile_id(), 'Lifecycle test item five', 'A listing removed and restored via the RPC pair.',
     60, 'good', v_category, 'active')
  returning id into v_listing;

  perform public.delete_own_content('marketplace_listing', v_listing);
  perform public.test_assert(
    (select status from public.marketplace_listings where id = v_listing) = 'removed',
    '4b. delete_own_content must remove a listing from Browse'
  );
  perform public.restore_own_content('marketplace_listing', v_listing);
  perform public.test_assert(
    (select status from public.marketplace_listings where id = v_listing) = 'active',
    '4b. restore_own_content must bring a removed listing back'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Permanent delete is owner-only and does not orphan dependent rows
-- ---------------------------------------------------------------------------
do $$
declare
  v_category uuid;
  v_listing uuid;
begin
  select id into v_category from public.marketplace_categories where is_active order by sort_order limit 1;
  insert into public.marketplace_listings
    (seller_id, title, description, price, condition, category_id, status, contact_note)
  values
    (public.current_profile_id(), 'Lifecycle test item six', 'A listing that gets permanently deleted by its owner.',
     90, 'good', v_category, 'active', 'call me')
  returning id into v_listing;

  perform set_config('request.jwt.claim.sub', '95000000-0000-4000-a000-000000000002', true);
  perform public.record_listing_interest(v_listing);
  -- RLS scopes the DELETE's row set rather than raising: a non-owner's
  -- DELETE statement "succeeds" but matches zero rows, so the only reliable
  -- check is that the row is still there afterwards, not that an exception
  -- was thrown.
  delete from public.marketplace_listings where id = v_listing;
  perform set_config('request.jwt.claim.sub', '95000000-0000-4000-a000-000000000001', true);
  perform public.test_assert(
    (select count(*) from public.marketplace_listings where id = v_listing) = 1,
    '5. a non-owner''s delete must not remove someone else''s listing (RLS scopes it to zero rows)'
  );
  delete from public.marketplace_listings where id = v_listing;
  perform public.test_assert(
    (select count(*) from public.marketplace_listings where id = v_listing) = 0,
    '5. the owner must be able to permanently delete their own listing'
  );
  perform public.test_assert(
    (select count(*) from public.marketplace_interactions where listing_id = v_listing) = 0,
    '5. deleting a listing must cascade-delete its interactions, not orphan them'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. conversation_inbox() is no longer reachable by anon
-- ---------------------------------------------------------------------------
reset role;
set role anon;

do $$
begin
  perform public.test_assert_denied(
    $sql$select * from public.conversation_inbox(30)$sql$,
    '6. anon must not be able to call conversation_inbox()'
  );
end;
$$;

reset role;
select set_config('request.jwt.claim.role', '', false), set_config('request.jwt.claim.sub', '', false);
