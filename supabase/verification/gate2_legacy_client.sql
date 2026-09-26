-- Representative HEAD:src/lib/api.ts database operations after expand/backfill.
-- The runner owns BEGIN/ROLLBACK. No change may survive this suite.
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select extensions.plan(12);

insert into auth.users (id, email, raw_user_meta_data) values
  ('88888888-8888-4888-8888-888888888881', 'gate2-legacy-member@fixture.invalid', '{"full_name":"Gate 2 Legacy Member"}'::jsonb),
  ('88888888-8888-4888-8888-888888888882', 'gate2-legacy-staff@fixture.invalid', '{"full_name":"Gate 2 Legacy Staff"}'::jsonb),
  ('88888888-8888-4888-8888-888888888883', 'gate2-legacy-admin@fixture.invalid', '{"full_name":"Gate 2 Legacy Admin"}'::jsonb);
update public.profiles set role = 'staff' where id = '88888888-8888-4888-8888-888888888882';
update public.profiles set role = 'admin' where id = '88888888-8888-4888-8888-888888888883';
insert into public.club_staff_roles (club_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '88888888-8888-4888-8888-888888888882', 'staff'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '88888888-8888-4888-8888-888888888883', 'admin');
insert into public.staff_venue_grants (club_id, user_id, venue_id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '88888888-8888-4888-8888-888888888882', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab');
insert into public.courts (id, club_id, venue_id, name, status, hourly_rate) values
  ('88888888-8888-4888-8888-888888888884', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', 'Gate 2 Legacy Court', 'available', 500);

select extensions.ok(has_table_privilege('authenticated', 'public.courts', 'select'), 'legacy court read grant survives expansion');
select extensions.ok(has_table_privilege('authenticated', 'public.bookings', 'insert'), 'legacy booking write grant survives expansion');
select extensions.ok(has_table_privilege('authenticated', 'public.court_sessions', 'insert'), 'legacy rental write grant survives expansion');
select extensions.ok(has_table_privilege('authenticated', 'public.transactions', 'insert'), 'legacy charge write grant survives expansion');

set local role authenticated;
set local request.jwt.claim.sub = '88888888-8888-4888-8888-888888888881';
insert into public.bookings (id, court_id, member_id, start_at, end_at, hours, amount, status)
select '88888888-8888-4888-8888-888888888885', '88888888-8888-4888-8888-888888888884',
       m.id, timestamptz '2098-07-01 02:00:00+00', timestamptz '2098-07-01 03:00:00+00',
       1, 500, 'pending_payment'
from public.members m where m.user_id = '88888888-8888-4888-8888-888888888881';
select extensions.is((select count(*)::int from public.bookings where id = '88888888-8888-4888-8888-888888888885'),
  1, 'legacy member can create and read own pending booking');
select extensions.ok((select club_id is null and venue_id is null from public.bookings
  where id = '88888888-8888-4888-8888-888888888885'),
  'legacy write leaves nullable tenant keys for the final delta backfill');

set local request.jwt.claim.sub = '88888888-8888-4888-8888-888888888882';
insert into public.court_sessions (id, court_id, member_id, start_at, end_at, status, amount, created_by)
select '88888888-8888-4888-8888-888888888886', '88888888-8888-4888-8888-888888888884',
       m.id, timestamptz '2098-07-01 04:00:00+00', timestamptz '2098-07-01 05:00:00+00',
       'playing', 500, '88888888-8888-4888-8888-888888888882'
from public.members m where m.user_id = '88888888-8888-4888-8888-888888888881';
insert into public.transactions (id, member_id, amount, type, description, created_by)
select '88888888-8888-4888-8888-888888888887', m.id, 500, 'court_rental',
       'Gate 2 legacy recorded charge', '88888888-8888-4888-8888-888888888882'
from public.members m where m.user_id = '88888888-8888-4888-8888-888888888881';
update public.courts set status = 'occupied' where id = '88888888-8888-4888-8888-888888888884';
select extensions.is((select count(*)::int from public.court_sessions where id = '88888888-8888-4888-8888-888888888886'),
  1, 'legacy staff can create and read a rental session');
select extensions.ok((select club_id is null and venue_id is null from public.court_sessions
  where id = '88888888-8888-4888-8888-888888888886'),
  'legacy rental also requires the final delta backfill');
select extensions.is((select verification_status from public.transactions where id = '88888888-8888-4888-8888-888888888887'),
  'unverified', 'legacy recorded charge is not marked verified payment');
select extensions.is((select status::text from public.courts where id = '88888888-8888-4888-8888-888888888884'),
  'occupied', 'legacy staff can update court status');
select extensions.is((select count(*)::int from public.court_allocations where source_id in
  ('88888888-8888-4888-8888-888888888885', '88888888-8888-4888-8888-888888888886')), 0,
  'legacy writes do not create allocations and must be drained before enforcement');

set local request.jwt.claim.sub = '88888888-8888-4888-8888-888888888883';
update public.members set notes = 'Gate 2 legacy admin edit'
where user_id = '88888888-8888-4888-8888-888888888881';
select extensions.is((select notes from public.members where user_id = '88888888-8888-4888-8888-888888888881'),
  'Gate 2 legacy admin edit', 'legacy admin can update a member');
select * from extensions.finish();
