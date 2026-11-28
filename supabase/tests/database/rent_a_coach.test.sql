begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select extensions.plan(19);

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
select ('d4000000-0000-4000-8000-00000000000' || n)::uuid,
       'coach-booking-' || n || '@fixture.invalid', now(),
       jsonb_build_object('full_name', 'Coach Booking User ' || n)
from generate_series(1, 4) n;
insert into public.club_staff_roles (club_id, user_id, role)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'd4000000-0000-4000-8000-000000000003', 'admin');

select extensions.ok(
  (select bool_and(relrowsecurity) from pg_class
   where oid in ('public.coach_booking_slots'::regclass,
                 'public.coach_booking_requests'::regclass,
                 'public.coach_request_messages'::regclass)),
  'all coach booking tables have row security');
select extensions.ok(
  not has_table_privilege('authenticated', 'public.coach_booking_slots', 'SELECT, INSERT, UPDATE, DELETE')
  and not has_table_privilege('authenticated', 'public.coach_booking_requests', 'SELECT, INSERT, UPDATE, DELETE')
  and not has_table_privilege('authenticated', 'public.coach_request_messages', 'SELECT, INSERT, UPDATE, DELETE'),
  'signed-in users cannot access private booking tables directly');
select extensions.ok(
  (select count(*) = 14 and bool_and(prosecdef and 'search_path=""' = any(proconfig))
   from pg_proc where pronamespace = 'public'::regnamespace
     and proname in ('admin_link_club_coach_account', 'coach_my_profiles', 'coach_set_booking_policy',
       'coach_upsert_booking_slot', 'coach_set_booking_slot_open', 'member_list_coach_slots',
       'member_request_coach_slot', 'coach_list_my_slots', 'coach_list_my_requests',
       'member_list_my_coach_requests', 'coach_respond_to_booking_request',
       'member_cancel_coach_request', 'coach_send_request_message', 'coach_list_request_messages')),
  'all coach booking RPCs are security-definer functions with a fixed search path');
select extensions.ok(
  has_function_privilege('authenticated', 'public.member_request_coach_slot(uuid, integer, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.member_request_coach_slot(uuid, integer, text)', 'EXECUTE')
  and not has_table_privilege('authenticated', 'public.coach_request_messages', 'SELECT'),
  'only authenticated callers can reach booking RPCs, not private message rows');

select set_config('request.headers', '', true);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd4000000-0000-4000-8000-000000000003', true);
select set_config('test.coach_id',
  (public.admin_upsert_club_coach(null, 'Coach Ana', 'Beginner lessons', null, 600, null, null, true)).id::text, true);
select extensions.is(
  public.admin_link_club_coach_account(current_setting('test.coach_id')::uuid, 'coach-booking-1@fixture.invalid'),
  'd4000000-0000-4000-8000-000000000001'::uuid,
  'a club admin links a confirmed account to the coach profile');

select set_config('request.jwt.claim.sub', 'd4000000-0000-4000-8000-000000000001', true);
select extensions.is(
  (select count(*)::int from public.coach_my_profiles()), 1,
  'the linked coach sees only their linked profiles');
select set_config('test.slot_id',
  (public.coach_upsert_booking_slot(
    null, current_setting('test.coach_id')::uuid,
    timestamptz '2099-06-01 10:00+08', timestamptz '2099-06-01 11:00+08',
    'group', 'per_student', 600, 4)).id::text, true);

select set_config('request.jwt.claim.sub', 'd4000000-0000-4000-8000-000000000002', true);
select set_config('test.request_id',
  (public.member_request_coach_slot(current_setting('test.slot_id')::uuid, 3, 'Three players, please.')).id::text, true);
-- The table is closed to API roles (functions only), so the stored row is read as postgres.
set local role postgres;
select extensions.is(
  (select status from public.coach_booking_requests where id = current_setting('test.request_id')::uuid),
  'requested', 'a new lesson request waits for the coach');
set local role authenticated;
select extensions.is(
  (select count(*)::int from public.member_list_coach_slots(
    timestamptz '2099-06-01 00:00+08', timestamptz '2099-06-02 00:00+08')),
  0, 'a pending request holds the whole time');

select set_config('request.jwt.claim.sub', 'd4000000-0000-4000-8000-000000000004', true);
select extensions.throws_ok(
  $$select public.member_request_coach_slot(current_setting('test.slot_id')::uuid, 1, '')$$,
  '55000', 'This coach time is waiting for another player''s request to be decided',
  'another player cannot take the time while a request is pending');

select set_config('request.jwt.claim.sub', 'd4000000-0000-4000-8000-000000000003', true);
select extensions.throws_ok(
  $$select public.admin_link_club_coach_account(current_setting('test.coach_id')::uuid, null)$$,
  '55000', 'Cancel or finish active coaching requests before changing this account',
  'an admin cannot unlink a coach during an active request');
select set_config('request.jwt.claim.sub', 'd4000000-0000-4000-8000-000000000001', true);
select extensions.is(
  (public.coach_respond_to_booking_request(current_setting('test.request_id')::uuid, true)).status,
  'accepted', 'the linked coach can accept the requested time');

select set_config('request.jwt.claim.sub', 'd4000000-0000-4000-8000-000000000004', true);
select extensions.is(
  (select remaining_students from public.member_list_coach_slots(
    timestamptz '2099-06-01 00:00+08', timestamptz '2099-06-02 00:00+08')
   where slot_id = current_setting('test.slot_id')::uuid),
  1, 'accepted seats reduce group availability');
select extensions.throws_ok(
  $$select public.member_request_coach_slot(current_setting('test.slot_id')::uuid, 2, '')$$,
  '55000', 'Not enough places remain for this group', 'requests cannot exceed group capacity');
select set_config('test.second_request_id',
  (public.member_request_coach_slot(current_setting('test.slot_id')::uuid, 1, '')).id::text, true);

select set_config('request.jwt.claim.sub', 'd4000000-0000-4000-8000-000000000002', true);
select extensions.is(
  (public.coach_send_request_message(current_setting('test.request_id')::uuid, 'Can we use the north court?')).body,
  'Can we use the north court?', 'a player can message the coach in the private request thread');
select set_config('request.jwt.claim.sub', 'd4000000-0000-4000-8000-000000000001', true);
select extensions.is(
  (select count(*)::int from public.coach_list_request_messages(current_setting('test.request_id')::uuid)),
  1, 'the linked coach can read the player conversation');
select set_config('request.jwt.claim.sub', 'd4000000-0000-4000-8000-000000000003', true);
select extensions.throws_ok(
  $$select count(*) from public.coach_list_request_messages(current_setting('test.request_id')::uuid)$$,
  'P0002', 'Coaching request not found', 'an unrelated account cannot read the conversation');

select set_config('request.jwt.claim.sub', 'd4000000-0000-4000-8000-000000000004', true);
select extensions.is(
  (public.member_cancel_coach_request(current_setting('test.second_request_id')::uuid)).status,
  'cancelled', 'a player can cancel their own request and release its seats');
select set_config('request.jwt.claim.sub', 'd4000000-0000-4000-8000-000000000002', true);
select extensions.is(
  (public.member_cancel_coach_request(current_setting('test.request_id')::uuid)).status,
  'cancelled', 'a player can cancel an accepted request');
select set_config('request.jwt.claim.sub', 'd4000000-0000-4000-8000-000000000003', true);
select extensions.is(
  public.admin_link_club_coach_account(current_setting('test.coach_id')::uuid, null),
  null::uuid, 'an admin can unlink the coach after active requests end');

select * from extensions.finish();
rollback;
