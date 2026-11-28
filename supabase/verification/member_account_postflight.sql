-- Member account postflight. Read-only: catalog, ledger and counts only.
-- Run against the target after 20261125090000_member_profile.sql and
-- 20261125090100_membership_requests.sql. Every row with required = true must have ok = true.
-- This release adds a nickname and a profile photo to profiles (written only through
-- update_my_account and set_my_photo), the public member-photos Storage bucket with
-- own-folder policies, the closed membership_requests table with its request, wallet
-- and staff decision functions, and three more fields in check_in_qr's member object.
-- schema_fingerprint.sql covers the public schema only, so the Storage bucket and the
-- policies on storage.objects are checked here. No booking is written, so the
-- reservation-write pause is unchanged.
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
), account_functions(signature) as (
  values
    ('public.update_my_account(text, text)'),
    ('public.set_my_photo(text)'),
    ('public.list_my_member_passes()'),
    ('public.request_club_membership(uuid)'),
    ('public.cancel_my_membership_request(uuid)'),
    ('public.staff_list_membership_requests(text)'),
    ('public.staff_approve_membership_request(uuid, public.membership_type, numeric)'),
    ('public.staff_decline_membership_request(uuid, text)'),
    ('public.check_in_qr(text, uuid)')
), closed_helpers(signature) as (
  values
    ('private.tidy_name(text)'),
    ('private.member_profile_message(text)'),
    ('private.membership_is_active(public.membership_type, public.member_status, date)'),
    ('private.require_membership_desk()'),
    ('private.pending_membership_request(uuid, uuid)')
), definer_functions(signature) as (
  select signature from account_functions
  union all values ('private.is_own_member_photo(text)'), ('private.member_photo_folder_has_room()'),
                   ('private.require_membership_desk()'), ('private.pending_membership_request(uuid, uuid)')
), new_functions(signature) as (
  select signature from account_functions
  union all select signature from closed_helpers
  union all values ('private.is_own_member_photo(text)'), ('private.member_photo_folder_has_room()')
), photo_policies as (
  select policyname, cmd, roles, coalesce(qual, '') || coalesce(with_check, '') as rule
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects' and policyname like 'member_photos_%'
), checks(sort, check_name, required, ok, detail) as (
  select 1, 'ledger_has_member_account', true,
         exists (select 1 from supabase_migrations.schema_migrations where version = '20261125090000')
         and exists (select 1 from supabase_migrations.schema_migrations where version = '20261125090100')
         and (select count(*) from supabase_migrations.schema_migrations) = 36,
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
  select 3, 'profile_columns_read_only', true,
         (select count(*) from information_schema.columns
          where table_schema = 'public' and table_name = 'profiles'
            and column_name in ('nickname', 'photo_path') and data_type = 'text') = 2
         and (select count(*) from pg_constraint
              where conrelid = 'public.profiles'::regclass and contype = 'c'
                and conname in ('profiles_nickname_check', 'profiles_photo_path_check')) = 2
         and not has_table_privilege('anon', 'public.profiles', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE')
         and not has_table_privilege('authenticated', 'public.profiles', 'INSERT, UPDATE, DELETE, TRUNCATE'),
         'profiles have a checked nickname and photo path, and stay read-only for signed-in users'
  union all
  select 4, 'member_photo_bucket_public_and_limited', true,
         exists (select 1 from storage.buckets
                 where id = 'member-photos' and public and file_size_limit = 5242880
                   and allowed_mime_types @> array['image/webp', 'image/jpeg', 'image/png']
                   and array_length(allowed_mime_types, 1) = 3),
         'member-photos is public, 5 MB, JPEG/PNG/WebP only'
  union all
  select 5, 'member_photo_files_own_folder_only', true,
         (select count(*) from photo_policies) = 3
         and (select array_agg(cmd::text order by cmd::text) from photo_policies) = array['DELETE', 'INSERT', 'SELECT']
         and not exists (
           select 1 from photo_policies
           where roles <> '{authenticated}'
              or rule !~ 'member-photos'
              or rule !~ 'is_own_member_photo'
              or (cmd = 'INSERT' and rule !~ 'member_photo_folder_has_room'))
         and not exists (
           select 1 from pg_policies
           where schemaname = 'storage' and tablename = 'objects' and cmd in ('UPDATE', 'ALL')
             and coalesce(qual, '') || coalesce(with_check, '') ~ 'member-photos'),
         'signed-in people may upload (at most 3 files), read and delete only in their own folder; nobody may overwrite'
  union all
  select 6, 'request_table_closed', true,
         to_regclass('public.membership_requests') is not null
         and (select relrowsecurity from pg_class where oid = to_regclass('public.membership_requests'))
         and not exists (
           select 1 from api_roles r
           where has_table_privilege(r.name, 'public.membership_requests', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE'))
         and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'membership_requests') = 1
         and exists (select 1 from pg_policies
                     where schemaname = 'public' and tablename = 'membership_requests'
                       and policyname = 'no_direct_api_access' and permissive = 'RESTRICTIVE'
                       and cmd = 'ALL' and qual = 'false'),
         'membership_requests has row security, one restrictive deny policy, and no direct API access'
  union all
  select 7, 'account_functions_signed_in_only', true,
         not exists (
           select 1 from account_functions f
           where to_regprocedure(f.signature) is null
              or has_function_privilege('public', to_regprocedure(f.signature), 'EXECUTE')
              or has_function_privilege('anon', to_regprocedure(f.signature), 'EXECUTE')
              or not has_function_privilege('authenticated', to_regprocedure(f.signature), 'EXECUTE')),
         'the nine account, wallet, request and check-in functions need a signed-in caller (they check the caller inside)'
  union all
  select 8, 'account_helpers_private', true,
         not exists (
           select 1 from closed_helpers f, api_roles r
           where to_regprocedure(f.signature) is null
              or has_function_privilege(r.name, to_regprocedure(f.signature), 'EXECUTE'))
         and to_regprocedure('private.is_own_member_photo(text)') is not null
         and not has_function_privilege('anon', 'private.is_own_member_photo(text)', 'EXECUTE')
         and has_function_privilege('authenticated', 'private.is_own_member_photo(text)', 'EXECUTE')
         and to_regprocedure('private.member_photo_folder_has_room()') is not null
         and not has_function_privilege('anon', 'private.member_photo_folder_has_room()', 'EXECUTE')
         and has_function_privilege('authenticated', 'private.member_photo_folder_has_room()', 'EXECUTE'),
         'only the Storage policy checks are callable, and only by signed-in users'
  union all
  select 9, 'new_functions_pin_search_path', true,
         not exists (
           select 1 from new_functions f
           left join pg_proc p on p.oid = to_regprocedure(f.signature)
           where p.oid is null or not ('search_path=""' = any(coalesce(p.proconfig, '{}'))))
         and not exists (
           select 1 from definer_functions f
           left join pg_proc p on p.oid = to_regprocedure(f.signature)
           where p.oid is null or not p.prosecdef),
         'every new or replaced function has an empty search path, and the callable ones run with definer rights'
  union all
  select 10, 'one_pending_request_per_club', true,
         exists (select 1 from pg_index i
                 where i.indexrelid = to_regclass('public.membership_requests_one_pending')
                   and i.indisunique and i.indisvalid
                   and pg_get_expr(i.indpred, i.indrelid) ~ 'pending'),
         'a partial unique index allows one pending request per person per club'
  union all
  select 11, 'request_foreign_keys_indexed', true,
         not exists (
           select 1 from pg_constraint c
           where c.conrelid = to_regclass('public.membership_requests') and c.contype = 'f'
             and not exists (select 1 from pg_index i
                             where i.indrelid = c.conrelid and i.indisvalid and i.indpred is null
                               and (string_to_array(i.indkey::text, ' ')::smallint[])[1:cardinality(c.conkey)] = c.conkey)),
         'every membership_requests foreign key has an index in its own column order'
  union all
  select 12, 'membership_charges_earn_no_commission', true,
         exists (select 1 from pg_trigger t
                 where t.tgrelid = 'public.transactions'::regclass
                   and t.tgname = 'transactions_record_platform_commission' and t.tgenabled <> 'D')
         and not exists (select 1 from pg_trigger t
                         where t.tgrelid = 'public.transactions'::regclass
                           and t.tgname = 'transactions_record_platform_commission'
                           and pg_get_triggerdef(t.oid) ~ 'membership'),
         'the commission trigger still covers court time only, never membership charges'
  union all
  select 13, 'member_account_counts', false, true,
         (select count(*)::text from public.profiles where nickname is not null) || ' nicknames, '
         || (select count(*)::text from public.profiles where photo_path is not null) || ' profile photos, '
         || (select count(*)::text from public.membership_requests) || ' membership requests ('
         || (select count(*)::text from public.membership_requests where status = 'pending') || ' pending), '
         || (select count(*)::text from storage.objects where bucket_id = 'member-photos') || ' stored member photos'
)
select check_name, required, ok, detail from checks order by sort;
