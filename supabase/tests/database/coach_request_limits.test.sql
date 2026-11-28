begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select extensions.plan(20);

-- Coach request limits (20261128100300_coach_request_limits.sql): a player may have at most 3
-- coach requests waiting for an answer per club, and a member on hold cannot ask at all.
--
-- Fixture (every account has a confirmed email; signing up makes each a Gensan member):
--   user 1: the coach's own account, linked to Coach Lim at Gensan
--   user 2: Gensan player who asks for lessons; also has 3 open requests at the second club
--   user 3: Gensan admin
--   user 4: another Gensan player
--   user 5: Gensan member on hold (suspended)
--   user 6: Gensan member whose membership has expired
-- Coach Lim offers six private times (test.s1 to test.s6), two days ahead.
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
select ('e6000000-0000-4000-8000-00000000000' || n)::uuid, 'coach-limit-' || n || '@fixture.invalid', now(),
       jsonb_build_object('full_name', 'Coach Limit User ' || n)
from generate_series(1, 6) n;
insert into public.club_staff_roles (club_id, user_id, role)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'e6000000-0000-4000-8000-000000000003', 'admin');
update public.members set status = 'suspended'
where user_id = 'e6000000-0000-4000-8000-000000000005' and club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
update public.members set status = 'expired', expiry_date = current_date - 1
where user_id = 'e6000000-0000-4000-8000-000000000006' and club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

-- The second club: user 2 already has 3 requests waiting there. The tables are closed to API
-- roles, so these rows are written directly.
insert into public.members (club_id, user_id, member_code, full_name, membership_type, status, join_date, expiry_date)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'e6000000-0000-4000-8000-000000000002', 'CL-2', 'Coach Limit User 2',
        null, 'active', current_date, null);
insert into public.club_coaches (id, club_id, full_name)
values ('e6100000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Coach Second');
insert into public.coach_booking_slots (id, club_id, coach_id, starts_at, ends_at, lesson_type, pricing_model, rate, max_students)
select ('e6200000-0000-4000-8000-00000000000' || n)::uuid, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
       'e6100000-0000-4000-8000-000000000001',
       date_trunc('hour', now()) + interval '3 days' + make_interval(hours => n),
       date_trunc('hour', now()) + interval '3 days' + make_interval(hours => n + 1),
       'private', 'per_session', 500, 1
from generate_series(1, 3) n;
insert into public.coach_booking_requests (club_id, slot_id, player_user_id, student_count, quoted_amount)
select 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', ('e6200000-0000-4000-8000-00000000000' || n)::uuid,
       'e6000000-0000-4000-8000-000000000002', 1, 500
from generate_series(1, 3) n;

-- The coach and their six times at Gensan, made the app's way.
set local role authenticated;
select set_config('request.headers', '', true);
select set_config('request.jwt.claim.sub', 'e6000000-0000-4000-8000-000000000003', true);
select set_config('test.coach_id',
  (public.admin_upsert_club_coach(null, 'Coach Lim', 'Private lessons', null, 500, null, null, true)).id::text, true);
select public.admin_link_club_coach_account(current_setting('test.coach_id')::uuid, 'coach-limit-1@fixture.invalid');
select set_config('request.jwt.claim.sub', 'e6000000-0000-4000-8000-000000000001', true);
select set_config('test.s' || n,
  (public.coach_upsert_booking_slot(
    null, current_setting('test.coach_id')::uuid,
    date_trunc('hour', now()) + interval '2 days' + make_interval(hours => n),
    date_trunc('hour', now()) + interval '2 days' + make_interval(hours => n + 1),
    'private', 'per_session', 500, 1)).id::text, true)
from generate_series(1, 6) n;

-- ---------------------------------------------------------------------------
-- Structure and privileges are unchanged
-- ---------------------------------------------------------------------------
set local role postgres;
select extensions.ok(
  (select p.prosecdef and 'search_path=""' = any(coalesce(p.proconfig, '{}')) and pg_get_userbyid(p.proowner) = 'postgres'
          and p.prosrc ~ 'pg_advisory_xact_lock'
   from pg_proc p where p.oid = 'public.member_request_coach_slot(uuid, integer, text)'::regprocedure),
  'member_request_coach_slot stays a definer function with an empty search path, owned by postgres, and takes a per-player lock');
select extensions.ok(
  has_function_privilege('authenticated', 'public.member_request_coach_slot(uuid, integer, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.member_request_coach_slot(uuid, integer, text)', 'EXECUTE')
  and not has_function_privilege('public', 'public.member_request_coach_slot(uuid, integer, text)', 'EXECUTE'),
  'member_request_coach_slot is still for signed-in callers only');

-- ---------------------------------------------------------------------------
-- At most 3 requests waiting for an answer, per player and club
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e6000000-0000-4000-8000-000000000002', true);
select extensions.lives_ok(
  $$select set_config('test.r1', (public.member_request_coach_slot(current_setting('test.s1')::uuid, 1, '')).id::text, true)$$,
  'a player asks for a first time; the 3 requests at another club do not count');
select extensions.lives_ok(
  $$select set_config('test.r2', (public.member_request_coach_slot(current_setting('test.s2')::uuid, 1, '')).id::text, true)$$,
  'a second time');
select extensions.lives_ok(
  $$select set_config('test.r3', (public.member_request_coach_slot(current_setting('test.s3')::uuid, 1, '')).id::text, true)$$,
  'a third time');
select extensions.throws_ok(
  $$select public.member_request_coach_slot(current_setting('test.s4')::uuid, 1, '')$$,
  '55000', 'You have 3 coach requests waiting for an answer. Cancel one, or wait for a coach to answer, before you ask for another time.',
  'a fourth request is refused while 3 wait for an answer');
set local role postgres;
select extensions.is(
  (select count(*)::int from public.coach_booking_requests
   where player_user_id = 'e6000000-0000-4000-8000-000000000002' and club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  3, 'the refused request left nothing behind');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'e6000000-0000-4000-8000-000000000004', true);
select extensions.lives_ok(
  $$select public.member_request_coach_slot(current_setting('test.s4')::uuid, 1, '')$$,
  'another player can still ask: the limit is per player');

-- Cancelling one frees a place.
select set_config('request.jwt.claim.sub', 'e6000000-0000-4000-8000-000000000002', true);
select extensions.is(
  (public.member_cancel_coach_request(current_setting('test.r1')::uuid)).status,
  'cancelled', 'the player cancels one request');
select extensions.lives_ok(
  $$select set_config('test.r5', (public.member_request_coach_slot(current_setting('test.s5')::uuid, 1, '')).id::text, true)$$,
  'then can ask for another time');
select extensions.throws_ok(
  $$select public.member_request_coach_slot(current_setting('test.s6')::uuid, 1, '')$$,
  '55000', 'You have 3 coach requests waiting for an answer. Cancel one, or wait for a coach to answer, before you ask for another time.',
  'and is at the limit again');

-- A coach's answer frees a place too: accepted and declined requests do not count.
select set_config('request.jwt.claim.sub', 'e6000000-0000-4000-8000-000000000001', true);
select extensions.is(
  (public.coach_respond_to_booking_request(current_setting('test.r2')::uuid, true)).status,
  'accepted', 'the coach accepts one request');
select set_config('request.jwt.claim.sub', 'e6000000-0000-4000-8000-000000000002', true);
select extensions.lives_ok(
  $$select set_config('test.r6', (public.member_request_coach_slot(current_setting('test.s6')::uuid, 1, '')).id::text, true)$$,
  'an accepted request no longer counts, so the player can ask again');
select set_config('request.jwt.claim.sub', 'e6000000-0000-4000-8000-000000000001', true);
select extensions.is(
  (public.coach_respond_to_booking_request(current_setting('test.r3')::uuid, false)).status,
  'declined', 'the coach declines another');
select set_config('request.jwt.claim.sub', 'e6000000-0000-4000-8000-000000000002', true);
select extensions.lives_ok(
  $$select public.member_request_coach_slot(current_setting('test.s3')::uuid, 1, 'Any other time this week?')$$,
  'a declined request no longer counts either');
select extensions.throws_ok(
  $$select public.member_request_coach_slot(current_setting('test.s1')::uuid, 1, '')$$,
  '55000', 'You have 3 coach requests waiting for an answer. Cancel one, or wait for a coach to answer, before you ask for another time.',
  'three open requests again: the limit holds');

-- ---------------------------------------------------------------------------
-- A member on hold cannot ask
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'e6000000-0000-4000-8000-000000000005', true);
select extensions.throws_ok(
  $$select public.member_request_coach_slot(current_setting('test.s1')::uuid, 1, '')$$,
  '42501', 'Your account at this club is on hold. Ask the desk.',
  'a suspended member is refused, as for court bookings');
select set_config('request.jwt.claim.sub', 'e6000000-0000-4000-8000-000000000006', true);
select extensions.lives_ok(
  $$select public.member_request_coach_slot(current_setting('test.s1')::uuid, 1, '')$$,
  'a member whose membership expired can still ask, as for court bookings');

-- Unchanged: staff and admins are refused, and visitors cannot call it.
select set_config('request.jwt.claim.sub', 'e6000000-0000-4000-8000-000000000003', true);
select extensions.throws_ok(
  $$select public.member_request_coach_slot(current_setting('test.s2')::uuid, 1, '')$$,
  '42501', 'Join this club as a player to book a coach',
  'an admin still cannot ask for a lesson here');
set local role anon;
select extensions.throws_ok(
  $$select public.member_request_coach_slot(current_setting('test.s2')::uuid, 1, '')$$,
  '42501', null, 'visitors cannot ask');

select * from extensions.finish();
rollback;
