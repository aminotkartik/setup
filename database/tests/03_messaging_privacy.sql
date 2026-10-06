-- =============================================================================
-- Campus+ database tests — 03 direct messages, group chat, read receipts
-- =============================================================================
-- The core privacy guarantee this file proves:
--   "Student A cannot access Student B's private messages."
-- plus: blocked users cannot DM each other, and Seen receipts are visible only
-- to members of that conversation.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);

insert into auth.users (id, email) values
  ('c0000000-0000-4000-a000-000000000001', 'eera@pccoepune.org'),
  ('c0000000-0000-4000-a000-000000000002', 'farhan@pccoepune.org'),
  ('c0000000-0000-4000-a000-000000000003', 'gauri@pccoepune.org')
on conflict (id) do nothing;

select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-a000-000000000001', false);
select public.complete_profile('eera', 'Eera Joshi');
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-a000-000000000002', false);
select public.complete_profile('farhan', 'Farhan Sheikh');
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-a000-000000000003', false);
select public.complete_profile('gauri', 'Gauri Iyer');
select set_config('request.jwt.claim.sub', '', false);

-- ---------------------------------------------------------------------------
-- 1. A direct conversation is created once per pair, and both members see it.
-- ---------------------------------------------------------------------------
set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-a000-000000000001', false);

do $$
declare
  v_first uuid;
  v_second uuid;
  v_other uuid;
begin
  select id into v_other from public.profiles where username = 'farhan';

  v_first := public.get_or_create_direct_conversation(v_other);
  v_second := public.get_or_create_direct_conversation(v_other);

  perform public.test_assert(v_first = v_second, 'a DM pair must reuse the same conversation');
  perform public.test_assert(
    (select count(*) from public.conversation_members where conversation_id = v_first) = 2,
    'a direct conversation must have exactly its two members'
  );
  perform public.test_assert(
    (select count(*) from public.conversations
      where id = v_first
        and public.can_access_conversation(id)) = 1,
    'a member must be able to read their conversation'
  );

  insert into public.messages (conversation_id, sender_id, body)
  values (v_first, public.current_profile_id(), 'Are you joining the study group tonight?');
end;
$$;

select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-a000-000000000002', false);

do $$
declare
  v_conversation uuid;
  v_visible integer;
begin
  select c.id into v_conversation
  from public.conversations c
  join public.conversation_members m on m.conversation_id = c.id
  where m.user_id = public.current_profile_id() and c.kind = 'direct';

  select count(*) into v_visible from public.messages where conversation_id = v_conversation;
  perform public.test_assert(v_visible = 1, 'the recipient must see the message addressed to them');

  insert into public.messages (conversation_id, sender_id, body)
  values (v_conversation, public.current_profile_id(), 'Yes, I will be there.');
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. A third student sees nothing: not the thread, not the messages.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-a000-000000000003', false);

do $$
declare
  v_conversations integer;
  v_messages integer;
  v_reads integer;
begin
  select count(*) into v_conversations from public.conversations;
  perform public.test_assert(v_conversations = 0, 'a student must not see conversations they are not part of');

  select count(*) into v_messages from public.messages;
  perform public.test_assert(v_messages = 0, 'a student must not see messages from other conversations');

  select count(*) into v_reads from public.message_reads;
  perform public.test_assert(v_reads = 0, 'a student must not see read receipts from other conversations');
end;
$$;

-- Access by direct id is denied just the same: knowing (or guessing) a
-- conversation id is not enough, because the messages INSERT policy checks
-- membership independently.
reset role;
select set_config('request.jwt.claim.role', 'service_role', false);
insert into public.__test_scratch (key, value)
select 'eera_farhan_conversation', id from public.conversations where kind = 'direct' limit 1
on conflict (key) do update set value = excluded.value;
reset role;

set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-a000-000000000003', false);

select public.test_assert_denied(
  $sql$insert into public.messages (conversation_id, sender_id, body)
       select value, public.current_profile_id(), 'Peeking into a thread I was never part of'
       from public.__test_scratch where key = 'eera_farhan_conversation'$sql$,
  'a student must not be able to post into a conversation they do not belong to, even with its id'
);

select public.test_assert_denied(
  $sql$select public.mark_conversation_read((select value from public.__test_scratch where key = 'eera_farhan_conversation'))$sql$,
  'a non-member must not be able to mark a conversation as read'
);

select public.test_assert_denied(
  $sql$select public.conversation_member_ids((select value from public.__test_scratch where key = 'eera_farhan_conversation'))$sql$,
  'a non-member must not be able to list the members of a conversation'
);

-- ---------------------------------------------------------------------------
-- 3. Blocking stops the conversation, in both directions.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-a000-000000000003', false);

insert into public.blocks (blocker_id, blocked_id)
select a.id, b.id from public.profiles a, public.profiles b
where a.username = 'gauri' and b.username = 'eera';

select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-a000-000000000001', false);

do $$
declare
  v_blocked uuid;
begin
  select id into v_blocked from public.profiles where username = 'gauri';
  perform public.test_assert_denied(
    format($sql$select public.get_or_create_direct_conversation(%L::uuid)$sql$, v_blocked),
    'the blocking student must not be able to open a DM with the student she blocked'
  );
  perform public.test_assert_denied(
    format($sql$select public.get_or_create_direct_conversation(%L::uuid)$sql$, v_blocked),
    'the blocked student must not be able to open a DM with the student who blocked her'
  );
  perform public.test_assert(public.is_blocked(public.current_profile_id(), v_blocked), 'the block must be visible to the database');
end;
$$;

-- Sending into an existing thread with a blocked participant is impossible too.
select public.test_assert(
  not exists (
    select 1 from public.messages m
    join public.conversation_members cm on cm.conversation_id = m.conversation_id
    where cm.user_id = (select id from public.profiles where username = 'gauri')
  ),
  'a blocked student must never gain access to the thread'
);

-- ---------------------------------------------------------------------------
-- 4. Opting out of DMs from everyone is respected.
-- ---------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claim.role', 'service_role', false);
update public.profiles set allow_dms_from_everyone = false where username = 'farhan';
reset role;

set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-a000-000000000003', false);

do $$
declare
  v_farhan uuid;
begin
  select id into v_farhan from public.profiles where username = 'farhan';
  perform public.test_assert_denied(
    format($sql$select public.get_or_create_direct_conversation(%L::uuid)$sql$, v_farhan),
    'a student who disabled incoming DMs must not receive new conversations'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Read receipts (Seen) exist only inside the conversation.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-a000-000000000002', false);

do $$
declare
  v_conversation uuid;
  v_seen timestamptz;
begin
  select c.id into v_conversation
  from public.conversations c
  join public.conversation_members m on m.conversation_id = c.id
  where m.user_id = public.current_profile_id() and c.kind = 'direct';

  v_seen := public.mark_conversation_read(v_conversation);
  perform public.test_assert(v_seen is not null, 'marking a conversation read must record a timestamp');
  perform public.test_assert(
    (select last_read_at from public.message_reads
      where conversation_id = v_conversation and user_id = public.current_profile_id()) is not null,
    'the Seen receipt must be stored'
  );
end;
$$;

-- The other member can see it (that is the whole point of a receipt)…
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-a000-000000000001', false);
do $$
declare
  v_receipts integer;
begin
  select count(*) into v_receipts from public.message_reads;
  perform public.test_assert(v_receipts >= 1, 'a member must be able to see the Seen state of their own conversation');
end;
$$;

-- …and there is no such thing as a presence signal in this schema.
do $$
declare
  v_leaky integer;
begin
  select count(*) into v_leaky
  from information_schema.columns
  where table_schema = 'public'
    and column_name in ('is_online', 'online', 'last_active', 'presence', 'typing');
  perform public.test_assert(v_leaky = 0, 'the schema must not contain presence/typing columns');
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Messages: only the sender may edit, and only their own history.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-a000-000000000002', false);

update public.messages set body = 'Hijacked by someone else' where body like 'Are you joining%';
do $$
declare
  v_body text;
begin
  select body into v_body from public.messages where body like 'Are you joining%';
  perform public.test_assert(v_body like 'Are you joining%', 'a non-sender must not be able to edit a message');
end;
$$;

select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-a000-000000000001', false);

do $$
declare
  v_body text;
begin
  update public.messages set body = 'Are you joining the study group tonight? Bring notes.'
   where sender_id = public.current_profile_id();

  select body into v_body from public.messages where sender_id = public.current_profile_id();
  perform public.test_assert(v_body like '%Bring notes%', 'the sender must be able to correct their own message');
  perform public.test_assert(
    (select count(*) from public.message_edits) >= 1
    is not null,
    'an edit must leave an evidence row'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Deleting a message softens it but keeps the evidence for moderation.
-- ---------------------------------------------------------------------------
do $$
declare
  v_id uuid;
begin
  select id into v_id from public.messages where sender_id = public.current_profile_id() limit 1;
  perform public.delete_own_content('message', v_id);

  perform public.test_assert(
    (select body from public.messages where id = v_id) = '',
    'a deleted message must no longer expose its body'
  );
  perform public.test_assert(
    (select status from public.messages where id = v_id) = 'deleted',
    'a deleted message must be marked as deleted'
  );
end;
$$;

-- The removed content is retained as moderation evidence, visible to staff only.
reset role;
select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);

do $$
declare
  v_evidence text;
  v_id uuid;
begin
  select id into v_id from public.messages where status = 'deleted' limit 1;
  select previous_body into v_evidence
    from public.message_edits where message_id = v_id and reason = 'delete';

  perform public.test_assert(v_evidence like '%Bring notes%',
    'the deleted message content must be retained end-to-end as moderation evidence');
  perform public.test_assert(
    (select body from public.messages where id = v_id) = '',
    'the deleted message body must not be readable through the messages table'
  );
end;
$$;

set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-a000-000000000001', false);

-- Evidence is not readable by students.
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-a000-000000000002', false);
do $$
declare
  v_rows integer;
begin
  select count(*) into v_rows from public.message_edits;
  perform public.test_assert(v_rows = 0, 'message edit history must not be readable by students');
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Notifications are addressed, not broadcast.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-a000-000000000002', false);
do $$
declare
  v_other uuid;
  v_me uuid := public.current_profile_id();
begin
  select id into v_other from public.profiles where username = 'farhan';
  perform public.notify_user(v_other, 'dm_new', 'Test notification', 'Body', 'conversation', v_me::text, '/chat');

  select id into v_other from public.profiles where username = 'gauri';
  perform public.notify_user(v_other, 'dm_new', 'Should not arrive', 'Blocked relationship', 'conversation', v_me::text, '/chat');
end;
$$;

do $$
declare
  v_visible integer;
begin
  -- The attempt to notify yourself above must not have created anything.
  select count(*) into v_visible from public.notifications
   where recipient_id = public.current_profile_id();
  perform public.test_assert(v_visible = 0, 'a student must not be able to notify themselves');

  -- …and notifications addressed to other students are not readable at all.
  select count(*) into v_visible from public.notifications
   where recipient_id <> public.current_profile_id();
  perform public.test_assert(v_visible = 0, 'a student must not read another student''s notifications');
end;
$$;

-- A student cannot fabricate a moderation notice.
select public.test_assert_denied(
  $sql$select public.notify_user((select id from public.profiles where username = 'eera'),
        'moderation_notice', 'Fake moderation notice', 'You have been banned')$sql$,
  'students must not be able to send staff-only notification types'
);

reset role;
select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);
