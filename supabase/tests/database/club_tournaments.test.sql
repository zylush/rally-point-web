begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select extensions.plan(39);

-- Fixture:
--   user 1: Gensan player 1 (and Club B member)
--   user 2: Gensan staff (starts without scoring access; granted per-tournament then revoked)
--   user 3: Gensan admin
--   user 4: Club B admin only
--   users 5..9: Gensan players 2..6
insert into auth.users (id, email, raw_user_meta_data)
select ('2c000000-0000-4000-8000-00000000000' || n)::uuid, 'tr-' || n || '@fixture.invalid',
       jsonb_build_object('full_name', 'Tournament User ' || n)
from generate_series(1, 9) n;

insert into public.members (club_id, user_id, member_code, full_name, membership_type, status, join_date, expiry_date)
values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '2c000000-0000-4000-8000-000000000001', 'TR-B1', 'Tournament User 1',
   'standard', 'active', current_date, current_date + 30),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '2c000000-0000-4000-8000-000000000004', 'TR-B4', 'Tournament User 4',
   'standard', 'active', current_date, current_date + 30);

insert into public.club_staff_roles (club_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2c000000-0000-4000-8000-000000000002', 'staff'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2c000000-0000-4000-8000-000000000003', 'admin'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '2c000000-0000-4000-8000-000000000004', 'admin');

update public.club_accounts set status = 'active'
where club_id in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

select set_config('test.m1', (select id::text from public.members where club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id = '2c000000-0000-4000-8000-000000000001'), true);
select set_config('test.m5', (select id::text from public.members where club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id = '2c000000-0000-4000-8000-000000000005'), true);
select set_config('test.m6', (select id::text from public.members where club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id = '2c000000-0000-4000-8000-000000000006'), true);
select set_config('test.m7', (select id::text from public.members where club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id = '2c000000-0000-4000-8000-000000000007'), true);
select set_config('test.m8', (select id::text from public.members where club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id = '2c000000-0000-4000-8000-000000000008'), true);
select set_config('test.m9', (select id::text from public.members where club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id = '2c000000-0000-4000-8000-000000000009'), true);
select set_config('test.mb1', (select id::text from public.members where club_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and user_id = '2c000000-0000-4000-8000-000000000001'), true);
select set_config('test.mb4', (select id::text from public.members where club_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and user_id = '2c000000-0000-4000-8000-000000000004'), true);

-- ---------------------------------------------------------------------------
-- 1-5: Structure, RLS, privileges, and FK covering indexes
-- ---------------------------------------------------------------------------
select extensions.ok(
  (select bool_and(relrowsecurity) from pg_class
   where oid in (
     'public.club_tournaments'::regclass,
     'public.club_tournament_scorers'::regclass,
     'public.club_tournament_players'::regclass,
     'public.club_tournament_teams'::regclass,
     'public.club_tournament_matches'::regclass
   ))
  and not has_table_privilege('anon', 'public.club_tournaments', 'SELECT, INSERT, UPDATE, DELETE')
  and not has_table_privilege('authenticated', 'public.club_tournaments', 'SELECT, INSERT, UPDATE, DELETE'),
  'tournament tables have RLS enabled and no direct API privileges');

select extensions.is(
  (select count(*)::int from pg_policies
   where schemaname = 'public'
     and tablename in ('club_tournaments', 'club_tournament_scorers', 'club_tournament_players', 'club_tournament_teams', 'club_tournament_matches')
     and policyname = 'no_direct_api_access' and permissive = 'RESTRICTIVE' and qual = 'false'),
  5, 'all five tournament tables have restrictive deny-all API policies');

select extensions.ok(
  (select count(*) = 23 and bool_and(p.prosecdef and 'search_path=""' = any(p.proconfig))
   from unnest(array[
     'private.can_score_tournament(uuid, uuid)',
     'private.require_tournament_scorer(uuid)',
     'private.tournament_round_label(text, integer, integer, integer)',
     'private.build_tournament_bracket_draw(uuid, uuid)',
     'private.draw_next_tournament_queue_match(uuid, uuid, uuid)',
     'private.tournament_summary_json(uuid)',
     'private.tournament_detail_payload(uuid, uuid, uuid, boolean)',
     'public.list_public_club_tournaments(text, integer)',
     'public.get_public_tournament(text, uuid)',
     'public.list_club_tournaments(integer)',
     'public.get_club_tournament(uuid)',
     'public.admin_create_tournament(text, text, integer, uuid, boolean, timestamptz, text, uuid[])',
     'public.admin_set_tournament_players(uuid, uuid[])',
     'public.admin_generate_tournament_draw(uuid)',
     'public.admin_start_tournament(uuid)',
     'public.admin_set_tournament_scorer(uuid, uuid, boolean)',
     'public.admin_complete_tournament(uuid)',
     'public.admin_cancel_tournament(uuid)',
     'public.staff_draw_tournament_queue_match(uuid, uuid)',
     'public.staff_assign_tournament_match_court(uuid, uuid, uuid)',
     'public.staff_cancel_tournament_queue_match(uuid, uuid)',
     'public.staff_score_tournament_match(uuid, uuid, text, integer, integer, uuid)',
     'public.staff_void_club_match(uuid, text)'
   ]) f
   join pg_proc p on p.oid = to_regprocedure(f)::oid),
  'all tournament functions are security definer with empty search_path');

select extensions.ok(
  has_function_privilege('anon', 'public.list_public_club_tournaments(text, integer)', 'EXECUTE')
  and has_function_privilege('anon', 'public.get_public_tournament(text, uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.list_club_tournaments(integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.admin_create_tournament(text, text, integer, uuid, boolean, timestamptz, text, uuid[])', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.get_club_tournament(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.draw_next_tournament_queue_match(uuid, uuid, uuid)', 'EXECUTE'),
  'function execute grants separate public, signed-in, and private routines');

select extensions.is(
  (select count(*)::int from pg_constraint c
   where c.conrelid in (
     'public.club_tournaments'::regclass,
     'public.club_tournament_scorers'::regclass,
     'public.club_tournament_players'::regclass,
     'public.club_tournament_teams'::regclass,
     'public.club_tournament_matches'::regclass,
     'public.club_matches'::regclass
   )
     and c.contype = 'f'
     and not exists (
       select 1 from pg_index i
       where i.indrelid = c.conrelid and i.indpred is null
         and (i.indkey::int2[])[0:cardinality(c.conkey) - 1] = c.conkey::int2[])),
  0, 'every tournament foreign key has a covering index in matching column order');

-- ---------------------------------------------------------------------------
-- 6-10: Anonymous and unauthorized caller boundaries
-- ---------------------------------------------------------------------------
select set_config('request.headers', '', true);
set local role anon;
select set_config('request.jwt.claim.sub', '', true);

select extensions.throws_ok($$select count(*) from public.club_tournaments$$, '42501', null, 'anon cannot query club_tournaments');
select extensions.throws_ok($$select public.list_club_tournaments(20)$$, '42501', null, 'anon cannot call list_club_tournaments');
select extensions.is(public.list_public_club_tournaments('no-such-club-slug', 20), null, 'unknown club returns null from public tournament list');

set local role authenticated;
select set_config('request.jwt.claim.sub', '2c000000-0000-4000-8000-000000000001', true);
select extensions.throws_ok(
  $$select public.admin_create_tournament('Unauthorized Open', 'random_queue', 2)$$,
  '42501', null, 'member cannot create a tournament');

select set_config('request.jwt.claim.sub', '2c000000-0000-4000-8000-000000000004', true);
select extensions.throws_ok(
  $$select public.admin_create_tournament('Cross-club Attack', 'random_queue', 2)$$,
  '42501', null, 'foreign club admin cannot create a tournament in Gensan');

-- ---------------------------------------------------------------------------
-- 11-22: Single-Elimination 5-player Singles Bracket with BYEs + Per-Tournament Scorer + Voiding
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '2c000000-0000-4000-8000-000000000003', true);

-- Rejects odd players for doubles bracket
select extensions.lives_ok(
  $$select set_config('test.bad_dbl',
    public.admin_create_tournament(
      'Odd Doubles Test', 'single_elimination', 2, null, true, null, null,
      array[current_setting('test.m1')::uuid, current_setting('test.m5')::uuid, current_setting('test.m6')::uuid]
    ) -> 'tournament' ->> 'id', true)$$,
  'admin creates draft doubles tournament');

select extensions.throws_ok(
  $$select public.admin_generate_tournament_draw(current_setting('test.bad_dbl')::uuid)$$,
  '22023', null, 'doubles bracket rejects odd player count');

select extensions.lives_ok(
  $$select public.admin_cancel_tournament(current_setting('test.bad_dbl')::uuid)$$,
  'admin cancels unused draft tournament');

-- Create 5-player Singles Bracket -> produces 8-slot tree (7 match rows, 3 BYEs)
select extensions.lives_ok(
  $$select set_config('test.bracket_id',
    public.admin_create_tournament(
      'Sunday Singles Cup', 'single_elimination', 1, null, true, null, 'City qualifier',
      array[
        current_setting('test.m1')::uuid,
        current_setting('test.m5')::uuid,
        current_setting('test.m6')::uuid,
        current_setting('test.m7')::uuid,
        current_setting('test.m8')::uuid
      ]
    ) -> 'tournament' ->> 'id', true)$$,
  'admin creates 5-player singles bracket');

select extensions.lives_ok(
  $$select public.admin_generate_tournament_draw(current_setting('test.bracket_id')::uuid)$$,
  'admin randomizes singles bracket draw');

-- The tournament tables are closed to API roles, so direct reads run as the test owner.
set local role postgres;
select extensions.is(
  (select count(*)::int from public.club_tournament_matches
   where tournament_id = current_setting('test.bracket_id')::uuid and status = 'bye'),
  3, '5-player 8-slot bracket creates exactly 3 Round-1 BYEs');
set local role authenticated;

select extensions.lives_ok(
  $$select public.admin_start_tournament(current_setting('test.bracket_id')::uuid)$$,
  'admin starts the bracket tournament');

-- Assign staff (user 2) as scorer ONLY for this tournament
select extensions.lives_ok(
  $$select public.admin_set_tournament_scorer(current_setting('test.bracket_id')::uuid, '2c000000-0000-4000-8000-000000000002', true)$$,
  'admin grants per-tournament scoring to staff');

select set_config('request.jwt.claim.sub', '2c000000-0000-4000-8000-000000000002', true);
select extensions.is(
  (public.get_club_tournament(current_setting('test.bracket_id')::uuid) ->> 'can_score')::boolean,
  true, 'per-tournament staff scorer sees can_score = true');

-- Score all ready matches round by round until tournament completes (5 players -> 4 real matches)
do $$
declare
  v_tid uuid := current_setting('test.bracket_id')::uuid;
  v_mid uuid;
  v_steps integer := 0;
begin
  loop
    set local role postgres;
    select id into v_mid
    from public.club_tournament_matches
    where tournament_id = v_tid and status = 'ready'
    order by round_number asc, match_order asc
    limit 1;
    set local role authenticated;
    exit when v_mid is null;
    v_steps := v_steps + 1;
    perform public.staff_score_tournament_match(v_tid, v_mid, 'a', 11, 7, null);
    if v_steps > 10 then
      raise exception 'Unexpected loop count in bracket test';
    end if;
  end loop;
end;
$$;

select extensions.is(
  public.get_public_tournament('rally-point-gensan', current_setting('test.bracket_id')::uuid) -> 'tournament' ->> 'status',
  'completed', 'scoring the Finals automatically marks the bracket tournament completed');

select extensions.ok(
  (public.get_public_tournament('rally-point-gensan', current_setting('test.bracket_id')::uuid) -> 'tournament' ->> 'champion_label') is not null,
  'completed bracket exposes champion_label publicly');

set local role postgres;
select extensions.is(
  (select count(*)::int from public.club_matches where tournament_id = current_setting('test.bracket_id')::uuid and status = 'completed'),
  4, '5-player single-elimination writes 4 completed club_matches rows to club leaderboard');
select set_config('test.semi_match', (select club_match_id from public.club_tournament_matches
  where tournament_id = current_setting('test.bracket_id')::uuid and round_number = 2 and status = 'completed'
  limit 1)::text, true);
select set_config('test.final_match', (select club_match_id from public.club_tournament_matches
  where tournament_id = current_setting('test.bracket_id')::uuid and next_match_id is null
  limit 1)::text, true);
set local role authenticated;

-- Cannot void Semifinal match after Finals was played, CAN void Finals match and reopen tournament
select extensions.throws_ok(
  $$select public.staff_void_club_match(current_setting('test.semi_match')::uuid, 'Too late')$$,
  '22023', null, 'cannot void a semifinal match after finals was played');

select extensions.lives_ok(
  $$select public.staff_void_club_match(current_setting('test.final_match')::uuid, 'Retap finals winner')$$,
  'voiding finals match succeeds and reopens tournament');

select extensions.is(
  public.get_public_tournament('rally-point-gensan', current_setting('test.bracket_id')::uuid) -> 'tournament' ->> 'status',
  'live', 'voiding finals restores bracket status back to live');

-- ---------------------------------------------------------------------------
-- 23-32: Random Queue Mixer + Fairness Rotation + Leaderboard Off Toggle + Isolation
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '2c000000-0000-4000-8000-000000000003', true);

select extensions.lives_ok(
  $$select set_config('test.queue_id',
    public.admin_create_tournament(
      'Friday Night Queue', 'random_queue', 2, null, false, null, null,
      array[
        current_setting('test.m1')::uuid,
        current_setting('test.m5')::uuid,
        current_setting('test.m6')::uuid,
        current_setting('test.m7')::uuid,
        current_setting('test.m8')::uuid,
        current_setting('test.m9')::uuid
      ]
    ) -> 'tournament' ->> 'id', true)$$,
  'admin creates 6-player doubles random queue mixer with counts_for_leaderboard = false');

select extensions.lives_ok(
  $$select public.admin_start_tournament(current_setting('test.queue_id')::uuid)$$,
  'starting random queue mixer auto-draws Game 1');

set local role postgres;
select extensions.is(
  (select count(*)::int from public.club_tournament_matches
   where tournament_id = current_setting('test.queue_id')::uuid and status = 'ready'),
  1, 'starting queue creates 1 ready match');
select set_config('test.queue_game1', (select id from public.club_tournament_matches
  where tournament_id = current_setting('test.queue_id')::uuid and status = 'ready' limit 1)::text, true);
set local role authenticated;

-- Staff (only scorer on bracket_id, NOT club-wide) CANNOT draw/score on queue_id
select set_config('request.jwt.claim.sub', '2c000000-0000-4000-8000-000000000002', true);
select extensions.is(
  (public.get_club_tournament(current_setting('test.queue_id')::uuid) ->> 'can_score')::boolean,
  false, 'staff designated only for another tournament cannot score queue_id');
select extensions.throws_ok(
  $$select public.staff_draw_tournament_queue_match(current_setting('test.queue_id')::uuid, null)$$,
  '42501', null, 'non-designated staff cannot draw next queue match');

-- Admin scores Game 1, draws Game 2 -> the 2 sitting players from round 1 MUST be included in Game 2 (lowest games = 0)
select set_config('request.jwt.claim.sub', '2c000000-0000-4000-8000-000000000003', true);
select extensions.lives_ok(
  $$select public.staff_score_tournament_match(
      current_setting('test.queue_id')::uuid,
      current_setting('test.queue_game1')::uuid,
      'b', 9, 11, null
    )$$,
  'admin scores Game 1 in random queue');

set local role postgres;
select extensions.is(
  (select count(*)::int from public.club_matches where tournament_id = current_setting('test.queue_id')::uuid),
  0, 'counts_for_leaderboard = false skips writing to club_matches');
set local role authenticated;

select extensions.lives_ok(
  $$select public.staff_draw_tournament_queue_match(current_setting('test.queue_id')::uuid, null)$$,
  'admin draws Game 2 in random queue');

-- Verify the 2 players who had 0 completed games are in Game 2
set local role postgres;
select extensions.is(
  (select count(*)::int from public.club_tournament_players tp
   where tp.tournament_id = current_setting('test.queue_id')::uuid
     and not exists (
       select 1 from public.club_tournament_matches m
       where m.tournament_id = tp.tournament_id and m.status = 'completed'
         and tp.member_id = any(m.team_a_player_ids || m.team_b_player_ids)
     )
     and exists (
       select 1 from public.club_tournament_matches m2
       where m2.tournament_id = tp.tournament_id and m2.status = 'ready'
         and tp.member_id = any(m2.team_a_player_ids || m2.team_b_player_ids)
     )),
  2, 'queue mixer prioritizes players with lowest games played');
select set_config('test.queue_game2', (select id from public.club_tournament_matches
  where tournament_id = current_setting('test.queue_id')::uuid and status = 'ready' limit 1)::text, true);
set local role authenticated;

-- Public payload leaks zero private member columns
select extensions.ok(
  not exists (
    select 1
    from jsonb_array_elements(public.get_public_tournament('rally-point-gensan', current_setting('test.queue_id')::uuid) -> 'standings') e
    where e ?| array['email', 'phone', 'member_code', 'qr_token', 'user_id', 'notes']
  ),
  'public tournament standings expose zero private contact or token keys');

-- Cannot complete tournament while active queue match exists; cancel active match -> complete succeeds
select extensions.throws_ok(
  $$select public.admin_complete_tournament(current_setting('test.queue_id')::uuid)$$,
  '22023', null, 'cannot finish tournament while an active court match is open');

select extensions.lives_ok(
  $$select public.staff_cancel_tournament_queue_match(
      current_setting('test.queue_id')::uuid,
      current_setting('test.queue_game2')::uuid
    )$$,
  'cancelling active queue match succeeds');

select extensions.lives_ok(
  $$select public.admin_complete_tournament(current_setting('test.queue_id')::uuid)$$,
  'finishing queue tournament succeeds after closing active match');

-- Club B isolation
select set_config('request.jwt.claim.sub', '2c000000-0000-4000-8000-000000000004', true);
select set_config('request.headers', '{"x-club-id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}', true);
select extensions.is(
  jsonb_array_length(public.list_club_tournaments(20)),
  0, 'Club B sees zero tournaments from Gensan');

select * from extensions.finish();
rollback;
