begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select extensions.plan(32);

-- Fixture:
--   user 71: platform superadmin with no club role
--   user 72: confirmed account that already uses an owner's email
--   user 73: unconfirmed account registered (by someone) before the invite
--   user 75: Gensan member
--   club 71: a new club still in setup
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at, created_at) values
  ('c1000000-0000-4000-8000-000000000071', 'invite-admin@fixture.invalid', '{"full_name":"Invite Superadmin"}', now(), now() - interval '2 days'),
  ('c1000000-0000-4000-8000-000000000072', 'existing-owner@fixture.invalid', '{"full_name":"Existing Owner"}', now(), now() - interval '2 days'),
  ('c1000000-0000-4000-8000-000000000073', 'early-owner@fixture.invalid', '{"full_name":"Early Registrant"}', null, now() - interval '1 day'),
  ('c1000000-0000-4000-8000-000000000075', 'invite-member@fixture.invalid', '{"full_name":"Invite Member"}', now(), now() - interval '2 days');
insert into public.platform_roles (user_id) values ('c1000000-0000-4000-8000-000000000071');
delete from public.members where user_id = 'c1000000-0000-4000-8000-000000000071';
insert into public.clubs (id, slug, name, is_active) values
  ('c2000000-0000-4000-8000-000000000071', 'owner-invite-club', 'Owner Invite Club', false);

-- Structure and privileges.
select extensions.ok(
  (select relrowsecurity from pg_class where oid = 'public.club_owner_invites'::regclass),
  'row security is on for owner invites');
select extensions.ok(
  not exists (
    select 1 from (values ('anon'), ('authenticated')) r(role)
    where has_table_privilege(r.role, 'public.club_owner_invites', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')),
  'API roles have no direct access to owner invites');
select extensions.ok(
  (select bool_and(has_function_privilege('authenticated', f, 'EXECUTE') and not has_function_privilege('anon', f, 'EXECUTE'))
   from unnest(array[
     'public.platform_invite_club_owner(uuid, text)', 'public.platform_club_owner_invites(uuid)',
     'public.platform_cancel_club_owner_invite(uuid)', 'public.claim_my_owner_clubs()']) f),
  'the invite functions need a signed-in caller');
select extensions.ok(
  (select bool_and(prosecdef and 'search_path=""' = any(proconfig)) from pg_proc
   where oid in ('public.platform_invite_club_owner(uuid, text)'::regprocedure,
                 'public.platform_club_owner_invites(uuid)'::regprocedure,
                 'public.platform_cancel_club_owner_invite(uuid)'::regprocedure,
                 'public.claim_my_owner_clubs()'::regprocedure,
                 'public.handle_new_user()'::regprocedure)),
  'every function here runs with a fixed, empty search path');
select extensions.ok(
  not has_function_privilege('anon', 'public.handle_new_user()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.handle_new_user()', 'EXECUTE'),
  'only the auth service runs the sign-up function, as before');

-- A member is refused.
set local role authenticated;
select set_config('request.headers', '', true);
select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000075', true);
select extensions.throws_ok(
  $$select public.platform_invite_club_owner('c2000000-0000-4000-8000-000000000071', 'someone@fixture.invalid')$$,
  '42501', 'Platform access required', 'members cannot invite owners');
select extensions.throws_ok(
  $$select * from public.platform_club_owner_invites('c2000000-0000-4000-8000-000000000071')$$,
  '42501', 'Platform access required', 'members cannot list owner invites');
select extensions.is((select count(*)::int from public.claim_my_owner_clubs()), 0, 'a member owns no clubs');

-- The superadmin invites.
select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000071', true);
select extensions.throws_ok(
  $$select public.platform_invite_club_owner('c2000000-0000-4000-8000-000000000071', 'not an email')$$,
  '22023', 'Enter an email like name@example.com', 'a bad email is refused plainly');
select extensions.throws_ok(
  $$select public.platform_invite_club_owner('c2000000-0000-4000-8000-0000000000ff', 'someone@fixture.invalid')$$,
  'P0002', 'Club not found', 'an unknown club is refused');
select extensions.is(
  public.platform_invite_club_owner('c2000000-0000-4000-8000-000000000071', ' Existing-Owner@Fixture.invalid '),
  'assigned', 'a confirmed account becomes the admin at once');
select extensions.is(
  public.platform_invite_club_owner('c2000000-0000-4000-8000-000000000071', 'early-owner@fixture.invalid'),
  'invited', 'an unconfirmed account is only invited');
select extensions.is(
  public.platform_invite_club_owner('c2000000-0000-4000-8000-000000000071', 'new-owner@fixture.invalid'),
  'invited', 'an email with no account is invited');
select public.platform_invite_club_owner('c2000000-0000-4000-8000-000000000071', 'NEW-OWNER@fixture.invalid');
select extensions.is(
  (select string_agg(email, ',' order by email) from public.platform_club_owner_invites('c2000000-0000-4000-8000-000000000071')),
  'early-owner@fixture.invalid,new-owner@fixture.invalid', 'inviting the same email twice keeps one open invite');

set local role postgres;
select extensions.ok(
  exists (select 1 from public.club_staff_roles
          where club_id = 'c2000000-0000-4000-8000-000000000071'
            and user_id = 'c1000000-0000-4000-8000-000000000072' and role = 'admin' and is_active),
  'the existing account is now the club''s admin');

-- The owner signs up without a club link: no Gensan membership.
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at, created_at) values
  ('c1000000-0000-4000-8000-000000000074', 'new-owner@fixture.invalid', '{"full_name":"New Owner"}', null, clock_timestamp());
select extensions.is(
  (select count(*)::int from public.members where user_id = 'c1000000-0000-4000-8000-000000000074'), 0,
  'an invited owner gets no default membership');
select extensions.ok(
  exists (select 1 from public.profiles where id = 'c1000000-0000-4000-8000-000000000074'),
  'the invited owner still gets a profile');

-- An ordinary sign-up is unchanged; a club link to a club in setup is still refused.
insert into auth.users (id, email, raw_user_meta_data, created_at) values
  ('c1000000-0000-4000-8000-000000000076', 'plain-player@fixture.invalid', '{"full_name":"Plain Player"}', clock_timestamp());
select extensions.is(
  (select count(*)::int from public.members m join public.clubs c on c.id = m.club_id
   where m.user_id = 'c1000000-0000-4000-8000-000000000076' and c.slug = 'rally-point-gensan'), 1,
  'a sign-up without an invite still joins Rally Point Gensan');
select extensions.throws_ok(
  $$insert into auth.users (id, email, raw_user_meta_data) values
    ('c1000000-0000-4000-8000-000000000077', 'link-owner@fixture.invalid', '{"club_slug":"owner-invite-club"}')$$,
  '22023', 'This club link is not valid', 'a club in setup still has no working join link');

-- Before the email is confirmed, nothing is taken up.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000074', true);
select extensions.is(
  (select count(*)::int from public.profiles where id = 'c1000000-0000-4000-8000-000000000074'), 1,
  'an invited owner with no club yet can still read their own profile, which sign-in needs');
select extensions.is((select count(*)::int from public.claim_my_owner_clubs()), 0, 'an unconfirmed email takes up no invite');

set local role postgres;
select extensions.ok(
  not exists (select 1 from public.club_staff_roles where user_id = 'c1000000-0000-4000-8000-000000000074'),
  'an unconfirmed owner has no club role');

-- Once the email is confirmed, the invite is taken up.
update auth.users set email_confirmed_at = now() where id = 'c1000000-0000-4000-8000-000000000074';
set local role authenticated;
select extensions.is(
  (select row(club_id, name, status)::text from public.claim_my_owner_clubs()),
  row('c2000000-0000-4000-8000-000000000071'::uuid, 'Owner Invite Club', 'provisioning')::text,
  'a confirmed owner becomes the admin and sees the club still being set up');
select extensions.is((select count(*)::int from public.claim_my_owner_clubs()), 1, 'asking again changes nothing');

set local role postgres;
select extensions.ok(
  exists (select 1 from public.club_staff_roles
          where club_id = 'c2000000-0000-4000-8000-000000000071'
            and user_id = 'c1000000-0000-4000-8000-000000000074' and role = 'admin' and is_active),
  'the owner''s admin role comes from club_staff_roles');
select extensions.is(
  (select count(*)::int from public.platform_audit_log
   where action = 'club.owner_claim' and details ->> 'user_id' = 'c1000000-0000-4000-8000-000000000074'),
  1, 'taking up an invite is logged once');

-- An account registered before the invite does not take it up, even once confirmed.
update auth.users set email_confirmed_at = now() where id = 'c1000000-0000-4000-8000-000000000073';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000073', true);
select extensions.is((select count(*)::int from public.claim_my_owner_clubs()), 0,
  'an account older than the invite does not become the admin');

-- The superadmin sees what is still open, cancels it, and can now activate the club.
select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000071', true);
select extensions.is(
  (select string_agg(email, ',') from public.platform_club_owner_invites('c2000000-0000-4000-8000-000000000071')),
  'early-owner@fixture.invalid', 'the early registrant''s invite is still open for the superadmin to check');
select public.platform_cancel_club_owner_invite(
  (select id from public.platform_club_owner_invites('c2000000-0000-4000-8000-000000000071')));
select extensions.is((select count(*)::int from public.platform_club_owner_invites('c2000000-0000-4000-8000-000000000071')), 0,
  'a cancelled invite is no longer open');
select extensions.throws_ok(
  $$select public.platform_cancel_club_owner_invite('c3000000-0000-4000-8000-000000000071')$$,
  'P0002', 'That invite is no longer open', 'cancelling something that is not open is reported plainly');
select extensions.lives_ok(
  $$select public.platform_set_club_status('c2000000-0000-4000-8000-000000000071', 'active')$$,
  'with its owner as admin, the club can be activated');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000074', true);
select extensions.is((select status from public.claim_my_owner_clubs()), 'active', 'the owner then sees the club as active');

select * from extensions.finish();
rollback;
