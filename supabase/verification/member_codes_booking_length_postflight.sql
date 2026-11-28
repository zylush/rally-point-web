-- Member codes and booking length postflight. Read-only: catalog, ledger and counts only.
-- Run against the target after 20261124090000_member_code_prefix.sql and
-- 20261124100000_booking_any_length.sql. Every row with required = true must have ok = true.
-- New member codes start with BR- (four code-making functions redefined), and a booking has
-- no maximum length: bookings.hours allows 1 to 24 and hold_court_booking takes any length
-- of at least 1 hour that ends by midnight. The reservation-write pause is unchanged.
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
), code_functions(signature) as (
  values
    ('public.handle_new_user()'),
    ('public.admin_upsert_member(uuid, text, text, text, public.membership_type, public.member_status, date, date, text)'),
    ('public.join_club(text)'),
    ('public.join_club_as_player(text)')
), hold_function(oid) as (
  select to_regprocedure('public.hold_court_booking(uuid, uuid, uuid, date, integer, integer)')::oid
), checks(sort, check_name, required, ok, detail) as (
  select 1, 'ledger_has_codes_and_length', true,
         exists (select 1 from supabase_migrations.schema_migrations where version = '20261124090000')
         and exists (select 1 from supabase_migrations.schema_migrations where version = '20261124100000')
         and (select count(*) from supabase_migrations.schema_migrations) = 33,
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
  select 3, 'member_codes_use_br_prefix', true,
         not exists (
           select 1 from code_functions f
           left join pg_proc p on p.oid = to_regprocedure(f.signature)
           where p.oid is null or p.prosrc not like '%''BR-''%' or p.prosrc like '%''RP-''%'),
         'the four code-making functions make BR- codes and no longer RP- codes'
  union all
  select 4, 'code_functions_unchanged_settings', true,
         not exists (
           select 1 from code_functions f
           left join pg_proc p on p.oid = to_regprocedure(f.signature)
           where p.oid is null or not p.prosecdef
              or not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
              or pg_get_userbyid(p.proowner) <> 'postgres'),
         'the code-making functions stay definer functions with a fixed search path, owned by postgres'
  union all
  select 5, 'booking_hours_any_length', true,
         exists (select 1 from pg_constraint c
                 where c.conrelid = 'public.bookings'::regclass and c.conname = 'bookings_hours_check' and c.convalidated
                   and pg_get_constraintdef(c.oid) ~ '>= 1' and pg_get_constraintdef(c.oid) ~ '<= 24')
         and not exists (select 1 from pg_constraint c
                         where c.conrelid = 'public.bookings'::regclass and c.contype = 'c'
                           and pg_get_constraintdef(c.oid) ~ '\mhours\M' and pg_get_constraintdef(c.oid) ~ '<= 3\M'),
         'bookings.hours allows 1 to 24 and no 3-hour cap is left'
  union all
  select 6, 'hold_takes_any_length', true,
         (select p.prosrc !~ 'between 1 and 3' and p.prosrc ~ 'p_hours < 1' and p.prosrc ~ 'p_start_hour \+ p_hours > 24'
          from pg_proc p join hold_function h on p.oid = h.oid),
         'hold_court_booking takes any length of at least 1 hour that ends by midnight'
  union all
  select 7, 'hold_function_signed_in_only', true,
         (select h.oid is not null
                 and not has_function_privilege('public', h.oid, 'EXECUTE')
                 and not has_function_privilege('anon', h.oid, 'EXECUTE')
                 and not has_function_privilege('service_role', h.oid, 'EXECUTE')
                 and has_function_privilege('authenticated', h.oid, 'EXECUTE')
          from hold_function h)
         and (select p.prosecdef and 'search_path=""' = any(coalesce(p.proconfig, '{}')) and pg_get_userbyid(p.proowner) = 'postgres'
              from pg_proc p join hold_function h on p.oid = h.oid),
         'hold_court_booking still needs a signed-in caller, runs with definer rights and an empty search path'
  union all
  select 8, 'codes_and_length_counts', false, true,
         (select count(*)::text from public.members where member_code like 'BR-%') || ' BR- codes, '
         || (select count(*)::text from public.members where member_code like 'RP-%') || ' RP- codes, '
         || (select count(*)::text from public.bookings where hours > 3) || ' bookings over 3 hours'
)
select check_name, required, ok, detail from checks order by sort;
