begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select extensions.plan(24);

-- Fixture:
--   user 1: Gensan admin
--   user 2: Gensan staff
--   user 3: admin of the synthetic second club only
-- Courts come from supabase/seed.sql: Gensan Lagao Court A (...aaad) and B (...aaae);
-- second club Synthetic Court A (...bbbe).
insert into auth.users (id, email, raw_user_meta_data)
select ('c7000000-0000-4000-8000-00000000000' || n)::uuid, 'court-type-' || n || '@fixture.invalid',
       jsonb_build_object('full_name', 'Court Type User ' || n)
from generate_series(1, 3) n;
insert into public.club_staff_roles (club_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c7000000-0000-4000-8000-000000000001', 'admin'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c7000000-0000-4000-8000-000000000002', 'staff'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'c7000000-0000-4000-8000-000000000003', 'admin');

-- Structure and privileges.
select extensions.ok(
  exists (select 1 from pg_constraint where conrelid = 'public.courts'::regclass
          and conname = 'courts_court_type_check' and convalidated),
  'courts.court_type is limited to indoor or outdoor');
select extensions.ok(
  not exists (select 1 from public.courts where court_type is not null),
  'existing courts start not set');
select extensions.ok(
  (select prosecdef and 'search_path=""' = any(proconfig) from pg_proc
   where oid = 'public.admin_set_court_type(uuid, text)'::regprocedure),
  'admin_set_court_type runs with definer rights and an empty search path');
select extensions.ok(
  not has_function_privilege('anon', 'public.admin_set_court_type(uuid, text)', 'EXECUTE')
  and not has_function_privilege('public', 'public.admin_set_court_type(uuid, text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.admin_set_court_type(uuid, text)', 'EXECUTE'),
  'only signed-in callers reach admin_set_court_type, which checks the club role inside');
select extensions.ok(
  has_function_privilege('anon', 'public.list_public_club_court_types()', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.list_public_club_court_types()', 'EXECUTE')
  and not has_function_privilege('public', 'public.list_public_club_court_types()', 'EXECUTE'),
  'visitors can read the court type counts');
select extensions.ok(
  not has_table_privilege('authenticated', 'public.courts', 'INSERT, UPDATE, DELETE, TRUNCATE'),
  'the reservation-write pause still blocks direct court writes');

-- User 1: Gensan admin, no club header (Gensan by default).
select set_config('request.headers', '', true);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c7000000-0000-4000-8000-000000000001', true);

select extensions.is(
  (select court_type from public.admin_set_court_type('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad', 'indoor')),
  'indoor', 'an admin marks a court indoor');
select extensions.is(
  (select court_type from public.admin_set_court_type('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae', '  Outdoor ')),
  'outdoor', 'the type is trimmed and lower-cased');
select extensions.throws_ok(
  $$select public.admin_set_court_type('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad', 'covered')$$,
  '22023', 'Choose indoor or outdoor', 'any other type is refused');
select extensions.throws_ok(
  $$select public.admin_set_court_type('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbe', 'indoor')$$,
  'P0002', 'court not found', 'an admin cannot set another club''s court');
select extensions.throws_ok(
  $$select public.admin_set_court_type('00000000-0000-4000-8000-000000000000', 'indoor')$$,
  'P0002', 'court not found', 'an unknown court is refused');

-- Public reads, as a visitor.
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select extensions.is(
  (select string_agg(ct->>'name' || ':' || coalesce(ct->>'court_type', 'none'), ', ' order by ct->>'name')
   from jsonb_array_elements(public.get_public_club_detail('rally-point-gensan')->'venues') v,
        jsonb_array_elements(v->'courts') ct
   where ct->>'name' like 'Lagao Court%'),
  'Lagao Court A:indoor, Lagao Court B:outdoor',
  'the public club page shows each court''s type');
select extensions.ok(
  (select bool_and(ct ? 'court_type')
   from jsonb_array_elements(public.get_public_club_detail('rally-point-gensan')->'venues') v,
        jsonb_array_elements(v->'courts') ct),
  'every public court carries court_type, null when not set');
select extensions.is(
  (select indoor_courts || ':' || outdoor_courts from public.list_public_club_court_types() where slug = 'rally-point-gensan'),
  '1:1', 'the Find a court counts include the newly typed courts');
select extensions.is(
  (select indoor_courts || ':' || outdoor_courts from public.list_public_club_court_types() where slug = 'synthetic-second-club'),
  '0:0', 'a club with no typed courts counts zero of each');
select extensions.is(
  (select array_agg(slug order by slug) from public.list_public_club_court_types()),
  (select array_agg(slug order by slug) from public.list_public_clubs()),
  'the counts cover the same clubs as the public club list');

-- Out-of-service courts are not counted, as in list_public_clubs.
set local role postgres;
update public.courts set status = 'maintenance' where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad';
set local role anon;
select extensions.is(
  (select indoor_courts || ':' || outdoor_courts from public.list_public_club_court_types() where slug = 'rally-point-gensan'),
  '0:1', 'an out-of-service court is left out of the counts');
set local role postgres;
update public.courts set status = 'available' where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad';

-- Back to the Gensan admin: clearing the type.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c7000000-0000-4000-8000-000000000001', true);
select extensions.ok(
  (select court_type is null from public.admin_set_court_type('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae', null)),
  'an admin clears a court''s type');
select extensions.ok(
  (select court_type is null from public.admin_set_court_type('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae', '  ')),
  'a blank type also clears it');

-- User 2: Gensan staff.
select set_config('request.jwt.claim.sub', 'c7000000-0000-4000-8000-000000000002', true);
select extensions.throws_ok(
  $$select public.admin_set_court_type('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad', 'outdoor')$$,
  '42501', 'admin access required', 'staff cannot set a court''s type');

-- User 3: the second club's admin, naming Gensan in the header.
select set_config('request.jwt.claim.sub', 'c7000000-0000-4000-8000-000000000003', true);
select set_config('request.headers', '{"x-club-id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}', true);
select extensions.throws_ok(
  $$select public.admin_set_court_type('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad', 'outdoor')$$,
  '42501', 'admin access required', 'naming another club in the header gives no admin rights there');
-- In its own club it works.
select set_config('request.headers', '{"x-club-id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}', true);
select extensions.is(
  (select court_type from public.admin_set_court_type('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbe', 'outdoor')),
  'outdoor', 'the second club''s admin sets their own court');

-- A visitor cannot call the admin function at all.
set local role anon;
select set_config('request.headers', '', true);
select set_config('request.jwt.claim.sub', '', true);
select extensions.throws_ok(
  $$select public.admin_set_court_type('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad', 'indoor')$$,
  '42501', null, 'a visitor cannot run admin_set_court_type');

set local role postgres;
select extensions.is(
  (select court_type from public.courts where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad'),
  'indoor', 'refused calls left the court unchanged');

select * from extensions.finish();
rollback;
