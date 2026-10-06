-- =============================================================================
-- Campus+ migration 019 — staff visibility on the public projection
-- =============================================================================
-- Spec §13 requires a subtle staff marker next to a moderator's or admin's
-- username everywhere their content appears. `user_roles` is (correctly) not
-- readable for other students, so the application had no way to render that
-- marker: the badge was impossible without weakening a policy.
--
-- The fix is a single SECURITY DEFINER predicate plus one extra column on the
-- existing public projection. It answers exactly one boolean question — "does
-- this profile hold a moderator role or above?" — and reveals nothing else: not
-- which role, not when it was granted, not who granted it. Students have no row to show and
-- therefore see no marker, as the spec requires.
-- =============================================================================

create or replace function public.is_staff_profile(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- `rank` is the role's level: student < moderator < admin < super admin.
  select exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.key = ur.role_key
    where ur.user_id = p_profile
      and r.rank >= 2
  );
$$;

comment on function public.is_staff_profile(uuid) is
  'TRUE when a profile holds a staff role (moderator/admin/super admin). Used only to render the staff marker (spec §13); it exposes no role details.';

-- Same explicit grant contract as migration 018: PostgreSQL gives every new
-- function EXECUTE to PUBLIC by default, and Campus+ has no anonymous surface.
revoke all on function public.is_staff_profile(uuid) from public, anon;
grant execute on function public.is_staff_profile(uuid) to authenticated, service_role;

-- The projection keeps its block-aware filter and security_invoker behaviour.
-- Recreating a view drops its grants, so the SELECT grant is restored below.
create or replace view public.public_profiles
with (security_invoker = true)
as
select
  p.id,
  p.username,
  p.display_name,
  p.bio,
  case when p.show_branch_year then p.branch else null end as branch,
  case when p.show_branch_year then p.year else null end as year,
  p.reputation_score,
  p.reputation_count,
  p.marketplace_completed_count,
  public.is_active_profile(p.id) as is_active,
  p.created_at,
  -- Appended last on purpose: `create or replace view` cannot reorder columns,
  -- and keeping the existing order means existing readers are unaffected.
  public.is_staff_profile(p.id) as is_staff
from public.profiles p
where p.username is not null
  -- Discovery respects blocks in both directions (spec §14, §60). The raw
  -- `profiles` table stays available so blocking, unblocking and moderation can
  -- still resolve the person involved.
  and not public.is_blocked_with_current(p.id);

comment on view public.public_profiles is
  'Public projection of profiles. Institutional email, auth ids and moderation state are structurally absent. `is_staff` drives the staff marker only.';

grant select on public.public_profiles to authenticated;
