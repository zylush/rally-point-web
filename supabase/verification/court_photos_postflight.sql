-- Court photos postflight. Read-only: catalog, ledger and counts only.
-- Run against the target after 20261023090000_court_photos.sql.
-- Every row with required = true must have ok = true.
-- schema_fingerprint.sql covers the public schema only, so the Storage bucket and
-- the policies on storage.objects are checked here.
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
), admin_functions(signature) as (
  values
    ('public.admin_add_court_photo(uuid, text)'),
    ('public.admin_make_main_court_photo(uuid)'),
    ('public.admin_remove_court_photo(uuid)'),
    ('public.admin_set_venue_cover(uuid, text)')
), open_to_visitors(signature) as (
  values ('public.list_public_club_covers()'), ('public.get_public_club_detail(text)')
), new_functions(signature) as (
  select signature from admin_functions
  union all select signature from open_to_visitors
  union all values ('private.court_photo_target(text)'), ('private.can_manage_court_photo(text)')
), photo_policies as (
  select policyname, cmd, roles, coalesce(qual, '') || coalesce(with_check, '') as rule
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects' and policyname like 'court_photos_%'
), checks(sort, check_name, required, ok, detail) as (
  select 1, 'ledger_has_court_photos', true,
         exists (select 1 from supabase_migrations.schema_migrations where version = '20261023090000')
         and (select count(*) from supabase_migrations.schema_migrations) = 27,
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
  select 3, 'photo_records_admin_read_only', true,
         to_regclass('public.court_photos') is not null
         and (select relrowsecurity from pg_class where oid = to_regclass('public.court_photos'))
         and not has_table_privilege('anon', 'public.court_photos', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE')
         and has_table_privilege('authenticated', 'public.court_photos', 'SELECT')
         and not has_table_privilege('authenticated', 'public.court_photos', 'INSERT, UPDATE, DELETE, TRUNCATE')
         and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'court_photos') = 1
         and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'court_photos'
                     and policyname = 'court_photos_admin_read' and cmd = 'SELECT' and roles = '{authenticated}'),
         'court_photos has row security, one admin read policy, and no direct writes'
  union all
  select 4, 'photo_bucket_public_and_limited', true,
         exists (select 1 from storage.buckets
                 where id = 'court-photos' and public and file_size_limit = 5242880
                   and allowed_mime_types @> array['image/webp', 'image/jpeg', 'image/png']
                   and array_length(allowed_mime_types, 1) = 3),
         'court-photos is public, 5 MB, JPEG/PNG/WebP only'
  union all
  select 5, 'photo_files_admins_only', true,
         (select count(*) from photo_policies) = 3
         and (select array_agg(cmd::text order by cmd::text) from photo_policies) = array['DELETE', 'INSERT', 'SELECT']
         and not exists (
           select 1 from photo_policies
           where roles <> '{authenticated}'
              or rule !~ 'court-photos'
              or rule !~ 'can_manage_court_photo'),
         'signed-in admins of the folder''s club may upload, read and delete; nobody may overwrite'
  union all
  select 6, 'photo_functions_signed_in_only', true,
         not exists (
           select 1 from admin_functions f
           where to_regprocedure(f.signature) is null
              or has_function_privilege('anon', to_regprocedure(f.signature), 'EXECUTE')
              or not has_function_privilege('authenticated', to_regprocedure(f.signature), 'EXECUTE')),
         'the four admin photo functions need a signed-in caller (they check the admin role inside)'
  union all
  select 7, 'club_pages_open_to_visitors', true,
         not exists (
           select 1 from open_to_visitors f
           where to_regprocedure(f.signature) is null
              or not has_function_privilege('anon', to_regprocedure(f.signature), 'EXECUTE')
              or not has_function_privilege('authenticated', to_regprocedure(f.signature), 'EXECUTE')),
         'list_public_club_covers and get_public_club_detail are open to visitors'
  union all
  select 8, 'path_helpers_private', true,
         to_regprocedure('private.court_photo_target(text)') is not null
         and not has_function_privilege('anon', 'private.court_photo_target(text)', 'EXECUTE')
         and not has_function_privilege('authenticated', 'private.court_photo_target(text)', 'EXECUTE')
         and not has_function_privilege('anon', 'private.can_manage_court_photo(text)', 'EXECUTE')
         and has_function_privilege('authenticated', 'private.can_manage_court_photo(text)', 'EXECUTE'),
         'only the Storage policy check is callable, and only by signed-in users'
  union all
  select 9, 'new_functions_pin_search_path', true,
         not exists (
           select 1 from new_functions f
           left join pg_proc p on p.oid = to_regprocedure(f.signature)
           where p.oid is null or not p.prosecdef or not ('search_path=""' = any(coalesce(p.proconfig, '{}')))),
         'every new or replaced function runs with definer rights and an empty search path'
  union all
  select 10, 'photo_foreign_keys_indexed', true,
         not exists (
           select 1 from pg_constraint c
           where c.conrelid = to_regclass('public.court_photos') and c.contype = 'f'
             and not exists (select 1 from pg_index i
                             where i.indrelid = c.conrelid and i.indisvalid
                               and (string_to_array(i.indkey::text, ' ')::smallint[])[1:cardinality(c.conkey)] = c.conkey)),
         'every court_photos foreign key has an index in its own column order'
  union all
  select 11, 'photo_counts', false, true,
         (select count(*)::text from public.court_photos) || ' photo records, '
         || (select count(*)::text from storage.objects where bucket_id = 'court-photos') || ' stored files'
)
select check_name, required, ok, detail from checks order by sort;
