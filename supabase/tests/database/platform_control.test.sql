begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select extensions.plan(44);

-- Fixture:
--   user 31: platform superadmin with no club role
--   user 32: Gensan member
--   user 33: Gensan admin
--   user 34: has a confirmed account; becomes the new club's admin
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at)
select ('c1000000-0000-4000-8000-0000000000' || n)::uuid, 'plat-' || n || '@fixture.invalid',
       jsonb_build_object('full_name', 'Platform User ' || n), now()
from generate_series(31, 34) n;
insert into public.platform_roles (user_id) values ('c1000000-0000-4000-8000-000000000031');
delete from public.members where user_id = 'c1000000-0000-4000-8000-000000000031';
insert into public.club_staff_roles (club_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1000000-0000-4000-8000-000000000033', 'admin');

-- Structure and privileges.
select extensions.ok(
  (select bool_and(relrowsecurity) from pg_class where oid in (
    'public.platform_roles'::regclass, 'public.club_accounts'::regclass,
    'public.platform_audit_log'::regclass, 'public.platform_commissions'::regclass)),
  'row security is on for every platform table');
select extensions.ok(
  not exists (
    select 1
    from (values ('public.platform_roles'), ('public.platform_audit_log')) t(name),
         (values ('anon'), ('authenticated')) r(role)
    where has_table_privilege(r.role, t.name, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')),
  'API roles have no privileges on platform roles or the audit log');
select extensions.ok(
  has_table_privilege('authenticated', 'public.club_accounts', 'SELECT')
  and has_table_privilege('authenticated', 'public.platform_commissions', 'SELECT')
  and not has_table_privilege('authenticated', 'public.club_accounts', 'INSERT, UPDATE, DELETE, TRUNCATE')
  and not has_table_privilege('authenticated', 'public.platform_commissions', 'INSERT, UPDATE, DELETE, TRUNCATE')
  and not has_table_privilege('anon', 'public.club_accounts', 'SELECT')
  and not has_table_privilege('anon', 'public.platform_commissions', 'SELECT'),
  'club terms and commissions are read-only for signed-in users and hidden from anonymous visitors');
select extensions.ok(
  (select bool_and(has_function_privilege('authenticated', f, 'EXECUTE') and not has_function_privilege('anon', f, 'EXECUTE'))
   from unnest(array[
     'public.get_platform_access()', 'public.platform_list_clubs()',
     'public.platform_commission_ledger(uuid, integer)',
     'public.platform_provision_club(text, text, text, text, text, text, numeric, integer)',
     'public.platform_set_club_status(uuid, text)', 'public.platform_set_commission_rate(uuid, numeric)',
     'public.platform_assign_club_admin(uuid, text)', 'public.platform_revoke_club_admin(uuid, uuid)',
     'public.platform_recent_actions(integer)', 'public.platform_club_admins(uuid)']) f),
  'platform functions are callable only by signed-in users, and check the role themselves');
select extensions.ok(
  not exists (
    select 1 from unnest(array[
      'private.is_platform_superadmin()', 'private.require_platform_superadmin()',
      'private.platform_audit(text, uuid, jsonb)']) f
    where has_function_privilege('authenticated', f, 'EXECUTE') or has_function_privilege('anon', f, 'EXECUTE')),
  'private platform helpers are not callable from the API');

insert into public.clubs (id, slug, name, is_active) values
  ('c2000000-0000-4000-8000-000000000041', 'plat-later-active', 'Later Active Club', true),
  ('c2000000-0000-4000-8000-000000000042', 'plat-later-inactive', 'Later Inactive Club', false);
select extensions.is(
  (select string_agg(status, ',' order by club_id) from public.club_accounts
   where club_id in ('c2000000-0000-4000-8000-000000000041', 'c2000000-0000-4000-8000-000000000042')),
  'active,provisioning', 'clubs created later get an account automatically');
select extensions.is(
  (select count(*)::int from public.platform_audit_log
   where action = 'platform_role.insert' and details ->> 'user_id' = 'c1000000-0000-4000-8000-000000000031'),
  1, 'granting a platform role is recorded in the audit log');

-- A member is refused.
set local role authenticated;
select set_config('request.headers', '', true);
select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000032', true);
select extensions.throws_ok($$select * from public.platform_list_clubs()$$, '42501', 'Platform access required',
  'members cannot list platform clubs');
select extensions.throws_ok(
  $$select public.platform_provision_club('Sneaky Club', 'sneaky-club', '', '', '', '', 5, 2)$$,
  '42501', 'Platform access required', 'members cannot set up clubs');
select extensions.is(public.get_platform_access(), null::text, 'members have no platform access');
select extensions.is((select count(*)::int from public.club_accounts), 0, 'members cannot read club terms');

-- A club admin is refused platform actions but can read their own club's terms.
select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000033', true);
select extensions.throws_ok(
  $$select public.platform_set_club_status('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'active')$$,
  '42501', 'Platform access required', 'club admins cannot change club status');
select extensions.is((select count(*)::int from public.club_accounts), 1, 'club admins read their own club''s terms');
select set_config('request.headers', '{"x-club-id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}', true);
select extensions.is((select count(*)::int from public.club_accounts), 0, 'club admins cannot read another club''s terms');

-- The superadmin works only through platform functions.
select set_config('request.headers', '', true);
select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000031', true);
select extensions.is(public.get_platform_access(), 'superadmin', 'the superadmin has platform access');
select extensions.is(
  (select count(*)::int from public.platform_list_clubs()
   where club_id in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')),
  2, 'the superadmin sees every club in the platform list');
select extensions.is(
  (select count(*) from public.member_admin) + (select count(*) from public.transactions)
  + (select count(*) from public.club_accounts) + (select count(*) from public.platform_commissions),
  0::bigint, 'a superadmin with no club role reads no club rows directly');
select extensions.ok(
  public.platform_provision_club('Davao Test Club', 'davao-test', 'Davao City', 'Ecoland',
                                 ' Davao@Example.invalid ', '0917 000 0000', 0, 3) is not null,
  'the superadmin can set up a club');

set local role postgres;
select extensions.is(
  (select c.is_active::text || ':' || a.status || ':' || a.commission_rate::text || ':' || a.contact_email
   from public.clubs c join public.club_accounts a on a.club_id = c.id where c.slug = 'davao-test'),
  'false:provisioning:0.00:davao@example.invalid', 'a new club starts in setup with the agreed terms');
select extensions.is(
  (select count(*)::int from public.venues v join public.clubs c on c.id = v.club_id where c.slug = 'davao-test'),
  1, 'setup creates one main venue');
select extensions.is(
  (select count(*)::int from public.courts ct join public.clubs c on c.id = ct.club_id where c.slug = 'davao-test'),
  3, 'setup creates the requested courts');
select extensions.is((select count(*)::int from public.get_public_club('davao-test')), 0,
  'a club in setup is hidden from join links');

set local role authenticated;
select extensions.throws_ok(
  $$select public.platform_provision_club('Bad Link', 'Bad Link!', '', '', '', '', 5, 2)$$,
  '22023', 'Use 3 to 50 lowercase letters, numbers or dashes for the link name', 'link names are validated');
select extensions.throws_ok(
  $$select public.platform_provision_club('Copy', 'davao-test', '', '', '', '', 5, 2)$$,
  '23505', 'That link name is already used by another club', 'link names must be unique');
select extensions.throws_ok(
  $$select public.platform_provision_club('Rate', 'rate-test', '', '', '', '', 150, 2)$$,
  '22023', 'The platform fee is a flat amount per booking. Set the booking fee instead of a percentage.',
  'a percentage is refused at set-up (since the flat booking fee)');
select extensions.throws_ok(
  $$select public.platform_provision_club('Courts', 'courts-test', '', '', '', '', 0, 0)$$,
  '22023', 'Choose between 1 and 12 courts', 'court counts are validated');
select extensions.throws_ok(
  $$select public.platform_set_club_status((select club_id from public.platform_list_clubs() where slug = 'davao-test'), 'active')$$,
  '22023', 'Assign a club admin before activating this club', 'a club needs an admin before it goes live');
select extensions.is(
  public.platform_assign_club_admin((select club_id from public.platform_list_clubs() where slug = 'davao-test'),
                                    ' Plat-34@Fixture.invalid '),
  'c1000000-0000-4000-8000-000000000034'::uuid, 'the superadmin assigns a club admin by email');
select extensions.is(
  (select string_agg(email, ',') from public.platform_club_admins(
     (select club_id from public.platform_list_clubs() where slug = 'davao-test'))),
  'plat-34@fixture.invalid', 'the superadmin can see who administers a club');
select extensions.throws_ok(
  $$select public.platform_assign_club_admin((select club_id from public.platform_list_clubs() where slug = 'davao-test'), 'nobody@fixture.invalid')$$,
  'P0002', 'No account uses that email yet. Ask them to sign up first.', 'an unknown email is refused');
select extensions.lives_ok(
  $$select public.platform_set_club_status((select club_id from public.platform_list_clubs() where slug = 'davao-test'), 'active')$$,
  'with an admin assigned, the club can go live');

set local role postgres;
select extensions.is(
  (select c.is_active::text || ':' || a.status || ':'
          || (select count(*) from public.club_staff_roles r where r.club_id = c.id and r.role = 'admin' and r.is_active)::text
   from public.clubs c join public.club_accounts a on a.club_id = c.id where c.slug = 'davao-test'),
  'true:active:1', 'going live keeps the club and its account in step');
select extensions.is((select count(*)::int from public.get_public_club('davao-test')), 1,
  'a live club can be found through its join link');

set local role authenticated;
select extensions.throws_ok(
  $$select public.platform_set_club_status('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'suspended')$$,
  '22023', 'The default sign-up club must stay active', 'the default sign-up club cannot be suspended');
select extensions.lives_ok(
  $$select public.platform_set_commission_rate((select club_id from public.platform_list_clubs() where slug = 'davao-test'), 0)$$,
  'the superadmin can still set the retired rate, to 0 only');
select extensions.lives_ok(
  $$select public.platform_set_club_status((select club_id from public.platform_list_clubs() where slug = 'davao-test'), 'suspended')$$,
  'the superadmin can suspend a club');
select extensions.lives_ok(
  $$select public.platform_revoke_club_admin((select club_id from public.platform_list_clubs() where slug = 'davao-test'), 'c1000000-0000-4000-8000-000000000034')$$,
  'the superadmin can remove a club admin');
select extensions.throws_ok(
  $$select public.platform_revoke_club_admin((select club_id from public.platform_list_clubs() where slug = 'davao-test'), 'c1000000-0000-4000-8000-000000000034')$$,
  'P0002', 'That person is not an active admin of this club', 'removing an admin twice is refused');
select extensions.is(
  (select count(*)::int from public.platform_club_admins(
     (select club_id from public.platform_list_clubs() where slug = 'davao-test'))),
  0, 'a removed admin is no longer listed');
select extensions.is((select action from public.platform_recent_actions(1)), 'club.admin_revoke',
  'recent platform actions list the newest first');
select extensions.lives_ok($$select * from public.platform_commission_ledger(null, 10)$$,
  'the superadmin can read the commission ledger');

set local role postgres;
select extensions.is(
  (select c.is_active::text || ':' || a.status || ':' || a.commission_rate::text
   from public.clubs c join public.club_accounts a on a.club_id = c.id where c.slug = 'davao-test'),
  'false:suspended:0.00', 'suspending closes the club and keeps its terms');
select extensions.is(
  (select string_agg(action, ',' order by created_at)
   from public.platform_audit_log where club_id = (select id from public.clubs where slug = 'davao-test')),
  'club.provision,club.admin_assign,club.status,club.commission_rate,club.status,club.admin_revoke',
  'each successful change wrote one audit row, and refused attempts wrote none');
select extensions.is(
  (select count(*)::int from public.platform_audit_log
   where club_id = (select id from public.clubs where slug = 'davao-test')
     and actor_id is distinct from 'c1000000-0000-4000-8000-000000000031'),
  0, 'every audit row names the superadmin who acted');

select * from extensions.finish();
rollback;
