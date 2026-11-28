begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select extensions.plan(26);

-- Club admins (20261128100200_admin_assign_confirmed_email.sql): platform_assign_club_admin needs
-- a confirmed email, and no path makes a platform account a club admin: assigning, inviting, or
-- taking up an invite at sign-in.
--
-- Fixture:
--   user 1: platform superadmin (confirmed), the caller
--   user 2: another platform superadmin (confirmed)
--   user 3: platform superadmin whose email is not confirmed
--   user 4: confirmed account, becomes the club's admin
--   user 5: unconfirmed account
--   user 6: platform superadmin (confirmed) with an open owner invite from before their account
--   club 1: a new club still in setup
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at, created_at)
select ('e4000000-0000-4000-8000-00000000000' || n)::uuid, 'confirm-admin-' || n || '@fixture.invalid',
       jsonb_build_object('full_name', 'Confirm Admin User ' || n),
       case when n in (3, 5) then null else now() end, now() - interval '1 day'
from generate_series(1, 6) n;
insert into public.platform_roles (user_id) values
  ('e4000000-0000-4000-8000-000000000001'), ('e4000000-0000-4000-8000-000000000002'),
  ('e4000000-0000-4000-8000-000000000003'), ('e4000000-0000-4000-8000-000000000006');
delete from public.members where user_id in (
  'e4000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000002',
  'e4000000-0000-4000-8000-000000000003', 'e4000000-0000-4000-8000-000000000006');
insert into public.clubs (id, slug, name, is_active) values
  ('e4100000-0000-4000-8000-000000000001', 'confirmed-admin-club', 'Confirmed Admin Club', false);
insert into public.club_owner_invites (id, club_id, email, invited_by, created_at) values
  ('e4200000-0000-4000-8000-000000000006', 'e4100000-0000-4000-8000-000000000001',
   'confirm-admin-6@fixture.invalid', 'e4000000-0000-4000-8000-000000000001', now() - interval '2 days');

-- ---------------------------------------------------------------------------
-- Structure and privileges are unchanged
-- ---------------------------------------------------------------------------
select extensions.ok(
  (select count(*) = 3
          and bool_and(p.prosecdef and 'search_path=""' = any(coalesce(p.proconfig, '{}'))
                       and pg_get_userbyid(p.proowner) = 'postgres')
   from pg_proc p
   where p.oid in ('public.platform_assign_club_admin(uuid, text)'::regprocedure,
                   'public.platform_invite_club_owner(uuid, text)'::regprocedure,
                   'public.claim_my_owner_clubs()'::regprocedure)),
  'the three functions stay definer functions with an empty search path, owned by postgres');
select extensions.ok(
  (select bool_and(has_function_privilege('authenticated', f, 'EXECUTE')
                   and not has_function_privilege('anon', f, 'EXECUTE')
                   and not has_function_privilege('public', f, 'EXECUTE'))
   from unnest(array['public.platform_assign_club_admin(uuid, text)', 'public.platform_invite_club_owner(uuid, text)',
                     'public.claim_my_owner_clubs()']) f),
  'they are still for signed-in callers only, and check the caller inside');

-- ---------------------------------------------------------------------------
-- Assigning an admin needs a confirmed email
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.headers', '', true);
select set_config('request.jwt.claim.sub', 'e4000000-0000-4000-8000-000000000001', true);
select extensions.throws_ok(
  $$select public.platform_assign_club_admin('e4100000-0000-4000-8000-000000000001', 'confirm-admin-5@fixture.invalid')$$,
  '55000', 'That person has not confirmed their email yet. Ask them to confirm it, then try again.',
  'an account whose email is not confirmed is not made admin');
select extensions.throws_ok(
  $$select public.platform_assign_club_admin('e4100000-0000-4000-8000-000000000001', 'nobody-here@fixture.invalid')$$,
  'P0002', 'No account uses that email yet. Ask them to sign up first.',
  'an email without an account is still refused the same way');
select extensions.is(
  public.platform_assign_club_admin('e4100000-0000-4000-8000-000000000001', ' Confirm-Admin-4@Fixture.invalid '),
  'e4000000-0000-4000-8000-000000000004'::uuid,
  'a confirmed account becomes the admin');
set local role postgres;
select extensions.is(
  (select string_agg(r.user_id::text, ',') from public.club_staff_roles r
   where r.club_id = 'e4100000-0000-4000-8000-000000000001' and r.role = 'admin' and r.is_active),
  'e4000000-0000-4000-8000-000000000004',
  'only the confirmed account has the admin role');
select extensions.is(
  (select string_agg(action || ':' || (details ->> 'user_id'), ',') from public.platform_audit_log
   where club_id = 'e4100000-0000-4000-8000-000000000001'),
  'club.admin_assign:e4000000-0000-4000-8000-000000000004',
  'the assignment is logged once; refused attempts log nothing');

-- Once the email is confirmed, the same account can be assigned.
update auth.users set email_confirmed_at = now() where id = 'e4000000-0000-4000-8000-000000000005';
set local role authenticated;
select extensions.is(
  public.platform_assign_club_admin('e4100000-0000-4000-8000-000000000001', 'confirm-admin-5@fixture.invalid'),
  'e4000000-0000-4000-8000-000000000005'::uuid,
  'after confirming the email, the account can be made admin');

-- ---------------------------------------------------------------------------
-- No platform account becomes a club admin
-- ---------------------------------------------------------------------------
select extensions.throws_ok(
  $$select public.platform_assign_club_admin('e4100000-0000-4000-8000-000000000001', ' Confirm-Admin-1@Fixture.invalid ')$$,
  '22023', 'A platform account cannot be a club admin. Use a different email for the club.',
  'a superadmin cannot make themselves a club admin');
select extensions.throws_ok(
  $$select public.platform_assign_club_admin('e4100000-0000-4000-8000-000000000001', 'confirm-admin-2@fixture.invalid')$$,
  '22023', 'A platform account cannot be a club admin. Use a different email for the club.',
  'nor another platform account');
select extensions.throws_ok(
  $$select public.platform_invite_club_owner('e4100000-0000-4000-8000-000000000001', 'confirm-admin-1@fixture.invalid')$$,
  '22023', 'A platform account cannot be a club admin. Use a different email for the club.',
  'inviting their own confirmed email does not make a superadmin an admin');
select extensions.throws_ok(
  $$select public.platform_invite_club_owner('e4100000-0000-4000-8000-000000000001', 'confirm-admin-2@fixture.invalid')$$,
  '22023', 'A platform account cannot be a club admin. Use a different email for the club.',
  'nor does inviting another platform account''s email');
select extensions.throws_ok(
  $$select public.platform_invite_club_owner('e4100000-0000-4000-8000-000000000001', 'confirm-admin-3@fixture.invalid')$$,
  '22023', 'A platform account cannot be a club admin. Use a different email for the club.',
  'a platform account whose email is not confirmed is not invited either');
select extensions.is(
  public.platform_invite_club_owner('e4100000-0000-4000-8000-000000000001', 'confirm-admin-new@fixture.invalid'),
  'invited', 'an email without an account is still invited');

set local role postgres;
select extensions.ok(
  not exists (
    select 1 from public.club_staff_roles r
    where r.club_id = 'e4100000-0000-4000-8000-000000000001'
      and r.user_id in ('e4000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000002',
                        'e4000000-0000-4000-8000-000000000003', 'e4000000-0000-4000-8000-000000000006')),
  'no platform account got a role in the club');
select extensions.is(
  (select string_agg(i.email, ',' order by i.email) from public.club_owner_invites i
   where i.club_id = 'e4100000-0000-4000-8000-000000000001' and i.claimed_at is null and i.cancelled_at is null),
  'confirm-admin-6@fixture.invalid,confirm-admin-new@fixture.invalid',
  'no invite was recorded for a platform account''s email');
select extensions.is(
  (select string_agg(action, ',' order by created_at) from public.platform_audit_log
   where club_id = 'e4100000-0000-4000-8000-000000000001'),
  'club.admin_assign,club.admin_assign,club.owner_invite',
  'the refused attempts left no audit rows; the allowed ones are logged as before');

-- ---------------------------------------------------------------------------
-- Taking up an invite at sign-in skips a platform account, quietly
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e4000000-0000-4000-8000-000000000006', true);
select extensions.lives_ok($$select * from public.claim_my_owner_clubs()$$,
  'signing in as a platform account with an open invite raises nothing');
select extensions.is((select count(*)::int from public.claim_my_owner_clubs()), 0,
  'and lists no owned clubs');
set local role postgres;
select extensions.ok(
  (select i.claimed_at is null and i.claimed_by is null from public.club_owner_invites i
   where i.id = 'e4200000-0000-4000-8000-000000000006')
  and not exists (select 1 from public.club_staff_roles r where r.user_id = 'e4000000-0000-4000-8000-000000000006'),
  'the invite stays open and the platform account gets no club role');
select extensions.is(
  (select count(*)::int from public.platform_audit_log
   where action = 'club.owner_claim' and details ->> 'user_id' = 'e4000000-0000-4000-8000-000000000006'),
  0, 'nothing is logged as taken up');

-- Only the platform role stops it: without it, the same account takes the invite up as before.
delete from public.platform_roles where user_id = 'e4000000-0000-4000-8000-000000000006';
set local role authenticated;
select extensions.is(
  (select string_agg(club_id::text || ':' || status, ',') from public.claim_my_owner_clubs()),
  'e4100000-0000-4000-8000-000000000001:provisioning',
  'an ordinary confirmed account still takes up its invite');

-- ---------------------------------------------------------------------------
-- Rows that already overlap are left alone
-- ---------------------------------------------------------------------------
set local role postgres;
select extensions.lives_ok(
  $$insert into public.club_staff_roles (club_id, user_id, role)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'e4000000-0000-4000-8000-000000000002', 'admin')$$,
  'no trigger or constraint stops an existing platform account''s club role (trusted SQL)');
select extensions.ok(
  not exists (select 1 from pg_trigger t where t.tgrelid = 'public.club_staff_roles'::regclass
              and not t.tgisinternal and pg_get_triggerdef(t.oid) ~* 'platform')
  and not exists (select 1 from pg_trigger t where t.tgrelid = 'public.platform_roles'::regclass
                  and not t.tgisinternal and pg_get_triggerdef(t.oid) ~* 'club_staff'),
  'no trigger ties club roles and platform roles together');

-- Members cannot reach any of it.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e4000000-0000-4000-8000-000000000004', true);
select extensions.throws_ok(
  $$select public.platform_assign_club_admin('e4100000-0000-4000-8000-000000000001', 'confirm-admin-4@fixture.invalid')$$,
  '42501', 'Platform access required', 'a club admin who is not a platform account cannot assign admins');
select extensions.throws_ok(
  $$select public.platform_invite_club_owner('e4100000-0000-4000-8000-000000000001', 'someone@fixture.invalid')$$,
  '42501', 'Platform access required', 'nor invite owners');

select * from extensions.finish();
rollback;
