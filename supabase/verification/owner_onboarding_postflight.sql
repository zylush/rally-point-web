-- Owner onboarding postflight. Read-only: catalog, ledger and counts only.
-- Run against the target after 20261116090000_owner_call_requests.sql and
-- 20261116090100_club_owner_invites.sql. Every row with required = true must have ok = true.
-- schema_fingerprint.sql covers the public schema only, so the sign-up trigger on
-- auth.users is checked here: this release redefines handle_new_user but adds no trigger.
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
), owner_tables(name) as (
  values ('owner_call_requests'), ('club_owner_invites')
), signed_in_functions(signature) as (
  values
    ('public.platform_owner_call_requests(text, integer)'),
    ('public.platform_set_owner_call_status(uuid, text)'),
    ('public.platform_invite_club_owner(uuid, text)'),
    ('public.platform_club_owner_invites(uuid)'),
    ('public.platform_cancel_club_owner_invite(uuid)'),
    ('public.claim_my_owner_clubs()')
), definer_functions(signature) as (
  select signature from signed_in_functions
  union all values ('public.request_owner_call(text, text, text, integer, text, text, date, text, text)'),
    ('public.handle_new_user()')
), checks(sort, check_name, required, ok, detail) as (
  select 1, 'ledger_has_owner_onboarding', true,
         exists (select 1 from supabase_migrations.schema_migrations where version = '20261116090000')
         and exists (select 1 from supabase_migrations.schema_migrations where version = '20261116090100')
         and (select count(*) from supabase_migrations.schema_migrations) = 30,
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
  select 3, 'owner_tables_closed', true,
         not exists (
           select 1 from owner_tables t
           where to_regclass(format('public.%I', t.name)) is null
              or not (select relrowsecurity from pg_class where oid = to_regclass(format('public.%I', t.name)))
              or has_table_privilege('anon', format('public.%I', t.name), 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE')
              or has_table_privilege('authenticated', format('public.%I', t.name), 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE')
              or (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = t.name) <> 1
              or not exists (select 1 from pg_policies p
                             where p.schemaname = 'public' and p.tablename = t.name and p.policyname = 'no_direct_api_access'
                               and p.permissive = 'RESTRICTIVE' and p.cmd = 'ALL' and p.qual = 'false')),
         'both owner tables have row security, one restrictive deny policy, and no direct API access'
  union all
  select 4, 'owner_request_open_to_visitors', true,
         to_regprocedure('public.request_owner_call(text, text, text, integer, text, text, date, text, text)') is not null
         and has_function_privilege('anon', 'public.request_owner_call(text, text, text, integer, text, text, date, text, text)', 'EXECUTE')
         and has_function_privilege('authenticated', 'public.request_owner_call(text, text, text, integer, text, text, date, text, text)', 'EXECUTE'),
         'request_owner_call is open to visitors (it checks every field and limits floods)'
  union all
  select 5, 'owner_functions_signed_in_only', true,
         not exists (
           select 1 from signed_in_functions f
           where to_regprocedure(f.signature) is null
              or has_function_privilege('anon', to_regprocedure(f.signature), 'EXECUTE')
              or not has_function_privilege('authenticated', to_regprocedure(f.signature), 'EXECUTE')),
         'the five platform functions and claim_my_owner_clubs need a signed-in caller (they check the role inside)'
  union all
  select 6, 'signup_trigger_unchanged', true,
         (select count(*) from pg_trigger t where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal) = 1
         and exists (
           select 1 from pg_trigger t
           where t.tgrelid = 'auth.users'::regclass and t.tgname = 'on_auth_user_created' and not t.tgisinternal
             and t.tgfoid = 'public.handle_new_user()'::regprocedure)
         and not has_function_privilege('anon', 'public.handle_new_user()', 'EXECUTE')
         and not has_function_privilege('authenticated', 'public.handle_new_user()', 'EXECUTE')
         and has_function_privilege('supabase_auth_admin', 'public.handle_new_user()', 'EXECUTE'),
         'auth.users still has only the sign-up trigger, and only the auth service runs handle_new_user'
  union all
  select 7, 'new_functions_pin_search_path', true,
         not exists (
           select 1 from definer_functions f
           left join pg_proc p on p.oid = to_regprocedure(f.signature)
           where p.oid is null or not p.prosecdef or not ('search_path=""' = any(coalesce(p.proconfig, '{}')))),
         'every new or changed function runs with definer rights and an empty search path'
  union all
  select 8, 'owner_foreign_keys_indexed', true,
         not exists (
           select 1 from owner_tables t
           join pg_constraint c on c.conrelid = to_regclass(format('public.%I', t.name)) and c.contype = 'f'
           where not exists (select 1 from pg_index i
                             where i.indrelid = c.conrelid and i.indisvalid
                               and (string_to_array(i.indkey::text, ' ')::smallint[])[1:cardinality(c.conkey)] = c.conkey)),
         'every owner table foreign key has an index in its own column order'
  union all
  select 9, 'owner_counts', false, true,
         (select count(*)::text from public.owner_call_requests) || ' owner call requests, '
         || (select count(*)::text from public.club_owner_invites) || ' owner invites'
)
select check_name, required, ok, detail from checks order by sort;
