begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select extensions.plan(33);

-- Fixture: user 1 is a Gensan admin, user 2 a Gensan member with no staff role.
-- Players are club members without accounts.
insert into auth.users (id, email, raw_user_meta_data)
select ('4e000000-0000-4000-8000-00000000000' || n)::uuid, 'rf-' || n || '@fixture.invalid',
       jsonb_build_object('full_name', 'Review Fix User ' || n)
from generate_series(1, 2) n;

insert into public.club_staff_roles (club_id, user_id, role)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '4e000000-0000-4000-8000-000000000001', 'admin');
update public.club_accounts set status = 'active' where club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

insert into public.members (club_id, member_code, full_name, status, membership_type)
select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'RF-' || lpad(n::text, 3, '0'), 'Review Player ' || n, 'active', null
from generate_series(1, 70) n;

create temporary table fixture_players on commit drop as
select row_number() over (order by member_code) as n, id
from public.members
where club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and member_code like 'RF-%';
grant select on fixture_players to authenticated;

select set_config('test.court_a', (select id::text from public.courts where club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and name = 'Court A'), true);
select set_config('test.court_b', (select id::text from public.courts where club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and name = 'Court B'), true);
select set_config('test.court_c', (select id::text from public.courts where club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and name = 'Court C'), true);

-- ---------------------------------------------------------------------------
-- 1-3: privileges and triggers
-- ---------------------------------------------------------------------------
select extensions.ok(
  has_function_privilege('authenticated', 'public.staff_void_tournament_match(uuid, uuid, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.staff_void_tournament_match(uuid, uuid, text)', 'EXECUTE')
  and not has_function_privilege('public', 'public.staff_void_tournament_match(uuid, uuid, text)', 'EXECUTE'),
  'undoing a tournament result needs a signed-in caller');

select extensions.ok(
  (select bool_and(p.prosecdef and 'search_path=""' = any(p.proconfig) and pg_get_userbyid(p.proowner) = 'postgres')
   from pg_proc p
   where p.oid in ('public.staff_void_tournament_match(uuid, uuid, text)'::regprocedure,
                   'private.enforce_tournament_limits()'::regprocedure,
                   'private.check_tournament_match_court()'::regprocedure))
  and not has_function_privilege('authenticated', 'private.enforce_tournament_limits()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.check_tournament_match_court()', 'EXECUTE'),
  'new functions are definer functions with an empty search path; trigger helpers stay private');

select extensions.is(
  (select array_agg(t.tgname::text order by t.tgname) from pg_trigger t
   where t.tgrelid in ('public.club_tournament_players'::regclass, 'public.club_tournament_matches'::regclass)
     and not t.tgisinternal),
  array['club_tournament_matches_court_check', 'club_tournament_matches_limit', 'club_tournament_players_limit'],
  'the limit and court triggers are in place');

-- ---------------------------------------------------------------------------
-- 4-13: undo results in a bracket that does not count for the leaderboard
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '4e000000-0000-4000-8000-000000000001', true);

select extensions.lives_ok(
  $$select set_config('test.b',
    public.admin_create_tournament('Practice Bracket', 'single_elimination', 1, null, false, null, null,
      (select array_agg(id order by n) from fixture_players where n <= 4)) -> 'tournament' ->> 'id', true)$$,
  'admin creates a 4-player bracket that does not count for the leaderboard');

select extensions.lives_ok(
  $$select public.admin_generate_tournament_draw(current_setting('test.b')::uuid),
           public.admin_start_tournament(current_setting('test.b')::uuid)$$,
  'admin draws and starts it');

set local role postgres;
select set_config('test.r1a', (select id::text from public.club_tournament_matches
  where tournament_id = current_setting('test.b')::uuid and round_number = 1 and match_order = 1), true);
select set_config('test.r1b', (select id::text from public.club_tournament_matches
  where tournament_id = current_setting('test.b')::uuid and round_number = 1 and match_order = 2), true);
select set_config('test.final', (select id::text from public.club_tournament_matches
  where tournament_id = current_setting('test.b')::uuid and round_number = 2), true);
set local role authenticated;

select extensions.throws_ok(
  $$select public.staff_void_tournament_match(current_setting('test.b')::uuid, current_setting('test.r1a')::uuid)$$,
  '22023', 'Only a finished match can be undone', 'a match that has not been played cannot be undone');

select extensions.lives_ok(
  $$select public.staff_score_tournament_match(current_setting('test.b')::uuid, current_setting('test.r1a')::uuid, 'a', 11, 5)$$,
  'admin scores the first semifinal');

select extensions.lives_ok(
  $$select public.staff_void_tournament_match(current_setting('test.b')::uuid, current_setting('test.r1a')::uuid, 'Wrong winner')$$,
  'admin undoes a result in a tournament that does not count for the leaderboard');

set local role postgres;
select extensions.ok(
  (select m.status = 'ready' and m.winner_side is null and m.score_a is null and m.club_match_id is null
   from public.club_tournament_matches m where m.id = current_setting('test.r1a')::uuid)
  and (select cardinality(case m.next_match_side when 'a' then f.team_a_player_ids else f.team_b_player_ids end) = 0
         and f.status = 'pending'
       from public.club_tournament_matches m
       join public.club_tournament_matches f on f.id = m.next_match_id
       where m.id = current_setting('test.r1a')::uuid),
  'the match is ready again and the winner is taken out of the final');
set local role authenticated;

select extensions.lives_ok(
  $$select public.staff_score_tournament_match(current_setting('test.b')::uuid, current_setting('test.r1a')::uuid, 'b', 9, 11),
           public.staff_score_tournament_match(current_setting('test.b')::uuid, current_setting('test.r1b')::uuid, 'a', 11, 3)$$,
  'both semifinals are scored');

select extensions.lives_ok(
  $$select public.staff_score_tournament_match(current_setting('test.b')::uuid, current_setting('test.final')::uuid, 'a', 11, 8)$$,
  'the final is scored and the bracket finishes');

select extensions.throws_ok(
  $$select public.staff_void_tournament_match(current_setting('test.b')::uuid, current_setting('test.r1a')::uuid)$$,
  '22023', 'Cannot void a bracket match after the next round has been played',
  'a semifinal cannot be undone once the final is played');

select extensions.lives_ok(
  $$select public.staff_void_tournament_match(current_setting('test.b')::uuid, current_setting('test.final')::uuid)$$,
  'the final can be undone');

select extensions.is(
  public.get_club_tournament(current_setting('test.b')::uuid) -> 'tournament' ->> 'status',
  'live', 'undoing the final reopens the finished bracket');

select set_config('request.jwt.claim.sub', '4e000000-0000-4000-8000-000000000002', true);
select extensions.throws_ok(
  $$select public.staff_void_tournament_match(current_setting('test.b')::uuid, current_setting('test.r1b')::uuid)$$,
  '42501', null, 'a member without a scoring role cannot undo results');
select set_config('request.jwt.claim.sub', '4e000000-0000-4000-8000-000000000001', true);

-- ---------------------------------------------------------------------------
-- 14-15: a tournament that counts hands over to the leaderboard void
-- ---------------------------------------------------------------------------
select extensions.lives_ok(
  $$select set_config('test.c',
      public.admin_create_tournament('Club Final', 'single_elimination', 1, null, true, null, null,
        (select array_agg(id order by n) from fixture_players where n in (5, 6))) -> 'tournament' ->> 'id', true),
    public.admin_generate_tournament_draw(current_setting('test.c', true)::uuid)$$,
  'admin creates a 2-player bracket that counts for the leaderboard');

set local role postgres;
select set_config('test.c_final', (select id::text from public.club_tournament_matches
  where tournament_id = current_setting('test.c')::uuid), true);
set local role authenticated;
select public.admin_start_tournament(current_setting('test.c')::uuid);
select public.staff_score_tournament_match(current_setting('test.c')::uuid, current_setting('test.c_final')::uuid, 'a', 11, 2);
select public.staff_void_tournament_match(current_setting('test.c')::uuid, current_setting('test.c_final')::uuid, 'Recount');

set local role postgres;
select extensions.ok(
  (select cm.status = 'voided' and cm.void_reason = 'Recount'
   from public.club_matches cm
   where cm.tournament_id = current_setting('test.c')::uuid)
  and (select m.status = 'ready' and m.club_match_id is null
       from public.club_tournament_matches m where m.id = current_setting('test.c_final')::uuid),
  'a counted result is voided on the leaderboard too, with its reason');
select extensions.is(
  (select status from public.club_tournaments where id = current_setting('test.c')::uuid),
  'live', 'and the counted bracket reopens');
set local role authenticated;

-- ---------------------------------------------------------------------------
-- 16-21: courts
-- ---------------------------------------------------------------------------
select set_config('test.d',
  public.admin_create_tournament('Court Check', 'single_elimination', 1, null, false, null, null,
    (select array_agg(id order by n) from fixture_players where n between 7 and 10)) -> 'tournament' ->> 'id', true);
select public.admin_generate_tournament_draw(current_setting('test.d')::uuid);
select public.admin_start_tournament(current_setting('test.d')::uuid);

set local role postgres;
update public.courts set status = 'maintenance' where id = current_setting('test.court_c')::uuid;
select set_config('test.d1', (select id::text from public.club_tournament_matches
  where tournament_id = current_setting('test.d')::uuid and round_number = 1 and match_order = 1), true);
select set_config('test.d2', (select id::text from public.club_tournament_matches
  where tournament_id = current_setting('test.d')::uuid and round_number = 1 and match_order = 2), true);
select set_config('test.dfinal', (select id::text from public.club_tournament_matches
  where tournament_id = current_setting('test.d')::uuid and round_number = 2), true);
-- Free the courts in this club so the checks start from a clean state.
update public.club_tournament_matches set court_id = null
where club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and court_id is not null;
set local role authenticated;

select extensions.throws_ok(
  $$select public.staff_assign_tournament_match_court(current_setting('test.d')::uuid, current_setting('test.d1')::uuid, current_setting('test.court_c')::uuid)$$,
  '22023', 'That court is out of service', 'a court under maintenance cannot be assigned');

select extensions.lives_ok(
  $$select public.staff_assign_tournament_match_court(current_setting('test.d')::uuid, current_setting('test.d1')::uuid, current_setting('test.court_a')::uuid)$$,
  'a free court can be assigned');

select extensions.throws_ok(
  $$select public.staff_assign_tournament_match_court(current_setting('test.d')::uuid, current_setting('test.d2')::uuid, current_setting('test.court_a')::uuid)$$,
  '22023', 'That court already has a match on it', 'two ready matches cannot share a court');

select extensions.lives_ok(
  $$select public.staff_assign_tournament_match_court(current_setting('test.d')::uuid, current_setting('test.dfinal')::uuid, current_setting('test.court_a')::uuid)$$,
  'a waiting match can be lined up on a busy court');

select extensions.lives_ok(
  $$select public.staff_assign_tournament_match_court(current_setting('test.d')::uuid, current_setting('test.d2')::uuid, current_setting('test.court_b')::uuid)$$,
  'the second match takes another free court');

select extensions.lives_ok(
  $$select public.staff_score_tournament_match(current_setting('test.d')::uuid, current_setting('test.d1')::uuid, 'a', 11, 4)$$,
  'scoring a match on its court still works');

-- The automatic queue court picker skips courts used by other tournaments.
select public.staff_assign_tournament_match_court(current_setting('test.d')::uuid, current_setting('test.d2')::uuid, current_setting('test.court_a')::uuid);
select set_config('test.q2',
  public.admin_create_tournament('Second Mixer', 'random_queue', 2, null, false, null, null,
    (select array_agg(id order by n) from fixture_players where n between 11 and 14)) -> 'tournament' ->> 'id', true);
select extensions.is(
  (select m ->> 'court_id' from jsonb_array_elements(public.admin_start_tournament(current_setting('test.q2')::uuid) -> 'matches') m
   where m ->> 'status' = 'ready'),
  current_setting('test.court_b'),
  'a queue draw skips a court another tournament is playing on');

-- A winner advancing into a match lined up on a court that is now busy: scoring works, the court is cleared.
select extensions.lives_ok(
  $$select public.staff_assign_tournament_match_court(current_setting('test.d')::uuid, current_setting('test.dfinal')::uuid, current_setting('test.court_b')::uuid)$$,
  'the final is lined up on the court the other tournament is now using');
select extensions.lives_ok(
  $$select public.staff_score_tournament_match(current_setting('test.d')::uuid, current_setting('test.d2')::uuid, 'b', 7, 11)$$,
  'scoring the last semifinal still works');
set local role postgres;
select extensions.ok(
  (select m.status = 'ready' and m.court_id is null
   from public.club_tournament_matches m where m.id = current_setting('test.dfinal')::uuid),
  'the final is ready, and its busy court was cleared for staff to choose again');
set local role authenticated;

-- ---------------------------------------------------------------------------
-- 22-26: size limits
-- ---------------------------------------------------------------------------
select extensions.throws_ok(
  $$select public.admin_create_tournament('Too Big', 'random_queue', 2, null, false, null, null,
      (select array_agg(id order by n) from fixture_players where n <= 65))$$,
  '22023', 'A tournament can have at most 64 players', 'a tournament cannot have more than 64 players');

select extensions.lives_ok(
  $$select set_config('test.q',
      public.admin_create_tournament('Big Mixer', 'random_queue', 2, null, false, null, null,
        (select array_agg(id order by n) from fixture_players where n <= 64)) -> 'tournament' ->> 'id', true)$$,
  '64 players are allowed');

select extensions.throws_ok(
  $$select public.admin_set_tournament_players(current_setting('test.q')::uuid,
      (select array_agg(id order by n) from fixture_players where n <= 66))$$,
  '22023', 'A tournament can have at most 64 players', 'the roster cannot be raised past 64 later');

set local role postgres;
select extensions.lives_ok(
  $$insert into public.club_tournament_matches (club_id, tournament_id, round_number, match_order, status)
    select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', current_setting('test.q')::uuid, 1, n, 'voided'
    from generate_series(1, 300) n$$,
  '300 matches are allowed');

select extensions.throws_ok(
  $$insert into public.club_tournament_matches (club_id, tournament_id, round_number, match_order, status)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', current_setting('test.q')::uuid, 1, 301, 'voided')$$,
  '22023', 'This tournament has reached its limit of 300 matches', 'match 301 is refused');

select * from extensions.finish();
rollback;
