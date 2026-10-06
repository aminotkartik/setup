-- Campus+ migration 005 — social
-- Supabase CLI filename: 20261005000005_005_social.sql
-- This file is part of the single authoritative migration history in supabase/migrations/.
-- =============================================================================
-- Campus+ 005 — posts, discussions, polls, comments, reactions, mentions
-- =============================================================================
-- Text-first by construction: `body` is text, `gif` is a validated JSONB
-- reference to an external GIPHY asset, and there is deliberately no column,
-- bucket or policy that could hold an uploaded file (spec §3, §89).
-- =============================================================================

-- ----------------------------------------------------------------------------
-- posts (also serves discussions and polls through `kind`)
-- ----------------------------------------------------------------------------

create table public.posts (
  id                 uuid primary key default gen_random_uuid(),
  author_id          uuid not null references public.profiles (id) on delete cascade,
  kind               public.post_kind not null default 'post',
  title              text check (title is null or length(title) between 5 and 140),
  body               text not null check (length(btrim(body)) between 1 and 2000),
  gif                jsonb,
  community_id       uuid references public.communities (id) on delete cascade,
  visibility         public.visibility_level not null default 'public',
  status             public.content_status not null default 'published',
  is_official        boolean not null default false,
  pinned             boolean not null default false,
  poll_closes_at     timestamptz,
  comment_count      integer not null default 0 check (comment_count >= 0),
  reaction_count     integer not null default 0 check (reaction_count >= 0),
  moderated_by       uuid references public.profiles (id) on delete set null,
  moderated_at       timestamptz,
  moderation_reason  text,
  deleted_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  search_vector      tsvector generated always as (
    to_tsvector(
      'english'::regconfig,
      coalesce(title, '') || ' ' || coalesce(body, '')
    )
  ) stored,
  constraint posts_kind_title check (kind = 'post' or (title is not null and length(btrim(title)) >= 5)),
  constraint posts_community_visibility check (
    (community_id is null and visibility in ('public', 'campus'))
    or community_id is not null
  ),
  constraint posts_gif_provider check (
    gif is null or (gif->>'provider') = 'giphy'
  ),
  constraint posts_gif_url_host check (
    gif is null or (gif->>'url') ~ '^https://(media[0-9]?\.)?giphy\.com/'
  )
);

create index posts_feed_idx on public.posts (status, created_at desc) where community_id is null;
create index posts_community_idx on public.posts (community_id, created_at desc);
create index posts_author_idx on public.posts (author_id, created_at desc);
create index posts_kind_idx on public.posts (kind, created_at desc);
create index posts_search_idx on public.posts using gin (search_vector);
create index posts_recent_activity_idx on public.posts (updated_at desc);

create trigger posts_touch before update on public.posts
  for each row execute function public.touch_updated_at();

comment on table public.posts is
  'Text-first posts, discussions (kind=discussion) and polls (kind=poll). No attachments exist by design.';

-- Keep author-editable columns separate from moderation columns. A student
-- editing their own post can never change its status, official badge, counters
-- or moderation metadata.
create or replace function public.guard_post_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Counters are derived truth, never client input: they are recomputed from the
  -- rows that produce them, for every writer that is not an operator script.
  if not public.is_trusted_writer() then
    new.comment_count := (
      select count(*) from public.comments c
      where c.post_id = old.id and c.status = 'published' and c.deleted_at is null
    );
    new.reaction_count := (
      select count(*) from public.reactions r
      where r.target_type = 'post' and r.target_id = old.id
    );
  end if;

  if public.is_trusted_writer()
     or public.has_permission('remove_posts')
     or public.has_permission('moderate_all') then
    return new;
  end if;

  new.status            := old.status;
  new.is_official       := old.is_official;
  new.pinned            := old.pinned;
  new.author_id         := old.author_id;
  new.community_id      := old.community_id;
  new.kind              := old.kind;
  new.moderated_by      := old.moderated_by;
  new.moderated_at      := old.moderated_at;
  new.moderation_reason := old.moderation_reason;
  return new;
end;
$$;

create trigger posts_guard_update
  before update on public.posts
  for each row execute function public.guard_post_update();

-- ----------------------------------------------------------------------------
-- poll_options / poll_votes
-- ----------------------------------------------------------------------------

create table public.poll_options (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts (id) on delete cascade,
  label      text not null check (length(btrim(label)) between 1 and 120),
  position   integer not null default 0,
  vote_count integer not null default 0 check (vote_count >= 0),
  unique (post_id, position)
);

-- No separate (post_id) index: the unique (post_id, position) constraint already
-- serves lookups by post_id as a prefix.

create table public.poll_votes (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts (id) on delete cascade,
  option_id  uuid not null references public.poll_options (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (post_id, user_id)
);

create index poll_votes_post_idx on public.poll_votes (post_id);
create index poll_votes_option_idx on public.poll_votes (option_id);
create index poll_votes_user_idx on public.poll_votes (user_id);

comment on table public.poll_votes is
  'One row per voter per poll — duplicate voting is impossible at the schema level.';

-- ----------------------------------------------------------------------------
-- comments
-- ----------------------------------------------------------------------------

create table public.comments (
  id                uuid primary key default gen_random_uuid(),
  post_id           uuid not null references public.posts (id) on delete cascade,
  author_id         uuid not null references public.profiles (id) on delete cascade,
  parent_id         uuid references public.comments (id) on delete cascade,
  body              text not null check (length(btrim(body)) between 1 and 1000),
  gif               jsonb,
  status            public.content_status not null default 'published',
  reaction_count    integer not null default 0 check (reaction_count >= 0),
  moderated_by      uuid references public.profiles (id) on delete set null,
  moderated_at      timestamptz,
  moderation_reason text,
  deleted_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint comments_gif_provider check (gif is null or (gif->>'provider') = 'giphy'),
  constraint comments_gif_url_host check (
    gif is null or (gif->>'url') ~ '^https://(media[0-9]?\.)?giphy\.com/'
  )
);

create index comments_post_idx on public.comments (post_id, created_at);
create index comments_author_idx on public.comments (author_id);
create index comments_parent_idx on public.comments (parent_id);

create trigger comments_touch before update on public.comments
  for each row execute function public.touch_updated_at();

create or replace function public.guard_comment_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_trusted_writer() then
    new.reaction_count := (
      select count(*) from public.reactions r
      where r.target_type = 'comment' and r.target_id = old.id
    );
  end if;

  if public.is_trusted_writer()
     or public.has_permission('remove_comments')
     or public.has_permission('moderate_all') then
    return new;
  end if;

  new.status            := old.status;
  new.author_id         := old.author_id;
  new.post_id           := old.post_id;
  new.parent_id         := old.parent_id;
  new.moderated_by      := old.moderated_by;
  new.moderated_at      := old.moderated_at;
  new.moderation_reason := old.moderation_reason;
  return new;
end;
$$;

create trigger comments_guard_update
  before update on public.comments
  for each row execute function public.guard_comment_update();

-- ----------------------------------------------------------------------------
-- reactions (posts and comments)
-- ----------------------------------------------------------------------------

create table public.reactions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  target_type text not null check (target_type in ('post', 'comment')),
  target_id   uuid not null,
  kind        public.reaction_kind not null default 'like',
  created_at  timestamptz not null default now(),
  unique (user_id, target_type, target_id)
);

create index reactions_target_idx on public.reactions (target_type, target_id);
create index reactions_user_idx on public.reactions (user_id, created_at desc);

comment on table public.reactions is
  'One reaction per user per item. target_type validates the polymorphic reference; target_id is checked by the RLS policies of the parent table.';

-- ----------------------------------------------------------------------------
-- mentions
-- ----------------------------------------------------------------------------

create table public.mentions (
  id                uuid primary key default gen_random_uuid(),
  mentioned_user_id uuid not null references public.profiles (id) on delete cascade,
  actor_id          uuid not null references public.profiles (id) on delete cascade,
  source_type       text not null check (source_type in ('post', 'comment', 'message', 'community_post')),
  source_id         uuid not null,
  created_at        timestamptz not null default now(),
  unique (mentioned_user_id, source_type, source_id)
);

create index mentions_user_idx on public.mentions (mentioned_user_id, created_at desc);
create index mentions_source_idx on public.mentions (source_type, source_id);
create index mentions_actor_idx on public.mentions (actor_id);

-- ----------------------------------------------------------------------------
-- Counters
-- ----------------------------------------------------------------------------

create or replace function public.sync_post_counts()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_post uuid := coalesce(new.post_id, old.post_id);
begin
  update public.posts p
     set comment_count = (
       select count(*) from public.comments c
       where c.post_id = v_post and c.status = 'published' and c.deleted_at is null
     )
   where p.id = v_post;
  return coalesce(new, old);
end;
$$;

create trigger comments_sync_post_counts
  after insert or update or delete on public.comments
  for each row execute function public.sync_post_counts();

create or replace function public.sync_reaction_counts()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target_type text := coalesce(new.target_type, old.target_type);
  v_target uuid := coalesce(new.target_id, old.target_id);
  v_total integer;
begin
  select count(*) into v_total from public.reactions r
   where r.target_type = v_target_type and r.target_id = v_target;

  if v_target_type = 'post' then
    update public.posts set reaction_count = v_total where id = v_target;
  else
    update public.comments set reaction_count = v_total where id = v_target;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger reactions_sync_counts
  after insert or update or delete on public.reactions
  for each row execute function public.sync_reaction_counts();

-- Poll option vote counts are derived truth as well.
create or replace function public.guard_poll_option_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_trusted_writer() then
    new.vote_count := (select count(*) from public.poll_votes v where v.option_id = old.id);
    new.post_id := old.post_id;
    new.position := old.position;
  end if;
  return new;
end;
$$;

create trigger poll_options_guard_update
  before update on public.poll_options
  for each row execute function public.guard_poll_option_update();

create or replace function public.sync_poll_option_counts()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_option uuid := coalesce(new.option_id, old.option_id);
begin
  update public.poll_options o
     set vote_count = (select count(*) from public.poll_votes v where v.option_id = v_option)
   where o.id = v_option;
  return coalesce(new, old);
end;
$$;

create trigger poll_votes_sync_counts
  after insert or update or delete on public.poll_votes
  for each row execute function public.sync_poll_option_counts();

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------

alter table public.posts enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes enable row level security;
alter table public.comments enable row level security;
alter table public.reactions enable row level security;
alter table public.mentions enable row level security;

-- posts ---------------------------------------------------------------------
create policy posts_select_visible on public.posts
  for select to authenticated
  using (
    status = 'published'
    and deleted_at is null
    and public.is_active_profile(author_id)
    and not public.is_blocked_with_current(author_id)
    and not public.is_muted_by_current(author_id)
    and (
      (community_id is null and visibility in ('public', 'campus'))
      or (community_id is not null and public.can_view_community(community_id))
    )
  );

create policy posts_select_author on public.posts
  for select to authenticated using (author_id = public.current_profile_id());

create policy posts_select_staff on public.posts
  for select to authenticated
  using (public.has_permission('remove_posts') or public.has_permission('moderate_all'));

create policy posts_insert_own on public.posts
  for insert to authenticated
  with check (
    author_id = public.current_profile_id()
    and public.is_active_user()
    and public.has_permission('create_posts')
    and public.is_active_profile(author_id)
    and status in ('published', 'pending')
    and (is_official = false or public.has_permission('manage_notices'))
    and (community_id is null or public.can_post_in_community(community_id))
    and (kind <> 'poll' or public.has_permission('create_polls'))
  );

create policy posts_update_author on public.posts
  for update to authenticated
  using (author_id = public.current_profile_id() and public.is_active_user())
  with check (author_id = public.current_profile_id());

create policy posts_update_staff on public.posts
  for update to authenticated
  using (public.has_permission('remove_posts') or public.has_permission('moderate_all'))
  with check (public.has_permission('remove_posts') or public.has_permission('moderate_all'));

create policy posts_delete_author on public.posts
  for delete to authenticated using (author_id = public.current_profile_id());
create policy posts_delete_staff on public.posts
  for delete to authenticated
  using (public.has_permission('remove_posts') or public.has_permission('moderate_all'));

-- poll_options --------------------------------------------------------------
create policy poll_options_select_visible on public.poll_options
  for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id));

create policy poll_options_insert_author on public.poll_options
  for insert to authenticated
  with check (
    exists (
      select 1 from public.posts p
      where p.id = post_id
        and p.author_id = public.current_profile_id()
        and p.kind = 'poll'
        and p.created_at > now() - interval '5 minutes'
    )
  );

create policy poll_options_update_author on public.poll_options
  for update to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id and p.author_id = public.current_profile_id()))
  with check (exists (select 1 from public.posts p where p.id = post_id and p.author_id = public.current_profile_id()));

-- poll_votes ----------------------------------------------------------------
create policy poll_votes_select_visible on public.poll_votes
  for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id));

create policy poll_votes_insert_self on public.poll_votes
  for insert to authenticated
  with check (
    user_id = public.current_profile_id()
    and public.is_active_user()
    and exists (
      select 1 from public.posts p
      where p.id = post_id
        and p.kind = 'poll'
        and p.status = 'published'
        and (p.poll_closes_at is null or p.poll_closes_at > now())
        and p.author_id <> public.current_profile_id()
    )
    and not exists (
      select 1 from public.posts p2
      where p2.id = post_id and public.is_blocked_with_current(p2.author_id)
    )
  );

create policy poll_votes_delete_self on public.poll_votes
  for delete to authenticated using (user_id = public.current_profile_id());

-- comments ------------------------------------------------------------------
create policy comments_select_visible on public.comments
  for select to authenticated
  using (
    status = 'published'
    and deleted_at is null
    and public.is_active_profile(author_id)
    and not public.is_blocked_with_current(author_id)
    and exists (
      select 1 from public.posts p
      where p.id = post_id
        and p.status = 'published'
        and public.is_active_profile(p.author_id)
        and not public.is_blocked_with_current(p.author_id)
        and (
          (p.community_id is null and p.visibility in ('public', 'campus'))
          or (p.community_id is not null and public.can_view_community(p.community_id))
        )
    )
  );

create policy comments_select_author on public.comments
  for select to authenticated using (author_id = public.current_profile_id());

create policy comments_select_staff on public.comments
  for select to authenticated
  using (public.has_permission('remove_comments') or public.has_permission('moderate_all'));

create policy comments_insert_own on public.comments
  for insert to authenticated
  with check (
    author_id = public.current_profile_id()
    and public.is_active_user()
    and public.has_permission('create_comments')
    and status in ('published', 'pending')
    and exists (
      select 1 from public.posts p
      where p.id = post_id
        and p.status = 'published'
        and p.deleted_at is null
        and public.is_active_profile(p.author_id)
        and not public.is_blocked_with_current(p.author_id)
        and (
          (p.community_id is null and p.visibility in ('public', 'campus'))
          or (p.community_id is not null and public.can_view_community(p.community_id))
        )
    )
  );

create policy comments_update_author on public.comments
  for update to authenticated
  using (author_id = public.current_profile_id() and public.is_active_user())
  with check (author_id = public.current_profile_id());

create policy comments_update_staff on public.comments
  for update to authenticated
  using (public.has_permission('remove_comments') or public.has_permission('moderate_all'))
  with check (public.has_permission('remove_comments') or public.has_permission('moderate_all'));

create policy comments_delete_author on public.comments
  for delete to authenticated using (author_id = public.current_profile_id());
create policy comments_delete_staff on public.comments
  for delete to authenticated
  using (public.has_permission('remove_comments') or public.has_permission('moderate_all'));

-- reactions -----------------------------------------------------------------
create policy reactions_select_visible on public.reactions
  for select to authenticated
  using (
    case target_type
      when 'post' then exists (select 1 from public.posts p where p.id = target_id)
      else exists (select 1 from public.comments c where c.id = target_id)
    end
  );

create policy reactions_insert_self on public.reactions
  for insert to authenticated
  with check (
    user_id = public.current_profile_id()
    and public.is_active_user()
    and public.has_permission('react_content')
    and case target_type
      when 'post' then exists (
        select 1 from public.posts p
        where p.id = target_id and p.status = 'published' and not public.is_blocked_with_current(p.author_id)
      )
      else exists (
        select 1 from public.comments c
        where c.id = target_id and c.status = 'published' and not public.is_blocked_with_current(c.author_id)
      )
    end
  );

create policy reactions_update_self on public.reactions
  for update to authenticated
  using (user_id = public.current_profile_id())
  with check (user_id = public.current_profile_id());

create policy reactions_delete_self on public.reactions
  for delete to authenticated using (user_id = public.current_profile_id());

-- mentions ------------------------------------------------------------------
create policy mentions_select_own on public.mentions
  for select to authenticated
  using (mentioned_user_id = public.current_profile_id() or actor_id = public.current_profile_id());

create policy mentions_insert_actor on public.mentions
  for insert to authenticated
  with check (
    actor_id = public.current_profile_id()
    and public.is_active_user()
    and not public.is_blocked(actor_id, mentioned_user_id)
    and public.is_active_profile(mentioned_user_id)
  );

-- ----------------------------------------------------------------------------
-- Convenience: one call that records a post's mentions.
-- Runs as definer so a mention can only be recorded for a real, unblocked,
-- active user — the same checks the policy above performs.
-- ----------------------------------------------------------------------------

create or replace function public.record_mentions(
  p_source_type text,
  p_source_id uuid,
  p_usernames text[]
)
returns table (user_id uuid, username text, display_name text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_name text;
begin
  if v_actor is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  foreach v_name in array coalesce(p_usernames, '{}'::text[])
  loop
    insert into public.mentions (mentioned_user_id, actor_id, source_type, source_id)
    select p.id, v_actor, p_source_type, p_source_id
    from public.profiles p
    where p.username = lower(ltrim(v_name, '@'))
      and p.id <> v_actor
      and public.is_active_profile(p.id)
      and not public.is_blocked(v_actor, p.id)
    on conflict (mentioned_user_id, source_type, source_id) do nothing;
  end loop;

  return query
    select m.mentioned_user_id, p.username, p.display_name
    from public.mentions m
    join public.profiles p on p.id = m.mentioned_user_id
    where m.source_type = p_source_type and m.source_id = p_source_id;
end;
$$;

comment on function public.record_mentions(text, uuid, text[]) is
  'Records @mentions for a post/comment/message. Blocks and inactive accounts are filtered server-side.';
