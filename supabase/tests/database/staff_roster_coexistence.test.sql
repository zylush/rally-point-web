-- Works on both expanded/backfilled compatibility schema and enforced schema.
-- Synthetic Auth and assignment rows are local to this transaction.
begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;

select extensions.plan(7);

select extensions.ok(
  has_table_privilege('authenticated', 'public.member_roster', 'select'),
  'authenticated callers can reach the limited roster view'
);
select extensions.is(
  (select array_agg(column_name::text order by ordinal_position)
   from information_schema.columns
   where table_schema = 'public' and table_name = 'member_roster'),
  array['club_id','id','member_code','full_name','membership_type','status','expiry_date','created_at'],
  'the roster projects only approved fields'
);

insert into auth.users (id, email, raw_user_meta_data) values
  ('66666666-6666-4666-8666-666666666661', 'compat-staff@fixture.invalid', '{"full_name":"Compatibility Staff"}'::jsonb),
  ('66666666-6666-4666-8666-666666666662', 'compat-member@fixture.invalid', '{"full_name":"Compatibility Member"}'::jsonb),
  ('66666666-6666-4666-8666-666666666663', 'compat-foreign@fixture.invalid', '{"full_name":"Compatibility Foreign"}'::jsonb);
insert into public.clubs (id, slug, name)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'compat-second-club', 'Compatibility Second Club')
on conflict (id) do nothing;
update public.members set club_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
where user_id = '66666666-6666-4666-8666-666666666663';
update public.profiles set role = 'staff' where id = '66666666-6666-4666-8666-666666666661';
insert into public.club_staff_roles (club_id, user_id, role)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '66666666-6666-4666-8666-666666666661', 'staff');
insert into public.staff_venue_grants (club_id, user_id, venue_id)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '66666666-6666-4666-8666-666666666661', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab');

set local role authenticated;
set local request.jwt.claim.sub = '66666666-6666-4666-8666-666666666661';
select extensions.is((select count(*)::integer from public.member_roster where full_name = 'Compatibility Member'), 1,
  'assigned staff can find a same-club member across the club');
select extensions.is((select count(*)::integer from public.member_roster where full_name = 'Compatibility Foreign'), 0,
  'staff cannot find a foreign-club member');
select extensions.is((select count(*)::integer from public.member_admin), 0,
  'staff cannot read the admin member view');

set local request.jwt.claim.sub = '66666666-6666-4666-8666-666666666662';
select extensions.is((select count(*)::integer from public.member_roster), 0,
  'ordinary members cannot read the staff roster');

set local role anon;
select extensions.throws_ok('select * from public.member_roster', '42501', null,
  'anonymous callers cannot read the staff roster');

select * from extensions.finish();
rollback;
