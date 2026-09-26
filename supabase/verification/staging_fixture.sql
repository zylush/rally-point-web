-- Proposed Gate 5/6 staging fixture (data only).
--
-- Safety contract:
--   * Run only after the six Auth users have been provisioned through the
--     trusted Supabase Auth Admin path.
--   * Replace every {{..._USER_ID}} token with the captured Auth UUID.
--   * Run inside an explicit transaction after a fresh backup and drift check.
--   * This file does not commit, alter schema/grants, or apply enforcement.
--   * Any preflight mismatch aborts the caller's transaction.

do $fixture_preflight$
declare
  v_user_ids uuid[] := array[
    '{{RALLY_MEMBER_USER_ID}}'::uuid,
    '{{RALLY_ADMIN_USER_ID}}'::uuid,
    '{{RALLY_STAFF_USER_ID}}'::uuid,
    '{{SECOND_MEMBER_USER_ID}}'::uuid,
    '{{SECOND_ADMIN_USER_ID}}'::uuid,
    '{{SECOND_STAFF_USER_ID}}'::uuid
  ];
begin
  if private.current_club_id() is distinct from 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid then
    raise exception 'fixture target does not have the expected Rally Point club context';
  end if;

  if (select count(*) from auth.users where id = any(v_user_ids)) <> 6
     or (select count(*) from public.profiles where id = any(v_user_ids)) <> 6
     or (select count(*) from public.members where user_id = any(v_user_ids)) <> 6 then
    raise exception 'all six trusted Auth users, profiles, and trigger-created memberships are required';
  end if;

  if exists (
    select 1 from public.profiles
    where id = any(v_user_ids) and role is distinct from 'member'::public.user_role
  ) then
    raise exception 'new Auth identities must still have the member-only signup role';
  end if;

  if exists (
    select 1 from public.members
    where user_id = any(v_user_ids)
      and club_id is distinct from 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
  ) then
    raise exception 'new Auth memberships are not on the expected fixed signup club';
  end if;

  if exists (
    select 1 from public.clubs
    where id = '72000000-0000-4000-8000-000000000000'::uuid
       or slug = 'tenant-fixture-second-club'
  ) or exists (
    select 1 from public.venues
    where id in (
      '71000000-0000-4000-8100-000000000001'::uuid,
      '72000000-0000-4000-8100-000000000001'::uuid,
      '72000000-0000-4000-8100-000000000002'::uuid
    )
       or (club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid and slug = 'tenant-fixture-rally')
       or (club_id = '72000000-0000-4000-8000-000000000000'::uuid
           and slug in ('tenant-fixture-main', 'tenant-fixture-unassigned'))
  ) or exists (
    select 1 from public.courts
    where id in (
      '71000000-0000-4000-8200-000000000001'::uuid,
      '72000000-0000-4000-8200-000000000001'::uuid,
      '72000000-0000-4000-8200-000000000002'::uuid
    )
  ) then
    raise exception 'fixture club, venue, court ID, or slug already exists';
  end if;

  if exists (
    select 1 from public.members
    where member_code in (
      'RP-FIX-MEMBER', 'RP-FIX-ADMIN', 'RP-FIX-STAFF',
      'SC-FIX-MEMBER', 'SC-FIX-ADMIN', 'SC-FIX-STAFF'
    )
  ) then
    raise exception 'fixture member code already exists';
  end if;

  if exists (
    select 1 from public.bookings where id in (
      '71000000-0000-4000-8300-000000000001'::uuid,
      '72000000-0000-4000-8300-000000000001'::uuid
    )
    union all select 1 from public.court_sessions where id in (
      '71000000-0000-4000-8400-000000000001'::uuid,
      '72000000-0000-4000-8400-000000000001'::uuid
    )
    union all select 1 from public.open_plays where id in (
      '71000000-0000-4000-8500-000000000001'::uuid,
      '72000000-0000-4000-8500-000000000001'::uuid
    )
    union all select 1 from public.open_play_signups where id in (
      '71000000-0000-4000-8600-000000000001'::uuid,
      '72000000-0000-4000-8600-000000000001'::uuid
    )
    union all select 1 from public.checkins where id in (
      '71000000-0000-4000-8700-000000000001'::uuid,
      '72000000-0000-4000-8700-000000000001'::uuid
    )
    union all select 1 from public.walkins where id in (
      '71000000-0000-4000-8800-000000000001'::uuid,
      '72000000-0000-4000-8800-000000000001'::uuid
    )
    union all select 1 from public.transactions where id in (
      '71000000-0000-4000-8900-000000000001'::uuid,
      '72000000-0000-4000-8900-000000000001'::uuid
    )
    union all select 1 from public.notifications where id in (
      '71000000-0000-4000-8a00-000000000001'::uuid,
      '72000000-0000-4000-8a00-000000000001'::uuid
    )
    union all select 1 from public.reminders where id in (
      '71000000-0000-4000-8b00-000000000001'::uuid,
      '72000000-0000-4000-8b00-000000000001'::uuid
    )
    union all select 1 from public.court_allocations where id in (
      '71000000-0000-4000-8c00-000000000001'::uuid,
      '71000000-0000-4000-8c00-000000000002'::uuid,
      '71000000-0000-4000-8c00-000000000003'::uuid,
      '72000000-0000-4000-8c00-000000000001'::uuid,
      '72000000-0000-4000-8c00-000000000002'::uuid,
      '72000000-0000-4000-8c00-000000000003'::uuid
    )
  ) then
    raise exception 'one or more fixed fixture activity IDs already exist';
  end if;
end
$fixture_preflight$;

update public.profiles p
set full_name = v.full_name,
    role = v.role::public.user_role
from (values
  ('{{RALLY_MEMBER_USER_ID}}'::uuid, 'Fixture Rally Member', 'member'),
  ('{{RALLY_ADMIN_USER_ID}}'::uuid, 'Fixture Rally Admin', 'admin'),
  ('{{RALLY_STAFF_USER_ID}}'::uuid, 'Fixture Rally Staff', 'staff'),
  ('{{SECOND_MEMBER_USER_ID}}'::uuid, 'Fixture Second Member', 'member'),
  ('{{SECOND_ADMIN_USER_ID}}'::uuid, 'Fixture Second Admin', 'admin'),
  ('{{SECOND_STAFF_USER_ID}}'::uuid, 'Fixture Second Staff', 'staff')
) as v(user_id, full_name, role)
where p.id = v.user_id;

insert into public.clubs (id, slug, name, default_timezone, is_active)
values (
  '72000000-0000-4000-8000-000000000000',
  'tenant-fixture-second-club',
  'Tenant Fixture Second Club',
  'Asia/Manila',
  true
);

update public.members m
set club_id = v.club_id,
    member_code = v.member_code,
    full_name = v.full_name,
    membership_type = 'standard',
    status = 'active',
    join_date = date '2099-01-01',
    expiry_date = date '2099-12-31',
    notes = '[tenant-fixture-v1]'
from (values
  ('{{RALLY_MEMBER_USER_ID}}'::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'RP-FIX-MEMBER', 'Fixture Rally Member'),
  ('{{RALLY_ADMIN_USER_ID}}'::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'RP-FIX-ADMIN', 'Fixture Rally Admin'),
  ('{{RALLY_STAFF_USER_ID}}'::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'RP-FIX-STAFF', 'Fixture Rally Staff'),
  ('{{SECOND_MEMBER_USER_ID}}'::uuid, '72000000-0000-4000-8000-000000000000'::uuid, 'SC-FIX-MEMBER', 'Fixture Second Member'),
  ('{{SECOND_ADMIN_USER_ID}}'::uuid, '72000000-0000-4000-8000-000000000000'::uuid, 'SC-FIX-ADMIN', 'Fixture Second Admin'),
  ('{{SECOND_STAFF_USER_ID}}'::uuid, '72000000-0000-4000-8000-000000000000'::uuid, 'SC-FIX-STAFF', 'Fixture Second Staff')
) as v(user_id, club_id, member_code, full_name)
where m.user_id = v.user_id;

insert into public.venues (id, club_id, slug, name, timezone, open_hour, close_hour, is_active)
values
  ('71000000-0000-4000-8100-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'tenant-fixture-rally', 'Tenant Fixture Rally Venue', 'Asia/Manila', 6, 22, true),
  ('72000000-0000-4000-8100-000000000001', '72000000-0000-4000-8000-000000000000', 'tenant-fixture-main', 'Tenant Fixture Main Venue', 'Asia/Manila', 6, 22, true),
  ('72000000-0000-4000-8100-000000000002', '72000000-0000-4000-8000-000000000000', 'tenant-fixture-unassigned', 'Tenant Fixture Unassigned Venue', 'Asia/Manila', 6, 22, true);

insert into public.courts (id, club_id, venue_id, name, status, hourly_rate)
values
  ('71000000-0000-4000-8200-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '71000000-0000-4000-8100-000000000001', 'Tenant Fixture Rally Court', 'available', 500),
  ('72000000-0000-4000-8200-000000000001', '72000000-0000-4000-8000-000000000000', '72000000-0000-4000-8100-000000000001', 'Tenant Fixture Main Court', 'available', 400),
  ('72000000-0000-4000-8200-000000000002', '72000000-0000-4000-8000-000000000000', '72000000-0000-4000-8100-000000000002', 'Tenant Fixture Unassigned Court', 'available', 400);

insert into public.club_staff_roles (club_id, user_id, role, is_active)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '{{RALLY_ADMIN_USER_ID}}', 'admin', true),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '{{RALLY_STAFF_USER_ID}}', 'staff', true),
  ('72000000-0000-4000-8000-000000000000', '{{SECOND_ADMIN_USER_ID}}', 'admin', true),
  ('72000000-0000-4000-8000-000000000000', '{{SECOND_STAFF_USER_ID}}', 'staff', true);

insert into public.staff_venue_grants (club_id, user_id, venue_id, granted_by, is_active)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '{{RALLY_STAFF_USER_ID}}', '71000000-0000-4000-8100-000000000001', '{{RALLY_ADMIN_USER_ID}}', true),
  ('72000000-0000-4000-8000-000000000000', '{{SECOND_STAFF_USER_ID}}', '72000000-0000-4000-8100-000000000001', '{{SECOND_ADMIN_USER_ID}}', true);

insert into public.bookings (
  id, club_id, venue_id, court_id, member_id, start_at, end_at,
  hours, amount, status, payment_method, payment_ref
)
values
  ('71000000-0000-4000-8300-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '71000000-0000-4000-8100-000000000001', '71000000-0000-4000-8200-000000000001', (select id from public.members where user_id = '{{RALLY_MEMBER_USER_ID}}'), '2099-02-01 06:00+08', '2099-02-01 07:00+08', 1, 500, 'pending_payment', null, null),
  ('72000000-0000-4000-8300-000000000001', '72000000-0000-4000-8000-000000000000', '72000000-0000-4000-8100-000000000001', '72000000-0000-4000-8200-000000000001', (select id from public.members where user_id = '{{SECOND_MEMBER_USER_ID}}'), '2099-02-01 06:00+08', '2099-02-01 07:00+08', 1, 400, 'pending_payment', null, null);

insert into public.court_sessions (
  id, club_id, venue_id, court_id, member_id, start_at, end_at,
  status, amount, created_by, notes
)
values
  ('71000000-0000-4000-8400-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '71000000-0000-4000-8100-000000000001', '71000000-0000-4000-8200-000000000001', (select id from public.members where user_id = '{{RALLY_MEMBER_USER_ID}}'), '2099-02-01 07:00+08', '2099-02-01 08:00+08', 'scheduled', 500, '{{RALLY_STAFF_USER_ID}}', '[tenant-fixture-v1]'),
  ('72000000-0000-4000-8400-000000000001', '72000000-0000-4000-8000-000000000000', '72000000-0000-4000-8100-000000000001', '72000000-0000-4000-8200-000000000001', (select id from public.members where user_id = '{{SECOND_MEMBER_USER_ID}}'), '2099-02-01 07:00+08', '2099-02-01 08:00+08', 'scheduled', 400, '{{SECOND_STAFF_USER_ID}}', '[tenant-fixture-v1]');

insert into public.open_plays (
  id, club_id, venue_id, title, court_id, start_at, end_at,
  capacity, fee, skill_level, status, notes, created_by
)
values
  ('71000000-0000-4000-8500-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '71000000-0000-4000-8100-000000000001', 'Tenant Fixture Rally Open Play', '71000000-0000-4000-8200-000000000001', '2099-02-01 08:00+08', '2099-02-01 09:00+08', 8, 150, 'all', 'open', '[tenant-fixture-v1]', '{{RALLY_STAFF_USER_ID}}'),
  ('72000000-0000-4000-8500-000000000001', '72000000-0000-4000-8000-000000000000', '72000000-0000-4000-8100-000000000002', 'Tenant Fixture Second Open Play', '72000000-0000-4000-8200-000000000002', '2099-02-01 08:00+08', '2099-02-01 09:00+08', 8, 100, 'all', 'open', '[tenant-fixture-v1]', '{{SECOND_ADMIN_USER_ID}}');

insert into public.open_play_signups (id, club_id, venue_id, open_play_id, member_id, status)
values
  ('71000000-0000-4000-8600-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '71000000-0000-4000-8100-000000000001', '71000000-0000-4000-8500-000000000001', (select id from public.members where user_id = '{{RALLY_MEMBER_USER_ID}}'), 'joined'),
  ('72000000-0000-4000-8600-000000000001', '72000000-0000-4000-8000-000000000000', '72000000-0000-4000-8100-000000000002', '72000000-0000-4000-8500-000000000001', (select id from public.members where user_id = '{{SECOND_MEMBER_USER_ID}}'), 'joined');

insert into public.checkins (id, club_id, venue_id, member_id, staff_id, note, checked_in_at)
values
  ('71000000-0000-4000-8700-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '71000000-0000-4000-8100-000000000001', (select id from public.members where user_id = '{{RALLY_MEMBER_USER_ID}}'), '{{RALLY_STAFF_USER_ID}}', '[tenant-fixture-v1]', '2099-02-01 05:45+08'),
  ('72000000-0000-4000-8700-000000000001', '72000000-0000-4000-8000-000000000000', '72000000-0000-4000-8100-000000000001', (select id from public.members where user_id = '{{SECOND_MEMBER_USER_ID}}'), '{{SECOND_STAFF_USER_ID}}', '[tenant-fixture-v1]', '2099-02-01 05:45+08');

insert into public.walkins (id, club_id, venue_id, full_name, purpose, amount, created_by, created_at)
values
  ('71000000-0000-4000-8800-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '71000000-0000-4000-8100-000000000001', 'Fixture Rally Walk-in', '[tenant-fixture-v1]', 100, '{{RALLY_STAFF_USER_ID}}', '2099-02-01 05:40+08'),
  ('72000000-0000-4000-8800-000000000001', '72000000-0000-4000-8000-000000000000', '72000000-0000-4000-8100-000000000001', 'Fixture Second Walk-in', '[tenant-fixture-v1]', 80, '{{SECOND_STAFF_USER_ID}}', '2099-02-01 05:40+08');

insert into public.transactions (
  id, club_id, venue_id, member_id, amount, type, description,
  created_by, verification_status, created_at
)
values
  ('71000000-0000-4000-8900-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '71000000-0000-4000-8100-000000000001', (select id from public.members where user_id = '{{RALLY_MEMBER_USER_ID}}'), 500, 'booking', 'Tenant fixture recorded charge [tenant-fixture-v1]', '{{RALLY_STAFF_USER_ID}}', 'unverified', '2099-02-01 05:35+08'),
  ('72000000-0000-4000-8900-000000000001', '72000000-0000-4000-8000-000000000000', '72000000-0000-4000-8100-000000000001', (select id from public.members where user_id = '{{SECOND_MEMBER_USER_ID}}'), 400, 'booking', 'Tenant fixture recorded charge [tenant-fixture-v1]', '{{SECOND_STAFF_USER_ID}}', 'unverified', '2099-02-01 05:35+08');

insert into public.notifications (id, club_id, venue_id, user_id, title, body, read, created_at)
values
  ('71000000-0000-4000-8a00-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '71000000-0000-4000-8100-000000000001', '{{RALLY_MEMBER_USER_ID}}', 'Tenant fixture notice', '[tenant-fixture-v1]', false, '2099-02-01 05:30+08'),
  ('72000000-0000-4000-8a00-000000000001', '72000000-0000-4000-8000-000000000000', '72000000-0000-4000-8100-000000000001', '{{SECOND_MEMBER_USER_ID}}', 'Tenant fixture notice', '[tenant-fixture-v1]', false, '2099-02-01 05:30+08');

insert into public.reminders (
  id, club_id, venue_id, user_id, kind, title, body, fire_at, booking_id
)
values
  ('71000000-0000-4000-8b00-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '71000000-0000-4000-8100-000000000001', '{{RALLY_MEMBER_USER_ID}}', 'booking', 'Tenant fixture reminder', '[tenant-fixture-v1]', '2099-02-01 05:00+08', '71000000-0000-4000-8300-000000000001'),
  ('72000000-0000-4000-8b00-000000000001', '72000000-0000-4000-8000-000000000000', '72000000-0000-4000-8100-000000000001', '{{SECOND_MEMBER_USER_ID}}', 'booking', 'Tenant fixture reminder', '[tenant-fixture-v1]', '2099-02-01 05:00+08', '72000000-0000-4000-8300-000000000001');

insert into public.court_allocations (
  id, club_id, venue_id, court_id, source, source_id, interval, status, created_by
)
values
  ('71000000-0000-4000-8c00-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '71000000-0000-4000-8100-000000000001', '71000000-0000-4000-8200-000000000001', 'booking', '71000000-0000-4000-8300-000000000001', tstzrange('2099-02-01 06:00+08', '2099-02-01 07:00+08', '[)'), 'reserved', '{{RALLY_STAFF_USER_ID}}'),
  ('71000000-0000-4000-8c00-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '71000000-0000-4000-8100-000000000001', '71000000-0000-4000-8200-000000000001', 'session', '71000000-0000-4000-8400-000000000001', tstzrange('2099-02-01 07:00+08', '2099-02-01 08:00+08', '[)'), 'reserved', '{{RALLY_STAFF_USER_ID}}'),
  ('71000000-0000-4000-8c00-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '71000000-0000-4000-8100-000000000001', '71000000-0000-4000-8200-000000000001', 'open_play', '71000000-0000-4000-8500-000000000001', tstzrange('2099-02-01 08:00+08', '2099-02-01 09:00+08', '[)'), 'reserved', '{{RALLY_STAFF_USER_ID}}'),
  ('72000000-0000-4000-8c00-000000000001', '72000000-0000-4000-8000-000000000000', '72000000-0000-4000-8100-000000000001', '72000000-0000-4000-8200-000000000001', 'booking', '72000000-0000-4000-8300-000000000001', tstzrange('2099-02-01 06:00+08', '2099-02-01 07:00+08', '[)'), 'reserved', '{{SECOND_STAFF_USER_ID}}'),
  ('72000000-0000-4000-8c00-000000000002', '72000000-0000-4000-8000-000000000000', '72000000-0000-4000-8100-000000000001', '72000000-0000-4000-8200-000000000001', 'session', '72000000-0000-4000-8400-000000000001', tstzrange('2099-02-01 07:00+08', '2099-02-01 08:00+08', '[)'), 'reserved', '{{SECOND_STAFF_USER_ID}}'),
  ('72000000-0000-4000-8c00-000000000003', '72000000-0000-4000-8000-000000000000', '72000000-0000-4000-8100-000000000002', '72000000-0000-4000-8200-000000000002', 'open_play', '72000000-0000-4000-8500-000000000001', tstzrange('2099-02-01 08:00+08', '2099-02-01 09:00+08', '[)'), 'reserved', '{{SECOND_ADMIN_USER_ID}}');
