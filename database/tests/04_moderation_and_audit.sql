-- =============================================================================
-- Campus+ database tests — 04 reports, moderation, audit, roles, suspension
-- =============================================================================
-- Proves the staff-action contract:
--   * reporting is one central system and cannot be used to probe private ids,
--   * only permitted staff can see reports or act on them,
--   * every staff action leaves an audit trail,
--   * rank protects staff from each other and students from staff,
--   * suspension is enforced by the database, not by the UI.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);

insert into auth.users (id, email) values
  ('d0000000-0000-4000-a000-000000000001', 'dhiya@pccoepune.org'),
  ('d0000000-0000-4000-a000-000000000002', 'devansh@pccoepune.org'),
  ('d0000000-0000-4000-a000-000000000003', 'mrunal@pccoepune.org'),
  ('d0000000-0000-4000-a000-000000000004', 'nisha@pccoepune.org')
on conflict (id) do nothing;

select set_config('request.jwt.claim.sub', 'd0000000-0000-4000-a000-000000000001', false);
select public.complete_profile('dhiya', 'Dhiya Kulkarni');
select set_config('request.jwt.claim.sub', 'd0000000-0000-4000-a000-000000000002', false);
select public.complete_profile('devansh', 'Devansh Rane');
select set_config('request.jwt.claim.sub', 'd0000000-0000-4000-a000-000000000003', false);
select public.complete_profile('mrunal_mod', 'Mrunal Deshpande');
select set_config('request.jwt.claim.sub', 'd0000000-0000-4000-a000-000000000004', false);
select public.complete_profile('nisha_admin', 'Nisha Patil');
select set_config('request.jwt.claim.sub', '', false);

-- ---------------------------------------------------------------------------
-- 1. Roles are assigned through the audited function, never by students.
-- ---------------------------------------------------------------------------
set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', 'd0000000-0000-4000-a000-000000000001', false);

do $$
declare
  v_mod uuid;
begin
  select id into v_mod from public.profiles where username = 'mrunal_mod';
  perform public.test_assert_denied(
    format($sql$select public.grant_role(%L::uuid, 'moderator')$sql$, v_mod),
    'a student must not be able to grant themselves or anyone else a staff role'
  );
  perform public.test_assert(not public.has_permission('review_reports'),
    'a student must not hold moderation permissions');
  perform public.test_assert(public.role_rank(public.current_profile_id()) = 0,
    'a student must have the lowest role rank');
end;
$$;

-- A student writes a post for the moderator tests below.
do $$
begin
  insert into public.posts (author_id, body, kind)
  values (public.current_profile_id(), 'Selling my old lab coat, DM if interested.', 'post');
end;
$$;

-- The operator (secret key) assigns staff roles. This is the bootstrap path
-- documented for the first admin.
reset role;
select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);

select public.grant_role((select id from public.profiles where username = 'mrunal_mod'), 'moderator');
select public.grant_role((select id from public.profiles where username = 'nisha_admin'), 'admin');

do $$
begin
  perform public.test_assert(
    (select count(*) from public.user_roles ur
      join public.profiles p on p.id = ur.user_id
     where p.username = 'mrunal_mod' and ur.role_key = 'moderator') = 1,
    'the operator must be able to grant the moderator role'
  );
  perform public.test_assert(
    (select count(*) from public.audit_logs where action = 'admin.role_granted') >= 2,
    'role grants must be audited'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Reporting: one system, no probing, no duplicates, no student visibility.
-- ---------------------------------------------------------------------------
set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', 'd0000000-0000-4000-a000-000000000002', false);

do $$
declare
  v_post uuid;
  v_author uuid;
begin
  select p.id, p.author_id into v_post, v_author
  from public.posts p where p.body like 'Selling my old lab coat%';

  insert into public.reports (reporter_id, target_type, target_id, reason, details)
  values (public.current_profile_id(), 'post', v_post, 'spam', 'Repeated commercial posting.');

  perform public.test_assert(
    (select count(*) from public.reports where reporter_id = public.current_profile_id()) = 1,
    'a student must be able to file a report'
  );

  -- Duplicate reports on the same target are rejected.
  perform public.test_assert_denied(
    format($sql$insert into public.reports (reporter_id, target_type, target_id, reason)
                 values (public.current_profile_id(), 'post', %L::uuid, 'spam')$sql$, v_post),
    'the same student must not be able to report the same content twice'
  );

  -- A student cannot report content they cannot see (a private conversation id).
  perform public.test_assert_denied(
    format($sql$insert into public.reports (reporter_id, target_type, target_id, reason)
                 values (public.current_profile_id(), 'conversation', %L::uuid, 'harassment')$sql$,
           gen_random_uuid()),
    'a student must not be able to report an entity that does not exist'
  );

  -- A report must name its reporter as the current user.
  perform public.test_assert_denied(
    format($sql$insert into public.reports (reporter_id, target_type, target_id, reason)
                 values (%L::uuid, 'post', %L::uuid, 'spam')$sql$, v_author, v_post),
    'a student must not be able to file a report on someone else''s behalf'
  );

  -- Staff-only reads are closed.
  perform public.test_assert(
    (select count(*) from public.reports) = 1,
    'a student must only see their own reports'
  );
end;
$$;

select set_config('request.jwt.claim.sub', 'd0000000-0000-4000-a000-000000000001', false);

do $$
declare
  v_seen integer;
begin
  select count(*) into v_seen from public.reports;
  perform public.test_assert(v_seen = 0, 'a report must not be readable by the student who was reported');
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The moderator sees the queue, acts once, and is audited.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'd0000000-0000-4000-a000-000000000003', false);

do $$
declare
  v_report uuid;
  v_post uuid;
  v_status public.content_status;
begin
  perform public.test_assert(public.has_permission('review_reports'), 'a moderator must hold review_reports');
  perform public.test_assert(
    (select count(*) from public.reports) = 1,
    'a moderator must be able to read the report queue'
  );

  select id into v_report from public.reports where status = 'pending';
  select target_id into v_post from public.reports where id = v_report;

  perform public.resolve_report(v_report, 'resolved', 'Removed: commercial posting.', 'remove');

  select status into v_status from public.posts where id = v_post;
  perform public.test_assert(v_status = 'removed', 'resolving a report with an action must change the content status');

  perform public.test_assert(
    (select reviewed_by = public.current_profile_id() and reviewed_at is not null
       from public.reports where id = v_report),
    'resolving a report must record who reviewed it and when'
  );
  perform public.test_assert(
    (select count(*) from public.moderation_actions
      where target_id = v_post and action = 'moderation.content_remove') >= 1,
    'a moderation action must be recorded'
  );
  -- The audit log itself is admin-only; the moderator sees the action trail.
  perform public.test_assert(
    (select count(*) from public.audit_logs) = 0,
    'a moderator must not read the audit log without the audit permission'
  );
end;
$$;

-- The author is told, and the content is gone for students but kept for staff.
select set_config('request.jwt.claim.sub', 'd0000000-0000-4000-a000-000000000001', false);

do $$
declare
  v_post uuid;
  v_notified integer;
  v_visible integer;
begin
  select id into v_post from public.posts where body like 'Selling my old lab coat%' limit 1;

  select count(*) into v_notified from public.notifications
   where recipient_id = public.current_profile_id() and type = 'moderation_notice';
  perform public.test_assert(v_notified = 1, 'the author must be notified about a moderation decision');

  -- The author keeps sight of their own removed content (so the notice makes
  -- sense), but the row itself survives as evidence.
  select count(*) into v_visible from public.posts where id = v_post;
  perform public.test_assert(v_visible = 1, 'the author must be able to see their own removed post');
  perform public.test_assert(
    (select status from public.posts where id = v_post) = 'removed',
    'soft deletion must keep the moderation evidence in place'
  );
end;
$$;

-- …while every other student loses sight of it.
select set_config('request.jwt.claim.sub', 'd0000000-0000-4000-a000-000000000002', false);

do $$
declare
  v_visible integer;
begin
  select count(*) into v_visible from public.posts where body like 'Selling my old lab coat%';
  perform public.test_assert(v_visible = 0, 'a removed post must disappear from other students'' feeds');
end;
$$;

select set_config('request.jwt.claim.sub', 'd0000000-0000-4000-a000-000000000001', false);

-- ---------------------------------------------------------------------------
-- 4. Audit logs are not student-readable, and moderation logs are staff-only.
-- ---------------------------------------------------------------------------
do $$
declare
  v_audit integer;
  v_actions integer;
begin
  select count(*) into v_audit from public.audit_logs;
  select count(*) into v_actions from public.moderation_actions;
  perform public.test_assert(v_audit = 0, 'students must not read the audit log');
  perform public.test_assert(v_actions = 0, 'students must not read moderation actions');
end;
$$;

select set_config('request.jwt.claim.sub', 'd0000000-0000-4000-a000-000000000004', false);

do $$
begin
  perform public.test_assert(
    (select count(*) from public.audit_logs) >= 3,
    'an admin must be able to read the audit log'
  );
  perform public.test_assert(
    (select count(*) from public.moderation_actions) >= 1,
    'an admin must be able to read moderation actions'
  );
  perform public.test_assert(
    (select count(*) from public.audit_logs where action = 'moderation.content_remove') >= 1,
    'every moderation action must be written to the audit log'
  );
  perform public.test_assert(
    (select count(*) from public.audit_logs where action = 'moderation.user_suspended') >= 0,
    'the audit log must be queryable by action'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Rank: staff cannot act on peers or seniors, students cannot act at all.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'd0000000-0000-4000-a000-000000000003', false);

do $$
declare
  v_admin uuid;
  v_student uuid;
begin
  select id into v_admin from public.profiles where username = 'nisha_admin';
  select id into v_student from public.profiles where username = 'dhiya';

  perform public.test_assert_denied(
    format($sql$select public.admin_set_account_status(%L::uuid, 'banned', 'testing rank')$sql$, v_admin),
    'a moderator must not be able to ban an admin'
  );
  perform public.test_assert_denied(
    format($sql$select public.grant_role(%L::uuid, 'super_admin')$sql$, v_student),
    'a moderator must not be able to grant the Super Admin role'
  );
  perform public.test_assert_denied(
    format($sql$select public.grant_role(%L::uuid, 'admin')$sql$, v_student),
    'a moderator must not be able to grant a rank at or above their own'
  );
end;
$$;

select set_config('request.jwt.claim.sub', 'd0000000-0000-4000-a000-000000000001', false);

do $$
declare
  v_other uuid;
begin
  select id into v_other from public.profiles where username = 'devansh';
  perform public.test_assert_denied(
    format($sql$select public.admin_set_account_status(%L::uuid, 'banned', 'nope')$sql$, v_other),
    'a student must not be able to ban anyone'
  );
  perform public.test_assert_denied(
    format($sql$select public.moderate_content('post', %L::uuid, 'remove')$sql$, gen_random_uuid()),
    'a student must not be able to moderate content'
  );
  perform public.test_assert_denied(
    $sql$update public.profile_private set account_status = 'active' where true$sql$,
    'a suspended-or-not student must not write their own account status'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Suspension is enforced by the database itself.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'd0000000-0000-4000-a000-000000000004', false);

do $$
declare
  v_student uuid;
begin
  select id into v_student from public.profiles where username = 'dhiya';
  perform public.admin_set_account_status(v_student, 'suspended', 'Repeated commercial posting.', 7);

  perform public.test_assert(
    (select account_status from public.profile_private where profile_id = v_student) = 'suspended',
    'an admin must be able to suspend a student'
  );
  perform public.test_assert(
    (select suspended_until from public.profile_private where profile_id = v_student) > now(),
    'a suspension must carry an expiry'
  );
end;
$$;

select set_config('request.jwt.claim.sub', 'd0000000-0000-4000-a000-000000000001', false);

do $$
begin
  perform public.test_assert(not public.is_active_user(), 'a suspended student must be inactive');

  perform public.test_assert_denied(
    $sql$insert into public.posts (author_id, body) values (public.current_profile_id(), 'Trying to post while suspended.')$sql$,
    'a suspended student must not be able to post'
  );
  perform public.test_assert_denied(
    $sql$insert into public.comments (post_id, author_id, body)
         select id, public.current_profile_id(), 'Trying to comment while suspended.'
         from public.posts limit 1$sql$,
    'a suspended student must not be able to comment'
  );
  perform public.test_assert_denied(
    $sql$select public.join_random_queue()$sql$,
    'a suspended student must not be able to use Random'
  );
  perform public.test_assert_denied(
    $sql$insert into public.reports (reporter_id, target_type, target_id, reason)
         values (public.current_profile_id(), 'user', public.current_profile_id(), 'spam')$sql$,
    'a suspended student must not be able to file reports'
  );
end;
$$;

-- Reinstatement restores normal use and is audited.
select set_config('request.jwt.claim.sub', 'd0000000-0000-4000-a000-000000000004', false);

do $$
declare
  v_student uuid;
  v_ok boolean;
begin
  select id into v_student from public.profiles where username = 'dhiya';
  perform public.admin_set_account_status(v_student, 'active', 'Appeal accepted.');
  perform public.test_assert(
    (select count(*) from public.audit_logs where action = 'moderation.user_reinstated') >= 1,
    'reinstatement must be audited'
  );
end;
$$;

select set_config('request.jwt.claim.sub', 'd0000000-0000-4000-a000-000000000001', false);

do $$
declare
  v_posted boolean;
begin
  insert into public.posts (author_id, body) values (public.current_profile_id(), 'Back after my suspension.');
  select exists (select 1 from public.posts where author_id = public.current_profile_id()) into v_posted;
  perform public.test_assert(v_posted, 'a reinstated student must be able to post again');
end;
$$;

reset role;
select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);
