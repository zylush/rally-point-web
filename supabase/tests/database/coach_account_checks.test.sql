begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select extensions.plan(35);

-- Coach accounts (20261128100700_coach_account_checks.sql): only an active coach at an open club
-- works as a coach, and no coach gets a player's email. Players keep their side of a
-- conversation, threads close with the request, and a thread holds at most 200 messages.
--
-- Fixture (every account has a confirmed email; signing up makes each a Gensan member):
--   user 1: account of Coach Gone at Gensan, whom the club later removes
--   user 2: Gensan player
--   user 3: Gensan admin
--   user 4: account of Coach Far at the second club, which is later suspended
--   user 5: player at the second club
--   user 6: account of Coach Stay at Gensan, who stays active
-- Requests: r1 (waiting) and r2 (accepted) with Coach Gone, r3 and r4 with Coach Stay, rb with Coach Far.
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
select ('e9000000-0000-4000-8000-00000000000' || n)::uuid, 'coach-check-' || n || '@fixture.invalid', now(),
       jsonb_build_object('full_name', 'Coach Check User ' || n)
from generate_series(1, 6) n;
insert into public.club_staff_roles (club_id, user_id, role)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'e9000000-0000-4000-8000-000000000003', 'admin');
insert into public.members (club_id, user_id, member_code, full_name, membership_type, status, join_date, expiry_date)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'e9000000-0000-4000-8000-000000000005', 'CC-5', 'Coach Check User 5',
        null, 'active', current_date, null);
update public.club_accounts set status = 'active'
where club_id in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
insert into public.club_coaches (id, club_id, full_name, account_user_id)
values ('e9100000-0000-4000-8000-000000000004', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Coach Far',
        'e9000000-0000-4000-8000-000000000004');

-- The club admin adds two coaches and links their accounts; the coaches publish times.
set local role authenticated;
select set_config('request.headers', '', true);
select set_config('request.jwt.claim.sub', 'e9000000-0000-4000-8000-000000000003', true);
select set_config('test.gone', (public.admin_upsert_club_coach(null, 'Coach Gone', null, null, 500, null, null, true)).id::text, true);
select set_config('test.stay', (public.admin_upsert_club_coach(null, 'Coach Stay', null, null, 500, null, null, true)).id::text, true);
select public.admin_link_club_coach_account(current_setting('test.gone')::uuid, 'coach-check-1@fixture.invalid');
select public.admin_link_club_coach_account(current_setting('test.stay')::uuid, 'coach-check-6@fixture.invalid');
select set_config('request.jwt.claim.sub', 'e9000000-0000-4000-8000-000000000001', true);
select set_config('test.ga' || n, (public.coach_upsert_booking_slot(null, current_setting('test.gone')::uuid,
    date_trunc('hour', now()) + interval '2 days' + make_interval(hours => n),
    date_trunc('hour', now()) + interval '2 days' + make_interval(hours => n + 1),
    'private', 'per_session', 500, 1)).id::text, true)
from generate_series(1, 3) n;
select set_config('request.jwt.claim.sub', 'e9000000-0000-4000-8000-000000000006', true);
select set_config('test.st' || n, (public.coach_upsert_booking_slot(null, current_setting('test.stay')::uuid,
    date_trunc('hour', now()) + interval '3 days' + make_interval(hours => n),
    date_trunc('hour', now()) + interval '3 days' + make_interval(hours => n + 1),
    'private', 'per_session', 500, 1)).id::text, true)
from generate_series(1, 2) n;
select set_config('request.jwt.claim.sub', 'e9000000-0000-4000-8000-000000000004', true);
select set_config('test.far', (public.coach_upsert_booking_slot(null, 'e9100000-0000-4000-8000-000000000004',
    date_trunc('hour', now()) + interval '2 days', date_trunc('hour', now()) + interval '2 days 1 hour',
    'private', 'per_session', 500, 1)).id::text, true);

-- Players ask; Coach Gone accepts one and both sides talk. (A player may have 3 requests waiting,
-- so r4 is asked for after r2 is accepted.)
select set_config('request.jwt.claim.sub', 'e9000000-0000-4000-8000-000000000002', true);
select set_config('test.r1', (public.member_request_coach_slot(current_setting('test.ga1')::uuid, 1, '')).id::text, true);
select set_config('test.r2', (public.member_request_coach_slot(current_setting('test.ga2')::uuid, 1, '')).id::text, true);
select set_config('test.r3', (public.member_request_coach_slot(current_setting('test.st1')::uuid, 1, '')).id::text, true);
select set_config('request.jwt.claim.sub', 'e9000000-0000-4000-8000-000000000001', true);
select public.coach_respond_to_booking_request(current_setting('test.r2')::uuid, true);
select public.coach_send_request_message(current_setting('test.r1')::uuid, 'Hello from your coach');
select set_config('request.jwt.claim.sub', 'e9000000-0000-4000-8000-000000000002', true);
select public.coach_send_request_message(current_setting('test.r1')::uuid, 'Hello coach');
select set_config('test.r4', (public.member_request_coach_slot(current_setting('test.st2')::uuid, 1, '')).id::text, true);
select set_config('request.jwt.claim.sub', 'e9000000-0000-4000-8000-000000000005', true);
select set_config('request.headers', '{"x-club-id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}', true);
select set_config('test.rb', (public.member_request_coach_slot(current_setting('test.far')::uuid, 1, '')).id::text, true);
select set_config('request.headers', '', true);

-- ---------------------------------------------------------------------------
-- Structure and privileges are unchanged
-- ---------------------------------------------------------------------------
set local role postgres;
select extensions.ok(
  (select count(*) = 8 and bool_and(p.prosecdef and 'search_path=""' = any(coalesce(p.proconfig, '{}'))
                                    and pg_get_userbyid(p.proowner) = 'postgres'
                                    and has_function_privilege('authenticated', p.oid, 'EXECUTE')
                                    and not has_function_privilege('anon', p.oid, 'EXECUTE')
                                    and not has_function_privilege('public', p.oid, 'EXECUTE'))
   from pg_proc p
   where p.oid in ('public.coach_respond_to_booking_request(uuid, boolean)'::regprocedure,
                   'public.coach_send_request_message(uuid, text)'::regprocedure,
                   'public.coach_set_booking_slot_open(uuid, boolean)'::regprocedure,
                   'public.coach_upsert_booking_slot(uuid, uuid, timestamptz, timestamptz, text, text, numeric, integer)'::regprocedure,
                   'public.coach_set_booking_policy(uuid, text)'::regprocedure,
                   'public.coach_list_my_requests()'::regprocedure,
                   'public.coach_list_my_slots()'::regprocedure,
                   'public.coach_list_request_messages(uuid)'::regprocedure)),
  'the eight coach functions keep definer rights, an empty search path, postgres as owner and signed-in callers only');
select extensions.ok(
  (select not p.prosecdef and 'search_path=""' = any(coalesce(p.proconfig, '{}'))
          and not has_function_privilege('anon', p.oid, 'EXECUTE')
          and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
          and not has_function_privilege('public', p.oid, 'EXECUTE')
   from pg_proc p where p.oid = 'private.coach_can_act(uuid)'::regprocedure),
  'the coach check is private and runs with the caller''s rights');

-- ---------------------------------------------------------------------------
-- An active coach at an open club works as before
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e9000000-0000-4000-8000-000000000001', true);
select extensions.is((select count(*)::int from public.coach_list_my_requests()), 2,
  'while active, Coach Gone sees both requests');
select extensions.is((select count(*)::int from public.coach_list_my_slots()), 3,
  'and all three times');

-- ---------------------------------------------------------------------------
-- The club removes Coach Gone (the account link is kept)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'e9000000-0000-4000-8000-000000000003', true);
select public.admin_remove_club_coach(current_setting('test.gone')::uuid);
set local role postgres;
select extensions.ok(
  (select not is_active and account_user_id = 'e9000000-0000-4000-8000-000000000001'
   from public.club_coaches where id = current_setting('test.gone')::uuid),
  'a removed coach keeps the account link but is no longer active');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'e9000000-0000-4000-8000-000000000001', true);
select extensions.is((select count(*)::int from public.coach_list_my_requests()), 0,
  'a removed coach sees no requests, so no player names or emails');
select extensions.is((select count(*)::int from public.coach_list_my_slots()), 0,
  'and no times');
select extensions.throws_ok(
  $$select public.coach_respond_to_booking_request(current_setting('test.r1')::uuid, true)$$,
  'P0002', 'Coaching request not found', 'a removed coach cannot accept a waiting request');
select extensions.throws_ok(
  $$select public.coach_send_request_message(current_setting('test.r2')::uuid, 'Still on?')$$,
  'P0002', 'Coaching request not found', 'nor message a player');
select extensions.throws_ok(
  $$select * from public.coach_list_request_messages(current_setting('test.r1')::uuid)$$,
  'P0002', 'Coaching request not found', 'nor read the conversation');
select extensions.throws_ok(
  $$select public.coach_set_booking_slot_open(current_setting('test.ga3')::uuid, false)$$,
  'P0002', 'Coach slot not found', 'nor open or close a time');
select extensions.throws_ok(
  $$select public.coach_upsert_booking_slot(null, current_setting('test.gone')::uuid,
      date_trunc('hour', now()) + interval '4 days', date_trunc('hour', now()) + interval '4 days 1 hour',
      'private', 'per_session', 500, 1)$$,
  '42501', 'This coach profile is not available to your account', 'nor publish a new time');
select extensions.throws_ok(
  $$select public.coach_set_booking_policy(current_setting('test.gone')::uuid, 'New rules')$$,
  'P0002', 'Coach profile not found', 'nor change the booking policy');
set local role postgres;
select extensions.ok(
  (select status = 'requested' from public.coach_booking_requests where id = current_setting('test.r1')::uuid)
  and (select count(*) from public.notifications
       where user_id = 'e9000000-0000-4000-8000-000000000002' and title = 'Lesson request accepted') = 1,
  'the waiting request is still waiting, and the player got no "accepted" notice for it');

-- The player's side keeps working.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e9000000-0000-4000-8000-000000000002', true);
select extensions.is((select count(*)::int from public.coach_list_request_messages(current_setting('test.r1')::uuid)), 2,
  'the player still reads the conversation');
select extensions.lives_ok(
  $$select public.coach_send_request_message(current_setting('test.r1')::uuid, 'Is this lesson still on?')$$,
  'and can still write in it');
select extensions.is((public.member_cancel_coach_request(current_setting('test.r1')::uuid)).status, 'cancelled',
  'and can still cancel the request');

-- ---------------------------------------------------------------------------
-- A coach whose club is suspended
-- ---------------------------------------------------------------------------
set local role postgres;
update public.clubs set is_active = false where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
update public.club_accounts set status = 'suspended' where club_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e9000000-0000-4000-8000-000000000004', true);
select extensions.is((select count(*)::int from public.coach_list_my_requests()), 0,
  'a coach at a suspended club sees no requests');
select extensions.throws_ok(
  $$select public.coach_respond_to_booking_request(current_setting('test.rb')::uuid, true)$$,
  'P0002', 'Coaching request not found', 'and cannot accept one');
select extensions.throws_ok(
  $$select public.coach_upsert_booking_slot(null, 'e9100000-0000-4000-8000-000000000004',
      date_trunc('hour', now()) + interval '5 days', date_trunc('hour', now()) + interval '5 days 1 hour',
      'private', 'per_session', 500, 1)$$,
  '42501', 'This coach profile is not available to your account', 'or publish a time');
set local role postgres;
update public.clubs set is_active = true where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
update public.club_accounts set status = 'active' where club_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
set local role authenticated;
select extensions.is((select count(*)::int from public.coach_list_my_requests()), 1,
  'once the club is active again, the coach sees the request again');

-- ---------------------------------------------------------------------------
-- An active coach: player names but no emails, and conversations close with the request
-- ---------------------------------------------------------------------------
-- Owner decision (2026-11-28): coaches talk to players in the request's conversation, so
-- player_email is always null; the column stays only for the API shape.
select set_config('request.jwt.claim.sub', 'e9000000-0000-4000-8000-000000000006', true);
select extensions.ok(
  (select count(*) = 2 and bool_and(player_email is null) and bool_and(player_name = 'Coach Check User 2')
   from public.coach_list_my_requests()),
  'an active coach sees the player''s name on each request, but never their email');
select extensions.is((public.coach_respond_to_booking_request(current_setting('test.r3')::uuid, false)).status,
  'declined', 'the coach declines one request');
select extensions.throws_ok(
  $$select public.coach_send_request_message(current_setting('test.r3')::uuid, 'Sorry about that')$$,
  '55000', 'This lesson request is closed, so no new messages can be sent.',
  'no new messages on a declined request, from the coach');
select set_config('request.jwt.claim.sub', 'e9000000-0000-4000-8000-000000000002', true);
select extensions.throws_ok(
  $$select public.coach_send_request_message(current_setting('test.r3')::uuid, 'Why?')$$,
  '55000', 'This lesson request is closed, so no new messages can be sent.',
  'or from the player');
select extensions.throws_ok(
  $$select public.coach_send_request_message(current_setting('test.r1')::uuid, 'Hello again')$$,
  '55000', 'This lesson request is closed, so no new messages can be sent.',
  'a cancelled request is closed too');
set local role postgres;
select extensions.is(
  (select count(*)::int from public.notifications
   where user_id = 'e9000000-0000-4000-8000-000000000002' and title = 'New coaching message'),
  1, 'refused messages create no notices (only the coach''s one message while active did)');

-- ---------------------------------------------------------------------------
-- A conversation holds at most 200 messages
-- ---------------------------------------------------------------------------
insert into public.coach_request_messages (request_id, sender_user_id, body, created_at)
select current_setting('test.r4')::uuid, 'e9000000-0000-4000-8000-000000000002', 'm' || n,
       now() - interval '1 day' + make_interval(mins => n)
from generate_series(1, 199) n;
set local role authenticated;
select extensions.lives_ok(
  $$select public.coach_send_request_message(current_setting('test.r4')::uuid, 'Message 200')$$,
  'the 200th message is sent');
select set_config('request.jwt.claim.sub', 'e9000000-0000-4000-8000-000000000006', true);
select extensions.throws_ok(
  $$select public.coach_send_request_message(current_setting('test.r4')::uuid, 'One more')$$,
  '55000', 'This conversation has reached the limit of 200 messages.', 'the 201st is refused');
select set_config('request.jwt.claim.sub', 'e9000000-0000-4000-8000-000000000002', true);
select extensions.throws_ok(
  $$select public.coach_send_request_message(current_setting('test.r4')::uuid, 'And another')$$,
  '55000', 'This conversation has reached the limit of 200 messages.', 'for either side');
select extensions.is(
  (select count(*)::int from public.coach_list_request_messages(current_setting('test.r4')::uuid)), 200,
  'all 200 messages are listed');

-- The list shows the latest 200, oldest first.
set local role postgres;
insert into public.coach_request_messages (request_id, sender_user_id, body, created_at)
select current_setting('test.r2')::uuid, 'e9000000-0000-4000-8000-000000000002', 'old' || n,
       now() - interval '2 days' + make_interval(mins => n)
from generate_series(1, 250) n;
set local role authenticated;
select extensions.is(
  (select count(*)::int from public.coach_list_request_messages(current_setting('test.r2')::uuid)), 200,
  'a longer conversation lists only its latest 200 messages');
select extensions.is(
  (select array_agg(body order by ordinality)
   from (select body, ordinality from public.coach_list_request_messages(current_setting('test.r2')::uuid)
         with ordinality) x
   where ordinality in (1, 200)),
  array['old51', 'old250'], 'from the 51st to the 250th, oldest first');

-- Unchanged: nobody else reaches a conversation.
select set_config('request.jwt.claim.sub', 'e9000000-0000-4000-8000-000000000005', true);
select extensions.throws_ok(
  $$select * from public.coach_list_request_messages(current_setting('test.r4')::uuid)$$,
  'P0002', 'Coaching request not found', 'another player cannot read the conversation');
select extensions.throws_ok(
  $$select public.coach_send_request_message(current_setting('test.r4')::uuid, 'Hi')$$,
  'P0002', 'Coaching request not found', 'or write in it');

select * from extensions.finish();
rollback;
