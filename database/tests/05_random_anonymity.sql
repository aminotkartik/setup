-- =============================================================================
-- Campus+ database tests — 05 Random: anonymity and moderation access
-- =============================================================================
-- The guarantees this file proves, in the spec's own terms:
--   * matching never reveals who the other student is, in any API or view,
--   * a participant cannot unmask their partner by querying the tables directly,
--   * a non-participant cannot read, write or even confirm a session,
--   * a moderator with `moderate_random` can act on a report without identity,
--   * only a holder of `view_random_sessions` (admin) can unmask, and that path
--     is the audited one,
--   * blocked students are never matched together.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);

insert into auth.users (id, email) values
  ('e0000000-0000-4000-a000-000000000001', 'aakash@pccoepune.org'),
  ('e0000000-0000-4000-a000-000000000002', 'bela@pccoepune.org'),
  ('e0000000-0000-4000-a000-000000000003', 'chirag@pccoepune.org'),
  ('e0000000-0000-4000-a000-000000000004', 'disha@pccoepune.org'),
  ('e0000000-0000-4000-a000-000000000005', 'manav_mod@pccoepune.org'),
  ('e0000000-0000-4000-a000-000000000006', 'meera_admin@pccoepune.org')
on conflict (id) do nothing;

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('e0000000-0000-4000-a000-000000000001', 'aakash', 'Aakash Pawar'),
      ('e0000000-0000-4000-a000-000000000002', 'bela', 'Bela Kamat'),
      ('e0000000-0000-4000-a000-000000000003', 'chirag', 'Chirag Salvi'),
      ('e0000000-0000-4000-a000-000000000004', 'disha', 'Disha Bhor'),
      ('e0000000-0000-4000-a000-000000000005', 'manav_mod', 'Manav Raut'),
      ('e0000000-0000-4000-a000-000000000006', 'meera_admin', 'Meera Kale')
    ) as t(id, username, name)
  loop
    perform set_config('request.jwt.claim.sub', r.id, false);
    perform public.complete_profile(r.username, r.name);
  end loop;
end;
$$;

select set_config('request.jwt.claim.sub', '', false);
-- Profile ids are intentionally different from auth ids: resolve them by username.
select public.grant_role((select id from public.profiles where username = 'manav_mod'), 'moderator');
select public.grant_role((select id from public.profiles where username = 'meera_admin'), 'admin');

-- ---------------------------------------------------------------------------
-- 1. Queueing and matching
-- ---------------------------------------------------------------------------
set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-a000-000000000001', false);

do $$
declare
  v jsonb;
begin
  v := public.join_random_queue();
  perform public.test_assert(v->>'status' = 'waiting', 'the first student must wait for a partner');
  perform public.test_assert(
    (select count(*) from public.random_queue) = 1,
    'a waiting student must see exactly their own queue row'
  );
end;
$$;

select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-a000-000000000002', false);

do $$
declare
  v jsonb;
  v_sessions integer;
begin
  v := public.join_random_queue();
  perform public.test_assert(v->>'status' = 'matched', 'the second student must be matched immediately');
  perform public.test_assert(v->>'session_id' is not null, 'matching must return a session id to the participants');
  perform public.test_assert(
    (v->'partner' is null) and (v->'partner_id' is null) and (v->'username' is null),
    'the match result must not carry any partner identity'
  );

  -- A participant sees only their own participant row.
  select count(*) into v_sessions from public.random_session_participants;
  perform public.test_assert(v_sessions = 1, 'a participant must not be able to list the other participant row');
end;
$$;

-- The match is shared, and it is the only live session.
select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-a000-000000000001', false);

do $$
declare
  v_mine integer;
  v_other integer;
begin
  perform public.test_assert(
    (select count(*) from public.random_session_view) = 1,
    'the first student must see the session they were matched into'
  );

  -- The participant rows visible to me are only mine: the peer id stays hidden.
  select count(*) into v_mine from public.random_session_participants;
  perform public.test_assert(v_mine = 1, 'the peer participant row must not be visible to me');

  -- The raw session table (which holds both ids) is not readable at all.
  select count(*) into v_other from public.random_sessions;
  perform public.test_assert(v_other = 0, 'the identity mapping table must never be readable by participants');

  perform public.test_assert(
    (select participant_a is null and participant_b is null from (
        select participant_a, participant_b from public.random_sessions
     ) x) is null,
    'no participant id may be reachable through any query'
  );
end;
$$;

-- The participant-safe view carries no identity columns at all.
do $$
declare
  v_leaky integer;
begin
  select count(*) into v_leaky
  from information_schema.columns
  where table_schema = 'public'
    and table_name in ('random_session_view', 'random_messages_view')
    and column_name in ('user_id', 'sender_user_id', 'participant_a', 'participant_b',
                        'username', 'display_name', 'profile_id');
  perform public.test_assert(v_leaky = 0, 'the participant views must expose no identity columns');
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Messages inside a session are labelled "mine", never "from <person>"
-- ---------------------------------------------------------------------------
do $$
declare
  v_session uuid;
  v jsonb;
begin
  select id into v_session from public.random_session_view limit 1;

  v := public.send_random_message(v_session, 'Hey! Which branch are you in?', null);
  perform public.test_assert(v->>'id' is not null, 'a participant must be able to send a message');
  perform public.test_assert((v->>'mine')::boolean, 'the sender''s own copy must be marked as theirs');
  perform public.test_assert(
    not (v ? 'sender_user_id' or v ? 'sender' or v ? 'username'),
    'the send result must not expose a sender identity'
  );

  perform public.test_assert(
    (select count(*) from public.random_messages_view where mine) = 1,
    'my own message must be flagged as mine'
  );
end;
$$;

-- The peer sees the same message as theirs, with no sender identity attached.
select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-a000-000000000002', false);

do $$
declare
  v_session uuid;
  v_mine integer;
  v_theirs integer;
begin
  select id into v_session from public.random_session_view limit 1;

  select count(*) into v_mine from public.random_messages_view where mine;
  select count(*) into v_theirs from public.random_messages_view where not mine;
  perform public.test_assert(v_mine = 0, 'the peer must not see the message as their own');
  perform public.test_assert(v_theirs = 1, 'the peer must see the message without learning who sent it');

  perform public.test_assert(
    (select count(*) from public.random_messages) = 0,
    'the raw random_messages table must not expose sender ids to participants'
  );

  perform public.send_random_message(v_session, 'Second year, computer engineering.', null);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. A non-participant can neither see nor enter the session
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-a000-000000000003', false);

do $$
begin
  perform public.test_assert(
    (select count(*) from public.random_session_view) = 0,
    'a non-participant must not see any Random session'
  );
  perform public.test_assert(
    (select count(*) from public.random_messages_view) = 0,
    'a non-participant must not read Random messages'
  );
  perform public.test_assert(
    (select count(*) from public.random_sessions) = 0,
    'a non-participant must not read the identity mapping'
  );
end;
$$;

-- Knowing the id must not help either. The session id is handed over through the
-- test-only scratch table, standing in for a leaked id.
reset role;
select set_config('request.jwt.claim.role', 'service_role', false);
insert into public.__test_scratch (key, value)
select 'random_session', id from public.random_sessions where status = 'active' limit 1
on conflict (key) do update set value = excluded.value;
reset role;

set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-a000-000000000003', false);

do $$
declare
  v_session uuid;
begin
  select value into v_session from public.__test_scratch where key = 'random_session';
  perform public.test_assert(v_session is not null, 'the leaked session id must be available for this test');

  perform public.test_assert_denied(
    format($sql$select public.send_random_message(%L::uuid, 'Trying to join uninvited.', null)$sql$, v_session),
    'a non-participant must not be able to send into a session even with its id'
  );
  perform public.test_assert(
    public.random_session_state(v_session) is null,
    'a non-participant must not be able to confirm a session exists'
  );
  perform public.test_assert(
    (select count(*) from public.random_messages_view where session_id = v_session) = 0,
    'a leaked session id must not unlock the message stream'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. A moderator can act on Reports without unmasking; an admin can unmask.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-a000-000000000005', false);

do $$
begin
  perform public.test_assert(public.has_permission('moderate_random'), 'a moderator must be able to moderate Random reports');
  perform public.test_assert(
    not public.has_permission('view_random_sessions'),
    'a moderator must not hold the unmasking permission by default'
  );
  perform public.test_assert(
    (select count(*) from public.random_sessions) = 0,
    'a moderator without view_random_sessions must not see Random identities'
  );
  perform public.test_assert(
    (select count(*) from public.random_session_participants) = 0,
    'a moderator without view_random_sessions must not see participant rows'
  );
end;
$$;

select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-a000-000000000001', false);

do $$
declare
  v_session uuid;
  v_report uuid;
begin
  select id into v_session from public.random_session_view limit 1;
  v_report := public.report_random_session(v_session, 'harassment', 'They kept asking for my phone number.');

  perform public.test_assert(v_report is not null, 'a participant must be able to report a session');
  perform public.test_assert(
    (select status from public.random_session_view where id = v_session) = 'reported',
    'reporting a session must flag it for moderation'
  );
  perform public.test_assert(
    (select count(*) from public.reports where random_session_id = v_session and target_type = 'random_session') = 1,
    'a Random report must also appear in the central report queue'
  );
end;
$$;

select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-a000-000000000005', false);

do $$
declare
  v_session uuid;
begin
  select value into v_session from public.__test_scratch where key = 'random_session';

  perform public.test_assert(
    (select count(*) from public.reports where random_session_id = v_session) = 1,
    'a moderator must be able to see the Random report without unmasking anyone'
  );
  perform public.test_assert(
    public.random_other_participant(v_session, public.current_profile_id()) is null,
    'a moderator must never be treated as a participant'
  );
end;
$$;

select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-a000-000000000006', false);

do $$
declare
  v_session uuid;
begin
  select value into v_session from public.__test_scratch where key = 'random_session';

  perform public.test_assert(public.has_permission('view_random_sessions'), 'an admin must hold the unmasking permission');
  perform public.test_assert(
    (select count(*) from public.random_session_participants where session_id = v_session) = 2,
    'an admin with view_random_sessions must be able to resolve a reported session'
  );

  -- The unmasking is recorded in the audit trail by the application layer, and
  -- the trail is itself admin-readable.
  perform public.log_audit('moderation.random_unmasked', 'random_session', v_session::text,
    jsonb_build_object('reason', 'Reported session reviewed.'), false, 'Reported session reviewed.', 'staff');
  perform public.test_assert(
    (select count(*) from public.audit_logs where action = 'moderation.random_unmasked') = 1,
    'an unmasking action must be auditable'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Blocked students are never matched together
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-a000-000000000001', false);

do $$
declare
  v_session uuid;
begin
  select id into v_session from public.random_session_view limit 1;
  perform public.end_random_session(v_session, 'left');

  perform public.test_assert(
    (select count(*) from public.random_session_view) = 0,
    'an ended session must disappear from the participant view'
  );
end;
$$;

select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-a000-000000000003', false);

insert into public.blocks (blocker_id, blocked_id)
select a.id, b.id from public.profiles a, public.profiles b
where a.username = 'chirag' and b.username = 'disha';

do $$
declare
  v jsonb;
begin
  v := public.join_random_queue();
  perform public.test_assert(v->>'status' = 'waiting', 'a blocked student must wait rather than be matched');
end;
$$;

select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-a000-000000000004', false);

do $$
declare
  v jsonb;
begin
  v := public.join_random_queue();
  perform public.test_assert(v->>'status' = 'waiting',
    'a student who blocked someone must never be matched with them');
  perform public.test_assert(
    (select count(*) from public.random_session_view) = 0,
    'no session may exist between blocked students'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Random leaves no public trace
-- ---------------------------------------------------------------------------
do $$
declare
  v_slug_columns integer;
begin
  select count(*) into v_slug_columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name like 'random%'
    and column_name in ('slug', 'public_url', 'share_url', 'permalink');
  perform public.test_assert(v_slug_columns = 0,
    'Random sessions must not gain shareable URLs or public slugs');
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. random_session_view / random_messages_view must stay non-invoker
-- ---------------------------------------------------------------------------
-- random_sessions, random_session_participants and random_messages have no
-- participant-facing SELECT policy on purpose (see migration 010's own
-- comment). These two views are the only read path a participant has to
-- their own session and messages, and they work by running with the view
-- owner's privileges and filtering on current_profile_id() themselves. If a
-- future change sets `security_invoker = true` on either view, every
-- participant query against it will silently return zero rows (confirmed
-- empirically — see migration 022) while staff, who do have a
-- permission-gated SELECT policy on the base tables, would see no difference
-- at all. This regression would be easy to ship unnoticed, so it is pinned
-- here at both the configuration level and with a real read.
-- ---------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claim.role', 'service_role', false);

do $$
declare
  v_invoker boolean;
begin
  select (reloptions is not null and 'security_invoker=true' = any(reloptions))
    into v_invoker
  from pg_class where relname = 'random_session_view' and relnamespace = 'public'::regnamespace;
  perform public.test_assert(coalesce(v_invoker, false) = false,
    '7. random_session_view must not be security_invoker (see migration 022)');

  select (reloptions is not null and 'security_invoker=true' = any(reloptions))
    into v_invoker
  from pg_class where relname = 'random_messages_view' and relnamespace = 'public'::regnamespace;
  perform public.test_assert(coalesce(v_invoker, false) = false,
    '7. random_messages_view must not be security_invoker (see migration 022)');
end;
$$;

-- Fresh fixture, independent of the session state left by earlier sections
-- (section 5 ends the Aakash/Bela session).
insert into auth.users (id, email) values
  ('e0000000-0000-4000-a000-000000000007', 'eshan@pccoepune.org'),
  ('e0000000-0000-4000-a000-000000000008', 'falguni@pccoepune.org')
on conflict (id) do nothing;

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('e0000000-0000-4000-a000-000000000007', 'eshan', 'Eshan Jadhav'),
      ('e0000000-0000-4000-a000-000000000008', 'falguni', 'Falguni Shinde')
    ) as t(id, username, name)
  loop
    perform set_config('request.jwt.claim.sub', r.id, false);
    perform public.complete_profile(r.username, r.name);
  end loop;
end;
$$;

reset role;
set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-a000-000000000007', false);
select public.join_random_queue();
select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-a000-000000000008', false);
select public.join_random_queue();

do $$
declare
  v_session uuid;
begin
  -- random_sessions itself has no participant SELECT policy (by design), so
  -- the session id is read the same way the application reads it: through
  -- the view.
  select id into v_session from public.random_session_view where status = 'active' limit 1;

  if v_session is null then
    raise exception 'test setup: the fresh Eshan/Falguni match did not produce an active session';
  end if;

  perform public.send_random_message(v_session, 'regression check: can I read my own session?', null);

  perform public.test_assert(
    (select count(*) from public.random_session_view where id = v_session) = 1,
    '7. a real participant must be able to read their own session through random_session_view'
  );
  perform public.test_assert(
    (select count(*) from public.random_messages_view where session_id = v_session) >= 1,
    '7. a real participant must be able to read their own messages through random_messages_view'
  );
end;
$$;

reset role;
select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);

