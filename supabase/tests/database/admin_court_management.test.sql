begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select extensions.plan(29);

-- Fixture:
--   user 1: Gensan admin
--   user 2: Gensan staff
--   user 3: no club role (plain account)
--   user 4: admin of the synthetic second club only
-- Venues and courts come from supabase/seed.sql:
--   Gensan Lagao venue ...aaac with Lagao Court A (...aaad) and B (...aaae);
--   second club venues ...bbbc (Synthetic Court A ...bbbe) and ...bbbd.
insert into auth.users (id, email, raw_user_meta_data)
select ('c6000000-0000-4000-8000-00000000000' || n)::uuid, 'court-' || n || '@fixture.invalid',
       jsonb_build_object('full_name', 'Court User ' || n)
from generate_series(1, 4) n;
insert into public.club_staff_roles (club_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c6000000-0000-4000-8000-000000000001', 'admin'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c6000000-0000-4000-8000-000000000002', 'staff'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'c6000000-0000-4000-8000-000000000004', 'admin');

-- Structure and privileges.
select extensions.ok(
  (select prosecdef from pg_proc where oid = 'public.admin_upsert_court(uuid, uuid, text, numeric, numeric, boolean)'::regprocedure),
  'admin_upsert_court runs with definer rights');
select extensions.ok(
  (select 'search_path=""' = any(proconfig) from pg_proc
   where oid = 'public.admin_upsert_court(uuid, uuid, text, numeric, numeric, boolean)'::regprocedure),
  'admin_upsert_court pins an empty search path');
select extensions.ok(
  not has_function_privilege('anon', 'public.admin_upsert_court(uuid, uuid, text, numeric, numeric, boolean)', 'EXECUTE'),
  'anonymous callers cannot run admin_upsert_court');
select extensions.ok(
  has_function_privilege('authenticated', 'public.admin_upsert_court(uuid, uuid, text, numeric, numeric, boolean)', 'EXECUTE'),
  'signed-in callers can reach admin_upsert_court, which checks the club role inside');
select extensions.ok(
  not has_table_privilege('authenticated', 'public.courts', 'INSERT, UPDATE, DELETE, TRUNCATE'),
  'the reservation-write pause still blocks direct court writes');

-- User 1: Gensan admin, no club header (Gensan by default).
select set_config('request.headers', '', true);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c6000000-0000-4000-8000-000000000001', true);

select extensions.lives_ok(
  $$select public.admin_upsert_court(null, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac', '  Lagao Court C ', 550, null, true)$$,
  'an admin adds a court to one of the club''s venues');
select extensions.is(
  (select name || ':' || status::text || ':' || hourly_rate::text from public.courts where name = 'Lagao Court C'),
  'Lagao Court C:available:550.00',
  'the new court is trimmed, in service, and priced');
select extensions.throws_ok(
  $$select public.admin_upsert_court(null, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac', 'lagao court c', 500, null, true)$$,
  '23505', 'This venue already has a court with that name',
  'court names are unique within a venue, ignoring case');
select extensions.throws_ok(
  $$select public.admin_upsert_court(null, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac', '   ', 500, null, true)$$,
  '22023', 'Court name must be 1 to 40 characters', 'a blank court name is refused');
select extensions.throws_ok(
  $$select public.admin_upsert_court(null, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac', 'Cheap Court', -1, null, true)$$,
  '22023', 'Hourly rate must be between 0 and 100,000 pesos', 'a negative rate is refused');
select extensions.throws_ok(
  $$select public.admin_upsert_court(null, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac', 'Odd Court', 500.125, null, true)$$,
  '22023', 'Hourly rate must be between 0 and 100,000 pesos', 'a rate with more than two decimals is refused');
select extensions.throws_ok(
  $$select public.admin_upsert_court(null, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac', 'Pricey Member Court', 500, 600, true)$$,
  '22023', 'Member rate must be between 0 and the regular rate', 'a member rate above the regular rate is refused');
select extensions.is(
  (select coalesce(member_rate::text, 'none') from public.courts
   where id = (public.admin_upsert_court(null, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac', 'Member Court', 500, 400, true)).id),
  '400.00', 'an admin sets a lower member rate');
select extensions.throws_ok(
  $$select public.admin_upsert_court(null, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc', 'Other Club Court', 500, null, true)$$,
  'P0002', 'venue not found', 'an admin cannot add a court to another club''s venue');
select extensions.throws_ok(
  $$select public.admin_upsert_court('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbe', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc', 'Taken', 500, null, true)$$,
  'P0002', 'court not found', 'an admin cannot edit another club''s court');
select extensions.throws_ok(
  $$select public.admin_upsert_court('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', 'Lagao Court A', 500, null, true)$$,
  '22023', 'A court cannot move to another venue', 'a court stays in its venue');
select extensions.lives_ok(
  $$select public.admin_upsert_court('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac', 'Lagao Court A1', 600, null, false)$$,
  'an admin renames, re-prices and takes a court out of service');
select extensions.is(
  (select name || ':' || status::text || ':' || hourly_rate::text from public.courts where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad'),
  'Lagao Court A1:maintenance:600.00',
  'out of service is the maintenance status that bookings refuse');
select extensions.lives_ok(
  $$select public.admin_upsert_court('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac', 'Lagao Court A1', 600, null, true)$$,
  'an admin puts the court back in service');
select extensions.is(
  (select status::text from public.courts where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad'),
  'available', 'back in service means available');

-- A court in use cannot be taken out of service, and stays occupied when edited.
reset role;
update public.courts set status = 'occupied' where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae';
set local role authenticated;
select extensions.throws_ok(
  $$select public.admin_upsert_court('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac', 'Lagao Court B', 500, null, false)$$,
  '55006', 'This court is in use. Take it out of service after the session ends.',
  'a court in use cannot be taken out of service');
select extensions.lives_ok(
  $$select public.admin_upsert_court('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac', 'Lagao Court B2', 500, null, true)$$,
  'a court in use can still be renamed');
select extensions.is(
  (select status::text from public.courts where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae'),
  'occupied', 'editing a court in use keeps it occupied');

-- User 2: Gensan staff. User 3: no club role.
select set_config('request.jwt.claim.sub', 'c6000000-0000-4000-8000-000000000002', true);
select extensions.throws_ok(
  $$select public.admin_upsert_court(null, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac', 'Staff Court', 500, null, true)$$,
  '42501', 'admin access required', 'staff cannot manage courts');
select set_config('request.jwt.claim.sub', 'c6000000-0000-4000-8000-000000000003', true);
select extensions.throws_ok(
  $$select public.admin_upsert_court(null, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac', 'Member Court', 500, null, true)$$,
  '42501', 'admin access required', 'an account without a club role cannot manage courts');

-- User 4: second-club admin, acting in the second club.
select set_config('request.headers', '{"x-club-id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}', true);
select set_config('request.jwt.claim.sub', 'c6000000-0000-4000-8000-000000000004', true);
select extensions.throws_ok(
  $$select public.admin_upsert_court('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac', 'Hijack', 1, null, true)$$,
  'P0002', 'court not found', 'the second club''s admin cannot edit a Gensan court');
select extensions.lives_ok(
  $$select public.admin_upsert_court(null, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbd', 'East Court 1', 400, null, true)$$,
  'the second club''s admin adds a court to its second venue');
select extensions.is(
  (select club_id::text || ':' || venue_id::text from public.courts where name = 'East Court 1'),
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbd',
  'the new court belongs to the second club and venue');

-- User 1 names the second club but has no role there: the header grants nothing.
select set_config('request.jwt.claim.sub', 'c6000000-0000-4000-8000-000000000001', true);
select extensions.throws_ok(
  $$select public.admin_upsert_court(null, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbd', 'Sneaky Court', 500, null, true)$$,
  '42501', 'admin access required', 'naming another club in the header does not grant admin access');

select * from extensions.finish();
rollback;
