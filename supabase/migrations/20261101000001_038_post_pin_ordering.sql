-- =============================================================================
-- Campus+ migration 038 — durable post pin ordering and live pin changes
-- =============================================================================
-- The posts.pinned column already exists and is staff-controlled. This migration
-- does not add a pin timestamp or rewrite rows: existing pinned rows participate
-- in the corrected order as soon as campus_feed() is replaced.
--
-- Three contracts change together:
--   1. campus_feed() gives pinned entries priority, then retains the established
--      chronological/trending order and adds deterministic pagination tie-breaks.
--   2. moderate_content() adds audited pin/unpin actions for existing post
--      moderators. It grants no direct column update and no student permission.
--   3. posts uses a narrow replica-identity index (id, pinned, status), allowing
--      the existing Realtime UPDATE binding to discard counter-only updates while
--      still detecting a pin transition. Old post bodies are not added to WAL or
--      Realtime payloads, and RLS/publication membership are unchanged.
-- =============================================================================

create or replace function public.campus_feed(
  p_limit integer default 20,
  p_offset integer default 0,
  p_sort text default 'newest'
)
returns table (
  item_type text,
  id uuid,
  title text,
  body text,
  gif jsonb,
  author_username text,
  author_display_name text,
  is_official boolean,
  community_slug text,
  meta jsonb,
  created_at timestamptz,
  sort_at timestamptz
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with items as (
    -- student posts and discussions
    select
      case when p.kind = 'discussion' then 'discussion' else 'post' end as item_type,
      p.id,
      p.title,
      p.body,
      p.gif,
      pr.username as author_username,
      pr.display_name as author_display_name,
      p.is_official,
      c.slug as community_slug,
      jsonb_build_object(
        'kind', p.kind,
        'reaction_count', p.reaction_count,
        'comment_count', p.comment_count,
        'pinned', p.pinned
      ) as meta,
      p.created_at,
      p.created_at as sort_at
    from public.posts p
    join public.profiles pr on pr.id = p.author_id
    left join public.communities c on c.id = p.community_id
    where p.community_id is null
      and p.status = 'published'
      and p.deleted_at is null
      and public.feature_enabled('feed')

    union all

    -- official notices
    select
      'notice',
      n.id,
      n.title,
      n.body,
      null,
      null,
      null,
      true,
      null,
      jsonb_build_object('category', n.category, 'importance', n.importance, 'pinned', n.pinned),
      coalesce(n.published_at, n.created_at),
      case when n.pinned then now() + interval '1 day' else coalesce(n.published_at, n.created_at) end
    from public.notices n
    where n.status = 'published'
      and (n.expires_at is null or n.expires_at > now())
      and public.feature_enabled('noticeboard')

    union all

    -- upcoming events
    select
      'event',
      e.id,
      e.title,
      e.description,
      null,
      null,
      null,
      true,
      null,
      jsonb_build_object('starts_on', e.starts_on, 'start_time', e.start_time, 'location', e.location, 'organizer', e.organizer),
      e.created_at,
      case when e.starts_on <= current_date then now() else (e.starts_on::timestamptz) end
    from public.events e
    where e.status = 'published'
      and (e.ends_on is null or e.ends_on >= current_date)
      and public.feature_enabled('events')

    union all

    -- published opportunities
    select
      'opportunity',
      o.id,
      o.title,
      o.description,
      null,
      null,
      null,
      o.source = 'official',
      null,
      jsonb_build_object('organization', o.organization, 'deadline', o.deadline, 'source', o.source),
      o.created_at,
      o.created_at
    from public.opportunities o
    where o.status = 'published'
      and public.feature_enabled('opportunities')

    union all

    -- active marketplace highlights
    select
      'listing',
      l.id,
      l.title,
      l.description,
      null,
      pr.username,
      pr.display_name,
      false,
      null,
      jsonb_build_object('price', l.price, 'is_free', l.is_free, 'condition', l.condition),
      l.created_at,
      l.created_at
    from public.marketplace_listings l
    join public.profiles pr on pr.id = l.seller_id
    where l.status = 'active'
      and public.feature_enabled('marketplace')
      and public.setting('feed_marketplace_highlights', 'true'::jsonb) = 'true'::jsonb
  )
  select *
  from items
  order by
    -- A pin is a moderation decision, not a fabricated timestamp. Keep the
    -- existing pinned-notice behaviour in the same priority group, then use
    -- each entry's established ordering inside that group.
    case when coalesce((meta->>'pinned')::boolean, false) then 1 else 0 end desc,
    case when p_sort = 'trending' then null else sort_at end desc nulls last,
    -- deterministic secondary signal for trending: engagement density
    case when p_sort = 'trending'
      then coalesce((meta->>'reaction_count')::int, 0) * 2 + coalesce((meta->>'comment_count')::int, 0) * 3
      else 0 end desc,
    -- Offset pages must not reshuffle rows with equal sort keys.
    item_type asc,
    id asc
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

comment on function public.campus_feed(integer, integer, text) is
  'Unified home feed. Pinned entries lead; otherwise newest by timestamp or trending by the documented engagement formula, with deterministic page tie-breaks.';

create or replace function public.moderate_content(
  p_target_type text,
  p_target_id uuid,
  p_action text,
  p_reason text default null,
  p_report_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_permission text;
  v_new_status text;
  v_author uuid;
  v_pinned boolean;
  v_label text;
begin
  v_permission := public.content_moderation_permission(p_target_type);
  if v_permission is null then
    raise exception 'That content type cannot be moderated.' using errcode = '22023';
  end if;

  if not public.is_trusted_writer() then
    if not public.is_active_profile(public.current_profile_id()) then
      raise exception 'Your account cannot moderate content.' using errcode = '42501';
    end if;
    if not (public.has_permission(v_permission) or public.has_permission('moderate_all')) then
      raise exception 'You do not have permission to moderate this content.' using errcode = '42501';
    end if;
  end if;

  v_new_status := case p_action
    when 'hide' then 'hidden'
    when 'remove' then 'removed'
    when 'restore' then 'published'
    when 'approve' then 'published'
    when 'reject' then 'removed'
    else null
  end;

  if p_action in ('pin', 'unpin') and p_target_type <> 'post' then
    raise exception 'Only posts can be pinned or unpinned.' using errcode = '22023';
  end if;
  if p_target_type in ('post', 'comment', 'marketplace_listing', 'gig', 'community', 'club',
                       'project', 'lost_found', 'housing_post', 'ride_post')
     and v_new_status is null
     and not (p_target_type = 'post' and p_action in ('pin', 'unpin')) then
    raise exception 'Unsupported action for this content type.' using errcode = '22023';
  end if;
  if p_target_type = 'marketplace_listing' and p_action = 'approve' then
    v_new_status := 'active';
  end if;

  if p_target_type = 'post' then
    update public.posts
       set status = coalesce(v_new_status::public.content_status, status),
           pinned = case p_action when 'pin' then true when 'unpin' then false else pinned end,
           moderated_by = public.current_profile_id(),
           moderated_at = now(), moderation_reason = left(p_reason, 500)
     where id = p_target_id
       and (p_action <> 'pin' or status = 'published')
     returning author_id, pinned into v_author, v_pinned;
    if p_action in ('pin', 'unpin') and not found then
      raise exception 'The post could not be found or is not published.' using errcode = '22023';
    end if;
  elsif p_target_type = 'comment' then
    update public.comments
       set status = v_new_status::public.content_status, moderated_by = public.current_profile_id(),
           moderated_at = now(), moderation_reason = left(p_reason, 500)
     where id = p_target_id
     returning author_id into v_author;
  elsif p_target_type = 'marketplace_listing' then
    update public.marketplace_listings
       set status = v_new_status::public.listing_status, moderated_by = public.current_profile_id(),
           moderated_at = now(), moderation_reason = left(p_reason, 500)
     where id = p_target_id
     returning seller_id into v_author;
  elsif p_target_type = 'gig' then
    update public.gigs
       set status = v_new_status::public.content_status, moderated_by = public.current_profile_id(),
           moderated_at = now(), moderation_reason = left(p_reason, 500)
     where id = p_target_id
     returning creator_id into v_author;
  elsif p_target_type in ('community', 'club') then
    update public.communities
       set status = v_new_status::public.content_status
     where id = p_target_id
     returning created_by into v_author;
  elsif p_target_type = 'project' then
    update public.projects
       set status = v_new_status::public.content_status, moderated_by = public.current_profile_id(),
           moderated_at = now(), moderation_reason = left(p_reason, 500)
     where id = p_target_id
     returning creator_id into v_author;
  elsif p_target_type = 'lost_found' then
    update public.lost_found set status = v_new_status::public.content_status
     where id = p_target_id returning creator_id into v_author;
  elsif p_target_type = 'housing_post' then
    update public.housing_posts set status = v_new_status::public.content_status
     where id = p_target_id returning creator_id into v_author;
  elsif p_target_type = 'ride_post' then
    update public.ride_posts set status = v_new_status::public.content_status
     where id = p_target_id returning creator_id into v_author;
  elsif p_target_type in ('notice', 'event', 'resource', 'opportunity', 'deal') then
    -- Official content: staff already own these rows through RLS-managed updates.
    update public.audit_logs set id = id where false;  -- no-op keeps the branch explicit
    v_author := null;
  end if;

  perform public.log_audit('moderation.content_' || p_action, p_target_type, p_target_id::text,
    jsonb_build_object('report_id', p_report_id, 'status', v_new_status, 'pinned', v_pinned), true, p_reason, 'staff');

  if v_author is not null and p_action in ('hide', 'remove', 'reject') then
    v_label := replace(p_target_type, '_', ' ');
    perform public.notify_user(v_author, 'moderation_notice',
      'Your ' || v_label || ' was ' || case when p_action = 'hide' then 'hidden' else 'removed' end,
      coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Review the Campus+ rules and post again.'),
      p_target_type, p_target_id::text, null);
  end if;

  return jsonb_build_object('ok', true, 'status', v_new_status, 'pinned', v_pinned);
end;
$$;

comment on function public.moderate_content is
  'Single moderation action path: permission check → status or post-pin change → audit log → author notification where applicable.';

-- Postgres includes replica-identity key columns in an UPDATE old tuple. Using
-- this narrow index avoids REPLICA IDENTITY FULL and its old-content exposure.
create unique index posts_feed_replica_identity_idx
  on public.posts (id, pinned, status);
alter table public.posts replica identity using index posts_feed_replica_identity_idx;

comment on index public.posts_feed_replica_identity_idx is
  'Realtime update identity: old id/pin/status only, so pin transitions are distinguishable from counter-only writes without full-row replica identity.';
