-- Club business profile postflight. Read-only: catalog, ledger and counts only.
-- Run against the target after 20261115090000_club_business_profile.sql.
-- Every row with required = true must have ok = true.
-- schema_fingerprint.sql covers the public schema only, so the policies on
-- storage.objects for the club picture folders are checked here.
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
), profile_tables(name) as (
  values ('club_profiles'), ('club_addons'), ('club_coaches'), ('club_payment_methods'), ('club_gallery_photos')
), admin_functions(signature) as (
  values
    ('public.admin_club_profile()'),
    ('public.admin_update_club_profile(text, text, text, text, text, text, text, text[], text, text, text, text)'),
    ('public.admin_upsert_club_addon(uuid, text, text, numeric, text, boolean)'),
    ('public.admin_remove_club_addon(uuid)'),
    ('public.admin_upsert_club_coach(uuid, text, text, text, numeric, text, text, boolean)'),
    ('public.admin_set_club_coach_photo(uuid, text)'),
    ('public.admin_remove_club_coach(uuid)'),
    ('public.admin_upsert_club_payment_method(uuid, text, text, text, boolean)'),
    ('public.admin_set_club_payment_qr(uuid, text)'),
    ('public.admin_remove_club_payment_method(uuid)'),
    ('public.admin_add_club_photo(text, text)'),
    ('public.admin_remove_club_photo(uuid)'),
    ('public.admin_unused_club_pictures()')
), private_helpers(signature) as (
  values
    ('private.require_club_admin()'),
    ('private.club_profile_message(text)'),
    ('private.club_media_target(text)'),
    ('private.require_club_media(uuid, text, text)')
), definer_functions(signature) as (
  select signature from admin_functions
  union all values ('public.get_public_club_profile(text)'), ('private.require_club_admin()'),
    ('private.club_media_target(text)'), ('private.can_manage_club_media(text)'), ('private.require_club_media(uuid, text, text)')
), media_policies as (
  select policyname, cmd, roles, coalesce(qual, '') || coalesce(with_check, '') as rule
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects' and policyname like 'club_media_%'
), checks(sort, check_name, required, ok, detail) as (
  select 1, 'ledger_has_club_profile', true,
         exists (select 1 from supabase_migrations.schema_migrations where version = '20261115090000')
         and (select count(*) from supabase_migrations.schema_migrations) = 28,
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
  select 3, 'profile_tables_closed', true,
         not exists (
           select 1 from profile_tables t
           where to_regclass(format('public.%I', t.name)) is null
              or not (select relrowsecurity from pg_class where oid = to_regclass(format('public.%I', t.name)))
              or has_table_privilege('anon', format('public.%I', t.name), 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE')
              or has_table_privilege('authenticated', format('public.%I', t.name), 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE')
              or (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = t.name) <> 1
              or not exists (select 1 from pg_policies p
                             where p.schemaname = 'public' and p.tablename = t.name and p.policyname = 'no_direct_api_access'
                               and p.permissive = 'RESTRICTIVE' and p.cmd = 'ALL' and p.qual = 'false')),
         'the five profile tables have row security, one restrictive deny policy, and no direct API access'
  union all
  select 4, 'club_media_admins_only', true,
         (select count(*) from media_policies) = 3
         and (select array_agg(cmd::text order by cmd::text) from media_policies) = array['DELETE', 'INSERT', 'SELECT']
         and not exists (
           select 1 from media_policies
           where roles <> '{authenticated}'
              or rule !~ 'court-photos'
              or rule !~ 'can_manage_club_media')
         and not exists (
           select 1 from pg_policies
           where schemaname = 'storage' and tablename = 'objects' and cmd in ('UPDATE', 'ALL')
             and coalesce(qual, '') || coalesce(with_check, '') ~ 'court-photos'),
         'signed-in admins of the folder''s club may upload, read and delete club pictures; nobody may overwrite'
  union all
  select 5, 'profile_functions_signed_in_only', true,
         not exists (
           select 1 from admin_functions f
           where to_regprocedure(f.signature) is null
              or has_function_privilege('anon', to_regprocedure(f.signature), 'EXECUTE')
              or not has_function_privilege('authenticated', to_regprocedure(f.signature), 'EXECUTE')),
         'the thirteen admin profile functions need a signed-in caller (they check the admin role inside)'
  union all
  select 6, 'public_profile_open_to_visitors', true,
         to_regprocedure('public.get_public_club_profile(text)') is not null
         and has_function_privilege('anon', 'public.get_public_club_profile(text)', 'EXECUTE')
         and has_function_privilege('authenticated', 'public.get_public_club_profile(text)', 'EXECUTE'),
         'get_public_club_profile is open to visitors'
  union all
  select 7, 'profile_helpers_private', true,
         not exists (
           select 1 from private_helpers f, (values ('anon'), ('authenticated')) r(name)
           where to_regprocedure(f.signature) is null
              or has_function_privilege(r.name, to_regprocedure(f.signature), 'EXECUTE'))
         and to_regprocedure('private.can_manage_club_media(text)') is not null
         and not has_function_privilege('anon', 'private.can_manage_club_media(text)', 'EXECUTE')
         and has_function_privilege('authenticated', 'private.can_manage_club_media(text)', 'EXECUTE'),
         'only the Storage policy check is callable, and only by signed-in users'
  union all
  select 8, 'new_functions_pin_search_path', true,
         not exists (
           select 1 from definer_functions f
           left join pg_proc p on p.oid = to_regprocedure(f.signature)
           where p.oid is null or not p.prosecdef or not ('search_path=""' = any(coalesce(p.proconfig, '{}'))))
         and exists (
           select 1 from pg_proc p
           where p.oid = to_regprocedure('private.club_profile_message(text)')
             and 'search_path=""' = any(coalesce(p.proconfig, '{}'))),
         'every new function pins an empty search path; all but the message lookup run with definer rights'
  union all
  select 9, 'profile_foreign_keys_indexed', true,
         not exists (
           select 1 from profile_tables t
           join pg_constraint c on c.conrelid = to_regclass(format('public.%I', t.name)) and c.contype = 'f'
           where not exists (select 1 from pg_index i
                             where i.indrelid = c.conrelid and i.indisvalid
                               and (string_to_array(i.indkey::text, ' ')::smallint[])[1:cardinality(c.conkey)] = c.conkey)),
         'every profile table foreign key has an index in its own column order'
  union all
  select 10, 'profile_counts', false, true,
         (select count(*)::text from public.club_profiles) || ' profiles, '
         || (select count(*)::text from public.club_addons) || ' add-ons, '
         || (select count(*)::text from public.club_coaches) || ' coaches, '
         || (select count(*)::text from public.club_payment_methods) || ' payment methods, '
         || (select count(*)::text from public.club_gallery_photos) || ' gallery photos'
)
select check_name, required, ok, detail from checks order by sort;
