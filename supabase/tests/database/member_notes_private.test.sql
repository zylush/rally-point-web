begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select extensions.plan(26);

-- Fixture. Signing up gives every new account a Gensan membership row.
--   user 1: a Gensan member with staff notes on their card
--   user 2: a Gensan admin, also with notes on their own member card
--   user 3: Gensan staff
--   user 4: admin of the synthetic second club
insert into auth.users (id, email, raw_user_meta_data)
select ('e2800000-0000-4000-8000-00000000000' || n)::uuid, 'notes-' || n || '@fixture.invalid',
       jsonb_build_object('full_name', 'Notes User ' || n)
from generate_series(1, 4) n;
insert into public.club_staff_roles (club_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'e2800000-0000-4000-8000-000000000002', 'admin'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'e2800000-0000-4000-8000-000000000003', 'staff'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'e2800000-0000-4000-8000-000000000004', 'admin');
update public.members set notes = 'Staff only: paid late twice'
where club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id = 'e2800000-0000-4000-8000-000000000001';
update public.members set notes = 'Staff only: club owner'
where club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id = 'e2800000-0000-4000-8000-000000000002';
select set_config('test.member1', (select id::text from public.members
  where club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id = 'e2800000-0000-4000-8000-000000000001'), true);
select set_config('test.member2', (select id::text from public.members
  where club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id = 'e2800000-0000-4000-8000-000000000002'), true);
-- The browser names the active club on every request.
select set_config('request.headers', '{"x-club-id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}', true);

-- ---------------------------------------------------------------------------
-- Shapes and grants stay the same
-- ---------------------------------------------------------------------------
select extensions.is(
  (select string_agg(column_name::text || ':' || udt_name::text, ',' order by ordinal_position)
   from information_schema.columns where table_schema = 'public' and table_name = 'member_self'),
  'id:uuid,user_id:uuid,member_code:text,full_name:text,email:text,phone:text,membership_type:membership_type,'
  || 'status:member_status,join_date:date,expiry_date:date,notes:text,created_at:timestamptz,qr_token:text,club_id:uuid',
  'member_self keeps every column, notes included');
select extensions.is(
  (select string_agg(column_name::text || ':' || udt_name::text, ',' order by ordinal_position)
   from information_schema.columns where table_schema = 'public' and table_name = 'member_self'),
  (select string_agg(column_name::text || ':' || udt_name::text, ',' order by ordinal_position)
   from information_schema.columns where table_schema = 'public' and table_name = 'member_admin'),
  'member_self and member_admin still have the same columns');
select extensions.ok(
  (select 'security_invoker=true' = any(coalesce(c.reloptions, '{}')) from pg_class c
   where c.oid = 'public.member_self'::regclass)
  and pg_get_viewdef('public.member_self'::regclass) like '%private.member_self_rows()%',
  'member_self still reads private.member_self_rows() with the caller''s rights');
select extensions.ok(
  (select p.prosecdef and p.provolatile = 's' and 'search_path=""' = any(p.proconfig)
          and pg_get_userbyid(p.proowner) = 'postgres'
   from pg_proc p where p.oid = 'private.member_self_rows()'::regprocedure),
  'member_self_rows stays a stable definer function with an empty search path, owned by postgres');
select extensions.ok(
  (select p.prorettype = 'public.members'::regtype and not p.proretset and p.prosecdef
          and p.proconfig = array['search_path=pg_catalog, public, private']
          and pg_get_userbyid(p.proowner) = 'postgres'
   from pg_proc p where p.oid = 'public.ensure_member_qr(uuid)'::regprocedure),
  'ensure_member_qr still returns one whole members row with definer rights, owned by postgres');
select extensions.ok(
  has_function_privilege('authenticated', 'public.ensure_member_qr(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.ensure_member_qr(uuid)', 'EXECUTE')
  and not has_function_privilege('public', 'public.ensure_member_qr(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'private.member_self_rows()', 'EXECUTE')
  and not has_function_privilege('anon', 'private.member_self_rows()', 'EXECUTE')
  and not has_function_privilege('public', 'private.member_self_rows()', 'EXECUTE'),
  'only signed-in callers run ensure_member_qr and member_self_rows, as before');
select extensions.ok(
  has_table_privilege('authenticated', 'public.member_self', 'SELECT')
  and not has_table_privilege('authenticated', 'public.member_self', 'INSERT, UPDATE, DELETE')
  and not has_table_privilege('anon', 'public.member_self', 'SELECT')
  and not has_table_privilege('authenticated', 'public.members', 'SELECT')
  and not has_table_privilege('anon', 'public.members', 'SELECT'),
  'member_self stays read-only for signed-in users, and members stays closed');

-- ---------------------------------------------------------------------------
-- Visitors
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select extensions.throws_ok($$select notes from public.member_self$$, '42501', null,
  'a visitor cannot read member_self');
select extensions.throws_ok(
  format('select public.ensure_member_qr(%L::uuid)', current_setting('test.member1')), '42501', null,
  'a visitor cannot call ensure_member_qr');

-- ---------------------------------------------------------------------------
-- The member: their card and QR row come without the staff notes
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e2800000-0000-4000-8000-000000000001', true);
select extensions.is((select count(*)::int from public.member_self), 1, 'the member still sees their own card');
select extensions.is((select notes from public.member_self), null, 'member_self returns no notes to the member');
select extensions.ok(
  (select id = current_setting('test.member1')::uuid and full_name = 'Notes User 1'
          and member_code is not null and club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
   from public.member_self),
  'the rest of the card is unchanged');
select extensions.is(
  (select (public.ensure_member_qr(current_setting('test.member1')::uuid)).notes), null,
  'ensure_member_qr returns no notes to the member');
select extensions.ok(
  (select r.id = current_setting('test.member1')::uuid and r.qr_token is not null
   from public.ensure_member_qr(current_setting('test.member1')::uuid) r),
  'the member still gets their row with a QR token');
select extensions.throws_ok($$select notes from public.members$$, '42501', null,
  'the members table stays closed to the member');
reset role;
select extensions.is(
  (select notes from public.members where id = current_setting('test.member1')::uuid),
  'Staff only: paid late twice', 'the stored notes are not changed');

-- ---------------------------------------------------------------------------
-- Staff and another club's admin are refused, as before
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e2800000-0000-4000-8000-000000000003', true);
select extensions.throws_ok(
  format('select public.ensure_member_qr(%L::uuid)', current_setting('test.member1')), 'P0001', 'member access denied',
  'staff cannot fetch a member''s row');
select extensions.is((select count(*)::int from public.member_admin), 0, 'staff still get no admin member list');
select set_config('request.jwt.claim.sub', 'e2800000-0000-4000-8000-000000000004', true);
select extensions.throws_ok(
  format('select public.ensure_member_qr(%L::uuid)', current_setting('test.member1')), 'P0001', 'member access denied',
  'another club''s admin cannot fetch a Gensan member''s row');

-- ---------------------------------------------------------------------------
-- The club's admin keeps the notes
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'e2800000-0000-4000-8000-000000000002', true);
select extensions.is(
  (select notes from public.member_admin where id = current_setting('test.member1')::uuid),
  'Staff only: paid late twice', 'the admin member editor still reads the notes');
select extensions.is(
  (select (public.ensure_member_qr(current_setting('test.member1')::uuid)).notes),
  'Staff only: paid late twice', 'ensure_member_qr still returns the notes to the club''s admin');
select extensions.is(
  (select (public.admin_upsert_member(m.id, m.full_name, m.email, m.phone, m.membership_type, m.status,
                                      m.join_date, m.expiry_date, 'Staff only: paid in full')).notes
   from public.member_admin m where m.id = current_setting('test.member1')::uuid),
  'Staff only: paid in full', 'admin_upsert_member still saves and returns the notes');
select extensions.is((select notes from public.member_self), null,
  'an admin''s own member card comes without notes too');
select set_config('request.jwt.claim.sub', 'e2800000-0000-4000-8000-000000000001', true);
select extensions.is((select notes from public.member_self), null, 'the member still cannot see the new notes');

-- An admin whose admin role is switched off is an ordinary member again.
reset role;
update public.club_staff_roles set is_active = false
where club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id = 'e2800000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e2800000-0000-4000-8000-000000000002', true);
select extensions.is(
  (select (public.ensure_member_qr(current_setting('test.member2')::uuid)).notes), null,
  'a former admin gets their own row without notes');
select extensions.throws_ok(
  format('select public.ensure_member_qr(%L::uuid)', current_setting('test.member1')), 'P0001', 'member access denied',
  'a former admin can no longer fetch other members');

select * from extensions.finish();
rollback;
