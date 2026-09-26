begin;

set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;

select extensions.plan(38);

select extensions.ok(to_regclass('public.clubs') is not null, 'club ownership table exists');
select extensions.ok(to_regclass('public.venues') is not null, 'venue ownership table exists');
select extensions.ok(to_regclass('public.club_staff_roles') is not null, 'trusted club staff assignments exist');
select extensions.ok(to_regclass('public.staff_venue_grants') is not null, 'staff venue grants exist');
select extensions.ok(to_regclass('public.court_allocations') is not null, 'court allocation table exists');
select extensions.ok(
  exists (select 1 from pg_constraint where conname = 'court_allocations_no_overlap'),
  'active court allocations use an exclusion constraint'
);
select extensions.ok(
  exists (select 1 from pg_constraint where conname = 'bookings_member_club_fk'),
  'bookings enforce a matching club/member key'
);
select extensions.ok(
  exists (select 1 from pg_constraint where conname = 'courts_venue_fk'),
  'courts enforce a matching club/venue key'
);
select extensions.ok(
  exists (select 1 from pg_constraint where conname = 'court_sessions_court_venue_fk')
  and exists (select 1 from pg_constraint where conname = 'bookings_court_venue_fk')
  and exists (select 1 from pg_constraint where conname = 'open_plays_court_venue_fk')
  and exists (select 1 from pg_constraint where conname = 'open_play_signups_open_play_venue_fk')
  and exists (select 1 from pg_constraint where conname = 'bookings_session_venue_fk'),
  'court activity and related events enforce matching venue composites'
);
select extensions.ok(
  not has_table_privilege('authenticated', 'public.members', 'insert'),
  'authenticated clients cannot insert membership state directly'
);
select extensions.ok(
  not has_table_privilege('authenticated', 'public.members', 'select'),
  'authenticated clients still use limited membership views instead of the base table'
);
select extensions.ok(
  not has_table_privilege('authenticated', 'public.transactions', 'insert'),
  'authenticated clients cannot insert financial state directly'
);
select extensions.ok(
  has_function_privilege('authenticated', 'public.create_unpaid_desk_booking(uuid,uuid,uuid,uuid,date,integer,integer)', 'execute'),
  'authenticated clients reach desk booking only through the scoped command'
);
select extensions.ok(
  not has_function_privilege('anon', 'public.create_unpaid_desk_booking(uuid,uuid,uuid,uuid,date,integer,integer)', 'execute'),
  'anonymous clients cannot invoke desk booking commands'
);
select extensions.ok(
  has_function_privilege('authenticated', 'public.cancel_booking_reservation(uuid)', 'execute'),
  'authenticated clients reach booking cancellation only through the scoped command'
);
select extensions.ok(
  not has_function_privilege('anon', 'public.cancel_booking_reservation(uuid)', 'execute'),
  'anonymous clients cannot invoke booking cancellation'
);
select extensions.ok(
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'member_roster' and column_name = 'member_code')
  and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'member_roster' and column_name in ('email', 'phone', 'qr_token')),
  'staff roster projection omits contact, QR, and payment-sensitive fields'
);
select extensions.is(
  (select array_agg(column_name::text order by ordinal_position)
   from information_schema.columns where table_schema = 'public' and table_name = 'member_roster'),
  array['club_id','id','member_code','full_name','membership_type','status','expiry_date','created_at'],
  'staff roster has exactly the approved columns'
);
select extensions.ok(
  not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'public_schedule' and column_name in ('member_id', 'email', 'amount', 'payment_ref')),
  'public schedule projection omits names and financial fields'
);
select extensions.ok(has_table_privilege('anon', 'public.public_schedule', 'select'), 'anonymous TV read path is explicit');
select extensions.ok(to_regprocedure('public.get_current_access()') is not null, 'auth role resolution is server-owned');

insert into auth.users (id, email, raw_user_meta_data)
values
  ('33333333-3333-4333-8333-333333333333', 'tenant-admin@example.com', '{"full_name":"Tenant Admin"}'::jsonb),
  ('44444444-4444-4444-8444-444444444444', 'tenant-staff@example.com', '{"full_name":"Tenant Staff"}'::jsonb),
  ('55555555-5555-4555-8555-555555555555', 'tenant-second@example.com', '{"full_name":"Second Club Member"}'::jsonb);

update public.profiles set role = 'admin' where id = '33333333-3333-4333-8333-333333333333';
update public.profiles set role = 'staff' where id = '44444444-4444-4444-8444-444444444444';
insert into public.club_staff_roles (club_id, user_id, role)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '33333333-3333-4333-8333-333333333333', 'admin'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '44444444-4444-4444-8444-444444444444', 'staff')
on conflict do nothing;
insert into public.staff_venue_grants (club_id, user_id, venue_id, granted_by)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '44444444-4444-4444-8444-444444444444', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', '33333333-3333-4333-8333-333333333333')
on conflict do nothing;

insert into public.members (club_id, user_id, member_code, full_name, email, membership_type, status, join_date, expiry_date)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '55555555-5555-4555-8555-555555555555', 'RP-SECOND-1', 'Second Club Member', 'tenant-second@example.com', 'standard', 'active', current_date, current_date + 30);

set local role authenticated;
set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';

select extensions.is((select count(*)::integer from public.courts where club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and venue_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab'), 4, 'staff can read own club courts at the assigned venue');
select extensions.is((select count(*)::integer from public.courts where club_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 0, 'staff cannot read another club courts');
select extensions.is((select count(*)::integer from public.courts where venue_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac'), 0, 'staff cannot read an unassigned venue');
select extensions.ok((select count(*) from public.member_roster) > 0, 'staff can use the limited roster projection');
select extensions.is((select count(*)::integer from public.member_admin), 0, 'staff cannot read the admin member view');
select extensions.is((select count(*)::integer from public.member_roster where member_code = 'RP-SECOND-1'), 0, 'staff roster excludes a foreign club member');
select extensions.is(
  (select count(*)::integer from information_schema.columns where table_schema = 'public' and table_name = 'member_roster' and column_name in ('email', 'phone', 'qr_token')),
  0,
  'roster does not expose contact values'
);

select extensions.throws_ok(
  'select public.create_unpaid_desk_booking(''bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'', ''bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc'', ''bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbe'', ''55555555-5555-4555-8555-555555555555'', current_date, 10, 1)',
  'P0001',
  null,
  'a staff command cannot forge another club or venue'
);

select extensions.throws_ok(
  'select public.create_unpaid_desk_booking(''aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'', ''aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac'', ''aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab'', ''33333333-3333-4333-8333-333333333333'', current_date, 10, 1)',
  'P0001',
  null,
  'a staff command cannot pair a court with another venue'
);

select extensions.lives_ok(
  $test$
    select public.create_unpaid_desk_booking(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',
      (select id from public.courts
       where venue_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab'
       order by id limit 1),
      (select id from public.member_roster
       where full_name = 'Tenant Admin'
       order by id limit 1),
      date '2099-12-30', 10, 1
    )
  $test$,
  'assigned staff can create an unpaid desk booking through the scoped command'
);

select extensions.lives_ok(
  $test$
    select public.cancel_booking_reservation((
      select id from public.bookings
      where ((start_at at time zone 'Asia/Manila')::date) = date '2099-12-30'
      order by created_at desc limit 1
    ))
  $test$,
  'assigned staff can cancel the unpaid desk booking through the scoped command'
);
select extensions.is(
  (select status from public.court_allocations
   where source = 'booking'
     and source_id = (
       select id from public.bookings
       where ((start_at at time zone 'Asia/Manila')::date) = date '2099-12-30'
       order by created_at desc limit 1
     )),
  'cancelled',
  'booking cancellation releases its active allocation'
);
select extensions.lives_ok(
  $test$
    select public.create_unpaid_desk_booking(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',
      (select id from public.courts
       where venue_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab'
       order by id limit 1),
      (select id from public.member_roster
       where full_name = 'Tenant Admin'
       order by id limit 1),
      date '2099-12-30', 10, 1
    )
  $test$,
  'released booking interval can be reserved again'
);

set local role postgres;
update public.staff_venue_grants
set is_active = false
where club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  and user_id = '44444444-4444-4444-8444-444444444444'
  and venue_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab';
set local role authenticated;
select extensions.is(
  (select count(*)::integer from public.courts where club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and venue_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab'),
  0,
  'revoking a venue grant removes staff operational access'
);
select extensions.throws_ok(
  $test$
    select public.cancel_booking_reservation((
      select id from public.bookings
      where ((start_at at time zone 'Asia/Manila')::date) = date '2099-12-30'
        and status = 'pending_payment'
      order by created_at desc limit 1
    ))
  $test$,
  'P0001',
  'booking access denied',
  'revoked staff cannot cancel an assigned-venue booking'
);

set local role anon;
select extensions.ok(
  not exists (
    select 1 from public.public_schedule
    where title not in ('In use', 'Reserved', 'Open play')
      or status not in ('playing', 'scheduled', 'reserved', 'open', 'full')
      or (
        subtitle not in ('playing', 'scheduled', 'reserved')
        and subtitle !~ '^[0-9]+ seats$'
      )
  ),
  'anonymous schedule rows contain only static safe labels'
);
select extensions.throws_ok('select * from public.courts', '42501', null, 'anonymous clients cannot read operational courts');

select * from extensions.finish();
rollback;
