-- =============================================================================
-- Campus+ database tests — 19 post pin ordering, authorization and live metadata
-- =============================================================================

select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);

insert into auth.users (id, email) values
  ('f3000000-0000-4000-a000-000000000001', 'pin.author@pccoepune.org'),
  ('f3000000-0000-4000-a000-000000000002', 'pin.moderator@pccoepune.org')
on conflict (id) do nothing;

select set_config('request.jwt.claim.sub', 'f3000000-0000-4000-a000-000000000001', false);
select public.complete_profile('pin_author', 'Pin Author');
select set_config('request.jwt.claim.sub', 'f3000000-0000-4000-a000-000000000002', false);
select public.complete_profile('pin_moderator', 'Pin Moderator');
select set_config('request.jwt.claim.sub', '', false);
select public.grant_role((select id from public.profiles where username = 'pin_moderator'), 'moderator');

-- p4 represents a row that was already pinned before this read-side fix. No
-- backfill or pin timestamp is needed for it to join the corrected order.
insert into public.posts (id, author_id, body, pinned, created_at)
select id, (select id from public.profiles where username = 'pin_author'), body, pinned, created_at
from (values
  ('f3000000-0000-4000-b000-000000000001'::uuid, 'Regular newest', false, now()),
  ('f3000000-0000-4000-b000-000000000002'::uuid, 'Pinned newer', false, now() - interval '1 millisecond'),
  ('f3000000-0000-4000-b000-000000000003'::uuid, 'Regular middle', false, now() - interval '2 milliseconds'),
  ('f3000000-0000-4000-b000-000000000004'::uuid, 'Already pinned older', true, now() - interval '3 milliseconds'),
  ('f3000000-0000-4000-b000-000000000005'::uuid, 'Regular oldest', false, now() - interval '4 milliseconds')
) as fixture(id, body, pinned, created_at);

-- A student can neither patch the privileged column nor invoke the staff RPC.
set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', 'f3000000-0000-4000-a000-000000000001', false);
select public.test_assert_denied(
  $sql$update public.posts set pinned = true where id = 'f3000000-0000-4000-b000-000000000001'$sql$,
  'a student must not modify post pin state directly'
);
select public.test_assert_denied(
  $sql$select public.moderate_content('post', 'f3000000-0000-4000-b000-000000000001', 'pin')$sql$,
  'a student must not invoke the audited pin action'
);

-- The existing moderator role can pin through the audited definer path.
reset role;
select set_config('request.jwt.claim.role', 'service_role', false);
set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', 'f3000000-0000-4000-a000-000000000002', false);
do $$
declare
  v_result jsonb;
begin
  v_result := public.moderate_content(
    'post', 'f3000000-0000-4000-b000-000000000001'::uuid, 'pin', 'Pin ordering regression'
  );
  -- First pin an actually newer regular post as a sanity check, then unpin it;
  -- the main multi-pin fixture is p2 below.
  perform public.test_assert((v_result ->> 'pinned')::boolean, 'the moderator RPC confirms a committed pin');
  v_result := public.moderate_content('post', 'f3000000-0000-4000-b000-000000000001'::uuid, 'unpin');
  perform public.test_assert(not (v_result ->> 'pinned')::boolean, 'the moderator RPC confirms a committed unpin');
  v_result := public.moderate_content('post', 'f3000000-0000-4000-b000-000000000002'::uuid, 'pin');
  perform public.test_assert((v_result ->> 'pinned')::boolean, 'a second pinned post keeps its committed state');
end;
$$;

-- Every page is read under the student's own invoker/RLS context.
select set_config('request.jwt.claim.sub', 'f3000000-0000-4000-a000-000000000001', false);
do $$
declare
  v_fixture uuid[] := array[
    'f3000000-0000-4000-b000-000000000001'::uuid,
    'f3000000-0000-4000-b000-000000000002'::uuid,
    'f3000000-0000-4000-b000-000000000003'::uuid,
    'f3000000-0000-4000-b000-000000000004'::uuid,
    'f3000000-0000-4000-b000-000000000005'::uuid
  ];
  v_mine uuid[];
  v_all uuid[];
  v_repeat uuid[];
  v_offset integer;
  v_page_id uuid;
begin
  -- Earlier suites intentionally share this database. Filter only for the
  -- relative-order assertion; the offset checks below still exercise the real,
  -- unfiltered mixed feed and include the pinned head.
  select array_agg(id) into v_mine
  from (select id from public.campus_feed(50, 0, 'newest') where id = any(v_fixture)) ordered;
  select array_agg(id) into v_all from (select id from public.campus_feed(50, 0, 'newest')) page;
  select array_agg(id) into v_repeat from (select id from public.campus_feed(50, 0, 'newest')) page;

  perform public.test_assert(v_mine = array[
    'f3000000-0000-4000-b000-000000000002'::uuid,
    'f3000000-0000-4000-b000-000000000004'::uuid,
    'f3000000-0000-4000-b000-000000000001'::uuid,
    'f3000000-0000-4000-b000-000000000003'::uuid,
    'f3000000-0000-4000-b000-000000000005'::uuid
  ], 'multiple pins lead by created_at, followed by regular posts in chronological order');
  perform public.test_assert(v_all = v_repeat, 'a refresh returns the same persisted pin ordering');

  -- Every one-row offset page must reproduce the authoritative snapshot exactly:
  -- no duplicate, skip, or reshuffle at the pinned/regular page boundaries.
  for v_offset in 0..least(14, coalesce(array_length(v_all, 1), 1) - 1) loop
    select id into v_page_id from public.campus_feed(1, v_offset, 'newest');
    perform public.test_assert(v_page_id = v_all[v_offset + 1],
      'offset page ' || v_offset || ' must be stable with pinned posts present');
  end loop;
end;
$$;

-- Unpinning p2 restores its ordinary created_at position immediately in SQL.
select set_config('request.jwt.claim.sub', 'f3000000-0000-4000-a000-000000000002', false);
select public.moderate_content('post', 'f3000000-0000-4000-b000-000000000002'::uuid, 'unpin');
select set_config('request.jwt.claim.sub', 'f3000000-0000-4000-a000-000000000001', false);
do $$
declare
  v_ids uuid[];
begin
  select array_agg(id) into v_ids
  from (select id from public.campus_feed(50, 0, 'newest') where id::text like 'f3000000-%') page;
  perform public.test_assert(v_ids = array[
    'f3000000-0000-4000-b000-000000000004'::uuid,
    'f3000000-0000-4000-b000-000000000001'::uuid,
    'f3000000-0000-4000-b000-000000000002'::uuid,
    'f3000000-0000-4000-b000-000000000003'::uuid,
    'f3000000-0000-4000-b000-000000000005'::uuid
  ], 'unpin restores normal chronological position while other pins remain first');
end;
$$;

reset role;
select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);
do $$
declare
  v_identity char;
  v_index text;
begin
  perform public.test_assert(
    (select count(*) from public.audit_logs
      where action in ('moderation.content_pin', 'moderation.content_unpin')
        and target_type = 'post') >= 3,
    'pin and unpin are audited staff actions'
  );

  select c.relreplident, ic.relname into v_identity, v_index
  from pg_class c
  join pg_index i on i.indrelid = c.oid and i.indisreplident
  join pg_class ic on ic.oid = i.indexrelid
  where c.oid = 'public.posts'::regclass;
  perform public.test_assert(v_identity = 'i', 'posts uses the narrow replica-identity index, not full-row identity');
  perform public.test_assert(v_index = 'posts_feed_replica_identity_idx', 'Realtime receives old id, pin and status metadata');
end;
$$;
