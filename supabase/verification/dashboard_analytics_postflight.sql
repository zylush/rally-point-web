-- Dashboard analytics postflight. Read-only: catalog and ledger only.
-- Run against the target after 20261125120000_dashboard_analytics.sql. Every row with
-- required = true must have ok = true.
-- This release adds two read-only summary functions (counts and sums only):
-- admin_club_analytics for a club's admins and platform_analytics for platform
-- superadmins. No table, index, policy or table grant changes, and nothing inside
-- the reservation-write pause is touched.
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
), analytics_functions(signature) as (
  values
    ('public.admin_club_analytics(uuid, integer)'),
    ('public.platform_analytics(integer)')
), checks(sort, check_name, required, ok, detail) as (
  select 1, 'ledger_has_dashboard_analytics', true,
         exists (select 1 from supabase_migrations.schema_migrations where version = '20261125120000')
         and (select count(*) from supabase_migrations.schema_migrations) = 37,
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
  select 3, 'analytics_functions_signed_in_only', true,
         not exists (
           select 1 from analytics_functions f
           where to_regprocedure(f.signature) is null
              or has_function_privilege('public', to_regprocedure(f.signature), 'EXECUTE')
              or has_function_privilege('anon', to_regprocedure(f.signature), 'EXECUTE')
              or has_function_privilege('service_role', to_regprocedure(f.signature), 'EXECUTE')
              or not has_function_privilege('authenticated', to_regprocedure(f.signature), 'EXECUTE')),
         'the two summaries need a signed-in caller (they check the club admin or platform superadmin inside)'
  union all
  select 4, 'analytics_functions_pin_search_path', true,
         not exists (
           select 1 from analytics_functions f
           left join pg_proc p on p.oid = to_regprocedure(f.signature)
           where p.oid is null or not p.prosecdef
              or not ('search_path=""' = any(coalesce(p.proconfig, '{}')))),
         'both summaries run with definer rights and an empty search path'
  union all
  select 5, 'analytics_functions_read_only', true,
         not exists (
           select 1 from analytics_functions f
           left join pg_proc p on p.oid = to_regprocedure(f.signature)
           where p.oid is null or p.provolatile <> 's' or p.prorettype <> 'jsonb'::regtype
              or pg_get_userbyid(p.proowner) <> 'postgres'),
         'both summaries are stable (read-only) jsonb functions owned by postgres'
  union all
  select 6, 'analytics_function_count', false, true,
         (select count(*)::text from pg_proc p
          where p.pronamespace = 'public'::regnamespace
            and p.proname in ('admin_club_analytics', 'platform_analytics')) || ' summary functions in public'
)
select check_name, required, ok, detail from checks order by sort;
