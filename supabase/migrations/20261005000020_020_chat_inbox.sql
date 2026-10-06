-- =============================================================================
-- Campus+ migration 020 — conversation inbox read model
-- =============================================================================
-- The Messages inbox needs, per visible conversation: the newest message (for
-- the preview line) and how many messages are unread since the last read mark,
-- saturated at the same 30-message window the UI has always used.
--
-- Before this function the page fetched the newest 30 messages of *every*
-- conversation (bodies included) just to render one preview line each — about
-- 69 kB per inbox open on the reference data set, and worse as threads grow.
-- The window is a read model, not a product change: an unread badge still
-- saturates at 30, and the preview is still the newest message.
--
-- Security: `security invoker`, so every row is still filtered by the RLS
-- policies on `conversations`, `conversation_members` and `messages` for the
-- calling student — this adds no visibility the student did not already have.
-- =============================================================================

create or replace function public.conversation_inbox(p_limit integer default 30)
returns table (
  id                      uuid,
  kind                    public.conversation_kind,
  title                   text,
  community_id            uuid,
  status                  public.content_status,
  last_message_at         timestamptz,
  created_at              timestamptz,
  is_muted                boolean,
  last_read_at            timestamptz,
  unread                  integer,
  last_message_id         uuid,
  last_message_sender_id  uuid,
  last_message_body       text,
  last_message_gif        jsonb,
  last_message_created_at timestamptz
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with mine as (
    select m.conversation_id, m.is_muted, m.last_read_at
    from public.conversation_members m
    where m.user_id = public.current_profile_id()
      and m.status = 'active'
  )
  select
    c.id,
    c.kind,
    c.title,
    c.community_id,
    c.status,
    c.last_message_at,
    c.created_at,
    mine.is_muted,
    mine.last_read_at,
    (
      select count(*)::integer
      from (
        select msg.sender_id, msg.created_at
        from public.messages msg
        where msg.conversation_id = c.id
        order by msg.created_at desc
        limit 30
      ) window_rows
      where window_rows.sender_id <> public.current_profile_id()
        and (mine.last_read_at is null or window_rows.created_at > mine.last_read_at)
    ) as unread,
    latest.id,
    latest.sender_id,
    latest.body,
    latest.gif,
    latest.created_at
  from public.conversations c
  join mine on mine.conversation_id = c.id
  left join lateral (
    select msg.id, msg.sender_id, msg.body, msg.gif, msg.created_at
    from public.messages msg
    where msg.conversation_id = c.id
    order by msg.created_at desc
    limit 1
  ) latest on true
  order by c.last_message_at desc
  limit coalesce(p_limit, 30);
$$;

comment on function public.conversation_inbox(integer) is
  'Inbox read model (RLS-scoped): newest message plus the unread count within the newest 30 messages per visible conversation.';
