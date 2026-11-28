-- Tournament review fixes postflight. Read-only: catalog, ledger and row counts only.
-- Run against the target after 20261126110000_tournament_review_fixes.sql. Every row with
-- required = true must have ok = true.
-- This release adds staff_void_tournament_match (undo a result in any tournament), two trigger
-- helpers (at most 64 players and 300 matches per tournament; no court out of service and no two
-- active matches on one court) and redefines the queue draw so its court picker looks across the
-- club. No table, policy or table grant changes; nothing in the reservation-write pause is written.
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
), private_functions(signature) as (
  values
    ('private.enforce_tournament_limits()'),
    ('private.check_tournament_match_court()'),
    ('private.draw_next_tournament_queue_match(uuid, uuid, uuid)')
), changed_functions(signature) as (
  select signature from private_functions
  union all select 'public.staff_void_tournament_match(uuid, uuid, text)'
), expected_triggers(table_name, trigger_name) as (
  values
    ('club_tournament_players', 'club_tournament_players_limit'),
    ('club_tournament_matches', 'club_tournament_matches_limit'),
    ('club_tournament_matches', 'club_tournament_matches_court_check')
), checks(sort, check_name, required, ok, detail) as (
  select 1, 'ledger_has_tournament_fixes', true,
         exists (select 1 from supabase_migrations.schema_migrations where version = '20261126110000')
         and (select count(*) from supabase_migrations.schema_migrations) = 41,
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
  select 3, 'undo_function_signed_in_only', true,
         to_regprocedure('public.staff_void_tournament_match(uuid, uuid, text)') is not null
         and not has_function_privilege('public', 'public.staff_void_tournament_match(uuid, uuid, text)', 'EXECUTE')
         and not has_function_privilege('anon', 'public.staff_void_tournament_match(uuid, uuid, text)', 'EXECUTE')
         and has_function_privilege('authenticated', 'public.staff_void_tournament_match(uuid, uuid, text)', 'EXECUTE'),
         'undoing a tournament result needs a signed-in caller (the scorer check is inside)'
  union all
  select 4, 'tournament_helpers_private', true,
         not exists (
           select 1 from private_functions f, api_roles r
           where to_regprocedure(f.signature) is null
              or has_function_privilege('public', to_regprocedure(f.signature), 'EXECUTE')
              or has_function_privilege(r.name, to_regprocedure(f.signature), 'EXECUTE')),
         'no API role can run the trigger helpers or the queue draw'
  union all
  select 5, 'changed_functions_pin_search_path', true,
         not exists (
           select 1 from changed_functions f
           left join pg_proc p on p.oid = to_regprocedure(f.signature)
           where p.oid is null or not p.prosecdef
              or not ('search_path=""' = any(coalesce(p.proconfig, '{}')))
              or pg_get_userbyid(p.proowner) <> 'postgres'),
         'the four new or changed functions run with definer rights, an empty search path, and postgres as owner'
  union all
  select 6, 'tournament_triggers_enabled', true,
         not exists (
           select 1 from expected_triggers e
           where not exists (
             select 1 from pg_trigger t
             where t.tgrelid = to_regclass(format('public.%I', e.table_name))
               and t.tgname = e.trigger_name and not t.tgisinternal and t.tgenabled <> 'D')),
         'the player limit, match limit and court check triggers are in place and enabled'
  union all
  select 7, 'tournaments_within_limits', true,
         not exists (select 1 from public.club_tournament_players group by tournament_id having count(*) > 64)
         and not exists (select 1 from public.club_tournament_matches group by tournament_id having count(*) > 300),
         'no tournament has more than 64 players or 300 matches'
  union all
  select 8, 'tournament_fix_counts', false, true,
         (select count(*)::text from public.club_tournaments) || ' tournaments, '
         || (select count(*)::text from public.club_tournament_matches where status in ('ready', 'playing')) || ' active matches'
)
select check_name, required, ok, detail from checks order by sort;
