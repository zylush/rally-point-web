begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select extensions.plan(21);

-- Fixture:
--   user 61: Gensan admin    user 62: second-club admin
--   user 63: Gensan staff    user 64: platform superadmin with no club role
insert into auth.users (id, email, raw_user_meta_data)
select ('c1000000-0000-4000-8000-0000000000' || n)::uuid, 'ledger-' || n || '@fixture.invalid',
       jsonb_build_object('full_name', 'Ledger User ' || n)
from generate_series(61, 64) n;
insert into public.club_staff_roles (club_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1000000-0000-4000-8000-000000000061', 'admin'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'c1000000-0000-4000-8000-000000000062', 'admin'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1000000-0000-4000-8000-000000000063', 'staff');
insert into public.staff_venue_grants (club_id, user_id, venue_id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1000000-0000-4000-8000-000000000063', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab');
insert into public.platform_roles (user_id) values ('c1000000-0000-4000-8000-000000000064');
delete from public.members where user_id = 'c1000000-0000-4000-8000-000000000064';

-- This suite checks the percentage path, which the trigger still honours; since the flat booking
-- fee every club starts at 0%, so Gensan's 5% is set here.
update public.club_accounts set commission_rate = 5 where club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
update public.club_accounts set commission_rate = 10 where club_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

insert into public.transactions (id, club_id, venue_id, amount, type, description) values
  ('c6000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', 500, 'court_rental', 'Ledger Gensan rental'),
  ('c6000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', 100, 'walk_in', 'Ledger Gensan walk-in'),
  ('c6000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, 1000, 'membership', 'Ledger Gensan membership'),
  ('c6000000-0000-4000-8000-000000000004', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc', 333.33, 'booking', 'Ledger second-club booking'),
  ('c6000000-0000-4000-8000-000000000005', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', 0, 'court_rental', 'Ledger zero rental'),
  ('c6000000-0000-4000-8000-000000000006', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', -50, 'court_rental', 'Ledger negative rental'),
  ('c6000000-0000-4000-8000-000000000007', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, 120, 'extension', 'Ledger club-wide extension');

-- Which charges qualify, and how amounts are worked out.
select extensions.is(
  (select commission_rate::text || ':' || commission_amount::text || ':' || club_net_amount::text || ':' || verification_status
   from public.platform_commissions where transaction_id = 'c6000000-0000-4000-8000-000000000001'),
  '5.00:25.00:475.00:unverified', 'a court rental records commission at the club''s rate');
select extensions.is(
  (select count(*)::int from public.platform_commissions where transaction_id = 'c6000000-0000-4000-8000-000000000002'),
  0, 'walk-ins earn no commission');
select extensions.is(
  (select count(*)::int from public.platform_commissions where transaction_id = 'c6000000-0000-4000-8000-000000000003'),
  0, 'membership fees earn no commission');
select extensions.is(
  (select commission_rate::text || ':' || commission_amount::text || ':' || club_net_amount::text
   from public.platform_commissions where transaction_id = 'c6000000-0000-4000-8000-000000000004'),
  '10.00:33.33:300.00', 'bookings use their own club''s rate and round to the centavo');
select extensions.is(
  (select count(*)::int from public.platform_commissions
   where transaction_id in ('c6000000-0000-4000-8000-000000000005', 'c6000000-0000-4000-8000-000000000006')),
  0, 'zero and negative amounts earn no commission');
select extensions.is(
  (select club_id::text || ':' || coalesce(venue_id::text, 'none')
   from public.platform_commissions where transaction_id = 'c6000000-0000-4000-8000-000000000007'),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:none', 'extensions without a venue are still recorded');

-- The rate is captured when the charge is recorded.
update public.club_accounts set commission_rate = 7 where club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
insert into public.transactions (id, club_id, venue_id, amount, type, description) values
  ('c6000000-0000-4000-8000-000000000008', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', 100, 'court_rental', 'Ledger later rental');
select extensions.is(
  (select string_agg(commission_rate::text, ',' order by transaction_id) from public.platform_commissions
   where transaction_id in ('c6000000-0000-4000-8000-000000000001', 'c6000000-0000-4000-8000-000000000008')),
  '5.00,7.00', 'changing the rate leaves earlier lines untouched');

-- A club whose account row is missing still records charges.
insert into public.clubs (id, slug, name, is_active) values ('c2000000-0000-4000-8000-000000000051', 'ledger-no-account', 'Ledger No Account', true);
insert into public.venues (id, club_id, slug, name) values ('c3000000-0000-4000-8000-000000000051', 'c2000000-0000-4000-8000-000000000051', 'main', 'Ledger No Account');
delete from public.club_accounts where club_id = 'c2000000-0000-4000-8000-000000000051';
select extensions.lives_ok(
  $$insert into public.transactions (id, club_id, venue_id, amount, type, description) values
    ('c6000000-0000-4000-8000-000000000009', 'c2000000-0000-4000-8000-000000000051', 'c3000000-0000-4000-8000-000000000051', 200, 'court_rental', 'Ledger no-account rental')$$,
  'a club without an account row can still record a charge');
select extensions.is(
  (select commission_rate::text from public.platform_commissions where transaction_id = 'c6000000-0000-4000-8000-000000000009'),
  '5.00', 'the default rate is used when terms are missing');

update public.transactions set verification_status = 'verified' where id = 'c6000000-0000-4000-8000-000000000001';
select extensions.is(
  (select verification_status from public.platform_commissions where transaction_id = 'c6000000-0000-4000-8000-000000000001'),
  'verified', 'verifying a charge verifies its commission line');

-- Clean-up in the staging fixture's order still works.
insert into public.clubs (id, slug, name, is_active) values ('c2000000-0000-4000-8000-000000000052', 'ledger-cleanup', 'Ledger Cleanup', true);
insert into public.venues (id, club_id, slug, name) values ('c3000000-0000-4000-8000-000000000052', 'c2000000-0000-4000-8000-000000000052', 'main', 'Ledger Cleanup');
insert into public.courts (club_id, venue_id, name) values ('c2000000-0000-4000-8000-000000000052', 'c3000000-0000-4000-8000-000000000052', 'Cleanup Court');
insert into public.transactions (id, club_id, venue_id, amount, type, description) values
  ('c6000000-0000-4000-8000-000000000010', 'c2000000-0000-4000-8000-000000000052', 'c3000000-0000-4000-8000-000000000052', 300, 'court_rental', 'Ledger cleanup rental');
select extensions.lives_ok(
  $sql$do $cleanup$
    begin
      delete from public.transactions where club_id = 'c2000000-0000-4000-8000-000000000052';
      delete from public.courts where club_id = 'c2000000-0000-4000-8000-000000000052';
      delete from public.venues where club_id = 'c2000000-0000-4000-8000-000000000052';
      delete from public.clubs where id = 'c2000000-0000-4000-8000-000000000052';
    end
  $cleanup$$sql$,
  'charges, courts, venues and the club can still be deleted in order');
select extensions.is(
  (select count(*)::int from public.platform_commissions where club_id = 'c2000000-0000-4000-8000-000000000052'),
  0, 'deleted charges take their commission lines with them');
delete from public.transactions where id = 'c6000000-0000-4000-8000-000000000008';
select extensions.is(
  (select count(*)::int from public.platform_commissions where transaction_id = 'c6000000-0000-4000-8000-000000000008'),
  0, 'deleting one charge removes its commission line');

-- Who can see commission lines.
set local role authenticated;
select set_config('request.headers', '', true);
select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000061', true);
select extensions.ok(
  (select count(*) from public.platform_commissions where club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') >= 1,
  'a club admin sees their club''s commission lines');
select extensions.is(
  (select count(*)::int from public.platform_commissions where club_id <> 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  0, 'a club admin sees no other club''s lines');
select set_config('request.headers', '{"x-club-id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}', true);
select extensions.is((select count(*)::int from public.platform_commissions), 0,
  'naming another club does not reveal its lines');
select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000062', true);
select extensions.is(
  (select string_agg(transaction_id::text, ',') from public.platform_commissions),
  'c6000000-0000-4000-8000-000000000004', 'the second club''s admin sees only that club''s lines');
select set_config('request.headers', '', true);
select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000063', true);
select extensions.is((select count(*)::int from public.platform_commissions), 0, 'staff cannot see commission lines');

-- The superadmin's ledger and totals.
select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000064', true);
select extensions.is(
  (select club_name || ' | ' || description
   from public.platform_commission_ledger('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 10)
   where transaction_id = 'c6000000-0000-4000-8000-000000000004'),
  'Synthetic Second Club | Ledger second-club booking', 'the ledger names the club and the charge');
select extensions.is(
  (select count(*)::int from public.platform_commission_ledger('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 100)
   where club_id <> 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  0, 'filtering the ledger by club works');
select extensions.is(
  (select gross_amount::text || ':' || commission_amount::text || ':' || club_net_amount::text || ':' || entry_count::text
   from public.platform_list_clubs() where club_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  '333.33:33.33:300.00:1', 'club totals add up the club''s commission lines');

select * from extensions.finish();
rollback;
