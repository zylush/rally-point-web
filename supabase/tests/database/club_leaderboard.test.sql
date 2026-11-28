begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select extensions.plan(37);

-- Fixture:
--   user 1: Gensan player 1 (and Club B member)
--   user 2: Gensan staff (starts without scoring access; granted then revoked)
--   user 3: Gensan admin
--   user 4: Club B admin only
--   user 5: Gensan player 2
--   user 6: Gensan player 3
--   user 7: Gensan player 4
insert into auth.users (id, email, raw_user_meta_data)
select ('1b000000-0000-4000-8000-00000000000' || n)::uuid, 'lb-' || n || '@fixture.invalid',
       jsonb_build_object('full_name', 'Leaderboard User ' || n)
from generate_series(1, 7) n;

insert into public.members (club_id, user_id, member_code, full_name, membership_type, status, join_date, expiry_date)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '1b000000-0000-4000-8000-000000000001', 'LB-B1', 'Leaderboard User 1',
        'standard', 'active', current_date, current_date + 30);

insert into public.club_staff_roles (club_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '1b000000-0000-4000-8000-000000000002', 'staff'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '1b000000-0000-4000-8000-000000000003', 'admin'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '1b000000-0000-4000-8000-000000000004', 'admin');

insert into public.members (club_id, user_id, member_code, full_name, membership_type, status, join_date, expiry_date)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '1b000000-0000-4000-8000-000000000004', 'LB-B4', 'Leaderboard User 4',
        'standard', 'active', current_date, current_date + 30);

update public.club_accounts set status = 'active'
where club_id in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

select set_config('test.m1', (select id::text from public.members where club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id = '1b000000-0000-4000-8000-000000000001'), true);
select set_config('test.m5', (select id::text from public.members where club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id = '1b000000-0000-4000-8000-000000000005'), true);
select set_config('test.m6', (select id::text from public.members where club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id = '1b000000-0000-4000-8000-000000000006'), true);
select set_config('test.m7', (select id::text from public.members where club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id = '1b000000-0000-4000-8000-000000000007'), true);
select set_config('test.mb1', (select id::text from public.members where club_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and user_id = '1b000000-0000-4000-8000-000000000001'), true);
select set_config('test.mb4', (select id::text from public.members where club_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and user_id = '1b000000-0000-4000-8000-000000000004'), true);

-- ---------------------------------------------------------------------------
-- 1-5: Structure, RLS, privileges, and FK indexes
-- ---------------------------------------------------------------------------
select extensions.ok(
  (select bool_and(relrowsecurity) from pg_class
   where oid in ('public.club_leaderboard_scorers'::regclass, 'public.club_matches'::regclass, 'public.club_match_players'::regclass))
  and not has_table_privilege('anon', 'public.club_matches', 'SELECT, INSERT, UPDATE, DELETE')
  and not has_table_privilege('authenticated', 'public.club_matches', 'SELECT, INSERT, UPDATE, DELETE'),
  'leaderboard tables have RLS enabled and no direct API access');

select extensions.is(
  (select count(*)::int from pg_policies
   where schemaname = 'public'
     and tablename in ('club_leaderboard_scorers', 'club_matches', 'club_match_players')
     and policyname = 'no_direct_api_access' and permissive = 'RESTRICTIVE' and qual = 'false'),
  3, 'all three leaderboard tables have restrictive deny-all API policies');

select extensions.ok(
  (select count(*) = 11 and bool_and(p.prosecdef and 'search_path=""' = any(p.proconfig))
   from unnest(array[
     'private.can_score_club_matches(uuid)',
     'private.require_club_scorer()',
     'private.club_match_json(uuid)',
     'private.club_leaderboard_payload(uuid, text, text, integer, boolean, uuid)',
     'public.get_public_club_leaderboard(text, text, text, integer)',
     'public.get_public_player_matches(text, uuid, integer)',
     'public.get_club_leaderboard(text, text, integer)',
     'public.staff_record_club_match(text, uuid[], uuid[], text, integer, integer, uuid, uuid, text)',
     'public.staff_void_club_match(uuid, text)',
     'public.admin_list_leaderboard_scorers()',
     'public.admin_set_leaderboard_scorer(uuid, boolean)'
   ]) f
   join pg_proc p on p.oid = to_regprocedure(f)::oid),
  'all leaderboard functions are security definer with empty search_path');

select extensions.ok(
  has_function_privilege('anon', 'public.get_public_club_leaderboard(text, text, text, integer)', 'EXECUTE')
  and has_function_privilege('anon', 'public.get_public_player_matches(text, uuid, integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_club_leaderboard(text, text, integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.staff_record_club_match(text, uuid[], uuid[], text, integer, integer, uuid, uuid, text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.get_club_leaderboard(text, text, integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.require_club_scorer()', 'EXECUTE'),
  'function execute grants separate public, signed-in, and private routines');

select extensions.is(
  (select count(*)::int from pg_constraint c
   where c.conrelid in ('public.club_leaderboard_scorers'::regclass, 'public.club_matches'::regclass, 'public.club_match_players'::regclass)
     and c.contype = 'f'
     and not exists (
       select 1 from pg_index i
       where i.indrelid = c.conrelid and i.indpred is null
         and (i.indkey::int2[])[0:cardinality(c.conkey) - 1] = c.conkey::int2[])),
  0, 'every leaderboard foreign key has a covering index in matching column order');

-- ---------------------------------------------------------------------------
-- 6-11: Anonymous caller checks
-- ---------------------------------------------------------------------------
select set_config('request.headers', '', true);
set local role anon;
select set_config('request.jwt.claim.sub', '', true);

select extensions.throws_ok($$select count(*) from public.club_matches$$, '42501', null, 'anon cannot query club_matches');
select extensions.throws_ok($$select public.get_club_leaderboard('month', 'all', 50)$$, '42501', null, 'anon cannot call get_club_leaderboard');
select extensions.throws_ok(
  $$select public.staff_record_club_match('singles', array[current_setting('test.m1')::uuid], array[current_setting('test.m5')::uuid], 'a')$$,
  '42501', null, 'anon cannot record a match');
select extensions.throws_ok($$select public.admin_list_leaderboard_scorers()$$, '42501', null, 'anon cannot list scorers');
select extensions.is(
  public.get_public_club_leaderboard('no-such-club-slug', 'month', 'all', 50),
  null, 'unknown club slug returns null from public leaderboard');
select extensions.is(
  public.get_public_player_matches('no-such-club-slug', current_setting('test.m1')::uuid, 10),
  null, 'unknown club slug returns null from public player matches');

-- ---------------------------------------------------------------------------
-- 12-16: Member and non-designated staff cannot write
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '1b000000-0000-4000-8000-000000000001', true);

select extensions.throws_ok(
  $$select public.staff_record_club_match('singles', array[current_setting('test.m1')::uuid], array[current_setting('test.m5')::uuid], 'a')$$,
  '42501', null, 'member cannot record a match');
select extensions.throws_ok(
  $$select public.admin_list_leaderboard_scorers()$$,
  '42501', null, 'member cannot list scorers');

select set_config('request.jwt.claim.sub', '1b000000-0000-4000-8000-000000000002', true);
select extensions.is(
  (public.get_club_leaderboard('month', 'all', 50) ->> 'can_score')::boolean,
  false, 'non-designated staff sees can_score = false');
select extensions.throws_ok(
  $$select public.staff_record_club_match('singles', array[current_setting('test.m1')::uuid], array[current_setting('test.m5')::uuid], 'a')$$,
  '42501', null, 'non-designated staff cannot record a match');

-- Foreign club admin naming Gensan via x-club-id cannot list/set scorers or record matches
select set_config('request.jwt.claim.sub', '1b000000-0000-4000-8000-000000000004', true);
select extensions.throws_ok(
  $$select public.admin_list_leaderboard_scorers()$$,
  '42501', null, 'foreign club admin cannot manage Gensan scorers');

-- ---------------------------------------------------------------------------
-- 17-24: Admin assigns scorer and validates match inputs
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '1b000000-0000-4000-8000-000000000003', true);
select extensions.throws_ok(
  $$select public.admin_set_leaderboard_scorer('1b000000-0000-4000-8000-000000000001', true)$$,
  'P0002', null, 'cannot designate a non-staff player as scorer');

select extensions.lives_ok(
  $$select public.admin_set_leaderboard_scorer('1b000000-0000-4000-8000-000000000002', true)$$,
  'admin grants scoring access to club staff');

select extensions.is(
  (select (x ->> 'can_score')::boolean
   from jsonb_array_elements(public.admin_list_leaderboard_scorers()) x
   where x ->> 'user_id' = '1b000000-0000-4000-8000-000000000002'),
  true, 'admin_list_leaderboard_scorers reflects newly designated staff');

select extensions.throws_ok(
  $$select public.staff_record_club_match('singles', array[current_setting('test.m1')::uuid], array[current_setting('test.m1')::uuid], 'a')$$,
  '22023', null, 'rejects duplicate player across teams');

select extensions.throws_ok(
  $$select public.staff_record_club_match('singles', array[current_setting('test.m1')::uuid], array[current_setting('test.m5')::uuid], 'a', 8, 11)$$,
  '22023', null, 'rejects score where losing side outscores winner');

select extensions.throws_ok(
  $$select public.staff_record_club_match('singles', array[current_setting('test.m1')::uuid], array[current_setting('test.mb1')::uuid], 'a')$$,
  '22023', null, 'rejects player from another club');

select extensions.lives_ok(
  $$select set_config('test.match_1',
    public.staff_record_club_match(
      'doubles',
      array[current_setting('test.m1')::uuid, current_setting('test.m5')::uuid],
      array[current_setting('test.m6')::uuid, current_setting('test.m7')::uuid],
      'a', 11, 7, null, null, 'Courtly style opener'
    ) ->> 'id', true)$$,
  'admin records a scored doubles match');

-- ---------------------------------------------------------------------------
-- 25-30: Designated staff scores matches, public & member standings update
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '1b000000-0000-4000-8000-000000000002', true);
select extensions.is(
  (public.get_club_leaderboard('month', 'all', 50) ->> 'can_score')::boolean,
  true, 'designated staff sees can_score = true');

select extensions.lives_ok(
  $$select set_config('test.match_2',
    public.staff_record_club_match(
      'singles',
      array[current_setting('test.m1')::uuid],
      array[current_setting('test.m6')::uuid],
      'a', null, null, null, null, null
    ) ->> 'id', true)$$,
  'designated staff records a 1-tap singles win without numeric scores');

-- m1 has 2 wins (6 pts, streak +2, diff +4); m5 has 1 win (3 pts, streak +1); m6 has 2 losses (2 pts, streak -2); m7 has 1 loss (1 pt, streak -1)
select extensions.is(
  (select jsonb_agg((e ->> 'member_id') || ':' || (e ->> 'points') || ':' || (e ->> 'wins') || '-' || (e ->> 'losses') || ':' || (e ->> 'streak') order by (e ->> 'rank')::int)
   from jsonb_array_elements(public.get_public_club_leaderboard('rally-point-gensan', 'month', 'all', 50) -> 'entries') e
   where (e ->> 'member_id') in (current_setting('test.m1'), current_setting('test.m5'), current_setting('test.m6'), current_setting('test.m7'))),
  jsonb_build_array(
    current_setting('test.m1') || ':6:2-0:2',
    current_setting('test.m5') || ':3:1-0:1',
    current_setting('test.m6') || ':2:0-2:-2',
    current_setting('test.m7') || ':1:0-1:-1'
  ),
  'public leaderboard derives exact points, W-L, and streak ordering');

select extensions.ok(
  not exists (
    select 1
    from jsonb_array_elements(public.get_public_club_leaderboard('rally-point-gensan', 'month', 'all', 50) -> 'entries') e
    where e ?| array['email', 'phone', 'member_code', 'qr_token', 'user_id', 'notes']
  ),
  'public leaderboard exposes zero private contact, token, or billing keys');

select extensions.is(
  jsonb_array_length(public.get_public_player_matches('rally-point-gensan', current_setting('test.m1')::uuid, 15)),
  2, 'public player matches returns completed matches for the player');

select extensions.is(
  jsonb_array_length(public.get_public_player_matches('rally-point-gensan', current_setting('test.mb1')::uuid, 15)),
  0, 'public player matches never exposes another club''s member');

-- Member 1 sees own standing highlight
select set_config('request.jwt.claim.sub', '1b000000-0000-4000-8000-000000000001', true);
select extensions.is(
  (public.get_club_leaderboard('month', 'all', 50) -> 'my_entry' ->> 'points')::int,
  6, 'signed-in player sees their derived standing in my_entry');

-- ---------------------------------------------------------------------------
-- 31-35: Voiding a match recalculates standings; revoking scorer blocks writes
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '1b000000-0000-4000-8000-000000000002', true);
select extensions.lives_ok(
  $$select public.staff_void_club_match(current_setting('test.match_2')::uuid, 'Wrong winner tapped')$$,
  'designated staff voids mistaken match');

select extensions.is(
  (select (e ->> 'points')::int
   from jsonb_array_elements(public.get_public_club_leaderboard('rally-point-gensan', 'month', 'all', 50) -> 'entries') e
   where e ->> 'member_id' = current_setting('test.m1')),
  3, 'voiding match immediately recalculates player points back to 3');

select extensions.is(
  (select m ->> 'status'
   from jsonb_array_elements(public.get_club_leaderboard('month', 'all', 50) -> 'recent_matches') m
   where m ->> 'id' = current_setting('test.match_2')),
  'voided', 'staff audit list retains voided match with status voided');

select set_config('request.jwt.claim.sub', '1b000000-0000-4000-8000-000000000003', true);
select extensions.lives_ok(
  $$select public.admin_set_leaderboard_scorer('1b000000-0000-4000-8000-000000000002', false)$$,
  'admin revokes staff scoring permission');

select set_config('request.jwt.claim.sub', '1b000000-0000-4000-8000-000000000002', true);
select extensions.throws_ok(
  $$select public.staff_record_club_match('singles', array[current_setting('test.m1')::uuid], array[current_setting('test.m5')::uuid], 'a')$$,
  '42501', null, 'revoked staff can no longer record matches');

-- ---------------------------------------------------------------------------
-- 36-37: Two-club isolation
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '1b000000-0000-4000-8000-000000000004', true);
select set_config('request.headers', '{"x-club-id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}', true);

select extensions.lives_ok(
  $$select public.staff_record_club_match(
    'singles',
    array[current_setting('test.mb1')::uuid],
    array[current_setting('test.mb4')::uuid],
    'a', 11, 9, null, null, null
  )$$,
  'Club B admin records a match inside Club B');

select extensions.is(
  (public.get_club_leaderboard('month', 'all', 50) ->> 'total_matches')::int,
  1, 'Club B leaderboard contains only Club B matches');

select * from extensions.finish();
rollback;
