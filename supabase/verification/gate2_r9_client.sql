-- Representative r9 adapter reads and scoped commands after forward repairs,
-- before tenant enforcement. The runner owns BEGIN/ROLLBACK.
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select extensions.plan(13);

insert into auth.users (id, email, raw_user_meta_data) values
  ('99999999-9999-4999-8999-999999999991', 'gate2-r9-member@fixture.invalid', '{"full_name":"Gate 2 R9 Member"}'::jsonb),
  ('99999999-9999-4999-8999-999999999992', 'gate2-r9-staff@fixture.invalid', '{"full_name":"Gate 2 R9 Staff"}'::jsonb),
  ('99999999-9999-4999-8999-999999999993', 'gate2-r9-admin@fixture.invalid', '{"full_name":"Gate 2 R9 Admin"}'::jsonb);
update public.profiles set role = 'staff' where id = '99999999-9999-4999-8999-999999999992';
update public.profiles set role = 'admin' where id = '99999999-9999-4999-8999-999999999993';
insert into public.club_staff_roles (club_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '99999999-9999-4999-8999-999999999992', 'staff'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '99999999-9999-4999-8999-999999999993', 'admin');
insert into public.staff_venue_grants (club_id, user_id, venue_id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '99999999-9999-4999-8999-999999999992', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab');
insert into public.courts (id, club_id, venue_id, name, status, hourly_rate) values
  ('99999999-9999-4999-8999-999999999994', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', 'Gate 2 R9 Court', 'available', 500);

set local role authenticated;
set local request.jwt.claim.sub = '99999999-9999-4999-8999-999999999992';
select extensions.is((select role::text from public.get_current_access()), 'staff',
  'r9 resolves staff role from the club assignment');
select extensions.is((select count(*)::int from public.member_roster where full_name = 'Gate 2 R9 Member'), 1,
  'r9 staff can use limited same-club member lookup');
select extensions.ok((public.create_unpaid_desk_booking(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',
  '99999999-9999-4999-8999-999999999994',
  (select id from public.member_roster where full_name = 'Gate 2 R9 Member'),
  date '2098-07-01', 10, 1)).id is not null,
  'r9 staff can create an unpaid desk reservation before enforcement');
select extensions.is((select count(*)::int from public.bookings where court_id = '99999999-9999-4999-8999-999999999994'
  and club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  and venue_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab' and status = 'pending_payment'), 1,
  'desk reservation has fixed club, venue, and unpaid status');
select extensions.is((select count(*)::int from public.court_allocations where court_id = '99999999-9999-4999-8999-999999999994'
  and source = 'booking' and status = 'reserved'), 1,
  'desk reservation records one occupied interval');
select extensions.is((select count(*)::int from public.public_schedule where court_id = '99999999-9999-4999-8999-999999999994'
  and title = 'Reserved'), 1, 'r9 safe schedule exposes the occupied court');
select extensions.is((select count(*)::int from public.open_play_seat_counts
  where open_play_id = '99999999-9999-4999-8999-999999999999'), 0,
  'r9 can query the repaired seat-count projection before enforcement');
select extensions.is((public.cancel_booking_reservation(
  (select id from public.bookings where court_id = '99999999-9999-4999-8999-999999999994'))).status::text,
  'cancelled', 'r9 scoped cancellation works before enforcement');
select extensions.is((select count(*)::int from public.court_allocations where court_id = '99999999-9999-4999-8999-999999999994'
  and status = 'cancelled'), 1, 'cancellation releases the interval');
select extensions.is((select count(*)::int from public.public_schedule where court_id = '99999999-9999-4999-8999-999999999994'),
  0, 'cancelled reservation leaves the safe schedule');

set local request.jwt.claim.sub = '99999999-9999-4999-8999-999999999991';
select extensions.is((select count(*)::int from public.member_self where user_id = auth.uid()), 1,
  'r9 member can read own membership through the limited self view');

set local request.jwt.claim.sub = '99999999-9999-4999-8999-999999999993';
select extensions.is((public.admin_upsert_venue(null, 'gate2-r9-venue', 'Gate 2 R9 Venue',
  'Asia/Manila', 6::smallint, 22::smallint, true)).club_id,
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
  'r9 admin can manage an own-club venue before enforcement');
select extensions.ok((public.set_staff_venue_grant('99999999-9999-4999-8999-999999999992',
  (select id from public.venues where slug = 'gate2-r9-venue'), true)).is_active,
  'r9 admin can assign already-provisioned staff to the venue');
select * from extensions.finish();
