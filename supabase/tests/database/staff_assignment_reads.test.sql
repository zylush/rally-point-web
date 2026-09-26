begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select extensions.plan(16);

insert into public.clubs (id,slug,name) values
  ('82000000-0000-4000-8000-000000000001','assignment-foreign','Assignment foreign club');
insert into public.venues (id,club_id,slug,name) values
  ('82000000-0000-4000-8000-000000000002','82000000-0000-4000-8000-000000000001','main','Foreign main');
insert into auth.users (id,email,raw_user_meta_data) values
  ('81000000-0000-4000-8000-000000000001','admin@assignment.example.invalid','{"full_name":"Admin"}'),
  ('81000000-0000-4000-8000-000000000002','staff@assignment.example.invalid','{"full_name":"Staff"}'),
  ('81000000-0000-4000-8000-000000000003','member@assignment.example.invalid','{"full_name":"Member"}'),
  ('81000000-0000-4000-8000-000000000004','foreign@assignment.example.invalid','{"full_name":"Foreign admin"}');
insert into public.club_staff_roles (club_id,user_id,role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','81000000-0000-4000-8000-000000000001','admin'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','81000000-0000-4000-8000-000000000002','staff'),
  ('82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000004','admin');
insert into public.staff_venue_grants (club_id,user_id,venue_id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','81000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab'),
  ('82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000004','82000000-0000-4000-8000-000000000002');

set local role authenticated;
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000001',true);
select extensions.is((
  select count(*)::integer from public.club_staff_roles
  where user_id in (
    '81000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000002'
  )
),2,'own admin reads the test club staff assignments');
select extensions.is((
  select count(*)::integer from public.staff_venue_grants
  where user_id = '81000000-0000-4000-8000-000000000002'
),1,'own admin reads the test staff venue grant');
select extensions.is((select count(*)::integer from public.club_staff_roles where club_id='82000000-0000-4000-8000-000000000001'),0,'own admin cannot read foreign assignments');
select extensions.is((select count(*)::integer from public.staff_venue_grants where club_id='82000000-0000-4000-8000-000000000001'),0,'own admin cannot read foreign venue grants');
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000002',true);
select extensions.is((select count(*)::integer from public.club_staff_roles),0,'staff cannot read assignment table');
select extensions.is((select count(*)::integer from public.staff_venue_grants),0,'staff cannot read grant table');
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000003',true);
select extensions.is((select count(*)::integer from public.club_staff_roles),0,'member cannot read assignment table');
select extensions.is((select count(*)::integer from public.staff_venue_grants),0,'member cannot read grant table');
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000004',true);
select extensions.is((select count(*)::integer from public.club_staff_roles),0,'foreign admin cannot read fixed-club assignments');
select extensions.is((select count(*)::integer from public.staff_venue_grants),0,'foreign admin cannot read fixed-club venue grants');
select set_config('request.jwt.claim.sub','',true);
select extensions.is((select count(*)::integer from public.club_staff_roles),0,'missing identity cannot read assignments');
select extensions.is((select count(*)::integer from public.staff_venue_grants),0,'missing identity cannot read grants');
set local role postgres;
update public.club_staff_roles set is_active=false
where user_id='81000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000001',true);
select extensions.is((select count(*)::integer from public.club_staff_roles),0,'revoked admin loses assignment reads');
select extensions.is((select count(*)::integer from public.staff_venue_grants),0,'revoked admin loses grant reads');
set local role anon;
select extensions.throws_ok('select * from public.club_staff_roles','42501',null,'anon cannot read assignments');
select extensions.throws_ok('select * from public.staff_venue_grants','42501',null,'anon cannot read grants');
select * from extensions.finish();
rollback;
