begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select extensions.plan(81);

-- Fixture. Signing up gives every new account a Gensan membership row
-- (standard, active for 30 days), so each user below is a Gensan member unless
-- changed here.
--   user 1: Gensan member with an active membership (pays the member rate)
--   user 2: Gensan player with no membership (pays the regular rate)
--   user 3: Gensan staff assigned to the Lagao location
--   user 4: Gensan admin
--   user 5: admin of the synthetic second club
--   user 6: platform superadmin (keeps the Gensan row sign-up gave them)
--   user 7: Gensan staff assigned only to the main location
--   user 8: player at the second club
--   user 9: another Gensan member
-- Places come from supabase/seed.sql: Gensan Lagao (...aaac) with Lagao Court A
-- (...aaad) and B (...aaae); the second club's Synthetic Main (...bbbc) with
-- Synthetic Court A (...bbbe). Hours and rates are set here.
-- Booking ids are kept in test.* settings: h1, h2, h2b, h2c, h2d, h2e, h9, h9b, h8 and desk.
insert into auth.users (id, email, raw_user_meta_data)
select ('d1000000-0000-4000-8000-00000000000' || n)::uuid, 'gcash-' || n || '@fixture.invalid',
       jsonb_build_object('full_name', 'GCash User ' || n)
from generate_series(1, 9) n;
update public.members set membership_type = null, expiry_date = null
where user_id = 'd1000000-0000-4000-8000-000000000002' and club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
insert into public.club_staff_roles (club_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'd1000000-0000-4000-8000-000000000003', 'staff'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'd1000000-0000-4000-8000-000000000004', 'admin'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'd1000000-0000-4000-8000-000000000005', 'admin'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'd1000000-0000-4000-8000-000000000007', 'staff');
insert into public.staff_venue_grants (club_id, user_id, venue_id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'd1000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'd1000000-0000-4000-8000-000000000007', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab');
insert into public.platform_roles (user_id) values ('d1000000-0000-4000-8000-000000000006');
insert into public.members (club_id, user_id, member_code, full_name, membership_type, status, join_date, expiry_date)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'd1000000-0000-4000-8000-000000000008', 'GC-8', 'GCash User 8',
        null, 'active', current_date, null);
update public.club_accounts set status = 'active', commission_rate = 5
where club_id in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
update public.venues set open_hour = 6, close_hour = 22
where id in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc');
update public.venues set open_hour = 0, close_hour = 24 where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab';
update public.courts set status = 'available', hourly_rate = 500, member_rate = 400
where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad';
update public.courts set status = 'available', hourly_rate = 500, member_rate = null
where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae';
update public.courts set status = 'available', hourly_rate = 400, member_rate = null
where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbe';
insert into public.courts (id, club_id, venue_id, name, status, hourly_rate) values
  ('d2000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac', 'GCash Closed Court', 'maintenance', 500),
  ('d2000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', 'GCash Night Court', 'available', 300);

-- ---------------------------------------------------------------------------
-- Structure and privileges
-- ---------------------------------------------------------------------------
select extensions.is(
  (select string_agg(column_name::text || ':' || data_type::text, ',' order by column_name::text)
   from information_schema.columns
   where table_schema = 'public' and table_name = 'bookings'
     and column_name in ('hold_expires_at', 'payment_reference', 'payment_submitted_at', 'confirm_by')),
  'confirm_by:timestamp with time zone,hold_expires_at:timestamp with time zone,payment_reference:text,payment_submitted_at:timestamp with time zone',
  'bookings gain the hold and payment columns');
select extensions.ok(
  (select count(*) = 5 and bool_and(p.prosecdef and 'search_path=""' = any(p.proconfig))
   from unnest(array[
     'public.hold_court_booking(uuid, uuid, uuid, date, integer, integer)',
     'public.release_booking_hold(uuid)',
     'public.submit_booking_payment(uuid, text)',
     'public.staff_confirm_booking_payment(uuid)',
     'public.staff_reject_booking_payment(uuid, text)']) f
   join pg_proc p on p.oid = to_regprocedure(f)::oid),
  'the five checkout functions run with definer rights and an empty search path');
select extensions.ok(
  (select bool_and(not has_function_privilege('anon', f, 'EXECUTE')
                   and not has_function_privilege('public', f, 'EXECUTE')
                   and has_function_privilege('authenticated', f, 'EXECUTE'))
   from unnest(array[
     'public.hold_court_booking(uuid, uuid, uuid, date, integer, integer)',
     'public.release_booking_hold(uuid)',
     'public.submit_booking_payment(uuid, text)',
     'public.staff_confirm_booking_payment(uuid)',
     'public.staff_reject_booking_payment(uuid, text)']) f),
  'only signed-in callers reach the checkout functions, which check the caller inside');
select extensions.ok(
  not has_table_privilege('authenticated', 'public.bookings', 'INSERT, UPDATE, DELETE')
  and not has_table_privilege('authenticated', 'public.court_allocations', 'INSERT, UPDATE, DELETE'),
  'the reservation-write pause still blocks direct booking and allocation writes');
select extensions.ok(
  has_function_privilege('anon', 'board.public_schedule_rows()', 'EXECUTE')
  and has_function_privilege('authenticated', 'board.public_schedule_rows()', 'EXECUTE')
  and not has_function_privilege('public', 'board.public_schedule_rows()', 'EXECUTE')
  and (select p.prosecdef and 'search_path=""' = any(p.proconfig) from pg_proc p
       where p.oid = 'board.public_schedule_rows()'::regprocedure),
  'the schedule function keeps its grants, definer rights and empty search path');

-- ---------------------------------------------------------------------------
-- A desk booking, made the desk's way. create_unpaid_desk_booking is paused for
-- API roles, so it runs here as its owner with the Lagao staff member signed in.
-- ---------------------------------------------------------------------------
select set_config('request.headers', '', true);
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000003', true);
select extensions.lives_ok(
  $$select set_config('test.desk', (public.create_unpaid_desk_booking(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae',
      (select m.id from public.members m
       where m.user_id = 'd1000000-0000-4000-8000-000000000002'
         and m.club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
      date '2099-06-01', 10, 1)).id::text, true)$$,
  'a desk booking is made for the player at 10 AM on Lagao Court B');

-- ---------------------------------------------------------------------------
-- Holding hours
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);
select extensions.lives_ok(
  $$select set_config('test.h1', (public.hold_court_booking(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad', date '2099-06-01', 18, 2)).id::text, true)$$,
  'a member holds Lagao Court A from 6 to 8 PM');
reset role;
select extensions.is(
  (select b.status::text || ':' || b.hours::text || ':' || b.amount::text || ':'
          || (b.hold_expires_at = now() + interval '15 minutes')::text || ':'
          || coalesce(b.payment_reference, 'none') || ':' || coalesce(b.payment_method::text, 'none')
   from public.bookings b where b.id = nullif(current_setting('test.h1', true), '')::uuid),
  'pending_payment:2:800.00:true:none:none',
  'the hold waits 15 minutes for payment, priced at the member rate');
select extensions.is(
  (select a.source || ':' || a.status || ':'
          || (a.interval = tstzrange(timestamptz '2099-06-01 18:00+08', timestamptz '2099-06-01 20:00+08', '[)'))::text
   from public.court_allocations a
   where a.source = 'booking' and a.source_id = nullif(current_setting('test.h1', true), '')::uuid),
  'booking:held:true',
  'the hold''s hours are held in Philippine time');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000002', true);
select extensions.lives_ok(
  $$select set_config('test.h2', (public.hold_court_booking(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad', date '2099-06-01', 20, 1)).id::text, true)$$,
  'a player with no membership holds the next hour');
reset role;
select extensions.is(
  (select b.amount::text from public.bookings b where b.id = nullif(current_setting('test.h2', true), '')::uuid),
  '500.00', 'a player pays the regular rate');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000009', true);
select extensions.throws_ok(
  $$select public.hold_court_booking('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad', date '2099-06-01', 19, 1)$$,
  '23P01', 'That time was just taken. Pick another time.',
  'a hold cannot overlap hours someone else holds');

select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000009', true);
select extensions.throws_ok(
  $$select public.hold_court_booking('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad', date '2099-06-01', 9, 0)$$,
  '22023', 'Pick at least 1 hour', 'a hold is at least 1 hour');
select extensions.throws_ok(
  $$select public.hold_court_booking('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad', date '2099-06-01', 21, 2)$$,
  '22023', 'That time is outside this location''s opening hours',
  'a hold must end by the location''s closing hour');
select extensions.throws_ok(
  $$select public.hold_court_booking('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',
      'd2000000-0000-4000-8000-000000000002', date '2099-06-01', 23, 2)$$,
  '22023', 'A booking must end by midnight',
  'a hold at a location open all day still ends by midnight');
select extensions.throws_ok(
  $$select public.hold_court_booking('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad', date '2020-01-01', 18, 1)$$,
  '22023', 'That time has already passed. Pick a later time.',
  'a hold cannot start in the past');
select extensions.throws_ok(
  $$select public.hold_court_booking('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac',
      'd2000000-0000-4000-8000-000000000001', date '2099-06-01', 9, 1)$$,
  '55000', 'This court is out of service. Pick another court.',
  'a court out of service cannot be held');
select extensions.throws_ok(
  $$select public.hold_court_booking('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad', date '2099-06-01', 9, 1)$$,
  'P0002', 'That court is not at this location',
  'a court must belong to the location named');
select extensions.throws_ok(
  $$select public.hold_court_booking('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbe', date '2099-06-01', 9, 1)$$,
  '22023', 'This club is not taking bookings',
  'the club named must be the club the request is for');
select set_config('request.headers', '{"x-club-id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}', true);
select extensions.throws_ok(
  $$select public.hold_court_booking('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbe', date '2099-06-01', 9, 1)$$,
  '42501', 'Join this club before booking a court',
  'naming a club in the header does not let a non-member book there');
select set_config('request.headers', '', true);
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000006', true);
select extensions.throws_ok(
  $$select public.hold_court_booking('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad', date '2099-06-01', 9, 1)$$,
  '42501', 'Platform accounts cannot book courts',
  'a platform superadmin cannot hold a court, even with a club row');

-- ---------------------------------------------------------------------------
-- A hold nobody pays for lapses
-- ---------------------------------------------------------------------------
reset role;
update public.bookings set hold_expires_at = now() - interval '1 minute'
where id = nullif(current_setting('test.h2', true), '')::uuid;
set local role anon;
select extensions.ok(
  not exists (select 1 from public.public_schedule where id = nullif(current_setting('test.h2', true), '')::uuid)
  and exists (select 1 from public.public_schedule where id = nullif(current_setting('test.h1', true), '')::uuid)
  and exists (select 1 from public.public_schedule where id = nullif(current_setting('test.desk', true), '')::uuid),
  'a lapsed hold leaves the public board at once; a live hold and a desk booking stay');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000009', true);
select extensions.lives_ok(
  $$select set_config('test.h9', (public.hold_court_booking(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad', date '2099-06-01', 20, 1)).id::text, true)$$,
  'someone else can hold the lapsed hour');
reset role;
select extensions.is(
  (select b.status::text || ':' || a.status
   from public.bookings b
   join public.court_allocations a on a.source = 'booking' and a.source_id = b.id
   where b.id = nullif(current_setting('test.h2', true), '')::uuid),
  'cancelled:cancelled',
  'the next hold in the club cancels the lapsed hold and frees its allocation');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000002', true);
select extensions.lives_ok(
  $$select set_config('test.h2b', (public.hold_court_booking(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae', date '2099-06-01', 14, 1)).id::text, true)$$,
  'the player holds again after their hold lapsed');
reset role;
select extensions.is(
  (select b.status::text || ':' || coalesce(b.hold_expires_at::text, 'no hold') || ':' || a.status
   from public.bookings b
   join public.court_allocations a on a.source = 'booking' and a.source_id = b.id
   where b.id = nullif(current_setting('test.desk', true), '')::uuid),
  'pending_payment:no hold:reserved',
  'the sweep leaves the desk booking alone');

-- ---------------------------------------------------------------------------
-- Releasing a hold
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);
select extensions.throws_ok(
  $$select public.release_booking_hold(nullif(current_setting('test.h9', true), '')::uuid)$$,
  'P0002', 'Booking not found', 'only the booking''s own player can release a hold');
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000002', true);
select extensions.lives_ok(
  $$select public.release_booking_hold(nullif(current_setting('test.h2b', true), '')::uuid)$$,
  'the player releases their hold before paying');
reset role;
select extensions.is(
  (select b.status::text || ':' || a.status
   from public.bookings b
   join public.court_allocations a on a.source = 'booking' and a.source_id = b.id
   where b.id = nullif(current_setting('test.h2b', true), '')::uuid),
  'cancelled:cancelled',
  'releasing cancels the hold and frees its hours');
set local role authenticated;
select extensions.lives_ok(
  $$select public.release_booking_hold(nullif(current_setting('test.h2b', true), '')::uuid)$$,
  'releasing again changes nothing');
select extensions.throws_ok(
  $$select public.release_booking_hold(nullif(current_setting('test.desk', true), '')::uuid)$$,
  '55000', 'This booking was made at the desk. Ask the club to cancel it.',
  'a player cannot release a desk booking');

-- Starting a new checkout gives back the player's previous unpaid hold; the
-- same player's desk booking is not an online hold and stays.
select extensions.lives_ok(
  $$select set_config('test.h2c', (public.hold_court_booking(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae', date '2099-06-01', 15, 1)).id::text, true)$$,
  'the player holds Lagao Court B at 3 PM');
select extensions.lives_ok(
  $$select set_config('test.h2d', (public.hold_court_booking(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae', date '2099-06-01', 16, 1)).id::text, true)$$,
  'starting again holds 4 PM instead');
reset role;
select extensions.is(
  (select string_agg(b.status::text || ':' || a.status, ',' order by b.start_at)
   from public.bookings b
   join public.court_allocations a on a.source = 'booking' and a.source_id = b.id
   where b.id in (nullif(current_setting('test.desk', true), '')::uuid,
                  nullif(current_setting('test.h2c', true), '')::uuid,
                  nullif(current_setting('test.h2d', true), '')::uuid)),
  'pending_payment:reserved,cancelled:cancelled,pending_payment:held',
  'one unpaid hold per player: the 3 PM hold is given back, and the desk booking stays');

update public.members set status = 'suspended'
where user_id = 'd1000000-0000-4000-8000-000000000009' and club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000009', true);
select extensions.throws_ok(
  $$select public.hold_court_booking('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad', date '2099-06-03', 9, 1)$$,
  '42501', 'Your account at this club is on hold. Ask the desk.',
  'a suspended member cannot hold a court');
reset role;
update public.members set status = 'active'
where user_id = 'd1000000-0000-4000-8000-000000000009' and club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local role authenticated;

-- ---------------------------------------------------------------------------
-- Sending the GCash reference
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);
select extensions.throws_ok(
  $$select public.submit_booking_payment(nullif(current_setting('test.h1', true), '')::uuid, 'ab 12')$$,
  '22023', 'Enter the GCash reference number: 6 to 30 letters or digits',
  'a reference shorter than 6 characters is refused');
select extensions.throws_ok(
  $$select public.submit_booking_payment(nullif(current_setting('test.h1', true), '')::uuid, '1012-345-678')$$,
  '22023', 'Enter the GCash reference number: 6 to 30 letters or digits',
  'a reference with symbols is refused');
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000009', true);
select extensions.throws_ok(
  $$select public.submit_booking_payment(nullif(current_setting('test.h1', true), '')::uuid, '1012345678901')$$,
  'P0002', 'Booking not found', 'only the booking''s own player can send its payment');
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);
select extensions.lives_ok(
  $$select public.submit_booking_payment(nullif(current_setting('test.h1', true), '')::uuid, ' 1012 345 678 901 ')$$,
  'the member sends the GCash reference number');
reset role;
select extensions.is(
  (select b.status::text || ':' || b.payment_reference || ':' || (b.payment_submitted_at = now())::text || ':'
          || (b.confirm_by = now() + interval '15 minutes')::text || ':' || b.payment_method::text || ':' || a.status
   from public.bookings b
   join public.court_allocations a on a.source = 'booking' and a.source_id = b.id
   where b.id = nullif(current_setting('test.h1', true), '')::uuid),
  'pending_payment:1012345678901:true:true:gcash:held',
  'the reference is saved without spaces, the club gets 15 minutes to check it, and the hours stay held');
set local role authenticated;
select extensions.throws_ok(
  $$select public.submit_booking_payment(nullif(current_setting('test.h1', true), '')::uuid, '1012345678901')$$,
  '55000', 'You already sent a payment for this booking', 'a payment is sent once');
select extensions.throws_ok(
  $$select public.release_booking_hold(nullif(current_setting('test.h1', true), '')::uuid)$$,
  '55000', 'You already sent a payment. The club will confirm or reject it.',
  'a hold cannot be released after its payment was sent');
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000002', true);
select extensions.throws_ok(
  $$select public.submit_booking_payment(nullif(current_setting('test.h2d', true), '')::uuid, '1012 3456 78901')$$,
  '23505', 'This GCash reference number was already used for another booking',
  'an old GCash reference cannot pay for a second booking at the club');

reset role;
update public.bookings set hold_expires_at = now() - interval '1 minute'
where id = nullif(current_setting('test.h9', true), '')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000009', true);
select extensions.throws_ok(
  $$select public.submit_booking_payment(nullif(current_setting('test.h9', true), '')::uuid, 'LATE123456')$$,
  '55000', 'Your 15 minutes to pay ran out, so those hours were released. Pick a time again.',
  'a payment for a lapsed hold is refused');
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000002', true);
select extensions.throws_ok(
  $$select public.submit_booking_payment(nullif(current_setting('test.desk', true), '')::uuid, '1012345678901')$$,
  '55000', 'This booking was made at the desk. Pay the club directly.',
  'a desk booking cannot be paid here');

-- Time moves on: the sent payment's hold time and its check-by time both pass.
reset role;
update public.bookings
set hold_expires_at = now() - interval '1 hour', confirm_by = now() - interval '30 minutes'
where id = nullif(current_setting('test.h1', true), '')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000009', true);
select extensions.lives_ok(
  $$select set_config('test.h9b', (public.hold_court_booking(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae', date '2099-06-02', 10, 1)).id::text, true)$$,
  'a new hold sweeps the club''s lapsed holds again');
reset role;
select extensions.ok(
  (select b.status = 'pending_payment' and a.status = 'held'
   from public.bookings b
   join public.court_allocations a on a.source = 'booking' and a.source_id = b.id
   where b.id = nullif(current_setting('test.h1', true), '')::uuid)
  and exists (select 1 from public.public_schedule where id = nullif(current_setting('test.h1', true), '')::uuid)
  and (select b.status = 'cancelled' from public.bookings b
       where b.id = nullif(current_setting('test.h9', true), '')::uuid),
  'a sent payment never lapses, even when overdue, while the unpaid lapsed hold is swept');

-- ---------------------------------------------------------------------------
-- The club confirms or rejects
-- ---------------------------------------------------------------------------
set local role anon;
select extensions.throws_ok(
  $$select public.staff_confirm_booking_payment(nullif(current_setting('test.h1', true), '')::uuid)$$,
  '42501', null, 'visitors cannot confirm payments');
select extensions.throws_ok(
  $$select public.release_booking_hold(nullif(current_setting('test.h1', true), '')::uuid)$$,
  '42501', null, 'visitors cannot release holds');
select extensions.throws_ok(
  $$select public.submit_booking_payment(nullif(current_setting('test.h1', true), '')::uuid, '1012345678901')$$,
  '42501', null, 'visitors cannot send payments');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);
select extensions.throws_ok(
  $$select public.staff_confirm_booking_payment(nullif(current_setting('test.h1', true), '')::uuid)$$,
  '42501', 'Only club staff at this location can confirm payments',
  'the player cannot confirm their own payment');
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000005', true);
select set_config('request.headers', '{"x-club-id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}', true);
select extensions.throws_ok(
  $$select public.staff_confirm_booking_payment(nullif(current_setting('test.h1', true), '')::uuid)$$,
  'P0002', 'Booking not found',
  'another club''s admin cannot find this club''s booking');
select set_config('request.headers', '{"x-club-id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}', true);
select extensions.throws_ok(
  $$select public.staff_confirm_booking_payment(nullif(current_setting('test.h1', true), '')::uuid)$$,
  '42501', 'Only club staff at this location can confirm payments',
  'naming this club in the header gives another club''s admin nothing');
select set_config('request.headers', '', true);
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000007', true);
select extensions.throws_ok(
  $$select public.staff_confirm_booking_payment(nullif(current_setting('test.h1', true), '')::uuid)$$,
  '42501', 'Only club staff at this location can confirm payments',
  'staff assigned to another location cannot confirm');
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000006', true);
select extensions.throws_ok(
  $$select public.staff_confirm_booking_payment(nullif(current_setting('test.h1', true), '')::uuid)$$,
  '42501', 'Platform accounts cannot confirm club payments',
  'a platform superadmin cannot confirm club payments');

select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000003', true);
select extensions.throws_ok(
  $$select public.staff_confirm_booking_payment(nullif(current_setting('test.h9b', true), '')::uuid)$$,
  '55000', 'The player has not sent a payment for this booking yet',
  'a hold without a payment cannot be confirmed');
select extensions.throws_ok(
  $$select public.staff_confirm_booking_payment(nullif(current_setting('test.desk', true), '')::uuid)$$,
  '55000', 'The player has not sent a payment for this booking yet',
  'a desk booking cannot be confirmed as a GCash payment');
select extensions.lives_ok(
  $$select public.staff_confirm_booking_payment(nullif(current_setting('test.h1', true), '')::uuid)$$,
  'Lagao staff confirm the overdue payment');
reset role;
select extensions.is(
  (select b.status::text || ':' || b.payment_ref || ':' || a.status
   from public.bookings b
   join public.court_allocations a on a.source = 'booking' and a.source_id = b.id
   where b.id = nullif(current_setting('test.h1', true), '')::uuid),
  'confirmed:1012345678901:reserved',
  'confirmed: booked, with the GCash reference, and its hours reserved');
select extensions.is(
  (select t.type::text || ':' || t.amount::text || ':' || t.club_id::text || ':' || t.venue_id::text || ':'
          || (t.member_id = b.member_id)::text || ':'
          || (t.created_by = 'd1000000-0000-4000-8000-000000000003')::text || ':'
          || t.verification_status || ':' || starts_with(t.description, 'Lagao Court A booking ')::text
   from public.transactions t
   join public.bookings b on b.id = nullif(current_setting('test.h1', true), '')::uuid
   where t.description like '%GCash ref 1012345678901'),
  'booking:800.00:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac:true:true:unverified:true',
  'confirming records one booking charge for the club, location and member, by the staff member');
select extensions.is(
  (select pc.club_id::text || ':' || pc.gross_amount::text || ':' || pc.commission_rate::text || ':'
          || pc.commission_amount::text
   from public.platform_commissions pc
   join public.transactions t on t.id = pc.transaction_id
   where t.description like '%GCash ref 1012345678901'),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:800.00:5.00:40.00',
  'the booking charge gets its platform commission line');
select extensions.ok(
  exists (select 1 from public.notifications n
          where n.user_id = 'd1000000-0000-4000-8000-000000000001'
            and n.club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
            and n.title = 'Booking confirmed'
            and n.body = 'The club confirmed your GCash payment. Lagao Court A, Jun 1, 6:00 PM to 8:00 PM is booked.'),
  'the player is told the booking is confirmed, in Philippine time');

set local role authenticated;
select extensions.throws_ok(
  $$select public.staff_confirm_booking_payment(nullif(current_setting('test.h1', true), '')::uuid)$$,
  '55000', 'This payment is already confirmed', 'a payment is confirmed once');
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000004', true);
select extensions.throws_ok(
  $$select public.staff_reject_booking_payment(nullif(current_setting('test.h1', true), '')::uuid, 'Changed my mind')$$,
  '55000', 'This payment is already confirmed', 'a confirmed payment cannot be rejected');

select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000009', true);
select extensions.lives_ok(
  $$select public.submit_booking_payment(nullif(current_setting('test.h9b', true), '')::uuid, 'ABC123XYZ')$$,
  'another player sends a payment');
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000004', true);
select extensions.throws_ok(
  $$select public.staff_reject_booking_payment(nullif(current_setting('test.h9b', true), '')::uuid, '   ')$$,
  '22023', 'Give a reason of 1 to 200 characters', 'a rejection needs a reason');
select extensions.throws_ok(
  $$select public.staff_reject_booking_payment(nullif(current_setting('test.h9b', true), '')::uuid, repeat('x', 201))$$,
  '22023', 'Give a reason of 1 to 200 characters', 'a reason is at most 200 characters');
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000009', true);
select extensions.throws_ok(
  $$select public.staff_reject_booking_payment(nullif(current_setting('test.h9b', true), '')::uuid, 'Not paid')$$,
  '42501', 'Only club staff at this location can reject payments',
  'the player cannot reject their own payment');
-- The club has since closed Lagao: an admin can still decide, so a sent payment is never stuck.
reset role;
update public.venues set is_active = false where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000004', true);
select extensions.lives_ok(
  $$select public.staff_reject_booking_payment(nullif(current_setting('test.h9b', true), '')::uuid, ' No payment received ')$$,
  'an admin rejects a payment that did not arrive, even at a location since closed');
reset role;
update public.venues set is_active = true where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac';
select extensions.is(
  (select b.status::text || ':' || a.status || ':'
          || (select count(*) from public.transactions t where t.description like '%GCash ref ABC123XYZ')::text
   from public.bookings b
   join public.court_allocations a on a.source = 'booking' and a.source_id = b.id
   where b.id = nullif(current_setting('test.h9b', true), '')::uuid),
  'cancelled:cancelled:0',
  'rejecting cancels the booking, frees its hours and charges nothing');
select extensions.ok(
  exists (select 1 from public.notifications n
          where n.user_id = 'd1000000-0000-4000-8000-000000000009'
            and n.club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
            and n.title = 'Payment not confirmed'
            and n.body = 'The club could not confirm your GCash payment for Lagao Court B, Jun 2, 10:00 AM to 11:00 AM, so those hours were released. Reason: No payment received'),
  'the player is told the payment was not confirmed, and why');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000002', true);
select extensions.lives_ok(
  $$select set_config('test.h2e', (public.hold_court_booking(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae', date '2099-06-02', 10, 1)).id::text, true)$$,
  'the rejected hours can be held again');
select extensions.lives_ok(
  $$select public.submit_booking_payment(nullif(current_setting('test.h2e', true), '')::uuid, 'ABC123XYZ')$$,
  'a rejected payment''s reference can be used again');

-- ---------------------------------------------------------------------------
-- Two clubs stay apart
-- ---------------------------------------------------------------------------
select set_config('request.headers', '{"x-club-id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}', true);
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000008', true);
select extensions.lives_ok(
  $$select set_config('test.h8', (public.hold_court_booking(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbe', date '2099-06-01', 18, 2)).id::text, true)$$,
  'a second-club player holds a court there at the same hours');
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000003', true);
select extensions.throws_ok(
  $$select public.staff_confirm_booking_payment(nullif(current_setting('test.h8', true), '')::uuid)$$,
  '42501', 'Only club staff at this location can confirm payments',
  'naming the second club in the header gives Gensan staff nothing');
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000008', true);
select extensions.lives_ok(
  $$select public.submit_booking_payment(nullif(current_setting('test.h8', true), '')::uuid, 'SECOND1234')$$,
  'the second-club player sends a payment');
select set_config('request.headers', '', true);
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000004', true);
select extensions.throws_ok(
  $$select public.staff_confirm_booking_payment(nullif(current_setting('test.h8', true), '')::uuid)$$,
  'P0002', 'Booking not found',
  'the Gensan admin cannot find the second club''s booking');
select set_config('request.headers', '{"x-club-id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}', true);
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000005', true);
select extensions.lives_ok(
  $$select public.staff_confirm_booking_payment(nullif(current_setting('test.h8', true), '')::uuid)$$,
  'the second club''s admin confirms it');
reset role;
select extensions.is(
  (select pc.club_id::text || ':' || pc.gross_amount::text || ':' || pc.commission_rate::text || ':'
          || pc.commission_amount::text
   from public.platform_commissions pc
   join public.transactions t on t.id = pc.transaction_id
   where t.description like '%GCash ref SECOND1234'),
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb:800.00:5.00:40.00',
  'the second club''s charge and commission are its own');
set local role anon;
select extensions.ok(
  exists (select 1 from public.public_schedule where id = nullif(current_setting('test.h8', true), '')::uuid)
  and not exists (select 1 from public.public_schedule where id = nullif(current_setting('test.h1', true), '')::uuid),
  'the second club''s board shows its own booking only');
reset role;
select set_config('request.headers', '', true);
set local role anon;
select extensions.ok(
  exists (select 1 from public.public_schedule where id = nullif(current_setting('test.h1', true), '')::uuid)
  and not exists (select 1 from public.public_schedule where id = nullif(current_setting('test.h8', true), '')::uuid),
  'the Gensan board shows its own bookings only');

reset role;
select * from extensions.finish();
rollback;
