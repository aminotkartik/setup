-- Campus+ migration 022 — restore random_session_view / random_messages_view
-- Supabase CLI filename: 20261005000022_022_random_views_invoker_fix.sql
-- This file is part of the single authoritative migration history in supabase/migrations/.
-- =============================================================================
-- These two views were reported as having been manually switched to
-- `security_invoker = true` directly against a live project during an earlier
-- debugging session (outside of this migration history, so no prior migration
-- file shows it). This migration verifies that claim against real behaviour
-- and, since it is correct, restores the configuration the application
-- actually requires — explicitly, so a future "harden this view" pass does
-- not flip it back without re-reading this comment.
--
-- Verified empirically (not by inspection alone) against a disposable
-- Postgres instance with every migration through 021 applied and real
-- session/message rows:
--
--   default view (security definer semantics, as migration 010 created it):
--     a participant querying random_session_view / random_messages_view for
--     their own session sees their session row and their message — correct.
--
--   same query, same data, with `security_invoker = true` set on both views:
--     the same participant gets ZERO rows back from both views.
--
-- Why: random_sessions, random_session_participants and random_messages have
-- NO participant-facing SELECT policy at all — migration 010 says so in so
-- many words ("No participant policies on purpose: participants read
-- random_session_state() and random_session_view, which contain no
-- identities."). Access control for a participant's own session is enforced
-- by the view body (`p.user_id = current_profile_id()`) and by
-- random_session_state()'s own has_permission/ownership check, not by RLS on
-- the base tables — participant RLS was deliberately never built for these
-- tables. `security_invoker = true` makes a view subject to RLS as the
-- calling role; with no participant policy to pass, every participant query
-- returns nothing. Staff (who do have a `view_random_sessions`-gated SELECT
-- policy on the base tables) would not notice this change — the lobby and
-- message list silently stop working for every real participant, while admin
-- testing still looks fine. That matches a change that can go unnoticed.
--
-- lib/actions/random.js confirms the application depends on exactly this
-- definer behaviour: it queries `random_session_view` / `random_messages_view`
-- directly with no extra ownership filter, trusting the view to scope the
-- rows to the caller. (The `/random` UI route that called these actions was
-- since removed — see migration 023 — but the actions module and this view
-- behaviour are both kept, unreferenced, per the same retention decision.)
--
-- This does not weaken RLS: RLS stays enabled and unchanged on every base
-- table. It restores two views to the access-control design they were built
-- with, which is documented, narrow (no identity columns, no cross-session
-- reads) and already audited (`npm run audit:db` — "Definer views are limited
-- to the two audited Random projections").
-- =============================================================================

alter view public.random_session_view set (security_invoker = false);
alter view public.random_messages_view set (security_invoker = false);

comment on view public.random_session_view is
  'Participant-safe session projection: no participant ids, no usernames, no profile data. '
  'Deliberately NOT security_invoker — see migration 022. The base tables have no participant '
  'SELECT policy on purpose; this view''s own `p.user_id = current_profile_id()` filter is the '
  'access control. Do not add security_invoker to this view without also adding participant-safe '
  'RLS policies to random_sessions and random_session_participants, or every participant query '
  'will silently return zero rows.';

comment on view public.random_messages_view is
  'Participant-safe message stream. `sender_user_id` is mapped to a boolean `mine` flag so the '
  'other student cannot be identified. Deliberately NOT security_invoker — see migration 022; the '
  'same reasoning as random_session_view applies, since random_messages has no participant SELECT '
  'policy either.';
