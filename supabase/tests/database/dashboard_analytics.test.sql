begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select extensions.plan(41);

-- Fixture. Two new clubs, so the figures do not depend on the seed:
--   club A (...000a) "Analytics Fixture A": locations Analytics Main (...00a1, 6:00-22:00,
--     open) and Analytics Closed (...00a2, inactive); Court 1 (in service) and Court 2
--     (out of service) at Main, Court 3 at Closed.
--   club B (...000b) "Analytics Fixture B": one location (...00b1).
--   user 1: admin of A        user 2: staff of A      user 3: member of A
--   user 4: admin of B        user 5: platform superadmin (no club role)
-- Signing up gives every new account a Gensan membership row, nothing at A or B.
-- Times are Philippine days counted back from today, so the suite does not depend on
-- the run date: pg_temp.ph_day(n) is n days ago, pg_temp.ph_at(n, h) is h:00 that day.
-- With a 7-day period the current days are 0-6 days ago and the previous days 7-13.
create function pg_temp.ph_day(p_ago integer) returns date
language sql stable as $$ select (now() at time zone 'Asia/Manila')::date - p_ago $$;
create function pg_temp.ph_at(p_ago integer, p_hour integer) returns timestamptz
language sql stable as $$
  select (pg_temp.ph_day(p_ago)::timestamp + make_interval(hours => p_hour)) at time zone 'Asia/Manila'
$$;

insert into auth.users (id, email, raw_user_meta_data)
select ('e7100000-0000-4000-8000-00000000000' || n)::uuid, 'analytics-' || n || '@fixture.invalid',
       jsonb_build_object('full_name', 'Analytics User ' || n)
from generate_series(1, 5) n;

insert into public.clubs (id, slug, name, is_active) values
  ('e7000000-0000-4000-8000-00000000000a', 'analytics-fixture-a', 'Analytics Fixture A', true),
  ('e7000000-0000-4000-8000-00000000000b', 'analytics-fixture-b', 'Analytics Fixture B', true);
insert into public.venues (id, club_id, slug, name, open_hour, close_hour, is_active) values
  ('e7000000-0000-4000-8000-0000000000a1', 'e7000000-0000-4000-8000-00000000000a', 'main', 'Analytics Main', 6, 22, true),
  ('e7000000-0000-4000-8000-0000000000a2', 'e7000000-0000-4000-8000-00000000000a', 'closed', 'Analytics Closed', 0, 24, false),
  ('e7000000-0000-4000-8000-0000000000b1', 'e7000000-0000-4000-8000-00000000000b', 'main', 'Analytics B Main', 6, 22, true);
insert into public.courts (id, club_id, venue_id, name, status, hourly_rate) values
  ('e7000000-0000-4000-8000-0000000000c1', 'e7000000-0000-4000-8000-00000000000a',
   'e7000000-0000-4000-8000-0000000000a1', 'Court 1', 'available', 300),
  ('e7000000-0000-4000-8000-0000000000c2', 'e7000000-0000-4000-8000-00000000000a',
   'e7000000-0000-4000-8000-0000000000a1', 'Court 2', 'maintenance', 300),
  ('e7000000-0000-4000-8000-0000000000c3', 'e7000000-0000-4000-8000-00000000000a',
   'e7000000-0000-4000-8000-0000000000a2', 'Court 3', 'available', 300);

insert into public.club_staff_roles (club_id, user_id, role) values
  ('e7000000-0000-4000-8000-00000000000a', 'e7100000-0000-4000-8000-000000000001', 'admin'),
  ('e7000000-0000-4000-8000-00000000000a', 'e7100000-0000-4000-8000-000000000002', 'staff'),
  ('e7000000-0000-4000-8000-00000000000b', 'e7100000-0000-4000-8000-000000000004', 'admin');
insert into public.platform_roles (user_id) values ('e7100000-0000-4000-8000-000000000005');

-- Members of A. Current period: one member and one player joined. Previous: one member.
-- Today: three active memberships (one ends within 7 days), one expired, one player.
insert into public.members (id, club_id, user_id, member_code, full_name, membership_type, status, join_date, expiry_date) values
  ('e7000000-0000-4000-8000-0000000000d1', 'e7000000-0000-4000-8000-00000000000a', 'e7100000-0000-4000-8000-000000000003',
   'AN-1', 'Analytics Member One', 'basic', 'active', pg_temp.ph_day(2), pg_temp.ph_day(-5)),
  ('e7000000-0000-4000-8000-0000000000d2', 'e7000000-0000-4000-8000-00000000000a', null,
   'AN-2', 'Analytics Player Two', null, 'active', pg_temp.ph_day(1), null),
  ('e7000000-0000-4000-8000-0000000000d3', 'e7000000-0000-4000-8000-00000000000a', null,
   'AN-3', 'Analytics Member Three', 'premium', 'active', pg_temp.ph_day(200), pg_temp.ph_day(-100)),
  ('e7000000-0000-4000-8000-0000000000d4', 'e7000000-0000-4000-8000-00000000000a', null,
   'AN-4', 'Analytics Member Four', 'basic', 'expired', pg_temp.ph_day(400), pg_temp.ph_day(300)),
  ('e7000000-0000-4000-8000-0000000000d5', 'e7000000-0000-4000-8000-00000000000a', null,
   'AN-5', 'Analytics Member Five', 'standard', 'active', pg_temp.ph_day(10), pg_temp.ph_day(-20));

-- Charges. Court-time charges get a 5% commission line from the trigger; the line is
-- dated to its charge here so it falls on the same day.
insert into public.transactions (club_id, venue_id, member_id, amount, type, description, created_at) values
  ('e7000000-0000-4000-8000-00000000000a', 'e7000000-0000-4000-8000-0000000000a1', null, 500, 'booking',
   'Analytics fixture', pg_temp.ph_at(0, 9)),
  ('e7000000-0000-4000-8000-00000000000a', null, null, 300, 'membership',
   'Analytics fixture', pg_temp.ph_at(4, 9)),
  ('e7000000-0000-4000-8000-00000000000a', 'e7000000-0000-4000-8000-0000000000a1', null, 400, 'booking',
   'Analytics fixture', pg_temp.ph_at(9, 9)),
  ('e7000000-0000-4000-8000-00000000000a', 'e7000000-0000-4000-8000-0000000000a1', null, 999, 'booking',
   'Analytics fixture', pg_temp.ph_at(30, 9)),
  ('e7000000-0000-4000-8000-00000000000b', 'e7000000-0000-4000-8000-0000000000b1', null, 777, 'booking',
   'Analytics fixture', pg_temp.ph_at(0, 9));
update public.platform_commissions pc
set created_at = t.created_at
from public.transactions t
where t.id = pc.transaction_id
  and t.club_id in ('e7000000-0000-4000-8000-00000000000a', 'e7000000-0000-4000-8000-00000000000b');

-- Bookings on Court 1 (direct writes are paused for API roles, so postgres adds them).
-- Kept: 2h GCash yesterday 18:00, 1h today 8:00, 2h today 23:00 (only 23:00 is on the
-- grid), 1h no-show 3 days ago 12:00. Not kept: a cancelled and a waiting one 2 days ago.
-- Previous period: 3h 8 days ago.
insert into public.bookings (club_id, venue_id, court_id, member_id, start_at, end_at, hours, amount, status,
                             payment_reference, payment_submitted_at, confirm_by)
select 'e7000000-0000-4000-8000-00000000000a', 'e7000000-0000-4000-8000-0000000000a1',
       'e7000000-0000-4000-8000-0000000000c1', 'e7000000-0000-4000-8000-0000000000d1',
       pg_temp.ph_at(f.ago, f.hour), pg_temp.ph_at(f.ago, f.hour) + make_interval(hours => f.hours),
       f.hours, f.amount, f.status::public.booking_status,
       f.ref, case when f.ref is not null then pg_temp.ph_at(2, 10) end,
       case when f.ref is not null then pg_temp.ph_at(2, 10) + interval '15 minutes' end
from (values
  (1, 18, 2, 600, 'confirmed', 'GC123456'),
  (0, 8, 1, 300, 'completed', null),
  (0, 23, 2, 400, 'confirmed', null),
  (3, 12, 1, 300, 'no_show', null),
  (2, 8, 1, 300, 'cancelled', null),
  (2, 10, 1, 300, 'pending_payment', null),
  (8, 8, 3, 900, 'confirmed', null)
) as f(ago, hour, hours, amount, status, ref);

-- Coach requests at A: two in the current period (one accepted), one declined before.
insert into public.club_coaches (id, club_id, full_name)
values ('e7000000-0000-4000-8000-0000000000e1', 'e7000000-0000-4000-8000-00000000000a', 'Analytics Coach Name');
insert into public.coach_booking_slots (id, club_id, coach_id, starts_at, ends_at, lesson_type, pricing_model, rate, max_students) values
  ('e7000000-0000-4000-8000-0000000000f1', 'e7000000-0000-4000-8000-00000000000a', 'e7000000-0000-4000-8000-0000000000e1',
   pg_temp.ph_at(-2, 10), pg_temp.ph_at(-2, 11), 'private', 'per_session', 500, 1),
  ('e7000000-0000-4000-8000-0000000000f2', 'e7000000-0000-4000-8000-00000000000a', 'e7000000-0000-4000-8000-0000000000e1',
   pg_temp.ph_at(9, 10), pg_temp.ph_at(9, 11), 'private', 'per_session', 500, 1);
insert into public.coach_booking_requests (club_id, slot_id, player_user_id, student_count, quoted_amount, status, created_at) values
  ('e7000000-0000-4000-8000-00000000000a', 'e7000000-0000-4000-8000-0000000000f1', 'e7100000-0000-4000-8000-000000000003',
   1, 500, 'requested', pg_temp.ph_at(1, 9)),
  ('e7000000-0000-4000-8000-00000000000a', 'e7000000-0000-4000-8000-0000000000f1', 'e7100000-0000-4000-8000-000000000002',
   1, 500, 'accepted', pg_temp.ph_at(3, 9)),
  ('e7000000-0000-4000-8000-00000000000a', 'e7000000-0000-4000-8000-0000000000f2', 'e7100000-0000-4000-8000-000000000003',
   1, 500, 'declined', pg_temp.ph_at(10, 9));

-- Owner call requests today: one with a city, one with a blank city.
insert into public.owner_call_requests (full_name, club_name, city, court_count, phone, preferred_date, preferred_time, created_at) values
  ('Analytics Owner Name', 'Analytics Owner Club', 'Analytics City', 2, '0917 123 4567', pg_temp.ph_day(0), 'morning', pg_temp.ph_at(0, 1)),
  ('Analytics Owner Name', 'Analytics Owner Club', '  ', 2, '0917 123 4568', pg_temp.ph_day(0), 'evening', pg_temp.ph_at(0, 1));

-- ---------------------------------------------------------------------------
-- Structure and privileges
-- ---------------------------------------------------------------------------
select extensions.ok(
  (select count(*) = 2 and bool_and(p.prorettype = 'jsonb'::regtype)
   from unnest(array['public.admin_club_analytics(uuid, integer)', 'public.platform_analytics(integer)']) f
   join pg_proc p on p.oid = to_regprocedure(f)::oid),
  'admin_club_analytics(uuid, integer) and platform_analytics(integer) exist and return jsonb');
select extensions.ok(
  (select count(*) = 2 and bool_and(p.prosecdef and p.provolatile = 's' and 'search_path=""' = any(p.proconfig))
   from unnest(array['public.admin_club_analytics(uuid, integer)', 'public.platform_analytics(integer)']) f
   join pg_proc p on p.oid = to_regprocedure(f)::oid),
  'both run with definer rights, read only (stable) and with an empty search path');
select extensions.ok(
  (select bool_and(not has_function_privilege('anon', f, 'EXECUTE')
                   and not has_function_privilege('public', f, 'EXECUTE')
                   and not has_function_privilege('service_role', f, 'EXECUTE')
                   and has_function_privilege('authenticated', f, 'EXECUTE'))
   from unnest(array['public.admin_club_analytics(uuid, integer)', 'public.platform_analytics(integer)']) f),
  'only signed-in callers reach the summaries, which check the caller inside');

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.headers', '{"x-club-id":"e7000000-0000-4000-8000-00000000000a"}', true);
select extensions.throws_ok(
  $$select public.admin_club_analytics('e7000000-0000-4000-8000-00000000000a', 7)$$,
  '42501', null, 'a visitor cannot run the club summary');

-- ---------------------------------------------------------------------------
-- Calls: the admin of A, then everyone who must be refused
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e7100000-0000-4000-8000-000000000001', true);
select extensions.lives_ok(
  $$select set_config('test.club7',
      public.admin_club_analytics('e7000000-0000-4000-8000-00000000000a', 7)::text, true)$$,
  'the admin of A reads A''s 7-day summary');
select extensions.lives_ok(
  $$select set_config('test.club30',
      public.admin_club_analytics('e7000000-0000-4000-8000-00000000000a', 30)::text, true)$$,
  'the admin of A reads A''s 30-day summary');
select extensions.throws_ok(
  $$select public.admin_club_analytics('e7000000-0000-4000-8000-00000000000a', 31)$$,
  '22023', 'Choose a period of 7, 30 or 90 days', 'only 7, 30 or 90 days are offered');
select extensions.throws_ok(
  $$select public.platform_analytics(7)$$,
  '42501', 'Platform access required', 'a club admin cannot read the platform summary');
select set_config('request.headers', '', true);
select extensions.throws_ok(
  $$select public.admin_club_analytics('e7000000-0000-4000-8000-00000000000a', 7)$$,
  '42501', 'admin access required', 'the club asked for must be the club the request names');

select set_config('request.headers', '{"x-club-id":"e7000000-0000-4000-8000-00000000000a"}', true);
select set_config('request.jwt.claim.sub', 'e7100000-0000-4000-8000-000000000002', true);
select extensions.throws_ok(
  $$select public.admin_club_analytics('e7000000-0000-4000-8000-00000000000a', 7)$$,
  '42501', 'admin access required', 'staff of A are refused');
select set_config('request.jwt.claim.sub', 'e7100000-0000-4000-8000-000000000003', true);
select extensions.throws_ok(
  $$select public.admin_club_analytics('e7000000-0000-4000-8000-00000000000a', 7)$$,
  '42501', 'admin access required', 'a member of A is refused');
select set_config('request.jwt.claim.sub', 'e7100000-0000-4000-8000-000000000004', true);
select extensions.throws_ok(
  $$select public.admin_club_analytics('e7000000-0000-4000-8000-00000000000a', 7)$$,
  '42501', 'admin access required', 'the admin of B naming A in the header is refused');
select set_config('request.headers', '{"x-club-id":"e7000000-0000-4000-8000-00000000000b"}', true);
select extensions.throws_ok(
  $$select public.admin_club_analytics('e7000000-0000-4000-8000-00000000000a', 7)$$,
  '42501', 'admin access required', 'the admin of B asking for A from B is refused');

select set_config('request.headers', '{"x-club-id":"e7000000-0000-4000-8000-00000000000a"}', true);
select set_config('request.jwt.claim.sub', 'e7100000-0000-4000-8000-000000000005', true);
select extensions.throws_ok(
  $$select public.admin_club_analytics('e7000000-0000-4000-8000-00000000000a', 7)$$,
  '42501', 'admin access required', 'a platform superadmin without a club role is refused');
select extensions.lives_ok(
  $$select set_config('test.platform7', public.platform_analytics(7)::text, true)$$,
  'the platform superadmin reads the 7-day platform summary');
select extensions.throws_ok(
  $$select public.platform_analytics(31)$$,
  '22023', 'Choose a period of 7, 30 or 90 days', 'the platform summary offers only 7, 30 or 90 days');
select set_config('request.jwt.claim.sub', 'e7100000-0000-4000-8000-000000000003', true);
select extensions.throws_ok(
  $$select public.platform_analytics(7)$$,
  '42501', 'Platform access required', 'a member cannot read the platform summary');

reset role;

-- ---------------------------------------------------------------------------
-- Club A, 7 days
-- ---------------------------------------------------------------------------
select extensions.is(
  (select array_agg(k order by k collate "C") from jsonb_object_keys(current_setting('test.club7')::jsonb) k),
  array['bookings_by_status', 'busy_hours', 'by_day', 'charges_by_type', 'charges_by_venue', 'coaching',
        'courts', 'current', 'members', 'payment_split', 'period', 'previous', 'previous_period', 'source'],
  'the club summary has the ClubAnalytics keys');
select extensions.is(
  jsonb_build_array(current_setting('test.club7')::jsonb -> 'period', current_setting('test.club7')::jsonb -> 'previous_period'),
  jsonb_build_array(
    jsonb_build_object('from', to_char(pg_temp.ph_day(6), 'YYYY-MM-DD'), 'to', to_char(pg_temp.ph_day(0), 'YYYY-MM-DD'), 'days', 7),
    jsonb_build_object('from', to_char(pg_temp.ph_day(13), 'YYYY-MM-DD'), 'to', to_char(pg_temp.ph_day(7), 'YYYY-MM-DD'), 'days', 7)),
  'the period ends today in Philippine time and the previous period is the 7 days before');
select extensions.is(
  current_setting('test.club7')::jsonb -> 'current',
  '{"charges": 800, "bookings": 4, "hours": 6, "open_hours": 112, "new_members": 1, "new_players": 1,
    "cancellations": 2, "avg_booking": 400, "commission": 25}'::jsonb,
  'current totals: charges by day, kept bookings, in-service open hours, joins and commission');
select extensions.is(
  current_setting('test.club7')::jsonb -> 'previous',
  '{"charges": 400, "bookings": 1, "hours": 3, "open_hours": 112, "new_members": 1, "new_players": 0,
    "cancellations": 0, "avg_booking": 900, "commission": 20}'::jsonb,
  'previous totals count only the 7 days before, and nothing older');
select extensions.ok(
  jsonb_array_length(current_setting('test.club7')::jsonb -> 'by_day') = 7
  and current_setting('test.club7')::jsonb -> 'by_day' -> 0 ->> 'day' = to_char(pg_temp.ph_day(6), 'YYYY-MM-DD')
  and current_setting('test.club7')::jsonb -> 'by_day' -> 6 ->> 'day' = to_char(pg_temp.ph_day(0), 'YYYY-MM-DD'),
  'by_day has one point per day, oldest first');
select extensions.is(
  current_setting('test.club7')::jsonb -> 'by_day' -> 6,
  jsonb_build_object('day', to_char(pg_temp.ph_day(0), 'YYYY-MM-DD'), 'charges', 500, 'bookings', 2, 'hours', 3,
                     'new_members', 0, 'cancellations', 0, 'commission', 25),
  'today''s point has today''s charge, kept bookings and commission');
select extensions.is(
  current_setting('test.club7')::jsonb -> 'by_day' -> 4,
  jsonb_build_object('day', to_char(pg_temp.ph_day(2), 'YYYY-MM-DD'), 'charges', 0, 'bookings', 0, 'hours', 0,
                     'new_members', 1, 'cancellations', 1, 'commission', 0),
  'a day with no charge is filled with zeros and still counts its join and cancellation');
select extensions.is(
  current_setting('test.club7')::jsonb -> 'charges_by_type',
  '[{"type": "booking", "amount": 500}, {"type": "membership", "amount": 300}]'::jsonb,
  'charges by type follow the fixed type order and list only types with charges');
select extensions.is(
  current_setting('test.club7')::jsonb -> 'charges_by_venue',
  '[{"venue_id": "e7000000-0000-4000-8000-0000000000a1", "name": "Analytics Main", "amount": 500},
    {"venue_id": null, "name": "No location", "amount": 300}]'::jsonb,
  'charges by location, largest first, with "No location" for charges without one');
select extensions.is(
  current_setting('test.club7')::jsonb -> 'bookings_by_status',
  '[{"status": "confirmed", "count": 2}, {"status": "completed", "count": 1},
    {"status": "pending_payment", "count": 1}, {"status": "cancelled", "count": 1},
    {"status": "no_show", "count": 1}]'::jsonb,
  'bookings by status in the fixed status order');
select extensions.is(
  current_setting('test.club7')::jsonb -> 'courts',
  '[{"court_id": "e7000000-0000-4000-8000-0000000000c1", "name": "Court 1", "venue_name": "Analytics Main", "hours": 6, "open_hours": 112},
    {"court_id": "e7000000-0000-4000-8000-0000000000c2", "name": "Court 2", "venue_name": "Analytics Main", "hours": 0, "open_hours": 0},
    {"court_id": "e7000000-0000-4000-8000-0000000000c3", "name": "Court 3", "venue_name": "Analytics Closed", "hours": 0, "open_hours": 0}]'::jsonb,
  'courts by booked hours then name; out-of-service courts and closed locations open no hours');
select extensions.ok(
  jsonb_array_length(current_setting('test.club7')::jsonb -> 'busy_hours') = 7
  and (select bool_and(jsonb_array_length(r) = 24)
       from jsonb_array_elements(current_setting('test.club7')::jsonb -> 'busy_hours') r),
  'busy_hours is 7 weekdays by 24 hours');
select extensions.ok(
  (current_setting('test.club7')::jsonb -> 'busy_hours' -> ((extract(dow from pg_temp.ph_day(1))::int + 6) % 7) ->> 18)::int = 1
  and (current_setting('test.club7')::jsonb -> 'busy_hours' -> ((extract(dow from pg_temp.ph_day(1))::int + 6) % 7) ->> 19)::int = 1
  and (current_setting('test.club7')::jsonb -> 'busy_hours' -> ((extract(dow from pg_temp.ph_day(0))::int + 6) % 7) ->> 8)::int = 1
  and (current_setting('test.club7')::jsonb -> 'busy_hours' -> ((extract(dow from pg_temp.ph_day(0))::int + 6) % 7) ->> 23)::int = 1
  and (current_setting('test.club7')::jsonb -> 'busy_hours' -> ((extract(dow from pg_temp.ph_day(3))::int + 6) % 7) ->> 12)::int = 1
  and (select sum(c::int) from jsonb_array_elements(current_setting('test.club7')::jsonb -> 'busy_hours') r,
       jsonb_array_elements_text(r) c) = 5,
  'busy hours use Philippine weekdays (Monday first) and hours, and stop at 23:00');
select extensions.is(
  current_setting('test.club7')::jsonb -> 'payment_split',
  '{"online": 1, "desk": 3}'::jsonb,
  'kept bookings with a GCash reference count as online, the rest as desk');
select extensions.is(
  current_setting('test.club7')::jsonb -> 'members',
  '{"active_members": 3, "ending_soon": 1, "players": 1}'::jsonb,
  'today''s standing: active memberships, those ending within 7 days, and players');
select extensions.is(
  jsonb_build_array(current_setting('test.club7')::jsonb -> 'coaching', current_setting('test.club7')::jsonb -> 'source'),
  '[{"requests": 2, "previous_requests": 1, "accepted": 1}, "server"]'::jsonb,
  'coach requests are counted by the day they were made, and the summary says it came from the server');
select extensions.ok(
  current_setting('test.club7')::jsonb::text !~ '"(email|full_name|phone|member_code|player_user_id|player_name|coach_name|contact_email|contact_phone)":'
  and position('Analytics Member' in current_setting('test.club7')) = 0
  and position('Analytics Player' in current_setting('test.club7')) = 0
  and position('Analytics Coach' in current_setting('test.club7')) = 0
  and current_setting('test.club30')::jsonb::text !~ '"(email|full_name|phone|member_code)":',
  'the club summary holds no names, emails, phones or member codes');

-- ---------------------------------------------------------------------------
-- Club A, 30 days
-- ---------------------------------------------------------------------------
select extensions.ok(
  jsonb_array_length(current_setting('test.club30')::jsonb -> 'by_day') = 30
  and current_setting('test.club30')::jsonb -> 'previous_period' = jsonb_build_object(
        'from', to_char(pg_temp.ph_day(59), 'YYYY-MM-DD'), 'to', to_char(pg_temp.ph_day(30), 'YYYY-MM-DD'), 'days', 30)
  and (current_setting('test.club30')::jsonb -> 'current' ->> 'charges')::numeric = 1200
  and (current_setting('test.club30')::jsonb -> 'previous' ->> 'charges')::numeric = 999
  and (current_setting('test.club30')::jsonb -> 'current' ->> 'open_hours')::numeric = 480,
  'a 30-day period has 30 points and moves the older charges into the right periods');

-- ---------------------------------------------------------------------------
-- Platform, 7 days
-- ---------------------------------------------------------------------------
select extensions.is(
  (select array_agg(k order by k collate "C") from jsonb_object_keys(current_setting('test.platform7')::jsonb) k),
  array['by_day', 'clubs_by_status', 'current', 'ledger_capped', 'period', 'previous', 'previous_period',
        'requests_by_city', 'requests_by_status', 'source', 'top_clubs'],
  'the platform summary has the PlatformAnalytics keys');
select extensions.ok(
  jsonb_array_length(current_setting('test.platform7')::jsonb -> 'by_day') = 7
  and current_setting('test.platform7')::jsonb -> 'by_day' -> 6 ->> 'day' = to_char(pg_temp.ph_day(0), 'YYYY-MM-DD')
  and current_setting('test.platform7')::jsonb -> 'period' = jsonb_build_object(
        'from', to_char(pg_temp.ph_day(6), 'YYYY-MM-DD'), 'to', to_char(pg_temp.ph_day(0), 'YYYY-MM-DD'), 'days', 7)
  and (current_setting('test.platform7')::jsonb -> 'current' ->> 'new_clubs')::int >= 2
  and (current_setting('test.platform7')::jsonb -> 'current' ->> 'gross')::numeric >= 1277,
  'the platform summary has 7 days ending today and counts the new clubs and their charges');
select extensions.ok(
  exists (
    select 1 from jsonb_array_elements(current_setting('test.platform7')::jsonb -> 'top_clubs') e
    where e = '{"club_id": "e7000000-0000-4000-8000-00000000000a", "name": "Analytics Fixture A",
                "gross": 500, "commission": 25, "lines": 1}'::jsonb)
  and exists (
    select 1 from jsonb_array_elements(current_setting('test.platform7')::jsonb -> 'top_clubs') e
    where e = '{"club_id": "e7000000-0000-4000-8000-00000000000b", "name": "Analytics Fixture B",
                "gross": 777, "commission": 38.85, "lines": 1}'::jsonb)
  and (select min(o.n) filter (where o.e ->> 'club_id' = 'e7000000-0000-4000-8000-00000000000b')
            < min(o.n) filter (where o.e ->> 'club_id' = 'e7000000-0000-4000-8000-00000000000a')
       from jsonb_array_elements(current_setting('test.platform7')::jsonb -> 'top_clubs') with ordinality as o(e, n)),
  'top clubs total the current period''s ledger per club, largest first');
select extensions.ok(
  (select sum((e ->> 'count')::int) from jsonb_array_elements(current_setting('test.platform7')::jsonb -> 'clubs_by_status') e)
    = (select count(*) from public.clubs)
  and (select bool_and(e ->> 'status' in ('active', 'provisioning', 'suspended'))
       from jsonb_array_elements(current_setting('test.platform7')::jsonb -> 'clubs_by_status') e)
  and current_setting('test.platform7')::jsonb -> 'clubs_by_status' -> 0 ->> 'status' = 'active',
  'clubs by status cover every club, active first');
select extensions.ok(
  exists (select 1 from jsonb_array_elements(current_setting('test.platform7')::jsonb -> 'requests_by_city') e
          where e ->> 'city' = 'Analytics City' and (e ->> 'count')::int >= 1)
  and exists (select 1 from jsonb_array_elements(current_setting('test.platform7')::jsonb -> 'requests_by_city') e
              where e ->> 'city' = 'Not given' and (e ->> 'count')::int >= 1)
  and exists (select 1 from jsonb_array_elements(current_setting('test.platform7')::jsonb -> 'requests_by_status') e
              where e ->> 'status' = 'new' and (e ->> 'count')::int >= 2)
  and (current_setting('test.platform7')::jsonb -> 'current' ->> 'requests')::int >= 2,
  'owner requests are counted by city (blank as "Not given") and by status');
select extensions.ok(
  current_setting('test.platform7')::jsonb::text !~ '"(email|full_name|phone|member_code|contact_email|contact_phone|handled_by)":'
  and position('Analytics Owner Name' in current_setting('test.platform7')) = 0
  and position('0917' in current_setting('test.platform7')) = 0
  and position('fixture.invalid' in current_setting('test.platform7')) = 0
  and current_setting('test.platform7')::jsonb -> 'ledger_capped' = 'false'::jsonb
  and current_setting('test.platform7')::jsonb ->> 'source' = 'server',
  'the platform summary holds no names, emails or phones, is never capped, and comes from the server');

select * from extensions.finish();
rollback;
