begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select extensions.plan(42);

-- Fixture:
--   user 1: Gensan admin
--   user 2: Gensan staff
--   user 3: no club role (plain account)
--   user 4: admin of the synthetic second club only
-- From supabase/seed.sql: Gensan (aaaa...aaaa) venue Rally Point Lagao (...aaac) with
-- Lagao Court A (...aaad) and B (...aaae); second club (bbbb...bbbb) Synthetic Court A (...bbbe).
-- Photo file names are fixed ids dddddddd-dddd-4ddd-8ddd-00000000000N.
insert into auth.users (id, email, raw_user_meta_data)
select ('c7000000-0000-4000-8000-00000000000' || n)::uuid, 'photo-' || n || '@fixture.invalid',
       jsonb_build_object('full_name', 'Photo User ' || n)
from generate_series(1, 4) n;
insert into public.club_staff_roles (club_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c7000000-0000-4000-8000-000000000001', 'admin'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c7000000-0000-4000-8000-000000000002', 'staff'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'c7000000-0000-4000-8000-000000000004', 'admin');

-- ---------------------------------------------------------------------------
-- Structure and privileges
-- ---------------------------------------------------------------------------
select extensions.ok(
  (select public and file_size_limit = 5242880
          and allowed_mime_types @> array['image/webp', 'image/jpeg', 'image/png']
          and array_length(allowed_mime_types, 1) = 3
   from storage.buckets where id = 'court-photos'),
  'court-photos is a public bucket limited to 5 MB JPEG, PNG and WebP');
select extensions.ok(
  (select relrowsecurity from pg_class where oid = 'public.court_photos'::regclass),
  'court_photos has row security');
select extensions.ok(
  not has_table_privilege('anon', 'public.court_photos', 'SELECT, INSERT, UPDATE, DELETE'),
  'visitors cannot touch court_photos directly');
select extensions.ok(
  not has_table_privilege('authenticated', 'public.court_photos', 'INSERT, UPDATE, DELETE, TRUNCATE'),
  'signed-in users cannot write court_photos directly');
select extensions.ok(
  (select bool_and(prosecdef and 'search_path=""' = any(proconfig)) from pg_proc
   where oid in ('public.admin_add_court_photo(uuid, text)'::regprocedure,
                 'public.admin_make_main_court_photo(uuid)'::regprocedure,
                 'public.admin_remove_court_photo(uuid)'::regprocedure,
                 'public.admin_set_venue_cover(uuid, text)'::regprocedure,
                 'public.list_public_club_covers()'::regprocedure,
                 'private.court_photo_target(text)'::regprocedure,
                 'private.can_manage_court_photo(text)'::regprocedure)),
  'photo functions run with definer rights and an empty search path');
select extensions.ok(
  not has_function_privilege('anon', 'public.admin_add_court_photo(uuid, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.admin_make_main_court_photo(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.admin_remove_court_photo(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.admin_set_venue_cover(uuid, text)', 'EXECUTE'),
  'visitors cannot run the admin photo functions');
select extensions.ok(
  has_function_privilege('anon', 'public.list_public_club_covers()', 'EXECUTE')
  and has_function_privilege('anon', 'public.get_public_club_detail(text)', 'EXECUTE'),
  'visitors can read club covers and the club page');
select extensions.ok(
  not has_function_privilege('authenticated', 'private.court_photo_target(text)', 'EXECUTE')
  and not has_function_privilege('anon', 'private.can_manage_court_photo(text)', 'EXECUTE'),
  'the path helpers stay private');
select extensions.is(
  (select count(*)::int from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and policyname like 'court_photos_%' and cmd = 'UPDATE'),
  0, 'no policy lets anyone overwrite a stored photo');

-- ---------------------------------------------------------------------------
-- User 1: Gensan admin, no club header (Gensan by default)
-- ---------------------------------------------------------------------------
select set_config('request.headers', '', true);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c7000000-0000-4000-8000-000000000001', true);

select extensions.lives_ok(
  $$insert into storage.objects (bucket_id, name) values
    ('court-photos', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/courts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad/dddddddd-dddd-4ddd-8ddd-000000000001.webp'),
    ('court-photos', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/courts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad/dddddddd-dddd-4ddd-8ddd-000000000002.jpg'),
    ('court-photos', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/courts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae/dddddddd-dddd-4ddd-8ddd-000000000003.webp'),
    ('court-photos', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/venues/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac/dddddddd-dddd-4ddd-8ddd-000000000004.webp'),
    ('court-photos', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/venues/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac/dddddddd-dddd-4ddd-8ddd-000000000005.png')$$,
  'an admin uploads into their club''s court and location folders');
select extensions.throws_ok(
  $$insert into storage.objects (bucket_id, name) values
    ('court-photos', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/courts/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbe/dddddddd-dddd-4ddd-8ddd-000000000006.webp')$$,
  '42501', null, 'an admin cannot upload into another club''s folder');
select extensions.throws_ok(
  $$insert into storage.objects (bucket_id, name) values
    ('court-photos', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/courts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad/dddddddd-dddd-4ddd-8ddd-000000000006.webp')$$,
  '42501', null, 'a folder pairing another club with this club''s court is refused');
select extensions.throws_ok(
  $$insert into storage.objects (bucket_id, name) values
    ('court-photos', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/courts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad/anything.webp')$$,
  '42501', null, 'badly named files are refused');
select extensions.throws_ok(
  $$insert into storage.objects (bucket_id, name) values
    ('court-photos', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/courts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad/dddddddd-dddd-4ddd-8ddd-000000000007.gif')$$,
  '42501', null, 'only webp, jpg and png names are accepted');

select extensions.throws_ok(
  $$select public.admin_add_court_photo('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/courts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad/dddddddd-dddd-4ddd-8ddd-000000000009.webp')$$,
  'P0002', 'Upload the photo first', 'a photo must be uploaded before it is recorded');
select extensions.throws_ok(
  $$select public.admin_add_court_photo('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/courts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae/dddddddd-dddd-4ddd-8ddd-000000000003.webp')$$,
  '22023', 'This photo is not in this court''s folder', 'another court''s photo cannot be attached to this court');
select extensions.throws_ok(
  $$select public.admin_add_court_photo('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbe',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/courts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad/dddddddd-dddd-4ddd-8ddd-000000000001.webp')$$,
  'P0002', 'court not found', 'another club''s court is not found');

select extensions.is(
  (select position from public.admin_add_court_photo('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/courts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad/dddddddd-dddd-4ddd-8ddd-000000000001.webp')),
  0, 'the first photo of a court is its main photo');
select extensions.is(
  (select position from public.admin_add_court_photo('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/courts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad/dddddddd-dddd-4ddd-8ddd-000000000002.jpg')),
  1, 'later photos follow it');
select extensions.throws_ok(
  $$select public.admin_add_court_photo('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/courts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad/dddddddd-dddd-4ddd-8ddd-000000000001.webp')$$,
  '23505', null, 'the same file cannot be recorded twice');

select extensions.lives_ok(
  $$select public.admin_make_main_court_photo(
    (select id from public.court_photos where path like '%000000000002.jpg'))$$,
  'an admin picks a different main photo');
select extensions.is(
  (select array_agg(right(path, 8) order by position) from public.court_photos where court_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad'),
  array['0002.jpg', '001.webp'],
  'the chosen photo now comes first');

select extensions.is(
  public.admin_set_venue_cover('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/venues/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac/dddddddd-dddd-4ddd-8ddd-000000000004.webp'),
  null, 'a first cover replaces nothing');
select extensions.is(
  public.admin_set_venue_cover('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/venues/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac/dddddddd-dddd-4ddd-8ddd-000000000005.png'),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/venues/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac/dddddddd-dddd-4ddd-8ddd-000000000004.webp',
  'a new cover returns the old one, so its file can be deleted');
select extensions.throws_ok(
  $$select public.admin_set_venue_cover('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/courts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad/dddddddd-dddd-4ddd-8ddd-000000000001.webp')$$,
  '22023', 'This photo is not in this location''s folder', 'a court photo cannot become a location cover');
select extensions.is(
  (select count(*)::int from public.court_photos),
  3, 'an admin reads their club''s photo records: two court photos and one cover');

-- ---------------------------------------------------------------------------
-- Public pages (as a visitor)
-- ---------------------------------------------------------------------------
reset role;
-- Kept for the cross-club check below, where row security hides the record.
select set_config('test.gensan_photo', (select id::text from public.court_photos where path like '%000000000001.webp'), true);
set local role anon;
select set_config('request.jwt.claim.sub', '', true);

select extensions.is(
  (select ct -> 'photos'
   from jsonb_array_elements(public.get_public_club_detail('rally-point-gensan') -> 'venues') v,
        jsonb_array_elements(v -> 'courts') ct
   where ct ->> 'id' = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad'),
  jsonb_build_array(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/courts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad/dddddddd-dddd-4ddd-8ddd-000000000002.jpg',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/courts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad/dddddddd-dddd-4ddd-8ddd-000000000001.webp'),
  'visitors see a court''s photos right away, main photo first');
select extensions.is(
  (select v ->> 'cover_photo'
   from jsonb_array_elements(public.get_public_club_detail('rally-point-gensan') -> 'venues') v
   where v ->> 'id' = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac'),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/venues/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac/dddddddd-dddd-4ddd-8ddd-000000000005.png',
  'visitors see the location cover');
select extensions.is(
  (select ct -> 'photos'
   from jsonb_array_elements(public.get_public_club_detail('rally-point-gensan') -> 'venues') v,
        jsonb_array_elements(v -> 'courts') ct
   where ct ->> 'id' = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae'),
  '[]'::jsonb, 'a court without photos lists none');
select extensions.is(
  (select cover_photo from public.list_public_club_covers() where slug = 'rally-point-gensan'),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/venues/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac/dddddddd-dddd-4ddd-8ddd-000000000005.png',
  'the club card uses a location cover');
select extensions.is(
  (select cover_photo from public.list_public_club_covers() where slug = 'synthetic-second-club'),
  null, 'a club without photos has no cover, so the app shows a sample picture');
select extensions.throws_ok(
  $$insert into storage.objects (bucket_id, name) values
    ('court-photos', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/courts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad/dddddddd-dddd-4ddd-8ddd-000000000008.webp')$$,
  '42501', null, 'visitors cannot upload');

-- ---------------------------------------------------------------------------
-- User 2: Gensan staff
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c7000000-0000-4000-8000-000000000002', true);

select extensions.throws_ok(
  $$insert into storage.objects (bucket_id, name) values
    ('court-photos', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/courts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad/dddddddd-dddd-4ddd-8ddd-000000000008.webp')$$,
  '42501', null, 'staff cannot upload photos');
select extensions.throws_ok(
  $$select public.admin_remove_court_photo('00000000-0000-4000-8000-000000000000')$$,
  '42501', 'admin access required', 'staff cannot remove photos');
select extensions.is(
  (select count(*)::int from public.court_photos), 0, 'staff do not read photo records');

-- ---------------------------------------------------------------------------
-- User 3: plain account
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'c7000000-0000-4000-8000-000000000003', true);
select extensions.ok(
  not private.can_manage_court_photo(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/courts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad/dddddddd-dddd-4ddd-8ddd-000000000001.webp'),
  'a plain account cannot manage, and so cannot delete, a club''s photos');

-- ---------------------------------------------------------------------------
-- User 4: admin of the second club only, naming each club in the header
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'c7000000-0000-4000-8000-000000000004', true);
select set_config('request.headers', '{"x-club-id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}', true);
select extensions.throws_ok(
  $$select public.admin_set_venue_cover('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac', null)$$,
  '42501', 'admin access required', 'naming Gensan in the header does not make another club''s admin a Gensan admin');
select extensions.ok(
  not private.can_manage_court_photo(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/courts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad/dddddddd-dddd-4ddd-8ddd-000000000001.webp'),
  'another club''s admin cannot manage Gensan''s files');

select set_config('request.headers', '{"x-club-id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}', true);
select extensions.throws_ok(
  $$select public.admin_remove_court_photo(current_setting('test.gensan_photo')::uuid)$$,
  'P0002', 'photo not found', 'another club''s admin cannot remove Gensan photos');
select extensions.is(
  (select count(*)::int from public.court_photos), 0, 'another club''s admin reads none of Gensan''s photo records');

-- ---------------------------------------------------------------------------
-- Back to the Gensan admin: removing, and the 8-photo limit
-- ---------------------------------------------------------------------------
select set_config('request.headers', '', true);
select set_config('request.jwt.claim.sub', 'c7000000-0000-4000-8000-000000000001', true);

select extensions.is(
  public.admin_remove_court_photo((select id from public.court_photos where path like '%000000000002.jpg')),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/courts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad/dddddddd-dddd-4ddd-8ddd-000000000002.jpg',
  'removing a photo returns its path, so the app can delete the file');

reset role;
-- Fill Court A up to 8 records (1 left + 7 placeholders) and upload one more file.
insert into public.court_photos (club_id, venue_id, court_id, path, position)
select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad', 'placeholder/' || n, 10 + n
from generate_series(1, 7) n;
insert into storage.objects (bucket_id, name) values
  ('court-photos', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/courts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad/dddddddd-dddd-4ddd-8ddd-000000000008.webp');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c7000000-0000-4000-8000-000000000001', true);
select extensions.throws_ok(
  $$select public.admin_add_court_photo('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/courts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad/dddddddd-dddd-4ddd-8ddd-000000000008.webp')$$,
  '22023', 'A court can have up to 8 photos', 'a court holds at most 8 photos');

select * from extensions.finish();
rollback;
