-- 023: Random Chat removed from the UI — reflect it in the feature flag.
--
-- Random Chat has no nav link, no /random route and no composer anywhere in
-- the app (see lib/constants.js FEATURE_FLAGS for the full rationale). This
-- migration only flips the admin-visible `feature_flags` row so staff see an
-- accurate state in the Admin > Feature flags panel; it is a one-row UPDATE,
-- not a deletion:
--   - random_sessions, random_session_participants, random_messages and their
--     views/functions/RLS policies are all left exactly as they are;
--   - the `use_random_chat`, `moderate_random` and `view_random_sessions`
--     permissions are untouched — moderators still need them to review
--     reports already filed against past sessions;
--   - the moderator "Random reports" queue keeps working against existing data.
-- Nothing in the application currently reads this flag to gate anything (the
-- /random page checked the `use_random_chat` permission directly and no
-- longer exists at all), so this update has no functional effect beyond the
-- admin panel's own display — it exists purely so the control panel doesn't
-- claim a retired feature is still enabled.

update public.feature_flags
set
  label = 'Random (retired — no UI entry point)',
  description = 'Anonymous paired conversations between verified students. Removed from navigation; data and moderation tools are retained.',
  enabled = false
where key = 'random_chat';
