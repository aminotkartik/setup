-- =============================================================================
-- Campus+ migration 018 — final function grants
-- =============================================================================
-- This file runs last so that every function defined by earlier migrations is
-- reachable by `authenticated` and unreachable by `anon`.
--
-- Two layers matter:
--
--   1. PostgreSQL grants EXECUTE on every new function to PUBLIC by default, so
--      `anon` inherits the whole RPC surface unless it is revoked explicitly.
--      Campus+ has no anonymous features, so PUBLIC loses EXECUTE entirely and
--      the default is changed for functions created by future migrations too.
--
--   2. Every function that changes state validates the caller itself
--      (has_permission, ownership, rank, or is_trusted_writer). Granting
--      EXECUTE is therefore not a privilege escalation: it only makes the
--      audited entry point callable.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Remove the PostgreSQL default (EXECUTE to PUBLIC) from existing functions
-- ----------------------------------------------------------------------------

do $$
declare
  v_fn record;
begin
  for v_fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
  loop
    -- Explicit, not inherited: authenticated and service_role only.
    execute format('revoke all on function %s from public', v_fn.signature);
    execute format('revoke all on function %s from anon', v_fn.signature);
    execute format('grant execute on function %s to authenticated', v_fn.signature);
    execute format('grant execute on function %s to service_role', v_fn.signature);
  end loop;
end;
$$;

-- Same rule for anything a future migration adds. `alter default privileges`
-- applies to objects created by the role running it (postgres, the migration
-- owner), which is exactly the CLI's role.
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public grant execute on functions to service_role;
alter default privileges in schema public grant execute on functions to authenticated;

-- ----------------------------------------------------------------------------
-- 2. Tables, sequences and views
-- ----------------------------------------------------------------------------

-- NOTE: this loop only removes access from anon/PUBLIC. It deliberately does not
-- touch `authenticated`: the two-dimensional grant matrix (which *rows* via RLS,
-- which *columns* via migration 015) is authoritative there, and a blanket
-- `grant update` here would silently undo 015's column privileges.
do $$
declare
  v_rel record;
begin
  for v_rel in
    select c.oid::regclass as name, c.relkind
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S')
  loop
    execute format('revoke all on %s from anon', v_rel.name);
    execute format('revoke all on %s from public', v_rel.name);
    execute format('grant all on %s to service_role', v_rel.name);
    if v_rel.relkind = 'S' then
      execute format('grant usage, select on %s to authenticated', v_rel.name);
    elsif v_rel.relkind in ('v', 'm') then
      -- RLS of the base tables still applies (security_invoker) unless a definer
      -- view is intentionally whitelisted (see migration 010).
      execute format('grant select on %s to authenticated', v_rel.name);
    end if;
  end loop;
end;
$$;

-- Defaults for objects future migrations add: no anonymous access, no client
-- UPDATE unless a column grant says so. `authenticated` keeps SELECT/INSERT/DELETE
-- so a new table is usable immediately, with RLS as the row boundary.
alter default privileges in schema public revoke all on tables from public;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant select, insert, delete on tables to authenticated;
alter default privileges in schema public grant usage, select on sequences to authenticated, service_role;

-- Schema usage: the API roles need to see the schema, but nothing else.
revoke all on schema public from anon, public;
grant usage on schema public to anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. Explicitly public, pre-authentication helpers
-- ----------------------------------------------------------------------------
-- The sign-in screen checks a domain *before* a session exists. These two
-- functions are pure, read-only and harmless, so anon may call them:

grant execute on function public.allowed_email_domain(text) to anon;
grant execute on function public.is_reserved_username(text) to anon;
grant execute on function public.feature_enabled(text) to anon;
grant execute on function public.setting(text, jsonb) to anon;

-- Views that are intentionally readable by any signed-in student.
grant select on public.public_profiles to authenticated;
grant select on public.random_session_view to authenticated;
grant select on public.random_messages_view to authenticated;
