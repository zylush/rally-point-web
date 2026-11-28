begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select extensions.plan(24);

-- Fixture:
--   user 81: platform superadmin with no club role
--   user 82: Gensan admin
insert into auth.users (id, email, raw_user_meta_data)
select ('c1000000-0000-4000-8000-0000000000' || n)::uuid, 'fee-' || n || '@fixture.invalid',
       jsonb_build_object('full_name', 'Fee User ' || n)
from generate_series(81, 82) n;
insert into public.platform_roles (user_id) values ('c1000000-0000-4000-8000-000000000081');
delete from public.members where user_id = 'c1000000-0000-4000-8000-000000000081';
insert into public.club_staff_roles (club_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1000000-0000-4000-8000-000000000082', 'admin');

-- Structure: the fee is pesos, every club starts at 0, and the percentage is retired.
select extensions.is(
  (select string_agg(table_name || '.' || column_name || ':' || data_type || ':' || column_default, ',' order by table_name)
   from information_schema.columns
   where table_schema = 'public' and column_name = 'booking_fee'
     and table_name in ('club_accounts', 'platform_commissions')),
  'club_accounts.booking_fee:numeric:0,platform_commissions.booking_fee:numeric:0',
  'club accounts and ledger lines carry a peso booking fee that defaults to 0');
select extensions.is(
  (select count(*)::int from public.club_accounts where booking_fee <> 0 or commission_rate <> 0),
  0, 'every club starts with no booking fee and no percentage');
insert into public.clubs (id, slug, name, is_active) values
  ('f8000000-0000-4000-8000-00000000000a', 'fee-fixture-club', 'Fee Fixture Club', false);
select extensions.is(
  (select commission_rate::text || ':' || booking_fee::text from public.club_accounts
   where club_id = 'f8000000-0000-4000-8000-00000000000a'),
  '0.00:0.00', 'a new club starts with no booking fee and no percentage');
select extensions.ok(
  has_function_privilege('authenticated', 'public.platform_set_booking_fee(uuid, numeric)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.platform_set_booking_fee(uuid, numeric)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.platform_list_clubs()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.platform_list_clubs()', 'EXECUTE'),
  'the fee functions are for signed-in users only, and check the role themselves');

-- With no fee set, a booking records its line at 0.
insert into public.transactions (id, club_id, venue_id, amount, type, description) values
  ('f6000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', 500, 'booking', 'Fee test, no fee yet');
select extensions.is(
  (select commission_amount::text || ':' || club_net_amount::text from public.platform_commissions
   where transaction_id = 'f6000000-0000-4000-8000-000000000001'),
  '0.00:500.00', 'with no fee set, the club keeps the whole charge');

-- Only the superadmin sets the fee.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000082', true);
select extensions.throws_ok(
  $$select public.platform_set_booking_fee('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 30)$$,
  '42501', 'Platform access required', 'a club admin cannot set the booking fee');

select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000081', true);
select extensions.throws_ok(
  $$select public.platform_set_booking_fee('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', -1)$$,
  '22023', 'The booking fee must be between 0 and 10,000 pesos', 'a negative fee is refused');
select extensions.throws_ok(
  $$select public.platform_set_booking_fee('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 10000.01)$$,
  '22023', 'The booking fee must be between 0 and 10,000 pesos', 'a fee over 10,000 pesos is refused');
select extensions.throws_ok(
  $$select public.platform_set_booking_fee('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null)$$,
  '22023', 'The booking fee must be between 0 and 10,000 pesos', 'a missing fee is refused');
select extensions.throws_ok(
  $$select public.platform_set_booking_fee('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 12.345)$$,
  '22023', 'Enter the booking fee in pesos and centavos', 'fractions of a centavo are refused');
select extensions.throws_ok(
  $$select public.platform_set_booking_fee('f8000000-0000-4000-8000-0000000000ff', 30)$$,
  'P0002', 'Club not found', 'an unknown club is refused');
select extensions.lives_ok(
  $$select public.platform_set_booking_fee('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 30)$$,
  'the superadmin sets a club''s booking fee');
select extensions.is(
  (select booking_fee::text from public.platform_list_clubs() where club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  '30.00', 'the club list shows the club''s booking fee');

set local role postgres;
select extensions.is(
  (select details::text from public.platform_audit_log
   where action = 'club.booking_fee' and club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
     and actor_id = 'c1000000-0000-4000-8000-000000000081'),
  '{"to": 30, "from": 0.00}', 'setting the fee wrote one audit row naming the superadmin');

-- Each booking and desk rental pays the flat fee; extensions and other charges do not.
insert into public.transactions (id, club_id, venue_id, amount, type, description) values
  ('f6000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', 1500, 'booking', 'Fee test, 3-hour booking'),
  ('f6000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', 500, 'court_rental', 'Fee test, desk rental'),
  ('f6000000-0000-4000-8000-000000000004', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', 250, 'extension', 'Fee test, extension'),
  ('f6000000-0000-4000-8000-000000000005', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', 20, 'booking', 'Fee test, charge below the fee'),
  ('f6000000-0000-4000-8000-000000000006', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', 350, 'walk_in', 'Fee test, walk-in'),
  ('f6000000-0000-4000-8000-000000000007', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, 2000, 'membership', 'Fee test, membership');
select extensions.is(
  (select commission_rate::text || ':' || booking_fee::text || ':' || commission_amount::text || ':' || club_net_amount::text
   from public.platform_commissions where transaction_id = 'f6000000-0000-4000-8000-000000000002'),
  '0.00:30.00:30.00:1470.00', 'a booking pays the flat fee, however long it is');
select extensions.is(
  (select booking_fee::text || ':' || commission_amount::text || ':' || club_net_amount::text
   from public.platform_commissions where transaction_id = 'f6000000-0000-4000-8000-000000000003'),
  '30.00:30.00:470.00', 'a desk rental pays the flat fee');
select extensions.is(
  (select booking_fee::text || ':' || commission_amount::text || ':' || club_net_amount::text
   from public.platform_commissions where transaction_id = 'f6000000-0000-4000-8000-000000000004'),
  '0.00:0.00:250.00', 'an extension is recorded as court time but pays no fee');
select extensions.is(
  (select commission_amount::text || ':' || club_net_amount::text
   from public.platform_commissions where transaction_id = 'f6000000-0000-4000-8000-000000000005'),
  '20.00:0.00', 'the fee never exceeds the charge');
select extensions.is(
  (select count(*)::int from public.platform_commissions
   where transaction_id in ('f6000000-0000-4000-8000-000000000006', 'f6000000-0000-4000-8000-000000000007')),
  0, 'walk-ins and membership charges still get no ledger line');

-- The fee is captured when the charge is recorded.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000081', true);
select public.platform_set_booking_fee('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 45.50);
set local role postgres;
insert into public.transactions (id, club_id, venue_id, amount, type, description) values
  ('f6000000-0000-4000-8000-000000000008', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', 600, 'booking', 'Fee test, after the change');
select extensions.is(
  (select string_agg(commission_amount::text, ',' order by transaction_id) from public.platform_commissions
   where transaction_id in ('f6000000-0000-4000-8000-000000000002', 'f6000000-0000-4000-8000-000000000008')),
  '30.00,45.50', 'a new fee applies to new charges only');
select extensions.is(
  (select booking_fee::text from public.club_accounts where club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  '45.50', 'the club account keeps the latest fee');
select set_config('fee_test.gensan_total',
  (select coalesce(sum(commission_amount), 0)::text from public.platform_commissions
   where club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), true);

-- Totals add up in pesos, and the club admin sees their own club's fees.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000081', true);
select extensions.is(
  (select commission_amount from public.platform_list_clubs() where club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  current_setting('fee_test.gensan_total')::numeric,
  'the club list adds up the club''s fees');
select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000082', true);
select extensions.is(
  (select sum(commission_amount)::text from public.platform_commissions
   where transaction_id::text like 'f6000000-%'),
  '125.50', 'the club admin reads their own club''s fee lines');
select extensions.throws_ok(
  $$select * from public.platform_list_clubs()$$,
  '42501', 'Platform access required', 'a club admin cannot read the platform club list');

select * from extensions.finish();
rollback;
