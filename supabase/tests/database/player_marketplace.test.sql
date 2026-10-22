begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select extensions.plan(26);

-- Fixture:
--   user 1: plain account with no club role
--   user 2: already an active standard member of the second club
--   user 3: platform superadmin
--   club "setup-club": still being set up (account status 'provisioning')
insert into auth.users (id, email, raw_user_meta_data)
select ('c7000000-0000-4000-8000-00000000000' || n)::uuid, 'player-' || n || '@fixture.invalid',
       jsonb_build_object('full_name', 'Player ' || n)
from generate_series(1, 3) n;
insert into public.platform_roles (user_id) values ('c7000000-0000-4000-8000-000000000003');
delete from public.members where user_id in (
  'c7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000003');
insert into public.members (club_id, user_id, member_code, full_name, membership_type, status, join_date, expiry_date)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'c7000000-0000-4000-8000-000000000002', 'MKT-2', 'Player 2',
        'standard', 'active', current_date, current_date + 30)
on conflict (club_id, user_id) do update set membership_type = 'standard', expiry_date = current_date + 30;
insert into public.clubs (id, slug, name, default_timezone, is_active)
values ('c7100000-0000-4000-8000-000000000001', 'setup-club', 'Setup Club', 'Asia/Manila', true);
update public.club_accounts set status = 'provisioning', city = 'Cebu City'
where club_id = 'c7100000-0000-4000-8000-000000000001';
insert into public.venues (id, club_id, slug, name, timezone, open_hour, close_hour, is_active)
values ('c7100000-0000-4000-8000-000000000002', 'c7100000-0000-4000-8000-000000000001', 'setup-main', 'Setup Main', 'Asia/Manila', 6, 22, true);
update public.club_accounts set city = 'Davao City', address = '1 Sample Road'
where club_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
-- One second-club court out of service, so it is left out of counts and rates.
insert into public.courts (id, club_id, venue_id, name, status, hourly_rate, member_rate)
values ('c7100000-0000-4000-8000-000000000003', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc', 'Closed Court', 'maintenance', 100, 50);
update public.courts set member_rate = 350 where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbe';

-- Structure and privileges.
select extensions.ok(
  (select not attnotnull from pg_attribute where attrelid = 'public.members'::regclass and attname = 'membership_type')
  and (select not attnotnull from pg_attribute where attrelid = 'public.members'::regclass and attname = 'expiry_date'),
  'membership type and expiry may be empty for players');
select extensions.throws_ok(
  $$insert into public.members (club_id, user_id, member_code, full_name, membership_type, status, join_date, expiry_date)
    values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', null, 'MKT-BAD', 'Half Member', null, 'active', current_date, current_date + 30)$$,
  '23514', null, 'membership type and expiry are set together or not at all');
select extensions.ok(
  has_function_privilege('anon', 'public.list_public_clubs()', 'EXECUTE')
  and has_function_privilege('anon', 'public.get_public_club_detail(text)', 'EXECUTE'),
  'visitors can browse the club list and club pages');
select extensions.ok(
  not has_function_privilege('anon', 'public.join_club_as_player(text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.join_club_as_player(text)', 'EXECUTE'),
  'only signed-in people can join a club as a player');

-- Directory, as a visitor.
set local role anon;
select extensions.ok(
  exists (select 1 from public.list_public_clubs() where slug = 'synthetic-second-club'),
  'an active club is listed');
select extensions.ok(
  not exists (select 1 from public.list_public_clubs() where slug = 'setup-club'),
  'a club still being set up is not listed');
select extensions.is(
  (select city || '|' || address || '|' || court_count::text || '|' || min_rate::text || '|' || min_member_rate::text
   from public.list_public_clubs() where slug = 'synthetic-second-club'),
  'Davao City|1 Sample Road|1|400.00|350.00',
  'the listing shows city, address, in-service court count, and lowest regular and member rates');
select extensions.is(
  (select jsonb_array_length(public.get_public_club_detail('synthetic-second-club') -> 'venues')),
  2, 'the club page lists the club''s active venues');
select extensions.is(
  (select string_agg((court ->> 'name') || ':' || (court ->> 'in_service'), ',' order by court ->> 'name')
   from jsonb_array_elements(public.get_public_club_detail('synthetic-second-club') -> 'venues') v,
        jsonb_array_elements(v -> 'courts') court),
  'Closed Court:false,Synthetic Court A:true',
  'the club page shows each court and whether it is in service');
select extensions.ok(
  (select not (public.get_public_club_detail('synthetic-second-club')::text ~* 'member_code|email|phone|full_name')),
  'the club page carries no member details');
select extensions.is(public.get_public_club_detail('setup-club'), null::jsonb,
  'a club still being set up has no public page');
select extensions.is(public.get_public_club_detail('no-such-club'), null::jsonb,
  'an unknown club has no public page');

-- Joining as a player.
reset role;
set local role authenticated;
select set_config('request.headers', '', true);
select set_config('request.jwt.claim.sub', 'c7000000-0000-4000-8000-000000000001', true);
select extensions.is(public.join_club_as_player(' Synthetic-Second-Club '), 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,
  'a signed-in person joins a club as a player');
select extensions.lives_ok($$select public.join_club_as_player('synthetic-second-club')$$,
  'joining again is harmless');
select extensions.throws_ok($$select public.join_club_as_player('setup-club')$$,
  '22023', 'This club is not taking bookings', 'a club still being set up cannot be joined');

select set_config('request.jwt.claim.sub', 'c7000000-0000-4000-8000-000000000002', true);
select extensions.lives_ok($$select public.join_club_as_player('synthetic-second-club')$$,
  'an existing member can use the same path');

select set_config('request.jwt.claim.sub', 'c7000000-0000-4000-8000-000000000003', true);
select extensions.throws_ok($$select public.join_club_as_player('synthetic-second-club')$$,
  '42501', 'Platform accounts cannot book courts', 'platform superadmins cannot join as players');

reset role;
select extensions.is(
  (select string_agg(user_id::text || ':' || coalesce(membership_type::text, 'player') || ':' || count_rows::text, ',' order by user_id)
   from (select user_id, membership_type, count(*) over (partition by user_id) as count_rows
         from public.members
         where club_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
           and user_id in ('c7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000002')) t),
  'c7000000-0000-4000-8000-000000000001:player:1,c7000000-0000-4000-8000-000000000002:standard:1',
  'the new player has one row with no membership; the existing member keeps their plan');

-- Locations, opening hours and Philippine time.
--   user 4: Gensan admin
insert into auth.users (id, email, raw_user_meta_data)
values ('c7000000-0000-4000-8000-000000000004', 'player-4@fixture.invalid', '{"full_name":"Player 4"}');
insert into public.club_staff_roles (club_id, user_id, role)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c7000000-0000-4000-8000-000000000004', 'admin');

select extensions.ok(
  (select column_default from information_schema.columns
   where table_schema = 'public' and table_name = 'venues' and column_name = 'open_hour') = '0'
  and (select column_default from information_schema.columns
   where table_schema = 'public' and table_name = 'venues' and column_name = 'close_hour') = '24',
  'new venues open around the clock by default');
select extensions.throws_ok(
  $$insert into public.venues (id, club_id, slug, name, timezone)
    values ('c7100000-0000-4000-8000-000000000009', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'tokyo', 'Tokyo', 'Asia/Tokyo')$$,
  '23514', null, 'venues stay on Philippine time');

set local role authenticated;
select set_config('request.headers', '', true);
select set_config('request.jwt.claim.sub', 'c7000000-0000-4000-8000-000000000001', true);
select extensions.throws_ok(
  $$select public.admin_update_venue_location('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac', 'Somewhere', 'Somecity', null, null)$$,
  '42501', 'admin access required', 'a player cannot change a location');
select set_config('request.jwt.claim.sub', 'c7000000-0000-4000-8000-000000000004', true);
select extensions.lives_ok(
  $$select public.admin_update_venue_location('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac', ' 12 Sample St ', 'Koronadal City', 6.13, 124.85)$$,
  'an admin sets a location''s address, city and map pin');
select extensions.throws_ok(
  $$select public.admin_update_venue_location('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac', 'x', 'y', 6.13, null)$$,
  '22023', 'Enter both latitude and longitude, or neither', 'a map pin needs both coordinates');
select extensions.throws_ok(
  $$select public.admin_update_venue_location('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc', 'x', 'y', null, null)$$,
  'P0002', 'venue not found', 'an admin cannot change another club''s location');

reset role;
set local role anon;
select extensions.is(
  (select (v ->> 'address') || '|' || (v ->> 'city') || '|' || (v ->> 'latitude') || '|' || (v ->> 'longitude')
   from jsonb_array_elements(public.get_public_club_detail('rally-point-gensan') -> 'venues') v
   where v ->> 'id' = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac'),
  '12 Sample St|Koronadal City|6.130000|124.850000',
  'the club page shows the location''s address and map pin');
select extensions.ok(
  (select 'Koronadal City' = any(cities) from public.list_public_clubs() where slug = 'rally-point-gensan'),
  'the city filter includes the cities of a club''s locations');

select * from extensions.finish();
rollback;
