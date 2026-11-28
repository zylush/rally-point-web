begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select extensions.plan(76);

-- Fixture:
--   user 1: Gensan admin
--   user 2: Gensan staff
--   user 3: no club role (plain account)
--   user 4: admin of the synthetic second club only
-- From supabase/seed.sql: Gensan (aaaa...aaaa, slug rally-point-gensan) and the
-- second club (bbbb...bbbb, slug synthetic-second-club).
-- Picture file names are fixed ids eeeeeeee-eeee-4eee-8eee-00000000000N.
insert into auth.users (id, email, raw_user_meta_data)
select ('e8000000-0000-4000-8000-00000000000' || n)::uuid, 'profile-' || n || '@fixture.invalid',
       jsonb_build_object('full_name', 'Profile User ' || n)
from generate_series(1, 4) n;
insert into public.club_staff_roles (club_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'e8000000-0000-4000-8000-000000000001', 'admin'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'e8000000-0000-4000-8000-000000000002', 'staff'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'e8000000-0000-4000-8000-000000000004', 'admin');

-- ---------------------------------------------------------------------------
-- Structure and privileges
-- ---------------------------------------------------------------------------
select extensions.ok(
  (select bool_and(relrowsecurity) from pg_class
   where oid in ('public.club_profiles'::regclass, 'public.club_addons'::regclass, 'public.club_coaches'::regclass,
                 'public.club_payment_methods'::regclass, 'public.club_gallery_photos'::regclass)),
  'every profile table has row security');
select extensions.ok(
  not exists (
    select 1 from unnest(array['public.club_profiles', 'public.club_addons', 'public.club_coaches',
                               'public.club_payment_methods', 'public.club_gallery_photos']) t
    where has_table_privilege('anon', t, 'SELECT, INSERT, UPDATE, DELETE')
  ),
  'visitors cannot touch the profile tables directly');
select extensions.ok(
  not exists (
    select 1 from unnest(array['public.club_profiles', 'public.club_addons', 'public.club_coaches',
                               'public.club_payment_methods', 'public.club_gallery_photos']) t
    where has_table_privilege('authenticated', t, 'SELECT, INSERT, UPDATE, DELETE')
  ),
  'signed-in users cannot read or write the profile tables directly');
select extensions.ok(
  (select bool_and(prosecdef and 'search_path=""' = any(proconfig)) from pg_proc
   where oid in ('public.admin_club_profile()'::regprocedure,
                 'public.admin_update_club_profile(text, text, text, text, text, text, text, text[], text, text, text, text)'::regprocedure,
                 'public.admin_upsert_club_addon(uuid, text, text, numeric, text, boolean)'::regprocedure,
                 'public.admin_remove_club_addon(uuid)'::regprocedure,
                 'public.admin_upsert_club_coach(uuid, text, text, text, numeric, text, text, boolean)'::regprocedure,
                 'public.admin_set_club_coach_photo(uuid, text)'::regprocedure,
                 'public.admin_remove_club_coach(uuid)'::regprocedure,
                 'public.admin_upsert_club_payment_method(uuid, text, text, text, boolean)'::regprocedure,
                 'public.admin_set_club_payment_qr(uuid, text)'::regprocedure,
                 'public.admin_remove_club_payment_method(uuid)'::regprocedure,
                 'public.admin_add_club_photo(text, text)'::regprocedure,
                 'public.admin_remove_club_photo(uuid)'::regprocedure,
                 'public.admin_unused_club_pictures()'::regprocedure,
                 'public.get_public_club_profile(text)'::regprocedure,
                 'private.require_club_admin()'::regprocedure,
                 'private.club_media_target(text)'::regprocedure,
                 'private.can_manage_club_media(text)'::regprocedure,
                 'private.require_club_media(uuid, text, text)'::regprocedure)),
  'profile functions run with definer rights and an empty search path');
select extensions.ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('admin_club_profile', 'admin_update_club_profile', 'admin_upsert_club_addon',
                        'admin_remove_club_addon', 'admin_upsert_club_coach', 'admin_set_club_coach_photo',
                        'admin_remove_club_coach', 'admin_upsert_club_payment_method', 'admin_set_club_payment_qr',
                        'admin_remove_club_payment_method', 'admin_add_club_photo', 'admin_remove_club_photo',
                        'admin_unused_club_pictures')
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  ),
  'visitors cannot run any admin profile function');
select extensions.ok(
  has_function_privilege('anon', 'public.get_public_club_profile(text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.get_public_club_profile(text)', 'EXECUTE'),
  'everyone can read a club''s public profile');
select extensions.ok(
  not has_function_privilege('authenticated', 'private.require_club_admin()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.club_media_target(text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.require_club_media(uuid, text, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.club_profile_message(text)', 'EXECUTE')
  and not has_function_privilege('anon', 'private.can_manage_club_media(text)', 'EXECUTE'),
  'the helpers stay private');
select extensions.is(
  (select count(*)::int from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and policyname like 'club_media_%' and cmd = 'UPDATE'),
  0, 'no policy lets anyone overwrite a stored club picture');

-- ---------------------------------------------------------------------------
-- User 1: Gensan admin, no club header (Gensan by default)
-- ---------------------------------------------------------------------------
select set_config('request.headers', '', true);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e8000000-0000-4000-8000-000000000001', true);

select extensions.is(
  (select terms from public.admin_update_club_profile(
    p_about => 'Six indoor courts in General Santos.',
    p_phone => '0917 123 4567',
    p_email => 'Hello@RallyPoint.ph',
    p_facebook_url => 'https://www.facebook.com/rallypointgensan',
    p_messenger_url => 'https://m.me/rallypointgensan',
    p_instagram_url => null,
    p_website_url => 'https://rallypoint.ph',
    p_amenities => array['parking', 'night_lights', 'parking'],
    p_payment_note => 'Pay at the desk.',
    p_house_rules => 'Non-marking shoes only.',
    p_cancellation_policy => null,
    p_terms => '   ')),
  null, 'an admin saves the profile, and blank text is stored as empty');
select extensions.is(
  public.admin_club_profile() -> 'profile' ->> 'email',
  'hello@rallypoint.ph', 'the email is kept in lower case');
select extensions.is(
  public.admin_club_profile() -> 'profile' -> 'amenities',
  '["night_lights", "parking"]'::jsonb, 'amenities are stored once each, in order');
select extensions.throws_ok(
  $$select public.admin_update_club_profile(null, null, null, 'https://facebook.com.evil.example/page',
    null, null, null, '{}', null, null, null, null)$$,
  '22023', 'The Facebook link must start with https://facebook.com/ or https://fb.com/',
  'a "Facebook" link to another site is refused');
select extensions.throws_ok(
  $$select public.admin_update_club_profile(null, null, null, null, null, null, 'http://rallypoint.ph',
    '{}', null, null, null, null)$$,
  '22023', 'The website link must start with https:// and name a web address, like https://yourclub.ph', 'a link without https is refused');
select extensions.throws_ok(
  $$select public.admin_update_club_profile(null, null, null, null, null, null, 'https://192.168.0.1/',
    '{}', null, null, null, null)$$,
  '22023', 'The website link must start with https:// and name a web address, like https://yourclub.ph', 'a website given as an IP address is refused');
select extensions.throws_ok(
  $$select public.admin_update_club_profile(null, null, null, null, null, null, 'https://rallypoint.ph:8443/',
    '{}', null, null, null, null)$$,
  '22023', 'The website link must start with https:// and name a web address, like https://yourclub.ph', 'a website with a port number is refused');
select extensions.throws_ok(
  $$select public.admin_update_club_profile(null, null, null, null, 'javascript:alert(1)', null, null,
    '{}', null, null, null, null)$$,
  '22023', 'The Messenger link must start with https://m.me/', 'a script link is refused');
select extensions.throws_ok(
  $$select public.admin_update_club_profile(null, null, null, null, null, null, null,
    array['helipad'], null, null, null, null)$$,
  '22023', 'Pick amenities from the list', 'only listed amenities are accepted');

-- Add-ons
select extensions.is(
  (select name from public.admin_upsert_club_addon(null, ' Paddle rental ', 'Two paddles', 100, 'per_hour', true)),
  'Paddle rental', 'an admin adds an add-on, name trimmed');
select extensions.throws_ok(
  $$select public.admin_upsert_club_addon(null, 'PADDLE RENTAL', null, 120, 'per_hour', true)$$,
  '23505', 'This club already has an add-on with that name', 'add-on names are unique in a club, whatever the case');
select extensions.throws_ok(
  $$select public.admin_upsert_club_addon(null, 'Balls', null, 10.555, 'per_item', true)$$,
  '22023', 'Price must be between 0 and 100,000 pesos', 'prices are whole centavos');
select extensions.throws_ok(
  $$select public.admin_upsert_club_addon(null, 'Balls', null, 10, 'per_day', true)$$,
  '22023', 'Choose how the price is charged', 'only known price units are accepted');
select extensions.throws_ok(
  $$select public.admin_upsert_club_addon(null, '   ', null, 10, 'per_item', true)$$,
  '22023', 'Add-on name must be 1 to 60 characters', 'an add-on needs a name');
select extensions.lives_ok(
  $$select public.admin_upsert_club_addon(null, 'Ball rental', null, 50, 'per_item', false)$$,
  'an admin can add a hidden add-on');

-- Coaches
select extensions.is(
  (select full_name from public.admin_upsert_club_coach(null, 'Coach Ana', 'Beginners', null, 500, '0917 000 0000',
    'https://m.me/coachana', true)),
  'Coach Ana', 'an admin adds a coach');
select extensions.throws_ok(
  $$select public.admin_upsert_club_coach(null, 'Coach Cy', null, null, null, null, 'http://coach.example', true)$$,
  '22023', 'The coach''s link must start with https:// and name a web address, like https://m.me/coachana', 'a coach link without https is refused');
select extensions.throws_ok(
  $$select public.admin_upsert_club_coach(null, 'Coach Cy', null, null, null, null, 'https://-coach.example', true)$$,
  '22023', 'The coach''s link must start with https:// and name a web address, like https://m.me/coachana', 'a coach link whose address starts with a hyphen is refused');
select extensions.lives_ok(
  $$select public.admin_upsert_club_coach(null, 'Coach Ben', null, null, null, null, null, false)$$,
  'an admin can add a hidden coach');

-- Payment methods
select extensions.is(
  (select label from public.admin_upsert_club_payment_method(null, 'GCash', 'Rally Point Gensan', '0917 111 1111', true)),
  'GCash', 'an admin adds a payment method');

-- Storage folders
select extensions.lives_ok(
  $$insert into storage.objects (bucket_id, name) values
    ('court-photos', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/gallery/eeeeeeee-eeee-4eee-8eee-000000000001.webp'),
    ('court-photos', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/gallery/eeeeeeee-eeee-4eee-8eee-000000000002.jpg'),
    ('court-photos', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/payment/eeeeeeee-eeee-4eee-8eee-000000000003.png'),
    ('court-photos', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/payment/eeeeeeee-eeee-4eee-8eee-000000000004.webp'),
    ('court-photos', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/coaches/eeeeeeee-eeee-4eee-8eee-000000000005.webp')$$,
  'an admin uploads into their club''s gallery, payment and coach folders');
select extensions.throws_ok(
  $$insert into storage.objects (bucket_id, name) values
    ('court-photos', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/gallery/eeeeeeee-eeee-4eee-8eee-000000000006.webp')$$,
  '42501', null, 'an admin cannot upload into another club''s folder');
select extensions.throws_ok(
  $$insert into storage.objects (bucket_id, name) values
    ('court-photos', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/gallery/photo.webp')$$,
  '42501', null, 'badly named club pictures are refused');
select extensions.throws_ok(
  $$insert into storage.objects (bucket_id, name) values
    ('court-photos', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/menus/eeeeeeee-eeee-4eee-8eee-000000000007.webp')$$,
  '42501', null, 'unknown folders are refused');

-- Record ids for the steps below (the tables are not readable by API roles).
reset role;
select set_config('test.paddle', (select id::text from public.club_addons where name = 'Paddle rental'), true);
select set_config('test.ana', (select id::text from public.club_coaches where full_name = 'Coach Ana'), true);
select set_config('test.gcash', (select id::text from public.club_payment_methods where label = 'GCash'), true);
select set_config('test.ben', (select id::text from public.club_coaches where full_name = 'Coach Ben'), true);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e8000000-0000-4000-8000-000000000001', true);

select extensions.throws_ok(
  $$select public.admin_add_club_photo('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/gallery/eeeeeeee-eeee-4eee-8eee-000000000009.webp', null)$$,
  'P0002', 'Upload the picture first', 'a gallery photo must be uploaded before it is recorded');
select extensions.throws_ok(
  $$select public.admin_add_club_photo('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/payment/eeeeeeee-eeee-4eee-8eee-000000000003.png', null)$$,
  '22023', 'This picture is not in this club''s gallery folder', 'a payment picture cannot become a gallery photo');
select extensions.is(
  (select position from public.admin_add_club_photo(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/gallery/eeeeeeee-eeee-4eee-8eee-000000000001.webp', 'Our courts')),
  0, 'the first gallery photo comes first');
select extensions.is(
  public.admin_set_club_payment_qr(current_setting('test.gcash')::uuid,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/payment/eeeeeeee-eeee-4eee-8eee-000000000003.png'),
  null, 'a first QR code replaces nothing');
select extensions.is(
  public.admin_set_club_coach_photo(current_setting('test.ana')::uuid,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/coaches/eeeeeeee-eeee-4eee-8eee-000000000005.webp'),
  null, 'a first coach photo replaces nothing');
select extensions.is(
  public.admin_set_club_payment_qr(current_setting('test.gcash')::uuid,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/payment/eeeeeeee-eeee-4eee-8eee-000000000004.webp'),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/payment/eeeeeeee-eeee-4eee-8eee-000000000003.png',
  'a new QR code returns the old one, so its file can be deleted');
select extensions.is(
  public.admin_set_club_payment_qr(current_setting('test.gcash')::uuid,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/payment/eeeeeeee-eeee-4eee-8eee-000000000004.webp'),
  null, 'setting the same QR code again returns nothing, so the live file is never deleted');
select extensions.is(
  public.admin_set_club_coach_photo(current_setting('test.ana')::uuid,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/coaches/eeeeeeee-eeee-4eee-8eee-000000000005.webp'),
  null, 'setting the same coach photo again returns nothing');
select extensions.throws_ok(
  $$select public.admin_set_club_coach_photo(current_setting('test.ben')::uuid,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/coaches/eeeeeeee-eeee-4eee-8eee-000000000005.webp')$$,
  '23505', 'This picture is already in use. Upload it again.', 'one picture cannot be two coaches'' photo');
select extensions.throws_ok(
  $$select public.admin_add_club_photo('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/gallery/eeeeeeee-eeee-4eee-8eee-000000000001.webp', null)$$,
  '23505', 'This picture is already in use. Upload it again.', 'a gallery photo cannot be recorded twice');
select extensions.is(
  (select array[jsonb_array_length(p -> 'addons'), jsonb_array_length(p -> 'coaches'),
                jsonb_array_length(p -> 'payment_methods'), jsonb_array_length(p -> 'gallery')]
   from public.admin_club_profile() p),
  array[2, 2, 1, 1], 'the admin screen lists every item, hidden ones included');

-- Unused picture files. So far gallery 1, QR 4 and coach photo 5 are in use; gallery 2 was
-- never saved and QR 3 was replaced. Add a court photo in use, an old court photo nothing
-- uses, a gallery upload never saved, a badly named file and another club's file; make them
-- all older than an hour; then add one uploaded just now.
reset role;
select set_config('test.court', (select id::text from public.courts where club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' order by name limit 1), true);
select set_config('test.court_venue', (select venue_id::text from public.courts where id = current_setting('test.court')::uuid), true);
insert into storage.objects (bucket_id, name) values
  ('court-photos', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/courts/' || current_setting('test.court') || '/eeeeeeee-eeee-4eee-8eee-00000000000c.webp'),
  ('court-photos', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/courts/' || current_setting('test.court') || '/eeeeeeee-eeee-4eee-8eee-00000000000e.webp'),
  ('court-photos', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/gallery/eeeeeeee-eeee-4eee-8eee-00000000000a.webp'),
  ('court-photos', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/gallery/photo.webp'),
  ('court-photos', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/gallery/eeeeeeee-eeee-4eee-8eee-00000000000d.webp');
insert into public.court_photos (club_id, venue_id, court_id, path) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', current_setting('test.court_venue')::uuid, current_setting('test.court')::uuid,
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/courts/' || current_setting('test.court') || '/eeeeeeee-eeee-4eee-8eee-00000000000c.webp');
update storage.objects set created_at = now() - interval '2 hours'
where bucket_id = 'court-photos' and (name like 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/%' or name like 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/%');
insert into storage.objects (bucket_id, name) values
  ('court-photos', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/gallery/eeeeeeee-eeee-4eee-8eee-00000000000b.webp');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e8000000-0000-4000-8000-000000000001', true);

select extensions.is(
  (select array_agg(x order by x collate "C") from unnest(public.admin_unused_club_pictures()) x
   where x like '%/eeeeeeee-eeee-4eee-8eee-%' or x like '%/photo.webp'),
  array[
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/courts/' || current_setting('test.court') || '/eeeeeeee-eeee-4eee-8eee-00000000000e.webp',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/gallery/eeeeeeee-eeee-4eee-8eee-000000000002.jpg',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/gallery/eeeeeeee-eeee-4eee-8eee-00000000000a.webp',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/payment/eeeeeeee-eeee-4eee-8eee-000000000003.png'],
  'only files nothing uses are listed: not those in use, uploaded in the last hour, badly named or another club''s');

-- ---------------------------------------------------------------------------
-- The public club page (as a visitor)
-- ---------------------------------------------------------------------------
reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);

select extensions.is(
  public.get_public_club_profile('rally-point-gensan') ->> 'about',
  'Six indoor courts in General Santos.', 'visitors see the club''s about text');
select extensions.is(
  (select jsonb_agg(a ->> 'name') from jsonb_array_elements(public.get_public_club_profile('rally-point-gensan') -> 'addons') a),
  '["Paddle rental"]'::jsonb, 'visitors see shown add-ons only');
select extensions.is(
  (select jsonb_agg(c ->> 'full_name') from jsonb_array_elements(public.get_public_club_profile('rally-point-gensan') -> 'coaches') c),
  '["Coach Ana"]'::jsonb, 'visitors see shown coaches only');
select extensions.is(
  public.get_public_club_profile('rally-point-gensan') -> 'coaches' -> 0 ->> 'photo_path',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/coaches/eeeeeeee-eeee-4eee-8eee-000000000005.webp',
  'visitors see the coach''s photo');
select extensions.is(
  public.get_public_club_profile('rally-point-gensan') -> 'payment_methods' -> 0 ->> 'qr_path',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/payment/eeeeeeee-eeee-4eee-8eee-000000000004.webp',
  'visitors see the current QR code');
select extensions.is(
  public.get_public_club_profile('rally-point-gensan') -> 'gallery' -> 0 ->> 'caption',
  'Our courts', 'visitors see the gallery');
select extensions.is(
  public.get_public_club_profile('no-such-club'), null, 'an unknown club has no profile');
select extensions.is(
  (select array_agg(k order by k) from jsonb_object_keys(public.get_public_club_profile('rally-point-gensan')) k),
  array['about', 'addons', 'amenities', 'cancellation_policy', 'coaches', 'email', 'facebook_url', 'gallery',
        'house_rules', 'instagram_url', 'messenger_url', 'payment_methods', 'payment_note', 'phone', 'terms',
        'website_url'],
  'the public profile holds only the public fields');
select extensions.ok(
  (select (p ->> 'about') is null and p -> 'addons' = '[]'::jsonb and p -> 'amenities' = '[]'::jsonb
   from public.get_public_club_profile('synthetic-second-club') p),
  'a club without a profile shows an empty one');
select extensions.throws_ok(
  $$select public.admin_update_club_profile(null, null, null, null, null, null, null, '{}', null, null, null, null)$$,
  '42501', null, 'visitors cannot change a profile');
select extensions.throws_ok(
  $$insert into storage.objects (bucket_id, name) values
    ('court-photos', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/gallery/eeeeeeee-eeee-4eee-8eee-000000000008.webp')$$,
  '42501', null, 'visitors cannot upload');

-- ---------------------------------------------------------------------------
-- User 2: Gensan staff
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e8000000-0000-4000-8000-000000000002', true);

select extensions.throws_ok(
  $$select public.admin_club_profile()$$,
  '42501', 'admin access required', 'staff cannot open the admin profile');
select extensions.throws_ok(
  $$select public.admin_upsert_club_addon(null, 'Towels', null, 20, 'per_item', true)$$,
  '42501', 'admin access required', 'staff cannot add add-ons');
select extensions.throws_ok(
  $$insert into storage.objects (bucket_id, name) values
    ('court-photos', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/gallery/eeeeeeee-eeee-4eee-8eee-000000000008.webp')$$,
  '42501', null, 'staff cannot upload club pictures');
select extensions.throws_ok(
  $$select public.admin_unused_club_pictures()$$,
  '42501', 'admin access required', 'staff cannot list the club''s unused picture files');
select extensions.throws_ok(
  $$select count(*) from public.club_addons$$,
  '42501', null, 'staff cannot read the add-on table directly');

-- ---------------------------------------------------------------------------
-- User 3: plain account
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'e8000000-0000-4000-8000-000000000003', true);
select extensions.ok(
  not private.can_manage_club_media('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/gallery/eeeeeeee-eeee-4eee-8eee-000000000001.webp'),
  'a plain account cannot manage, and so cannot delete, a club''s pictures');

-- ---------------------------------------------------------------------------
-- User 4: admin of the second club only, naming each club in the header
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'e8000000-0000-4000-8000-000000000004', true);
select set_config('request.headers', '{"x-club-id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}', true);
select extensions.throws_ok(
  $$select public.admin_update_club_profile('Taken over', null, null, null, null, null, null, '{}', null, null, null, null)$$,
  '42501', 'admin access required', 'naming Gensan in the header does not make another club''s admin a Gensan admin');
select extensions.ok(
  not private.can_manage_club_media('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/gallery/eeeeeeee-eeee-4eee-8eee-000000000001.webp'),
  'another club''s admin cannot manage Gensan''s pictures');

select set_config('request.headers', '{"x-club-id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}', true);
select extensions.is(
  (select array_agg(x) from unnest(public.admin_unused_club_pictures()) x where x like '%/eeeeeeee-eeee-4eee-8eee-%'),
  array['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/gallery/eeeeeeee-eeee-4eee-8eee-00000000000d.webp'],
  'another club''s admin sees only their own club''s unused files');
select extensions.throws_ok(
  $$select public.admin_remove_club_addon(current_setting('test.paddle')::uuid)$$,
  'P0002', 'add-on not found', 'another club''s admin cannot remove Gensan add-ons');
select extensions.throws_ok(
  $$select public.admin_set_club_payment_qr(current_setting('test.gcash')::uuid, null)$$,
  'P0002', 'payment method not found', 'another club''s admin cannot change Gensan''s QR code');
select extensions.throws_ok(
  $$select public.admin_add_club_photo('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/gallery/eeeeeeee-eeee-4eee-8eee-000000000002.jpg', null)$$,
  '22023', 'This picture is not in this club''s gallery folder', 'another club''s admin cannot claim a Gensan picture');
select extensions.is(
  public.admin_club_profile() -> 'addons', '[]'::jsonb, 'another club''s admin sees none of Gensan''s add-ons');

-- ---------------------------------------------------------------------------
-- Back to the Gensan admin: removing, and the limits
-- ---------------------------------------------------------------------------
select set_config('request.headers', '', true);
select set_config('request.jwt.claim.sub', 'e8000000-0000-4000-8000-000000000001', true);

select extensions.is(
  public.admin_remove_club_photo(((public.admin_club_profile() -> 'gallery' -> 0) ->> 'id')::uuid),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/gallery/eeeeeeee-eeee-4eee-8eee-000000000001.webp',
  'removing a gallery photo returns its path, so the app can delete the file');
select extensions.is(
  public.admin_remove_club_coach(current_setting('test.ana')::uuid),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/coaches/eeeeeeee-eeee-4eee-8eee-000000000005.webp',
  'removing a coach returns their photo''s path');
select extensions.is(
  public.admin_remove_club_payment_method(current_setting('test.gcash')::uuid),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/payment/eeeeeeee-eeee-4eee-8eee-000000000004.webp',
  'removing a payment method returns its QR code''s path');
select extensions.lives_ok(
  $$select public.admin_remove_club_addon(current_setting('test.paddle')::uuid)$$,
  'an admin removes an add-on');
select extensions.throws_ok(
  $$select public.admin_remove_club_addon(current_setting('test.paddle')::uuid)$$,
  'P0002', 'add-on not found', 'a removed add-on is gone');

reset role;
-- Fill the gallery (12), payment methods (6) and add-ons (30, with the hidden Ball rental).
insert into public.club_gallery_photos (club_id, path, position)
select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'placeholder/gallery/' || n, 10 + n from generate_series(1, 12) n;
insert into public.club_payment_methods (club_id, label, position)
select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Method ' || n, 10 + n from generate_series(1, 6) n;
insert into public.club_addons (club_id, name, price, unit, position)
select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Extra ' || n, 10, 'per_item', 10 + n from generate_series(1, 29) n;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e8000000-0000-4000-8000-000000000001', true);

select extensions.throws_ok(
  $$select public.admin_add_club_photo('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/gallery/eeeeeeee-eeee-4eee-8eee-000000000002.jpg', null)$$,
  '22023', 'The gallery holds up to 12 photos', 'the gallery holds at most 12 photos');
select extensions.throws_ok(
  $$select public.admin_upsert_club_payment_method(null, 'Maya', null, null, true)$$,
  '22023', 'A club can list up to 6 payment methods', 'a club lists at most 6 payment methods');
select extensions.throws_ok(
  $$select public.admin_upsert_club_addon(null, 'Towels', null, 20, 'per_item', true)$$,
  '22023', 'A club can list up to 30 add-ons', 'a club lists at most 30 add-ons');

select * from extensions.finish();
rollback;
