begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select extensions.plan(30);

-- Fixture (Gensan; venue ...ab is gensan-main, ...ac is gensan-lagao).
--   user 1: staff with a grant for gensan-main only
--   user 2: Gensan admin
--   user 3: a plain member
--   user 4: staff without any venue grant
insert into auth.users (id, email, raw_user_meta_data)
select ('e2900000-0000-4000-8000-00000000000' || n)::uuid, 'walkin-' || n || '@fixture.invalid',
       jsonb_build_object('full_name', 'Walkin User ' || n)
from generate_series(1, 4) n;
insert into public.club_staff_roles (club_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'e2900000-0000-4000-8000-000000000001', 'staff'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'e2900000-0000-4000-8000-000000000002', 'admin'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'e2900000-0000-4000-8000-000000000004', 'staff');
insert into public.staff_venue_grants (club_id, user_id, venue_id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'e2900000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab');
select set_config('request.headers', '{"x-club-id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}', true);

-- ---------------------------------------------------------------------------
-- The function keeps its shape and grants; the tables get no new constraints
-- ---------------------------------------------------------------------------
select extensions.ok(
  (select p.prorettype = 'public.walkins'::regtype and not p.proretset and p.prosecdef
          and p.proconfig = array['search_path=pg_catalog, public, private']
          and pg_get_userbyid(p.proowner) = 'postgres'
   from pg_proc p where p.oid = to_regprocedure('public.create_desk_walkin(uuid, text, text, text, numeric)')),
  'create_desk_walkin keeps its signature, result, definer rights and owner');
select extensions.ok(
  has_function_privilege('authenticated', 'public.create_desk_walkin(uuid, text, text, text, numeric)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.create_desk_walkin(uuid, text, text, text, numeric)', 'EXECUTE')
  and not has_function_privilege('public', 'public.create_desk_walkin(uuid, text, text, text, numeric)', 'EXECUTE'),
  'only signed-in callers run create_desk_walkin, as before');
select extensions.ok(
  not exists (
    select 1
    from unnest(array[
      'public.create_unpaid_desk_booking(uuid, uuid, uuid, uuid, date, integer, integer)',
      'public.create_desk_rental(uuid, uuid, uuid, uuid, text, integer)',
      'public.add_member_to_session(uuid, uuid)',
      'public.extend_desk_session(uuid, integer)',
      'public.end_desk_session(uuid)',
      'public.create_open_play_session(uuid, uuid, uuid, text, timestamptz, timestamptz, integer, numeric, public.skill_level, text)',
      'public.join_open_play_session(uuid, uuid)',
      'public.leave_open_play_session(uuid, uuid)',
      'public.cancel_booking_reservation(uuid)']) f,
      (values ('anon'), ('authenticated')) r(role)
    where has_function_privilege(r.role, f, 'EXECUTE')),
  'create_desk_walkin is not a paused booking function, and the nine paused ones stay closed');
select extensions.ok(
  not exists (select 1 from pg_constraint c
              where c.conrelid in ('public.walkins'::regclass, 'public.transactions'::regclass)
                and c.contype = 'c'
                and pg_get_constraintdef(c.oid) ~ '(amount|full_name|phone|purpose)'),
  'walkins and transactions get no new constraints (stored rows are left alone)');
select extensions.ok(
  not has_table_privilege('authenticated', 'public.walkins', 'INSERT, UPDATE, DELETE')
  and not has_table_privilege('authenticated', 'public.transactions', 'INSERT, UPDATE, DELETE'),
  'walk-ins and charges are still written only through the function');

-- ---------------------------------------------------------------------------
-- Access comes first: callers without the venue get the same refusal as before
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select extensions.throws_ok(
  $$select public.create_desk_walkin('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', 'Guest', null, 'Day pass', 350)$$,
  '42501', null, 'a visitor cannot record a walk-in');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e2900000-0000-4000-8000-000000000003', true);
select extensions.throws_ok(
  $$select public.create_desk_walkin('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', 'Guest', null, 'Day pass', -500)$$,
  'P0001', 'venue is outside assigned club', 'a member is refused before the amount is looked at');
select set_config('request.jwt.claim.sub', 'e2900000-0000-4000-8000-000000000004', true);
select extensions.throws_ok(
  $$select public.create_desk_walkin('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', '', null, 'Day pass', -500)$$,
  'P0001', 'venue is outside assigned club', 'staff without a venue grant are refused as before');
select set_config('request.jwt.claim.sub', 'e2900000-0000-4000-8000-000000000001', true);
select extensions.throws_ok(
  $$select public.create_desk_walkin('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac', 'Guest', null, 'Day pass', 350)$$,
  'P0001', 'venue is outside assigned club', 'staff cannot record a walk-in at a venue they are not assigned to');

-- ---------------------------------------------------------------------------
-- Staff at their venue: bad input is refused with a plain message
-- ---------------------------------------------------------------------------
select extensions.throws_ok(
  $$select public.create_desk_walkin('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', 'Guest', null, 'Day pass', -1)$$,
  '22023', 'Amount must be between 0 and 100,000 pesos', 'a negative amount is refused');
select extensions.throws_ok(
  $$select public.create_desk_walkin('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', 'Guest', null, 'Day pass', -0.01)$$,
  '22023', 'Amount must be between 0 and 100,000 pesos', 'even one centavo below zero is refused');
select extensions.throws_ok(
  $$select public.create_desk_walkin('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', 'Guest', null, 'Day pass', 100000.01)$$,
  '22023', 'Amount must be between 0 and 100,000 pesos', 'an amount over 100,000 pesos is refused');
select extensions.throws_ok(
  $$select public.create_desk_walkin('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', 'Guest', null, 'Day pass', null)$$,
  '22023', 'Amount must be between 0 and 100,000 pesos', 'a missing amount is refused');
select extensions.throws_ok(
  $$select public.create_desk_walkin('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', 'Guest', null, 'Day pass', 'NaN'::numeric)$$,
  '22023', 'Amount must be between 0 and 100,000 pesos', 'an amount that is not a number is refused');
select extensions.throws_ok(
  $$select public.create_desk_walkin('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', '   ', null, 'Day pass', 350)$$,
  '22023', 'Please enter the guest''s full name', 'an empty name is refused');
select extensions.throws_ok(
  format('select public.create_desk_walkin(%L, %L, null, %L, 350)', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',
         chr(8203) || chr(8238) || E'\t', 'Day pass'),
  '22023', 'Please enter the guest''s full name', 'a name of only hidden characters is refused');
select extensions.throws_ok(
  $$select public.create_desk_walkin('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', repeat('a', 81), null, 'Day pass', 350)$$,
  '22023', 'Full name is limited to 80 characters', 'a name over 80 characters is refused');
select extensions.throws_ok(
  $$select public.create_desk_walkin('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', 'Guest', repeat('9', 25), 'Day pass', 350)$$,
  '22023', 'Phone is limited to 24 characters', 'a phone over 24 characters is refused');
select extensions.throws_ok(
  $$select public.create_desk_walkin('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', 'Guest', null, repeat('p', 201), 350)$$,
  '22023', 'Purpose is limited to 200 characters', 'a purpose over 200 characters is refused');
reset role;
select extensions.is(
  (select count(*)::int from public.walkins where created_by::text like 'e2900000-%')
  + (select count(*)::int from public.transactions where created_by::text like 'e2900000-%'),
  0, 'nothing was written for the refused walk-ins');

-- ---------------------------------------------------------------------------
-- Good input is tidied and recorded with its charge
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e2900000-0000-4000-8000-000000000001', true);
select extensions.is(
  (with r as (
     select * from public.create_desk_walkin('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',
       E'  Juan \t dela   Cruz ', ' 0917 123 4567 ', '  Day   pass ', 350))
   select r.full_name || '|' || r.phone || '|' || r.purpose || '|' || r.amount::text || '|'
          || (r.club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')::text || '|'
          || (r.venue_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab')::text || '|' || r.created_by::text
   from r),
  'Juan dela Cruz|0917 123 4567|Day pass|350.00|true|true|e2900000-0000-4000-8000-000000000001',
  'a walk-in is recorded with its name, phone and purpose tidied');
select extensions.is(
  (with r as (
     select * from public.create_desk_walkin('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',
       'Ana' || chr(8203) || ' Lim' || chr(8238), '', '', 0))
   select r.full_name || '|' || coalesce(r.phone, 'no phone') || '|' || r.purpose || '|' || r.amount::text from r),
  'Ana Lim|no phone||0.00',
  'hidden characters are dropped, an empty phone is no phone, and a free visit is allowed');
select extensions.lives_ok(
  $$select public.create_desk_walkin('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', repeat('a', 80), repeat('9', 24),
      repeat('p', 200), 100000)$$,
  'the longest name, phone and purpose and the highest amount are accepted');
select extensions.is(
  (select string_agg(t.amount::text || ':' || t.type::text || ':' || t.verification_status || ':' || t.description,
                     ',' order by t.amount)
   from public.transactions t
   where t.created_by = 'e2900000-0000-4000-8000-000000000001'
     and t.venue_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab'),
  '0.00:walk_in:unverified:Walk-in — recorded charge,350.00:walk_in:unverified:Walk-in — recorded charge,'
  || '100000.00:walk_in:unverified:Walk-in — recorded charge',
  'each walk-in records one unverified walk-in charge, as before');
select extensions.is(
  (select count(*)::int from public.walkins
   where created_by = 'e2900000-0000-4000-8000-000000000001' and venue_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab'),
  3, 'staff still see the walk-ins at their venue');

select set_config('request.jwt.claim.sub', 'e2900000-0000-4000-8000-000000000002', true);
select extensions.lives_ok(
  $$select public.create_desk_walkin('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac', 'Admin Guest', null, 'Day pass', 300)$$,
  'a club admin records a walk-in at any venue of the club');
select extensions.throws_ok(
  $$select public.create_desk_walkin('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac', 'Admin Guest', null, 'Refund', -300)$$,
  '22023', 'Amount must be between 0 and 100,000 pesos', 'an admin cannot record a negative walk-in either');
select extensions.throws_ok(
  $$select public.create_desk_walkin('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc', 'Admin Guest', null, 'Day pass', 300)$$,
  'P0001', 'venue is outside assigned club', 'an admin cannot record a walk-in at another club''s venue');

-- Revenue: only the accepted amounts count, and none is negative.
reset role;
select extensions.is(
  (select sum(t.amount)::text || '|' || min(t.amount)::text
   from public.transactions t where t.type = 'walk_in' and t.created_by::text like 'e2900000-%'),
  '100650.00|0.00', 'the club''s walk-in revenue holds only the accepted amounts');

-- Unchanged: an amount with more than two decimals is stored to the centavo, as before.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e2900000-0000-4000-8000-000000000001', true);
select extensions.is(
  (select (public.create_desk_walkin('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', 'Guest', null, 'Day pass', 12.345)).amount::text),
  '12.35', 'amounts are still stored to the centavo');

select * from extensions.finish();
rollback;
