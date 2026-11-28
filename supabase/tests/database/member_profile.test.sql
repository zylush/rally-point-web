begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select extensions.plan(42);

-- Fixture. Signing up gives every new account a Gensan membership row.
--   user 1: Gensan member who also belongs to the synthetic second club
--   user 2: another Gensan member
-- Photo file names are fixed ids eeeeeeee-eeee-4eee-8eee-00000000000N.
insert into auth.users (id, email, raw_user_meta_data)
select ('e1000000-0000-4000-8000-00000000000' || n)::uuid, 'profile-' || n || '@fixture.invalid',
       jsonb_build_object('full_name', 'Profile User ' || n)
from generate_series(1, 2) n;
insert into public.members (club_id, user_id, member_code, full_name, membership_type, status, join_date, expiry_date)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'e1000000-0000-4000-8000-000000000001', 'MP-1', 'Profile User 1',
        null, 'active', current_date, null);

-- ---------------------------------------------------------------------------
-- Structure and privileges
-- ---------------------------------------------------------------------------
select extensions.is(
  (select string_agg(column_name::text || ':' || data_type::text, ',' order by column_name::text)
   from information_schema.columns
   where table_schema = 'public' and table_name = 'profiles' and column_name in ('nickname', 'photo_path')),
  'nickname:text,photo_path:text',
  'profiles gain a nickname and a photo path');
select extensions.is(
  (select array_agg(conname::text order by conname::text) from pg_constraint
   where conrelid = 'public.profiles'::regclass and conname in ('profiles_nickname_check', 'profiles_photo_path_check')),
  array['profiles_nickname_check', 'profiles_photo_path_check'],
  'both new profile columns have named checks');
select extensions.ok(
  (select public and file_size_limit = 5242880
          and allowed_mime_types @> array['image/webp', 'image/jpeg', 'image/png']
          and array_length(allowed_mime_types, 1) = 3
   from storage.buckets where id = 'member-photos'),
  'member-photos is a public bucket limited to 5 MB JPEG, PNG and WebP');
select extensions.ok(
  (select count(*) = 3 and bool_and(p.prosecdef and 'search_path=""' = any(p.proconfig))
   from unnest(array['public.update_my_account(text, text)', 'public.set_my_photo(text)',
                     'private.is_own_member_photo(text)']) f
   join pg_proc p on p.oid = to_regprocedure(f)::oid),
  'the account functions run with definer rights and an empty search path');
select extensions.ok(
  (select bool_and(not has_function_privilege('anon', f, 'EXECUTE')
                   and not has_function_privilege('public', f, 'EXECUTE')
                   and has_function_privilege('authenticated', f, 'EXECUTE'))
   from unnest(array['public.update_my_account(text, text)', 'public.set_my_photo(text)']) f),
  'only signed-in callers reach the account functions');
select extensions.ok(
  not has_function_privilege('anon', 'private.is_own_member_photo(text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'private.is_own_member_photo(text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.tidy_name(text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.member_profile_message(text)', 'EXECUTE'),
  'only the Storage policy check is callable, and only by signed-in users');
select extensions.ok(
  not has_table_privilege('authenticated', 'public.profiles', 'INSERT, UPDATE, DELETE')
  and not has_table_privilege('anon', 'public.profiles', 'SELECT, INSERT, UPDATE, DELETE'),
  'profiles stay read-only for signed-in users and closed to visitors');
select extensions.is(
  (select array_agg(cmd::text order by cmd::text) from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and policyname like 'member_photos_%'
     and roles = '{authenticated}'
     and (coalesce(qual, '') || coalesce(with_check, '')) ~ 'member-photos'
     and (coalesce(qual, '') || coalesce(with_check, '')) ~ 'is_own_member_photo'),
  array['DELETE', 'INSERT', 'SELECT'],
  'signed-in people may upload, read and delete in their own folder');
select extensions.is(
  (select count(*)::int from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and cmd in ('UPDATE', 'ALL')
     and (coalesce(qual, '') || coalesce(with_check, '')) ~ 'member-photos'),
  0, 'no policy lets anyone overwrite a stored member photo');

-- ---------------------------------------------------------------------------
-- Visitors
-- ---------------------------------------------------------------------------
select set_config('request.headers', '', true);
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select extensions.throws_ok(
  $$select public.update_my_account('Visitor', null)$$,
  '42501', null, 'a visitor cannot change an account');
select extensions.throws_ok(
  $$select public.set_my_photo(null)$$,
  '42501', null, 'a visitor cannot set a photo');
select extensions.throws_ok(
  $$insert into storage.objects (bucket_id, name) values
    ('member-photos', 'e1000000-0000-4000-8000-000000000001/eeeeeeee-eeee-4eee-8eee-000000000001.webp')$$,
  '42501', null, 'a visitor cannot upload a member photo');

-- ---------------------------------------------------------------------------
-- User 1: name and nickname
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);

select extensions.lives_ok(
  $$select public.update_my_account(E'  Mia   Dela\tCruz ', '  Mimi  ')$$,
  'a person changes their name and nickname');
select extensions.is(
  (select full_name || '|' || nickname from public.profiles where id = 'e1000000-0000-4000-8000-000000000001'),
  'Mia Dela Cruz|Mimi',
  'the name and nickname are trimmed and their spaces collapsed');
select extensions.throws_ok(
  $$select public.update_my_account('   ', null)$$,
  '22023', 'Please enter your name', 'an empty name is refused');
select extensions.throws_ok(
  $$select public.update_my_account(repeat('a', 81), null)$$,
  '22023', 'Your name is limited to 80 characters', 'a name over 80 characters is refused');
select extensions.throws_ok(
  $$select public.update_my_account('Mia Dela Cruz', repeat('n', 31))$$,
  '22023', 'Your nickname is limited to 30 characters', 'a nickname over 30 characters is refused');
select extensions.throws_ok(
  $$update public.profiles set full_name = 'Someone Else' where id = 'e1000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'a person cannot write their profile directly');

reset role;
select extensions.is(
  (select count(*)::int from public.members
   where user_id = 'e1000000-0000-4000-8000-000000000001' and full_name = 'Mia Dela Cruz'),
  2, 'the new name is on the member card at both clubs');
select extensions.is(
  (select full_name from public.profiles where id = 'e1000000-0000-4000-8000-000000000002'),
  'Profile User 2', 'nobody else''s name changes');
select extensions.is(
  (select count(*)::int from public.members
   where user_id = 'e1000000-0000-4000-8000-000000000002' and full_name = 'Profile User 2'),
  1, 'nobody else''s member card changes');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);
select extensions.lives_ok(
  $$select public.update_my_account('Mia Dela Cruz', '   ')$$,
  'an empty nickname clears it');
select extensions.is(
  (select nickname from public.profiles where id = 'e1000000-0000-4000-8000-000000000001'),
  null, 'the nickname is cleared');

-- ---------------------------------------------------------------------------
-- User 1: photo files and the photo path
-- ---------------------------------------------------------------------------
select extensions.lives_ok(
  $$insert into storage.objects (bucket_id, name) values
    ('member-photos', 'e1000000-0000-4000-8000-000000000001/eeeeeeee-eeee-4eee-8eee-000000000001.webp')$$,
  'a person uploads a photo into their own folder');
select extensions.throws_ok(
  $$insert into storage.objects (bucket_id, name) values
    ('member-photos', 'e1000000-0000-4000-8000-000000000002/eeeeeeee-eeee-4eee-8eee-000000000002.webp')$$,
  '42501', null, 'a person cannot upload into someone else''s folder');
select extensions.throws_ok(
  $$insert into storage.objects (bucket_id, name) values
    ('member-photos', 'e1000000-0000-4000-8000-000000000001/eeeeeeee-eeee-4eee-8eee-000000000003.gif')$$,
  '42501', null, 'only webp and jpg names are accepted');
select extensions.throws_ok(
  $$insert into storage.objects (bucket_id, name) values
    ('member-photos', 'e1000000-0000-4000-8000-000000000001/nested/eeeeeeee-eeee-4eee-8eee-000000000003.jpg')$$,
  '42501', null, 'files cannot go into sub-folders');

-- At most 3 files per person (owner decision, 2026-11-25).
select extensions.lives_ok(
  $$insert into storage.objects (bucket_id, name) values
    ('member-photos', 'e1000000-0000-4000-8000-000000000001/eeeeeeee-eeee-4eee-8eee-000000000004.jpg'),
    ('member-photos', 'e1000000-0000-4000-8000-000000000001/eeeeeeee-eeee-4eee-8eee-000000000005.webp')$$,
  'a person may hold a second and a third file');
select extensions.throws_ok(
  $$insert into storage.objects (bucket_id, name) values
    ('member-photos', 'e1000000-0000-4000-8000-000000000001/eeeeeeee-eeee-4eee-8eee-000000000006.webp')$$,
  '42501', null, 'a fourth file is refused');
-- The Storage API deletes with this setting on; the person's own-folder delete rule still applies.
select set_config('storage.allow_delete_query', 'true', true);
select extensions.lives_ok(
  $$delete from storage.objects where bucket_id = 'member-photos'
    and name in ('e1000000-0000-4000-8000-000000000001/eeeeeeee-eeee-4eee-8eee-000000000004.jpg',
                 'e1000000-0000-4000-8000-000000000001/eeeeeeee-eeee-4eee-8eee-000000000005.webp')$$,
  'a person clears their own leftover files');
select set_config('storage.allow_delete_query', 'false', true);
select extensions.is(
  (select count(*)::int from storage.objects
   where bucket_id = 'member-photos' and name like 'e1000000-0000-4000-8000-000000000001/%'),
  1, 'only the first photo is left');
select extensions.ok(
  has_function_privilege('authenticated', 'private.member_photo_folder_has_room()', 'EXECUTE')
  and not has_function_privilege('anon', 'private.member_photo_folder_has_room()', 'EXECUTE'),
  'the folder limit check is callable by signed-in people only');

select extensions.throws_ok(
  $$select public.set_my_photo('e1000000-0000-4000-8000-000000000002/eeeeeeee-eeee-4eee-8eee-000000000002.webp')$$,
  '22023', 'This photo is not in your folder', 'a person cannot point their profile at someone else''s photo');
select extensions.throws_ok(
  $$select public.set_my_photo('e1000000-0000-4000-8000-000000000001/eeeeeeee-eeee-4eee-8eee-000000000009.jpg')$$,
  'P0002', 'Upload the photo first', 'a photo must be uploaded before it is recorded');
select extensions.lives_ok(
  $$select public.set_my_photo('e1000000-0000-4000-8000-000000000001/eeeeeeee-eeee-4eee-8eee-000000000001.webp')$$,
  'a person records their uploaded photo');
select extensions.is(
  (select photo_path from public.profiles where id = 'e1000000-0000-4000-8000-000000000001'),
  'e1000000-0000-4000-8000-000000000001/eeeeeeee-eeee-4eee-8eee-000000000001.webp',
  'the profile holds the photo path');

-- User 2 uploads their own photo; user 1 cannot see it to delete it.
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000002', true);
select extensions.lives_ok(
  $$insert into storage.objects (bucket_id, name) values
    ('member-photos', 'e1000000-0000-4000-8000-000000000002/eeeeeeee-eeee-4eee-8eee-000000000002.webp')$$,
  'another person uploads into their own folder');
select extensions.throws_ok(
  $$select public.set_my_photo('e1000000-0000-4000-8000-000000000001/eeeeeeee-eeee-4eee-8eee-000000000001.webp')$$,
  '22023', 'This photo is not in your folder', 'they cannot set user 1''s photo as theirs');
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);
select extensions.is(
  (select count(*)::int from storage.objects
   where bucket_id = 'member-photos' and name like 'e1000000-0000-4000-8000-000000000002/%'),
  0, 'a person cannot read (or so delete) files in someone else''s folder');

select extensions.lives_ok(
  $$select public.set_my_photo(null)$$,
  'a person removes their photo');

reset role;
select extensions.is(
  (select coalesce(a.photo_path, 'none') || '|' || coalesce(b.photo_path, 'none')
   from public.profiles a, public.profiles b
   where a.id = 'e1000000-0000-4000-8000-000000000001' and b.id = 'e1000000-0000-4000-8000-000000000002'),
  'none|none', 'the photo is cleared and the other person''s profile was never touched');

-- Hidden characters cannot disguise a name at the desk (security review, 2026-11-25).
select extensions.is(
  private.tidy_name(E'Mia​ ‮Santos  Cruz'),
  'Mia Santos Cruz',
  'names lose control, zero-width and direction characters');

select * from extensions.finish();
rollback;
