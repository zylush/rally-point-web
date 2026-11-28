-- Public coaches and court types postflight. Read-only: catalog, ledger and row counts only.
-- Run against the target after 20261127090000_public_coaches.sql and 20261127100000_court_types.sql.
-- Every row with required = true must have ok = true.
-- This release adds list_public_coaches (coaches and open lesson times across clubs, open to
-- visitors), courts.court_type (indoor, outdoor or not set), admin_set_court_type (admin only),
-- list_public_club_court_types (open to visitors) and redefines get_public_club_detail to return
-- each court's type. Courts stay closed to direct API writes; no paused function changes.
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
), public_reads(signature) as (
  values
    ('public.list_public_coaches(text, timestamptz, timestamptz)'),
    ('public.list_public_club_court_types()'),
    ('public.get_public_club_detail(text)')
), changed_functions(signature) as (
  select signature from public_reads
  union all select 'public.admin_set_court_type(uuid, text)'
), checks(sort, check_name, required, ok, detail) as (
  select 1, 'ledger_has_coaches_court_types', true,
         exists (select 1 from supabase_migrations.schema_migrations where version = '20261127090000')
         and exists (select 1 from supabase_migrations.schema_migrations where version = '20261127100000')
         and (select count(*) from supabase_migrations.schema_migrations) = 43,
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
  select 3, 'court_type_column_checked', true,
         exists (select 1 from pg_attribute where attrelid = 'public.courts'::regclass and attname = 'court_type'
                 and not attisdropped and atttypid = 'text'::regtype and not attnotnull)
         and exists (select 1 from pg_constraint where conrelid = 'public.courts'::regclass
                     and conname = 'courts_court_type_check' and convalidated),
         'courts.court_type exists, may be empty, and allows only indoor or outdoor'
  union all
  select 4, 'court_type_setter_signed_in_only', true,
         to_regprocedure('public.admin_set_court_type(uuid, text)') is not null
         and not has_function_privilege('public', 'public.admin_set_court_type(uuid, text)', 'EXECUTE')
         and not has_function_privilege('anon', 'public.admin_set_court_type(uuid, text)', 'EXECUTE')
         and has_function_privilege('authenticated', 'public.admin_set_court_type(uuid, text)', 'EXECUTE'),
         'setting a court''s type needs a signed-in caller (the admin check is inside)'
  union all
  select 5, 'public_reads_open_to_visitors', true,
         not exists (
           select 1 from public_reads f
           where to_regprocedure(f.signature) is null
              or has_function_privilege('public', to_regprocedure(f.signature), 'EXECUTE')
              or not has_function_privilege('anon', to_regprocedure(f.signature), 'EXECUTE')
              or not has_function_privilege('authenticated', to_regprocedure(f.signature), 'EXECUTE')),
         'list_public_coaches, list_public_club_court_types and get_public_club_detail are open to visitors'
  union all
  select 6, 'changed_functions_pin_search_path', true,
         not exists (
           select 1 from changed_functions f
           left join pg_proc p on p.oid = to_regprocedure(f.signature)
           where p.oid is null or not p.prosecdef
              or not ('search_path=""' = any(coalesce(p.proconfig, '{}')))
              or pg_get_userbyid(p.proowner) <> 'postgres'),
         'the four new or changed functions run with definer rights, an empty search path, and postgres as owner'
  union all
  select 7, 'court_type_counts', false, true,
         (select count(*)::text from public.courts) || ' courts: '
         || (select count(*)::text from public.courts where court_type = 'indoor') || ' indoor, '
         || (select count(*)::text from public.courts where court_type = 'outdoor') || ' outdoor, '
         || (select count(*)::text from public.courts where court_type is null) || ' not set'
)
select check_name, required, ok, detail from checks order by sort;
