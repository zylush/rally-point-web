-- Court management and player marketplace postflight. Read-only: catalog, ledger and counts only.
-- Run against the target after 20261022090000, 20261022100000 and 20261022110000.
-- Every row with required = true must have ok = true.
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
), signed_in_only(signature) as (
  values
    ('public.admin_upsert_court(uuid, uuid, text, numeric, numeric, boolean)'),
    ('public.admin_update_venue_location(uuid, text, text, numeric, numeric)'),
    ('public.join_club_as_player(text)')
), open_to_visitors(signature) as (
  values ('public.list_public_clubs()'), ('public.get_public_club_detail(text)')
), new_functions as (
  select signature from signed_in_only union all select signature from open_to_visitors
), checks(sort, check_name, required, ok, detail) as (
  select 1, 'ledger_has_court_marketplace', true,
         (select count(*) from supabase_migrations.schema_migrations
          where version in ('20261022090000', '20261022100000', '20261022110000')) = 3
         and (select count(*) from supabase_migrations.schema_migrations) = 26,
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
  select 3, 'court_and_join_functions_signed_in_only', true,
         not exists (
           select 1 from signed_in_only f
           where to_regprocedure(f.signature) is null
              or has_function_privilege('anon', to_regprocedure(f.signature), 'EXECUTE')
              or not has_function_privilege('authenticated', to_regprocedure(f.signature), 'EXECUTE')),
         'admin_upsert_court, admin_update_venue_location and join_club_as_player need a signed-in caller'
  union all
  select 4, 'club_directory_open_to_visitors', true,
         not exists (
           select 1 from open_to_visitors f
           where to_regprocedure(f.signature) is null
              or not has_function_privilege('anon', to_regprocedure(f.signature), 'EXECUTE')
              or not has_function_privilege('authenticated', to_regprocedure(f.signature), 'EXECUTE')),
         'list_public_clubs and get_public_club_detail are open to visitors'
  union all
  select 5, 'new_functions_pin_search_path', true,
         not exists (
           select 1 from new_functions f
           left join pg_proc p on p.oid = to_regprocedure(f.signature)
           where p.oid is null or not p.prosecdef or not ('search_path=""' = any(coalesce(p.proconfig, '{}')))),
         'every new function runs with definer rights and an empty search path'
  union all
  select 6, 'court_member_rate', true,
         exists (select 1 from pg_attribute where attrelid = 'public.courts'::regclass and attname = 'member_rate' and not attisdropped)
         and exists (select 1 from pg_constraint where conrelid = 'public.courts'::regclass and conname = 'courts_member_rate_check' and convalidated),
         'courts.member_rate exists and stays between 0 and the hourly rate'
  union all
  select 7, 'player_membership_pair', true,
         exists (select 1 from pg_constraint where conrelid = 'public.members'::regclass and conname = 'members_membership_pair_check' and convalidated)
         and not exists (select 1 from public.members where (membership_type is null) <> (expiry_date is null)),
         'membership type and expiry are set together; players have neither'
  union all
  select 8, 'venue_locations', true,
         (select count(*) from pg_attribute where attrelid = 'public.venues'::regclass and not attisdropped
          and attname in ('address', 'city', 'latitude', 'longitude')) = 4
         and exists (select 1 from pg_constraint where conrelid = 'public.venues'::regclass and conname = 'venues_pin_check' and convalidated),
         'venues have address, city and a both-or-neither map pin'
  union all
  select 9, 'venues_open_all_day', true,
         not exists (select 1 from public.venues where open_hour <> 0 or close_hour <> 24)
         and (select column_default from information_schema.columns
              where table_schema = 'public' and table_name = 'venues' and column_name = 'open_hour') = '0'
         and (select column_default from information_schema.columns
              where table_schema = 'public' and table_name = 'venues' and column_name = 'close_hour') = '24',
         (select count(*)::text from public.venues) || ' venues open 0-24'
  union all
  select 10, 'philippine_time_only', true,
         exists (select 1 from pg_constraint where conrelid = 'public.venues'::regclass and conname = 'venues_timezone_ph_check' and convalidated)
         and exists (select 1 from pg_constraint where conrelid = 'public.clubs'::regclass and conname = 'clubs_timezone_ph_check' and convalidated),
         'venues and clubs are held to Asia/Manila'
  union all
  select 11, 'listed_clubs', false, true,
         (select count(*)::text from public.list_public_clubs()) || ' clubs in the public list'
)
select check_name, required, ok, detail from checks order by sort;
