begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select extensions.plan(14);

-- Fixture: both seeded clubs active. Gensan has an active linked coach with open/closed/pending/full
-- slots plus an inactive coach; the second club has an active coach with an open private slot.
update public.club_accounts set status = 'active'
where club_id in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
select set_config('test.club_b_city',
  coalesce((select city from public.club_accounts where club_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), ''), true);

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
select ('e5000000-0000-4000-8000-00000000000' || n)::uuid,
       'public-coach-' || n || '@fixture.invalid', now(),
       jsonb_build_object('full_name', 'Public Coach User ' || n)
from generate_series(1, 3) n;

insert into public.club_coaches (
  id, club_id, account_user_id, full_name, headline, bio, hourly_rate, booking_policy, is_active, position
) values
  ('e5100000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'e5000000-0000-4000-8000-000000000001', 'Coach Ana', 'Doubles strategy',
   'Focused drills.', 650, 'Bring paddles.', true, 0),
  ('e5100000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   null, 'Coach Inactive', 'Hidden', null, 500, null, false, 1),
  ('e5100000-0000-4000-8000-000000000003', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   null, 'Coach Ben', 'Beginner fundamentals', null, 500, null, true, 0);

insert into public.coach_booking_slots (
  id, club_id, coach_id, starts_at, ends_at, lesson_type, pricing_model, rate, max_students, is_open
) values
  -- Open group slot with 2 accepted seats -> 2 remaining
  ('e5200000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'e5100000-0000-4000-8000-000000000001',
   now() + interval '2 days', now() + interval '2 days 1 hour', 'group', 'per_student', 400, 4, true),
  -- Pending-held slot -> hidden
  ('e5200000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'e5100000-0000-4000-8000-000000000001',
   now() + interval '3 days', now() + interval '3 days 1 hour', 'private', 'per_session', 700, 1, true),
  -- Closed slot -> hidden
  ('e5200000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'e5100000-0000-4000-8000-000000000001',
   now() + interval '4 days', now() + interval '4 days 1 hour', 'private', 'per_session', 700, 1, false),
  -- Past slot -> hidden
  ('e5200000-0000-4000-8000-000000000004', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'e5100000-0000-4000-8000-000000000001',
   now() - interval '2 days', now() - interval '1 day 23 hours', 'private', 'per_session', 700, 1, true),
  -- Full private slot (accepted) -> hidden
  ('e5200000-0000-4000-8000-000000000005', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'e5100000-0000-4000-8000-000000000001',
   now() + interval '5 days', now() + interval '5 days 1 hour', 'private', 'per_session', 700, 1, true);

insert into public.coach_booking_requests (
  id, club_id, slot_id, player_user_id, student_count, quoted_amount, status
) values
  ('e5300000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'e5200000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000002', 2, 800, 'accepted'),
  ('e5300000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'e5200000-0000-4000-8000-000000000002', 'e5000000-0000-4000-8000-000000000002', 1, 700, 'requested'),
  ('e5300000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'e5200000-0000-4000-8000-000000000005', 'e5000000-0000-4000-8000-000000000003', 1, 700, 'accepted');

-- 1-2: definer, pinned search path, owner, grants
select extensions.ok(
  (select p.prosecdef and 'search_path=""' = any(p.proconfig) and pg_get_userbyid(p.proowner) = 'postgres'
   from pg_proc p where p.oid = to_regprocedure('public.list_public_coaches(text, timestamptz, timestamptz)')),
  'list_public_coaches is a definer function with an empty search path, owned by postgres');

select extensions.ok(
  has_function_privilege('anon', 'public.list_public_coaches(text, timestamptz, timestamptz)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.list_public_coaches(text, timestamptz, timestamptz)', 'EXECUTE')
  and not has_function_privilege('public', 'public.list_public_coaches(text, timestamptz, timestamptz)', 'EXECUTE'),
  'visitors and signed-in callers can list public coaches; PUBLIC has no grant');

-- 3-12: as a visitor, with no club header
select set_config('request.headers', '', true);
set local role anon;
select set_config('request.jwt.claim.sub', '', true);

select extensions.is(
  (select array_agg(e ->> 'full_name' order by ord)
   from jsonb_array_elements(public.list_public_coaches()) with ordinality x(e, ord)),
  array['Coach Ana', 'Coach Ben'],
  'lists active coaches across active clubs (default club first) and excludes inactive coaches');

select extensions.is(
  (select e -> 'club' from jsonb_array_elements(public.list_public_coaches()) e where e ->> 'full_name' = 'Coach Ben'),
  jsonb_build_object(
    'id', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::text,
    'slug', 'synthetic-second-club',
    'name', 'Synthetic Second Club',
    'city', nullif(current_setting('test.club_b_city'), '')
  ),
  'each coach names its club with id, slug, name and city');

select extensions.is(
  (select (e ->> 'accepts_requests')::boolean
   from jsonb_array_elements(public.list_public_coaches()) e where e ->> 'full_name' = 'Coach Ana'),
  true, 'linked coach reports accepts_requests = true');

select extensions.is(
  (select (e ->> 'accepts_requests')::boolean
   from jsonb_array_elements(public.list_public_coaches()) e where e ->> 'full_name' = 'Coach Ben'),
  false, 'unlinked coach reports accepts_requests = false');

select extensions.is(
  (select jsonb_array_length(e -> 'slots')
   from jsonb_array_elements(public.list_public_coaches()) e where e ->> 'full_name' = 'Coach Ana'),
  1, 'only the open future non-pending non-full slot is returned');

select extensions.is(
  (select ((e -> 'slots' -> 0) ->> 'remaining_students')::integer
   from jsonb_array_elements(public.list_public_coaches()) e where e ->> 'full_name' = 'Coach Ana'),
  2, 'accepted group seats reduce remaining_students on the public slot');

select extensions.is(
  (select array_agg(e ->> 'full_name')
   from jsonb_array_elements(public.list_public_coaches('SYNTHETIC-SECOND-CLUB')) e),
  array['Coach Ben'],
  'a club slug filter (any case) narrows to one club');

select extensions.throws_ok(
  $$select public.list_public_coaches(null, now(), now() - interval '1 hour')$$,
  '22023', null, 'an invalid date range is refused');

select extensions.ok(
  not exists (
    select 1 from jsonb_array_elements(public.list_public_coaches()) e
    where e ?| array['account_user_id', 'player_user_id', 'email', 'member_code', 'qr_token']
  ),
  'no private account, member or player keys appear in the public coach list');

select extensions.ok(
  not exists (
    select 1 from jsonb_array_elements(public.list_public_coaches()) e,
         jsonb_array_elements(e -> 'slots') s
    where s ?| array['account_user_id', 'player_user_id', 'email', 'member_code', 'qr_token']
  ),
  'no private account or player keys appear in public slot objects');

-- 13-14: clubs that are not active drop out
set local role postgres;
update public.club_accounts set status = 'suspended' where club_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
set local role anon;
select extensions.is(
  (select array_agg(e ->> 'full_name' order by ord)
   from jsonb_array_elements(public.list_public_coaches()) with ordinality x(e, ord)),
  array['Coach Ana'],
  'a suspended club''s coaches are not listed');

set local role postgres;
update public.club_accounts set status = 'active' where club_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
update public.clubs set is_active = false where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
set local role anon;
select extensions.is(
  jsonb_array_length(public.list_public_coaches()), 1,
  'an inactive club''s coaches are not listed');

select * from extensions.finish();
rollback;
