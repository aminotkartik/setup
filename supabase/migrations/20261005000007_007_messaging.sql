-- Campus+ migration 007 — messaging
-- Supabase CLI filename: 20261005000007_007_messaging.sql
-- This file is part of the single authoritative migration history in supabase/migrations/.
-- =============================================================================
-- Campus+ 007 — direct messages, group chat, read receipts
-- =============================================================================
-- One conversation model serves DMs, marketplace "Message seller", event
-- organizer contact, club/community/study-group chat (spec §133).
--
-- Direct conversations can only be created through
-- `get_or_create_direct_conversation()`, which enforces blocks, the recipient's
-- "allow DMs from everyone" preference and account status. That single rule is
-- what makes "blocked users cannot DM each other" a database guarantee.
--
-- Read receipts only. No presence, no typing indicators, no last-seen (spec §23,
-- §80, §102).
-- =============================================================================

create table public.conversations (
  id              uuid primary key default gen_random_uuid(),
  kind            public.conversation_kind not null default 'direct',
  title           text check (title is null or length(title) <= 120),
  -- canonical "uuid:uuid" key for direct conversations (least:greatest) so a
  -- pair can never accumulate duplicate threads.
  direct_key      text unique,
  community_id    uuid references public.communities (id) on delete cascade,
  created_by      uuid references public.profiles (id) on delete set null,
  status          public.content_status not null default 'published',
  last_message_at timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint conversations_direct_key check (
    (kind = 'direct' and direct_key is not null) or (kind = 'group')
  ),
  constraint conversations_group_title check (kind = 'group' or title is null)
);

create index conversations_last_message_idx on public.conversations (last_message_at desc);
create index conversations_community_idx on public.conversations (community_id);

create trigger conversations_touch before update on public.conversations
  for each row execute function public.touch_updated_at();

create table public.conversation_members (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  role            text not null default 'member' check (role in ('member', 'owner')),
  status          text not null default 'active' check (status in ('active', 'left', 'removed')),
  joined_at       timestamptz not null default now(),
  last_read_at    timestamptz,
  -- FK is added right after `messages` is created below: SET NULL keeps the read
  -- marker meaningful even when a sender hard-deletes a message.
  last_read_message_id uuid,
  is_muted        boolean not null default false,
  unique (conversation_id, user_id)
);

create index conversation_members_user_idx on public.conversation_members (user_id, status);
create index conversation_members_conversation_idx on public.conversation_members (conversation_id, status);

create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id       uuid not null references public.profiles (id) on delete cascade,
  body            text not null default '' check (length(body) <= 2000),
  gif             jsonb,
  status          public.content_status not null default 'published',
  edited_at       timestamptz,
  deleted_at      timestamptz,
  deleted_by      uuid references public.profiles (id) on delete set null,
  moderated_by    uuid references public.profiles (id) on delete set null,
  moderated_at    timestamptz,
  moderation_reason text,
  created_at      timestamptz not null default now(),
  -- A live message must carry content; a soft-deleted one deliberately carries
  -- none (the content is retained in message_edits for moderation).
  constraint messages_content_present check (
    length(btrim(body)) > 0 or gif is not null or status = 'deleted'
  ),
  constraint messages_gif_provider check (gif is null or (gif->>'provider') = 'giphy'),
  constraint messages_gif_url_host check (gif is null or (gif->>'url') ~ '^https://(media[0-9]?\.)?giphy\.com/')
);

create index messages_conversation_idx on public.messages (conversation_id, created_at desc);
create index messages_sender_idx on public.messages (sender_id, created_at desc);

alter table public.conversation_members
  add constraint conversation_members_last_read_fk
  foreign key (last_read_message_id) references public.messages (id) on delete set null;

comment on table public.messages is
  'DM and group-chat messages. Text plus an optional external GIF reference — never an upload.';

-- Evidence trail: keeps the previous body whenever a message is edited or
-- deleted, so moderation evidence survives (spec §121).
create table public.message_edits (
  id            uuid primary key default gen_random_uuid(),
  message_id    uuid not null references public.messages (id) on delete cascade,
  previous_body text,
  previous_gif  jsonb,
  edited_by     uuid references public.profiles (id) on delete set null,
  reason        text not null default 'edit' check (reason in ('edit', 'delete', 'moderation')),
  edited_at     timestamptz not null default now()
);

create index message_edits_message_idx on public.message_edits (message_id, edited_at desc);

create table public.message_reads (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  last_read_at     timestamptz not null default now(),
  last_message_id  uuid references public.messages (id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (conversation_id, user_id)
);

create index message_reads_conversation_idx on public.message_reads (conversation_id);
create index message_reads_user_idx on public.message_reads (user_id);

-- ----------------------------------------------------------------------------
-- Helpers
-- ----------------------------------------------------------------------------

create or replace function public.can_access_conversation(p_conversation uuid, p_user uuid default null)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.conversation_members m
    join public.conversations c on c.id = m.conversation_id
    where m.conversation_id = p_conversation
      and m.user_id = coalesce(p_user, public.current_profile_id())
      and m.status = 'active'
      and c.status = 'published'
  );
$$;

comment on function public.can_access_conversation(uuid, uuid) is
  'The only membership test used by conversation, message and read-receipt policies.';

create or replace function public.conversation_member_ids(p_conversation uuid)
returns uuid[]
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not (public.can_access_conversation(p_conversation) or public.is_staff()) then
    raise exception 'You are not a member of this conversation.' using errcode = '42501';
  end if;
  return (
    select coalesce(array_agg(m.user_id), '{}'::uuid[])
    from public.conversation_members m
    where m.conversation_id = p_conversation and m.status = 'active'
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- get_or_create_direct_conversation — the only path that creates a DM thread
-- ----------------------------------------------------------------------------

create or replace function public.get_or_create_direct_conversation(p_other uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := public.current_profile_id();
  v_key text;
  v_id uuid;
begin
  if v_me is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not public.is_active_user() then
    raise exception 'Your account cannot start conversations.' using errcode = '42501';
  end if;
  if not public.has_permission('send_messages') then
    raise exception 'You do not have permission to send messages.' using errcode = '42501';
  end if;
  if p_other is null or p_other = v_me then
    raise exception 'Choose another student to message.' using errcode = '22023';
  end if;
  if not public.is_active_profile(p_other) then
    raise exception 'That student is not available.' using errcode = '42501';
  end if;
  if public.is_blocked(v_me, p_other) then
    raise exception 'You cannot start a conversation with this student.' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.profiles pr
    where pr.id = p_other and pr.allow_dms_from_everyone = false
  ) then
    raise exception 'That student does not accept messages from everyone.' using errcode = '42501';
  end if;

  v_key := least(v_me::text, p_other::text) || ':' || greatest(v_me::text, p_other::text);

  select c.id into v_id from public.conversations c where c.direct_key = v_key;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.conversations (kind, direct_key, created_by)
  values ('direct', v_key, v_me)
  returning id into v_id;

  insert into public.conversation_members (conversation_id, user_id, role)
  values (v_id, v_me, 'member'), (v_id, p_other, 'member');

  return v_id;
end;
$$;

comment on function public.get_or_create_direct_conversation(uuid) is
  'Creates or returns the single DM thread between two students, enforcing blocks, DM preferences and account status.';

-- ----------------------------------------------------------------------------
-- open_community_chat — the group room for a community / study group / club
-- ----------------------------------------------------------------------------
-- Rooms are created and populated by the database, not by the client: one room
-- per space, members kept in sync with space membership. This keeps chat
-- authorization identical to community authorization (spec §23, §114).

create or replace function public.open_community_chat(p_community uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := public.current_profile_id();
  v_id uuid;
  v_title text;
begin
  if v_me is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not public.is_active_user() then
    raise exception 'Your account cannot open chats.' using errcode = '42501';
  end if;
  if not public.feature_enabled('group_chat') then
    raise exception 'Group chat is disabled.' using errcode = '42501';
  end if;
  if p_community is null then
    raise exception 'Choose a space.' using errcode = '22023';
  end if;
  if not public.can_view_community(p_community) then
    raise exception 'You cannot open this chat.' using errcode = '42501';
  end if;
  if not (public.is_community_member(p_community) or public.is_staff()) then
    raise exception 'Join the space before using its chat.' using errcode = '42501';
  end if;

  select c.id into v_id
  from public.conversations c
  where c.community_id = p_community and c.kind = 'group'
  limit 1;

  select co.name into v_title from public.communities co where co.id = p_community;

  if v_id is null then
    insert into public.conversations (kind, title, community_id, created_by)
    values ('group', left(v_title, 120), p_community, v_me)
    returning id into v_id;
  end if;

  -- Keep membership aligned with the space. Only active members are added.
  insert into public.conversation_members (conversation_id, user_id, role)
  select v_id, m.user_id, case when m.role = 'owner' then 'owner' else 'member' end
  from public.community_members m
  where m.community_id = p_community and m.status = 'active'
  on conflict (conversation_id, user_id) do nothing;

  insert into public.conversation_members (conversation_id, user_id, role)
  values (v_id, v_me, 'member')
  on conflict (conversation_id, user_id) do nothing;

  return v_id;
end;
$$;

comment on function public.open_community_chat(uuid) is
  'Returns (creating if needed) the single group chat room for a community, study group or club.';

-- ----------------------------------------------------------------------------
-- mark_conversation_read — powers the Seen receipt
-- ----------------------------------------------------------------------------

create or replace function public.mark_conversation_read(p_conversation uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := public.current_profile_id();
  v_now timestamptz := now();
  v_last uuid;
begin
  if v_me is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not public.can_access_conversation(p_conversation, v_me) then
    raise exception 'You are not a member of this conversation.' using errcode = '42501';
  end if;

  select m.id into v_last
  from public.messages m
  where m.conversation_id = p_conversation
  order by m.created_at desc
  limit 1;

  update public.conversation_members
     set last_read_at = v_now,
         last_read_message_id = coalesce(v_last, last_read_message_id)
   where conversation_id = p_conversation and user_id = v_me;

  insert into public.message_reads (conversation_id, user_id, last_read_at, last_message_id)
  values (p_conversation, v_me, v_now, v_last)
  on conflict (conversation_id, user_id)
  do update set last_read_at = v_now, last_message_id = coalesce(v_last, public.message_reads.last_message_id);

  return v_now;
end;
$$;

comment on function public.mark_conversation_read(uuid) is
  'Records the Seen receipt for the calling member. There is no other read-state mechanism.';

-- ----------------------------------------------------------------------------
-- Guarded writes
-- ----------------------------------------------------------------------------

-- Conversation last_message_at + the sender's own read position.
create or replace function public.on_message_inserted()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.conversations
     set last_message_at = new.created_at
   where id = new.conversation_id;
  return new;
end;
$$;

create trigger messages_touch_conversation
  after insert on public.messages
  for each row execute function public.on_message_inserted();

-- Preserve previous content when a message is edited or deleted.
create or replace function public.track_message_edit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Deletions are captured by soften_deleted_message (which owns that
  -- transition); this trigger records content edits and staff moderation edits.
  if (new.body is distinct from old.body or new.gif is distinct from old.gif)
     and new.deleted_at is not distinct from old.deleted_at then
    insert into public.message_edits (message_id, previous_body, previous_gif, edited_by, reason)
    values (
      old.id, old.body, old.gif, coalesce(public.current_profile_id(), new.sender_id),
      case when public.is_staff() and old.sender_id is distinct from public.current_profile_id()
           then 'moderation' else 'edit' end
    );
  end if;
  if new.body is distinct from old.body and new.deleted_at is null then
    new.edited_at := now();
  end if;
  return new;
end;
$$;

create trigger messages_track_edit
  before update on public.messages
  for each row execute function public.track_message_edit();

-- Soft-neutralise a deleted message: keep the row (and the evidence trail),
-- drop the visible content.
create or replace function public.soften_deleted_message()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    -- Retention first: the content being removed is kept as evidence so that a
    -- moderator can still read what was said (spec: deletion must never break
    -- moderation or audit).
    if length(btrim(coalesce(old.body, ''))) > 0 or old.gif is not null then
      insert into public.message_edits (message_id, previous_body, previous_gif, edited_by, reason)
      values (old.id, old.body, old.gif, coalesce(new.deleted_by, public.current_profile_id()), 'delete');
    end if;

    new.body := '';
    new.gif := null;
    new.status := 'deleted';
  end if;
  return new;
end;
$$;

create trigger messages_soften_deleted
  before update on public.messages
  for each row execute function public.soften_deleted_message();

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------

alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.message_edits enable row level security;
alter table public.message_reads enable row level security;

-- conversations -------------------------------------------------------------
-- The creator fallback keeps `INSERT ... RETURNING` working (PostgreSQL applies SELECT
-- policies to returned rows) and lets a room owner always see the room they opened.
create policy conversations_select_member on public.conversations
  for select to authenticated
  using (public.can_access_conversation(id) or created_by = public.current_profile_id());

-- Staff may read a conversation ONLY while a report is open against it. This is
-- the narrow, auditable moderation window (access is written to audit_logs by
-- the application every time it is used).
create policy conversations_select_staff_on_report on public.conversations
  for select to authenticated
  using (
    (public.has_permission('review_reports') or public.has_permission('moderate_all'))
    and exists (
      select 1 from public.reports r
      where r.target_type in ('conversation', 'message')
        and r.status in ('pending', 'reviewing')
        and (r.target_id = conversations.id
             or exists (select 1 from public.messages m
                        where m.id = r.target_id and m.conversation_id = conversations.id))
    )
  );

-- Direct conversations are created exclusively by the definer function; group
-- rooms may be created by a community moderator or by a student opening a chat
-- for a space they belong to.
create policy conversations_insert_group on public.conversations
  for insert to authenticated
  with check (
    kind = 'group'
    and created_by = public.current_profile_id()
    and public.is_active_user()
    and (
      (community_id is null and public.has_permission('create_communities'))
      or (community_id is not null and public.is_community_moderator(community_id))
    )
  );

create policy conversations_update_member on public.conversations
  for update to authenticated
  using (public.can_access_conversation(id))
  with check (public.can_access_conversation(id));

-- conversation_members ------------------------------------------------------
create policy conversation_members_select_member on public.conversation_members
  for select to authenticated
  using (public.can_access_conversation(conversation_id));

create policy conversation_members_update_self on public.conversation_members
  for update to authenticated
  using (user_id = public.current_profile_id())
  with check (user_id = public.current_profile_id());

create policy conversation_members_insert_group_member on public.conversation_members
  for insert to authenticated
  with check (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and c.kind = 'group'
        and public.can_access_conversation(c.id)
    )
  );

-- messages ------------------------------------------------------------------
create policy messages_select_member on public.messages
  for select to authenticated
  using (public.can_access_conversation(conversation_id));

create policy messages_select_staff_on_report on public.messages
  for select to authenticated
  using (
    (public.has_permission('review_reports') or public.has_permission('moderate_all'))
    and exists (
      select 1 from public.reports r
      where r.status in ('pending', 'reviewing')
        and (
          (r.target_type = 'message' and r.target_id = messages.id)
          or (r.target_type = 'conversation' and r.target_id = messages.conversation_id)
        )
    )
  );

create policy messages_insert_member on public.messages
  for insert to authenticated
  with check (
    sender_id = public.current_profile_id()
    and public.is_active_user()
    and public.has_permission('send_messages')
    and status = 'published'
    and public.can_access_conversation(conversation_id)
    -- A block in either direction stops message delivery, in direct threads and
    -- group rooms alike.
    -- `other.conversation_id` MUST be qualified against the outer table:
    -- an unqualified name inside the subquery binds to `other`, turning the
    -- join into a tautology and blocking the sender's unrelated conversations.
    and not exists (
      select 1
      from public.conversation_members other
      where other.conversation_id = messages.conversation_id
        and other.user_id <> messages.sender_id
        and other.status = 'active'
        and public.is_blocked(messages.sender_id, other.user_id)
    )
  );

create policy messages_update_sender on public.messages
  for update to authenticated
  using (
    sender_id = public.current_profile_id()
    and public.is_active_user()
    and deleted_at is null
    and created_at > now() - interval '15 minutes'
  )
  with check (sender_id = public.current_profile_id());

create policy messages_update_staff on public.messages
  for update to authenticated
  using ((public.has_permission('review_reports') or public.has_permission('moderate_all'))
         and exists (select 1 from public.reports r
                     where r.status in ('pending', 'reviewing')
                       and ((r.target_type = 'message' and r.target_id = messages.id)
                            or (r.target_type = 'conversation' and r.target_id = messages.conversation_id))))
  with check (true);

create policy messages_delete_sender on public.messages
  for delete to authenticated using (sender_id = public.current_profile_id());
create policy messages_delete_staff on public.messages
  for delete to authenticated
  using (public.has_permission('moderate_all'));

-- message_edits (evidence) ---------------------------------------------------
create policy message_edits_select_staff on public.message_edits
  for select to authenticated
  using (public.has_permission('view_moderation_logs') or public.has_permission('review_reports'));

-- message_reads --------------------------------------------------------------
-- Every member of a conversation may see the read state of that conversation's
-- members (that is the Seen receipt). Nobody can see read states elsewhere.
create policy message_reads_select_member on public.message_reads
  for select to authenticated
  using (public.can_access_conversation(conversation_id));

create policy message_reads_insert_self on public.message_reads
  for insert to authenticated
  with check (user_id = public.current_profile_id() and public.can_access_conversation(conversation_id));

create policy message_reads_update_self on public.message_reads
  for update to authenticated
  using (user_id = public.current_profile_id())
  with check (user_id = public.current_profile_id());
