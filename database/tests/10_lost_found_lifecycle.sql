-- =============================================================================
-- Campus+ database tests — 10 Lost & Found resolve lifecycle
-- =============================================================================
-- Regression coverage for a confirmed hard bug: resolveLostFound() used to
-- set status = 'resolved', but 'resolved' is not a value of the shared
-- content_status enum ('draft'/'pending'/'published'/'hidden'/'removed'/
-- 'archived'/'deleted') — every single "Mark as resolved" click raised a
-- 22P02 "invalid input value for enum" error. The fix leaves `status`
-- untouched (stays 'published', which is what lost_found_select_visible
-- requires) and uses resolved_at/resolved_by — both already client-writable
-- columns the table was built with — as the resolution marker.
-- =============================================================================

select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);

insert into auth.users (id, email) values
  ('9a000000-0000-4000-a000-000000000001', 'lf.reporter@pccoepune.org'),
  ('9a000000-0000-4000-a000-000000000002', 'lf.bystander@pccoepune.org')
on conflict (id) do nothing;

do $$
declare
  r record;
begin
  for r in select * from (values
    ('9a000000-0000-4000-a000-000000000001', 'lf_reporter', 'LF Reporter'),
    ('9a000000-0000-4000-a000-000000000002', 'lf_bystander', 'LF Bystander')
  ) as t(id, username, name)
  loop
    perform set_config('request.jwt.claim.sub', r.id, false);
    perform public.complete_profile(p_username => r.username, p_display_name => r.name,
      p_branch => 'Electronics Engineering', p_year => 'Second Year');
  end loop;
end;
$$;

select set_config('request.jwt.claim.sub', '', false);

reset role;
set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', '9a000000-0000-4000-a000-000000000001', false);

do $$
declare
  v_item uuid;
begin
  insert into public.lost_found (kind, title, description, creator_id, status)
  values ('lost', 'Regression test wallet', 'A black leather wallet lost somewhere near the library steps.',
          public.current_profile_id(), 'published')
  returning id into v_item;

  -- 1. The exact write resolveLostFound() performs must succeed (it used to
  --    raise 22P02 trying to write status = 'resolved').
  update public.lost_found
     set resolved_at = now(), resolved_by = public.current_profile_id()
   where id = v_item;

  perform public.test_assert(
    (select resolved_at from public.lost_found where id = v_item) is not null,
    '1. resolving a lost & found report must succeed and set resolved_at'
  );
  perform public.test_assert(
    (select status from public.lost_found where id = v_item) = 'published',
    '1. status must stay published — content_status has no "resolved" value'
  );

  perform public.test_assert(
    (select resolved_by from public.lost_found where id = v_item) = public.current_profile_id(),
    '1. resolved_by must record who resolved it'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. A resolved report stays visible to other students ("kept for reference")
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '9a000000-0000-4000-a000-000000000002', false);

do $$
begin
  perform public.test_assert(
    (select count(*) from public.lost_found
      where title = 'Regression test wallet' and resolved_at is not null) = 1,
    '2. a resolved report must remain visible to other students, not just its owner'
  );
end;
$$;

reset role;
select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);
