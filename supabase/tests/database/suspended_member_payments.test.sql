begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select extensions.plan(14);

-- Suspended members (20261128100800_suspended_member_payments.sql): a member put on hold cannot send
-- a GCash payment for hours held before that, with the words hold_court_booking uses. Staff can still
-- decide a payment that was already sent.
--
-- Fixture. Signing up gives every new account a Gensan membership row.
--   user 1: Gensan player who holds hours, then is put on hold
--   user 2: Gensan staff assigned to the Lagao location
--   user 3: Gensan player who sends two payments, then is put on hold
--   user 4: another Gensan player
-- Places come from supabase/seed.sql: Gensan Lagao (...aaac) with Lagao Court A (...aaad).
insert into auth.users (id, email, raw_user_meta_data)
select ('ea000000-0000-4000-8000-00000000000' || n)::uuid, 'pay-hold-' || n || '@fixture.invalid',
       jsonb_build_object('full_name', 'Pay Hold User ' || n)
from generate_series(1, 4) n;
insert into public.club_staff_roles (club_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'ea000000-0000-4000-8000-000000000002', 'staff');
insert into public.staff_venue_grants (club_id, user_id, venue_id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'ea000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac');
update public.club_accounts set status = 'active' where club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
update public.venues set open_hour = 6, close_hour = 22 where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac';
update public.courts set status = 'available', hourly_rate = 500, member_rate = null
where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad';
select set_config('test.d7', ((now() at time zone 'Asia/Manila')::date + 7)::text, true);

-- ---------------------------------------------------------------------------
-- Structure and privileges are unchanged
-- ---------------------------------------------------------------------------
select extensions.ok(
  (select p.prosecdef and 'search_path=""' = any(coalesce(p.proconfig, '{}')) and pg_get_userbyid(p.proowner) = 'postgres'
   from pg_proc p where p.oid = 'public.submit_booking_payment(uuid, text)'::regprocedure),
  'submit_booking_payment stays a definer function with an empty search path, owned by postgres');
select extensions.ok(
  has_function_privilege('authenticated', 'public.submit_booking_payment(uuid, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.submit_booking_payment(uuid, text)', 'EXECUTE')
  and not has_function_privilege('public', 'public.submit_booking_payment(uuid, text)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.submit_booking_payment(uuid, text)', 'EXECUTE'),
  'submit_booking_payment is still for signed-in callers only');

-- ---------------------------------------------------------------------------
-- A hold made before the account was put on hold
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.headers', '', true);
select set_config('request.jwt.claim.sub', 'ea000000-0000-4000-8000-000000000001', true);
select extensions.lives_ok(
  $$select set_config('test.h1', (public.hold_court_booking('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad',
      current_setting('test.d7')::date, 9, 1)).id::text, true)$$,
  'a player holds an hour');
set local role postgres;
update public.members set status = 'suspended'
where user_id = 'ea000000-0000-4000-8000-000000000001' and club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local role authenticated;
select extensions.throws_ok(
  $$select public.submit_booking_payment(nullif(current_setting('test.h1', true), '')::uuid, 'HOLD000001')$$,
  '42501', 'Your account at this club is on hold. Ask the desk.',
  'once on hold, the player cannot send a payment for it');
set local role postgres;
select extensions.is(
  (select b.status::text || ':' || coalesce(b.payment_reference, 'none') || ':' || (b.payment_submitted_at is null)::text
   from public.bookings b where b.id = nullif(current_setting('test.h1', true), '')::uuid),
  'pending_payment:none:true',
  'the hold stays unpaid, so it lapses on its own');
set local role authenticated;
select extensions.throws_ok(
  $$select public.hold_court_booking('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad', current_setting('test.d7')::date, 10, 1)$$,
  '42501', 'Your account at this club is on hold. Ask the desk.',
  'the same words as for a new hold');

select set_config('request.jwt.claim.sub', 'ea000000-0000-4000-8000-000000000004', true);
select extensions.throws_ok(
  $$select public.submit_booking_payment(nullif(current_setting('test.h1', true), '')::uuid, 'HOLD000002')$$,
  'P0002', 'Booking not found',
  'another player still gets "Booking not found", which says nothing about the hold on the account');

-- Only an account on hold is refused: an expired membership can still pay.
set local role postgres;
update public.members set status = 'expired', expiry_date = current_date - 1
where user_id = 'ea000000-0000-4000-8000-000000000001' and club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'ea000000-0000-4000-8000-000000000001', true);
select extensions.lives_ok(
  $$select public.submit_booking_payment(nullif(current_setting('test.h1', true), '')::uuid, 'HOLD000003')$$,
  'with an expired membership (not on hold) the player can pay');

-- ---------------------------------------------------------------------------
-- Payments sent before the hold are still decided by the club
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'ea000000-0000-4000-8000-000000000003', true);
select set_config('test.h3a', (public.hold_court_booking('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad',
  current_setting('test.d7')::date, 12, 1)).id::text, true);
select public.submit_booking_payment(current_setting('test.h3a')::uuid, 'SENT000001');
select set_config('test.h3b', (public.hold_court_booking('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad',
  current_setting('test.d7')::date, 13, 1)).id::text, true);
select public.submit_booking_payment(current_setting('test.h3b')::uuid, 'SENT000002');
set local role postgres;
update public.members set status = 'suspended'
where user_id = 'ea000000-0000-4000-8000-000000000003' and club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local role authenticated;
select extensions.throws_ok(
  $$select public.submit_booking_payment(current_setting('test.h3a')::uuid, 'SENT000003')$$,
  '42501', 'Your account at this club is on hold. Ask the desk.',
  'a member on hold is told so first, even for a payment already sent');
select set_config('request.jwt.claim.sub', 'ea000000-0000-4000-8000-000000000002', true);
select extensions.lives_ok(
  $$select public.staff_confirm_booking_payment(current_setting('test.h3a')::uuid)$$,
  'Lagao staff can still confirm a payment sent before the hold');
select extensions.lives_ok(
  $$select public.staff_reject_booking_payment(current_setting('test.h3b')::uuid, 'Account on hold')$$,
  'and can still reject one');
set local role postgres;
select extensions.is(
  (select string_agg(b.status::text, ',' order by b.start_at) from public.bookings b
   where b.id in (current_setting('test.h3a')::uuid, current_setting('test.h3b')::uuid)),
  'confirmed,cancelled', 'the club''s decisions are recorded');

-- Unchanged: signed-out callers and bad references.
set local role anon;
select extensions.throws_ok(
  $$select public.submit_booking_payment(nullif(current_setting('test.h1', true), '')::uuid, 'HOLD000004')$$,
  '42501', null, 'visitors cannot send payments');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'ea000000-0000-4000-8000-000000000003', true);
select extensions.throws_ok(
  $$select public.submit_booking_payment(current_setting('test.h3a')::uuid, 'ab 12')$$,
  '22023', 'Enter the GCash reference number: 6 to 30 letters or digits',
  'a bad reference is still refused first');

select * from extensions.finish();
rollback;
