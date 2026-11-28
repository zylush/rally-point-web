begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select extensions.plan(27);

-- Booking hold limits (20261128100000_booking_hold_limits.sql): a hold is at most 30 days ahead
-- (Philippine time), and a player with 4 sent payments waiting for the club holds no more hours
-- (with 3 waiting they still can). Desk bookings, unpaid holds and other clubs do not count, and
-- a sent payment still never lapses.
--
-- Fixture. Signing up gives every new account a Gensan membership row.
--   user 1: Gensan player who books online; also a player at the synthetic second club
--   user 2: another Gensan player
--   user 3: Gensan staff assigned to the Lagao location
-- Places come from supabase/seed.sql: Gensan Lagao (...aaac) with Lagao Court A (...aaad) and
-- B (...aaae); the second club's Synthetic Main (...bbbc) with Synthetic Court A (...bbbe).
-- Days count from today in Philippine time; test.d7 is a week ahead.
-- Booking ids are kept in test.* settings: desk, h30, ha, hb, hc, hf, hg, hd and he.
insert into auth.users (id, email, raw_user_meta_data)
select ('e2000000-0000-4000-8000-00000000000' || n)::uuid, 'hold-limit-' || n || '@fixture.invalid',
       jsonb_build_object('full_name', 'Hold Limit User ' || n)
from generate_series(1, 3) n;
insert into public.club_staff_roles (club_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'e2000000-0000-4000-8000-000000000003', 'staff');
insert into public.staff_venue_grants (club_id, user_id, venue_id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'e2000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac');
insert into public.members (club_id, user_id, member_code, full_name, membership_type, status, join_date, expiry_date)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'e2000000-0000-4000-8000-000000000001', 'HL-1', 'Hold Limit User 1',
        null, 'active', current_date, null);
update public.club_accounts set status = 'active'
where club_id in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
update public.venues set open_hour = 6, close_hour = 22
where id in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc');
update public.courts set status = 'available', hourly_rate = 500, member_rate = null
where id in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae',
             'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbe');
select set_config('test.today', ((now() at time zone 'Asia/Manila')::date)::text, true);
select set_config('test.d7', ((now() at time zone 'Asia/Manila')::date + 7)::text, true);
select set_config('test.member1', (select m.id::text from public.members m
  where m.user_id = 'e2000000-0000-4000-8000-000000000001' and m.club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), true);

-- ---------------------------------------------------------------------------
-- Structure and privileges are unchanged
-- ---------------------------------------------------------------------------
select extensions.ok(
  (select p.prosecdef and 'search_path=""' = any(coalesce(p.proconfig, '{}')) and pg_get_userbyid(p.proowner) = 'postgres'
   from pg_proc p where p.oid = 'public.hold_court_booking(uuid, uuid, uuid, date, integer, integer)'::regprocedure),
  'hold_court_booking stays a definer function with an empty search path, owned by postgres');
select extensions.ok(
  has_function_privilege('authenticated', 'public.hold_court_booking(uuid, uuid, uuid, date, integer, integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.hold_court_booking(uuid, uuid, uuid, date, integer, integer)', 'EXECUTE')
  and not has_function_privilege('public', 'public.hold_court_booking(uuid, uuid, uuid, date, integer, integer)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.hold_court_booking(uuid, uuid, uuid, date, integer, integer)', 'EXECUTE'),
  'hold_court_booking is still for signed-in callers only');

-- A desk booking for user 1, made the desk's way. create_unpaid_desk_booking is paused for API
-- roles, so it runs here as its owner with the Lagao staff member signed in.
select set_config('request.headers', '', true);
select set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-000000000003', true);
select extensions.lives_ok(
  $$select set_config('test.desk', (public.create_unpaid_desk_booking(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae', current_setting('test.member1')::uuid,
      current_setting('test.d7')::date, 8, 1)).id::text, true)$$,
  'the desk books Lagao Court B at 8 AM a week ahead for user 1');

-- ---------------------------------------------------------------------------
-- The booking window: up to 30 days ahead, in Philippine time
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-000000000001', true);
select extensions.throws_ok(
  $$select public.hold_court_booking('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad', current_setting('test.today')::date + 31, 9, 1)$$,
  '22023', 'You can book up to 30 days ahead. Pick an earlier date.',
  'a hold 31 days ahead is refused');
select extensions.throws_ok(
  $$select public.hold_court_booking('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad', date '2099-06-01', 9, 1)$$,
  '22023', 'You can book up to 30 days ahead. Pick an earlier date.',
  'a hold years ahead is refused');
select extensions.lives_ok(
  $$select set_config('test.h30', (public.hold_court_booking(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad', current_setting('test.today')::date + 30, 9, 1)).id::text, true)$$,
  'a hold exactly 30 days ahead is allowed');

-- ---------------------------------------------------------------------------
-- At most 4 sent payments waiting for the club
-- ---------------------------------------------------------------------------
select extensions.lives_ok(
  $$select set_config('test.ha', (public.hold_court_booking(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad', current_setting('test.d7')::date, 10, 1)).id::text, true)$$,
  'user 1 holds 10 AM a week ahead');
select extensions.lives_ok(
  $$select public.submit_booking_payment(nullif(current_setting('test.ha', true), '')::uuid, 'LIMIT00001')$$,
  'and sends its payment: 1 payment waiting');
select extensions.lives_ok(
  $$select set_config('test.hb', (public.hold_court_booking(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad', current_setting('test.d7')::date, 11, 1)).id::text, true)$$,
  'with 1 payment waiting, user 1 can hold 11 AM');
select extensions.lives_ok(
  $$select set_config('test.hc', (public.hold_court_booking(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad', current_setting('test.d7')::date, 12, 1)).id::text, true)$$,
  'starting again with 1 payment waiting, an unpaid hold and a desk booking is allowed: the last two do not count');
select extensions.lives_ok(
  $$select public.submit_booking_payment(nullif(current_setting('test.hc', true), '')::uuid, 'LIMIT00002')$$,
  'user 1 sends a second payment: 2 payments waiting');
select extensions.lives_ok(
  $$select set_config('test.hf', (public.hold_court_booking(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad', current_setting('test.d7')::date, 13, 1)).id::text, true)$$,
  'with 2 payments waiting, user 1 can hold 1 PM');
select extensions.lives_ok(
  $$select public.submit_booking_payment(nullif(current_setting('test.hf', true), '')::uuid, 'LIMIT00003')$$,
  'and sends a third payment: 3 payments waiting');
select extensions.lives_ok(
  $$select set_config('test.hg', (public.hold_court_booking(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad', current_setting('test.d7')::date, 14, 1)).id::text, true)$$,
  'with 3 payments waiting, user 1 can still hold 2 PM');
select extensions.lives_ok(
  $$select public.submit_booking_payment(nullif(current_setting('test.hg', true), '')::uuid, 'LIMIT00004')$$,
  'and sends a fourth payment: 4 payments waiting');
select extensions.throws_ok(
  $$select public.hold_court_booking('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad', current_setting('test.d7')::date, 15, 1)$$,
  '55000', 'You have 4 payments waiting for the club to check. You can book again once the club confirms or rejects one.',
  'a fifth hold is refused while 4 payments wait for the club');
reset role;
select extensions.is(
  (select string_agg(b.status::text || ':' || coalesce(a.status, 'none'), ',' order by b.start_at)
   from public.bookings b
   left join public.court_allocations a on a.source = 'booking' and a.source_id = b.id
   where b.club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and b.member_id = current_setting('test.member1')::uuid),
  'pending_payment:reserved,pending_payment:held,cancelled:cancelled,pending_payment:held,pending_payment:held,'
  || 'pending_payment:held,cancelled:cancelled',
  'the refused hold left nothing behind; the desk booking and all four sent payments keep their hours');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-000000000002', true);
select extensions.lives_ok(
  $$select public.hold_court_booking('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad', current_setting('test.d7')::date, 15, 1)$$,
  'another player can still hold: the limit is per player');
select set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-000000000001', true);
select set_config('request.headers', '{"x-club-id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}', true);
select extensions.lives_ok(
  $$select public.hold_court_booking('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbe', current_setting('test.d7')::date, 10, 1)$$,
  'at another club the same player can still hold: the limit is per club');
select set_config('request.headers', '', true);

-- Time moves on: the first payment is overdue for the club. It still never lapses, so it counts.
reset role;
update public.bookings
set hold_expires_at = now() - interval '1 hour', confirm_by = now() - interval '30 minutes'
where id = nullif(current_setting('test.ha', true), '')::uuid;
set local role authenticated;
select extensions.throws_ok(
  $$select public.hold_court_booking('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad', current_setting('test.d7')::date, 16, 1)$$,
  '55000', 'You have 4 payments waiting for the club to check. You can book again once the club confirms or rejects one.',
  'an overdue payment still counts, because a sent payment never lapses');

-- ---------------------------------------------------------------------------
-- Once the club decides, the player can book again
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-000000000003', true);
select extensions.lives_ok(
  $$select public.staff_reject_booking_payment(nullif(current_setting('test.hc', true), '')::uuid, 'No payment received')$$,
  'Lagao staff reject one payment');
select set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-000000000001', true);
select extensions.lives_ok(
  $$select set_config('test.hd', (public.hold_court_booking(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad', current_setting('test.d7')::date, 16, 1)).id::text, true)$$,
  'after a rejection user 1 can hold again');
select extensions.lives_ok(
  $$select public.submit_booking_payment(nullif(current_setting('test.hd', true), '')::uuid, 'LIMIT00005')$$,
  'and send that payment: 4 payments waiting again');
select extensions.throws_ok(
  $$select public.hold_court_booking('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad', current_setting('test.d7')::date, 17, 1)$$,
  '55000', 'You have 4 payments waiting for the club to check. You can book again once the club confirms or rejects one.',
  'the limit holds again');
select set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-000000000003', true);
select extensions.lives_ok(
  $$select public.staff_confirm_booking_payment(nullif(current_setting('test.ha', true), '')::uuid)$$,
  'Lagao staff confirm the overdue payment');
select set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-000000000001', true);
select extensions.lives_ok(
  $$select set_config('test.he', (public.hold_court_booking(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad', current_setting('test.d7')::date, 17, 1)).id::text, true)$$,
  'after a confirmation user 1 can hold again');
reset role;
select extensions.is(
  (select string_agg(b.status::text || ':' || a.status, ',' order by b.start_at)
   from public.bookings b
   join public.court_allocations a on a.source = 'booking' and a.source_id = b.id
   where b.id in (nullif(current_setting('test.ha', true), '')::uuid, nullif(current_setting('test.hc', true), '')::uuid,
                  nullif(current_setting('test.hd', true), '')::uuid, nullif(current_setting('test.he', true), '')::uuid)),
  'confirmed:reserved,cancelled:cancelled,pending_payment:held,pending_payment:held',
  'confirmed and rejected payments are settled, the waiting payment keeps its hours, and the new hold is held');

select * from extensions.finish();
rollback;
