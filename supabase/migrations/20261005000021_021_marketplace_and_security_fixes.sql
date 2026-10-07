-- Campus+ migration 021 — marketplace lifecycle fixes + security hardening
-- Supabase CLI filename: 20261005000021_021_marketplace_and_security_fixes.sql
-- This file is part of the single authoritative migration history in supabase/migrations/.
-- =============================================================================
-- This migration fixes two confirmed, root-caused marketplace bugs and closes
-- three small, real gaps the security review found. Nothing here touches RLS
-- in a way that widens access, converts a function away from the security
-- posture it needs to work, or uses the secret key to bypass a policy.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. "Remove listing" silently did nothing, and a resolved listing never
--    actually recorded its buyer.
-- ----------------------------------------------------------------------------
-- guard_listing_update() (migration 008) lets a seller move their own listing
-- between 'active', 'reserved', 'sold' and 'expired' only — any other value is
-- silently reverted to the old status (`new.status := old.status;`), with no
-- error raised. 'removed' was missing from that list, so the "Remove listing"
-- action in the UI ran its UPDATE, got a 200, and the listing stayed exactly
-- as visible as before. This adds 'removed' to the seller-controlled set.
--
-- Separately, this trigger unconditionally reverts `sold_to`/`sold_at` back to
-- their old values for any caller that is not `is_trusted_writer()` or a
-- marketplace moderator. mark_listing_completed() is SECURITY DEFINER so it
-- can legitimately set those two columns on the seller's behalf, but
-- SECURITY DEFINER only changes which role's *table privileges* apply — the
-- session's JWT claims (which is_trusted_writer() reads) are unchanged, so
-- from this trigger's point of view an ordinary seller's resolve looked
-- exactly like a student trying to edit sold_to directly, and it was silently
-- reverted. The result: calling mark_listing_completed() as a regular student
-- always left `sold_to`/`sold_at` untouched even when a buyer was found,
-- regardless of the two bugs fixed below. This now also recognises
-- `in_system_context()` (migration 002's existing marker for "a Campus+
-- definer function is doing privileged work on the user's behalf", already
-- used by prevent_privilege_escalation()) and mark_listing_completed() sets
-- that marker before writing.
-- ----------------------------------------------------------------------------

create or replace function public.guard_listing_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_trusted_writer() then
    new.view_count := (
      select count(*) from public.marketplace_interactions i
      where i.listing_id = old.id and i.kind = 'view'
    );
    new.contact_count := (
      select count(*) from public.marketplace_interactions i
      where i.listing_id = old.id and i.kind = 'contact'
    );
  end if;

  if public.is_trusted_writer() or public.in_system_context()
     or public.has_permission('moderate_marketplace') or public.has_permission('moderate_all') then
    return new;
  end if;
  new.seller_id         := old.seller_id;
  new.category_id       := old.category_id;
  new.is_official       := old.is_official;
  new.moderated_by      := old.moderated_by;
  new.moderated_at      := old.moderated_at;
  new.moderation_reason := old.moderation_reason;
  new.sold_at           := old.sold_at;
  new.sold_to           := old.sold_to;
  -- A seller may only move a listing between the student-controlled states.
  -- 'removed' is the self-service "take this down" state (delete_own_content /
  -- restore_own_content toggle it); a hard delete is a separate RLS-governed
  -- DELETE, not a status transition.
  if new.status is distinct from old.status
     and new.status not in ('active', 'reserved', 'sold', 'expired', 'removed') then
    new.status := old.status;
  end if;
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Generic "Something went wrong" on resolving a listing with no recorded
--    interest.
-- ----------------------------------------------------------------------------
-- mark_listing_completed() raised when it could not infer a buyer (nobody had
-- tapped "I'm interested" first) and the UI's "Mark as sold" button never
-- collects one, so the seller could never resolve such a listing. sold_to is
-- nullable (migration 008: `references profiles(id) on delete set null`) and
-- on_listing_completed() (migration 008) only counts completions — it does not
-- require a buyer — so completing with sold_to = null is safe. The matching
-- fromPostgresError() fix lives in lib/errors.js: it previously had no mapping
-- for the 22023 errcode these business-rule messages use, so this and ~50
-- other deliberately-written, user-safe messages across the app were being
-- swallowed into a generic "internal error" string.
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
    -- Default to the student who most recently showed interest, if any.
    select i.user_id into v_buyer
    from public.marketplace_interactions i
    where i.listing_id = p_listing and i.kind = 'contact'
    order by i.created_at desc
    limit 1;
  end if;
  -- No interest was ever recorded (e.g. handed off outside the app): complete
  -- the listing without a buyer rather than blocking the seller from ever
  -- resolving it. A buyer is still never allowed to be the seller.
  if v_buyer is not null and v_buyer = v_seller then
    raise exception 'The buyer cannot be the seller.' using errcode = '22023';
  end if;

  -- Mark this as privileged, definer-driven work so guard_listing_update()
  -- lets sold_to/sold_at through for an ordinary seller (see the comment on
  -- guard_listing_update() above). Transaction-local: cleared automatically
  -- once this call's transaction ends.
  perform set_config('campus.system_context', 'on', true);

  update public.marketplace_listings
     set status = 'sold', sold_to = v_buyer, sold_at = now()
   where id = p_listing;

  if v_buyer is not null then
    perform public.notify_user(
      v_buyer, 'marketplace_rating',
      'You can now rate this trade',
      'The seller marked "' || left(coalesce((select title from public.marketplace_listings where id = p_listing), 'a listing'), 80)
        || '" as completed. Leave a rating to help other students.',
      'marketplace_listing', p_listing::text, '/market/listing/' || p_listing::text
    );
  end if;

  perform public.log_audit('marketplace.completed', 'marketplace_listing', p_listing::text,
    jsonb_build_object('buyer_id', v_buyer), false, null, 'private');

  return jsonb_build_object('ok', true, 'buyer_id', v_buyer);
end;
$$;

-- ----------------------------------------------------------------------------
-- 2b. mark_listing_completed() could never finish for an ordinary student.
-- ----------------------------------------------------------------------------
-- Independently of the missing-buyer bug above, log_audit() (migration 006)
-- only allows a non-staff caller to write 'account.%', 'user.%' or
-- 'content.self_%' actions — anything else raises 42501 "You do not have
-- permission to write audit entries." mark_listing_completed() logs
-- 'marketplace.completed', which matches none of those, so the perform
-- public.log_audit(...) call at the end of a successful resolve would ALWAYS
-- fail with that 42501 for a regular student seller (it never surfaced before
-- because every student request hit the missing-buyer 22023 first — a
-- moderator-driven resolve worked, since v_is_staff short-circuits the check,
-- which is why this stayed hidden). 'marketplace.completed' is a self-service
-- action on the caller's own listing, the same category as content.self_*, so
-- it is added to the allowed set rather than loosening the check generally.
-- ----------------------------------------------------------------------------

create or replace function public.log_audit(
  p_action text,
  p_target_type text default null,
  p_target_id text default null,
  p_metadata jsonb default null,
  p_also_moderation boolean default false,
  p_reason text default null,
  p_visibility public.moderation_visibility default 'staff'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_id uuid;
  v_is_staff boolean;
begin
  if v_actor is null and not public.is_trusted_writer() then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  v_is_staff := public.is_staff() or public.is_trusted_writer();

  -- Non-staff may only record their own account-lifecycle events and a small,
  -- explicit allow-list of other self-service actions, never moderation or
  -- administration entries.
  if not v_is_staff
     and p_action not like 'account.%'
     and p_action not like 'user.%'
     and p_action not like 'content.self_%'
     and p_action <> 'marketplace.completed' then
    raise exception 'You do not have permission to write audit entries.' using errcode = '42501';
  end if;

  insert into public.audit_logs (actor_user_id, action, target_type, target_id, metadata, visibility)
  values (
    v_actor,
    left(p_action, 80),
    left(p_target_type, 60),
    case when p_target_id ~ '^[0-9a-f-]{36}$' then p_target_id::uuid else null end,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'reason', p_reason,
      'actor_username', (select username from public.profiles where id = v_actor)
    ),
    case when v_is_staff then p_visibility else 'private'::public.moderation_visibility end
  )
  returning id into v_id;

  if p_also_moderation and v_is_staff then
    insert into public.moderation_actions (
      moderator_id, report_id, action, target_type, target_id, note
    ) values (
      v_actor,
      nullif(p_metadata->>'report_id', '')::uuid,
      left(p_action, 60),
      left(p_target_type, 60),
      case when p_target_id ~ '^[0-9a-f-]{36}$' then p_target_id::uuid else null end,
      left(p_reason, 1000)
    );
  end if;

  return v_id;
end;
$$;

comment on function public.log_audit is
  'Append-only audit writer. Students are limited to their own account.* / user.* / content.self_* events plus the marketplace.completed self-service action; moderation entries require staff.';

-- ----------------------------------------------------------------------------
-- 3. conversation_inbox() was callable by anon.
-- ----------------------------------------------------------------------------
-- Migration 020 created this function after migration 018's blanket
-- revoke/grant loop and relied on `alter default privileges` to keep new
-- functions off PUBLIC. That did not take effect for this function, so it
-- kept PostgreSQL's built-in "EXECUTE to PUBLIC" default and `anon` could call
-- it. The function is `security invoker` and every row is still filtered by
-- RLS (an anon caller has no profile, so current_profile_id() is null and the
-- query returns nothing) — there is no data exposure — but an unauthenticated
-- caller should not be able to reach an application RPC at all. Fixed
-- explicitly here rather than re-relying on the default.
-- ----------------------------------------------------------------------------

revoke all on function public.conversation_inbox(integer) from public, anon;
grant execute on function public.conversation_inbox(integer) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. messages_update_staff allowed `with check (true)`.
-- ----------------------------------------------------------------------------
-- Column privileges already confine every authenticated UPDATE on `messages`
-- to the `body`/`gif` columns (migration 015), so this was never a path to
-- changing `sender_id`, `deleted_at`, etc. But `with check (true)` means a
-- moderator's update is accepted no matter what the row looks like afterwards,
-- so the same re-check used for `using` now also runs for `with check`: the
-- message must still belong to a conversation/message under an active
-- pending/reviewing report after the edit, matching the condition that let
-- the moderator reach the row in the first place.
-- ----------------------------------------------------------------------------

drop policy if exists messages_update_staff on public.messages;
create policy messages_update_staff on public.messages
  for update to authenticated
  using ((public.has_permission('review_reports') or public.has_permission('moderate_all'))
         and exists (select 1 from public.reports r
                     where r.status in ('pending', 'reviewing')
                       and ((r.target_type = 'message' and r.target_id = messages.id)
                            or (r.target_type = 'conversation' and r.target_id = messages.conversation_id))))
  with check ((public.has_permission('review_reports') or public.has_permission('moderate_all'))
         and exists (select 1 from public.reports r
                     where r.status in ('pending', 'reviewing')
                       and ((r.target_type = 'message' and r.target_id = messages.id)
                            or (r.target_type = 'conversation' and r.target_id = messages.conversation_id))));

-- ----------------------------------------------------------------------------
-- 5. Mutable search_path on a handful of helper functions this repo owns.
-- ----------------------------------------------------------------------------
-- Every SECURITY DEFINER function already pins search_path. These few small
-- SECURITY INVOKER helpers predate that convention; pinning them is a
-- metadata-only change (no behavioural difference — none of them reference an
-- unqualified relation) that silences the Advisor's "Function Search Path
-- Mutable" lint for the functions this project actually authored. The
-- remaining functions the lint can flag (pgcrypto, pg_trgm) are vendored
-- extension functions installed into `public`; they are intentionally left
-- alone — the fix for those is moving extensions to a dedicated schema, which
-- is a deploy-time decision for whoever owns the Supabase project, not a
-- migration that should be forced through here.
-- ----------------------------------------------------------------------------

alter function public.touch_updated_at() set search_path = public, pg_temp;
alter function public.request_claims() set search_path = public, pg_temp;
alter function public.jwt_role() set search_path = public, pg_temp;
alter function public.jwt_sub() set search_path = public, pg_temp;
alter function public.is_trusted_writer() set search_path = public, pg_temp;
alter function public.in_system_context() set search_path = public, pg_temp;
alter function public.safe_uuid(text) set search_path = public, pg_temp;
alter function public.content_moderation_permission(text) set search_path = public, pg_temp;

-- ----------------------------------------------------------------------------
-- Note on random_session_view / random_messages_view (not changed here)
-- ----------------------------------------------------------------------------
-- These two views are intentionally NOT `security_invoker`. random_sessions,
-- random_session_participants and random_messages have no participant-facing
-- SELECT policy on purpose (migration 010: "No participant policies on
-- purpose: participants read random_session_state() and random_session_view,
-- which contain no identities.") — the views themselves do the privacy
-- filtering (`p.user_id = current_profile_id()`) and intentionally run with
-- the view owner's privileges to assemble that projection across both
-- participants' rows. Setting `security_invoker = true` would make the views
-- subject to RLS as the calling student, who has no SELECT policy on the
-- underlying tables at all — every participant would get zero rows and
-- Random Chat's message/session reads would break outright. This is kept as
-- designed; the earlier assumption that these views already had
-- `security_invoker = true` set does not match the migration history and the
-- correct fix is not to add it.
