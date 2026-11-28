-- Club leaderboard and tournaments postflight. Read-only: catalog, ledger and row counts only.
-- Run against the target after 20261126080000_club_leaderboard.sql,
-- 20261126090000_club_tournaments.sql and 20261126100000_public_tournaments.sql. Every row with
-- required = true must have ok = true.
-- This release adds eight closed tables (match results, leaderboard scorers, tournaments,
-- their players, teams, matches and scorers), eleven private helpers and twenty-three definer
-- functions: five public reads for the club pages and the all-clubs Tournaments page (open to
-- visitors) and eighteen for signed-in
-- callers that check the club role inside. Nothing inside the reservation-write pause is touched.
with paused_tables(name) as (
  values ('bookings'), ('court_sessions'), ('open_plays'), ('open_play_signups'), ('court_allocations'), ('courts')
), paused_functions(signature) as (
  values
    ('public.create_unpaid_desk_booking(uuid, uuid, uuid, uuid, date, integer, integer)'),
    ('public.create_desk_rental(uuid, uuid, uuid, uuid, text, integer)'),
    ('public.add_member_to_session(uuid, uuid)'),
    ('public.extend_desk_session(uuid, integer)'),
    ('public.end_desk_session(uuid)'),
    ('public.create_open_play_session(uuid, uuid, uuid, text, timestamptz, timestamptz, integer, numeric, public.skill_level, text)'),
    ('public.join_open_play_session(uuid, uuid)'),
    ('public.leave_open_play_session(uuid, uuid)'),
    ('public.cancel_booking_reservation(uuid)')
), api_roles(name) as (
  values ('anon'), ('authenticated'), ('service_role')
), new_tables(name) as (
  values ('club_leaderboard_scorers'), ('club_matches'), ('club_match_players'), ('club_tournaments'),
         ('club_tournament_scorers'), ('club_tournament_players'), ('club_tournament_teams'), ('club_tournament_matches')
), public_reads(signature) as (
  values
    ('public.get_public_club_leaderboard(text, text, text, integer)'),
    ('public.get_public_player_matches(text, uuid, integer)'),
    ('public.list_public_club_tournaments(text, integer)'),
    ('public.get_public_tournament(text, uuid)'),
    ('public.list_public_tournaments(text, integer)')
), signed_in_functions(signature) as (
  values
    ('public.get_club_leaderboard(text, text, integer)'),
    ('public.staff_record_club_match(text, uuid[], uuid[], text, integer, integer, uuid, uuid, text)'),
    ('public.staff_void_club_match(uuid, text)'),
    ('public.admin_list_leaderboard_scorers()'),
    ('public.admin_set_leaderboard_scorer(uuid, boolean)'),
    ('public.list_club_tournaments(integer)'),
    ('public.get_club_tournament(uuid)'),
    ('public.admin_create_tournament(text, text, integer, uuid, boolean, timestamptz, text, uuid[])'),
    ('public.admin_set_tournament_players(uuid, uuid[])'),
    ('public.admin_generate_tournament_draw(uuid)'),
    ('public.admin_start_tournament(uuid)'),
    ('public.admin_set_tournament_scorer(uuid, uuid, boolean)'),
    ('public.admin_complete_tournament(uuid)'),
    ('public.admin_cancel_tournament(uuid)'),
    ('public.staff_draw_tournament_queue_match(uuid, uuid)'),
    ('public.staff_assign_tournament_match_court(uuid, uuid, uuid)'),
    ('public.staff_cancel_tournament_queue_match(uuid, uuid)'),
    ('public.staff_score_tournament_match(uuid, uuid, text, integer, integer, uuid)')
), private_helpers(signature) as (
  values
    ('private.can_score_club_matches(uuid)'),
    ('private.require_club_scorer()'),
    ('private.club_match_json(uuid)'),
    ('private.club_leaderboard_payload(uuid, text, text, integer, boolean, uuid)'),
    ('private.can_score_tournament(uuid, uuid)'),
    ('private.require_tournament_scorer(uuid)'),
    ('private.tournament_round_label(text, integer, integer, integer)'),
    ('private.build_tournament_bracket_draw(uuid, uuid)'),
    ('private.draw_next_tournament_queue_match(uuid, uuid, uuid)'),
    ('private.tournament_summary_json(uuid)'),
    ('private.tournament_detail_payload(uuid, uuid, uuid, boolean)')
), all_new_functions(signature) as (
  select signature from public_reads
  union all select signature from signed_in_functions
  union all select signature from private_helpers
), checks(sort, check_name, required, ok, detail) as (
  select 1, 'ledger_has_leaderboard_tournaments', true,
         exists (select 1 from supabase_migrations.schema_migrations where version = '20261126080000')
         and exists (select 1 from supabase_migrations.schema_migrations where version = '20261126090000')
         and exists (select 1 from supabase_migrations.schema_migrations where version = '20261126100000')
         and (select count(*) from supabase_migrations.schema_migrations) = 40,
         (select count(*)::text from supabase_migrations.schema_migrations) || ' versions recorded'
  union all
  select 2, 'reservation_writes_still_paused', true,
         not exists (
           select 1 from paused_tables t, api_roles r
           where has_table_privilege(r.name, format('public.%I', t.name), 'INSERT, UPDATE, DELETE, TRUNCATE'))
         and not exists (
           select 1 from paused_functions f, api_roles r
           where has_function_privilege(r.name, to_regprocedure(f.signature), 'EXECUTE')),
         'no API role can write paused tables or run paused booking functions'
  union all
  select 3, 'new_tables_closed', true,
         not exists (
           select 1 from new_tables t
           left join pg_class c on c.oid = to_regclass(format('public.%I', t.name))
           where c.oid is null or not c.relrowsecurity
              or has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE')
              or has_table_privilege('authenticated', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE')
              or (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = t.name) <> 1
              or not exists (select 1 from pg_policies p
                             where p.schemaname = 'public' and p.tablename = t.name
                               and p.policyname = 'no_direct_api_access' and p.permissive = 'RESTRICTIVE'
                               and p.cmd = 'ALL' and p.qual = 'false')),
         'the eight new tables have row security, one restrictive deny policy, and no direct access for anon or signed-in callers'
  union all
  select 4, 'public_reads_open_to_visitors', true,
         not exists (
           select 1 from public_reads f
           where to_regprocedure(f.signature) is null
              or has_function_privilege('public', to_regprocedure(f.signature), 'EXECUTE')
              or not has_function_privilege('anon', to_regprocedure(f.signature), 'EXECUTE')
              or not has_function_privilege('authenticated', to_regprocedure(f.signature), 'EXECUTE')),
         'the five public reads (leaderboard, player matches, club and all-clubs tournament lists, bracket) are open to visitors'
  union all
  select 5, 'other_functions_signed_in_only', true,
         not exists (
           select 1 from signed_in_functions f
           where to_regprocedure(f.signature) is null
              or has_function_privilege('public', to_regprocedure(f.signature), 'EXECUTE')
              or has_function_privilege('anon', to_regprocedure(f.signature), 'EXECUTE')
              or not has_function_privilege('authenticated', to_regprocedure(f.signature), 'EXECUTE')),
         'the eighteen staff, scorer and admin functions need a signed-in caller (they check the club role inside)'
  union all
  select 6, 'helpers_private', true,
         not exists (
           select 1 from private_helpers f, api_roles r
           where to_regprocedure(f.signature) is null
              or has_function_privilege('public', to_regprocedure(f.signature), 'EXECUTE')
              or has_function_privilege(r.name, to_regprocedure(f.signature), 'EXECUTE')),
         'no API role can run the eleven private helpers'
  union all
  select 7, 'new_functions_pin_search_path', true,
         not exists (
           select 1 from all_new_functions f
           left join pg_proc p on p.oid = to_regprocedure(f.signature)
           where p.oid is null or not p.prosecdef
              or not ('search_path=""' = any(coalesce(p.proconfig, '{}')))
              or pg_get_userbyid(p.proowner) <> 'postgres'),
         'all thirty-four new functions run with definer rights, an empty search path, and postgres as owner'
  union all
  select 8, 'new_foreign_keys_indexed', true,
         not exists (
           select 1 from new_tables t
           join pg_constraint c on c.conrelid = to_regclass(format('public.%I', t.name)) and c.contype = 'f'
           where not exists (select 1 from pg_index i
                             where i.indrelid = c.conrelid and i.indisvalid and i.indpred is null
                               and (string_to_array(i.indkey::text, ' ')::smallint[])[1:cardinality(c.conkey)] = c.conkey)),
         'every foreign key of the eight new tables has an index in its own column order'
  union all
  select 9, 'leaderboard_tournament_counts', false, true,
         (select count(*)::text from public.club_matches) || ' matches, '
         || (select count(*)::text from public.club_tournaments) || ' tournaments, '
         || (select count(*)::text from public.club_leaderboard_scorers) || ' leaderboard scorers, '
         || (select count(*)::text from public.club_tournament_scorers) || ' tournament scorers'
)
select check_name, required, ok, detail from checks order by sort;
