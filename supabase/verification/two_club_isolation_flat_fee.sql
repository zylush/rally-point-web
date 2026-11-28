-- Copy of two_club_isolation.sql for releases from flat-booking-fee-20261128 on. Since the flat
-- booking fee, set-up takes no percentage, so the second club starts at 0% with a 32-peso fee per
-- booking (the same 32.00 on its 400-peso charge). The original stays frozen for earlier releases.
-- Two-club isolation test for the club platform release.
--
-- Safety contract:
--   * One transaction that always rolls back: no users, clubs, rows or audit
--     entries survive it.
--   * Builds its own synthetic users, second club, venues and charges. It needs
--     only the default Rally Point Gensan club, so it does not depend on seed data.
--   * Refuses to start unless the whole club platform is applied and no
--     leftover fixture exists.
--   * Run as the postgres migration role: psql -X -v ON_ERROR_STOP=1 -f <this file>
begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;

do $guard$
begin
  if to_regclass('public.platform_support_sessions') is null
     or to_regclass('public.platform_commissions') is null
     or to_regclass('public.support_inquiries') is null
     or not exists (select 1 from pg_constraint
                    where conrelid = 'public.members'::regclass and conname = 'members_club_user_key')
     or not exists (select 1 from public.clubs
                    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and slug = 'rally-point-gensan' and is_active) then
    raise exception 'two-club isolation test needs the full club platform and an active default club';
  end if;
  if exists (select 1 from public.clubs where slug = 'two-club-isolation-b')
     or exists (select 1 from auth.users
                where email like 'two-club-%@fixture.invalid'
                   or id between '2c000000-0000-4000-8000-000000000000' and '2c000000-0000-4000-8000-0000000000ff') then
    raise exception 'two-club isolation fixture already exists; refusing to run';
  end if;
end
$guard$;

select extensions.plan(55);

-- Fixture, part 1. Sign-up without a link makes each person a default-club member.
--   user 1: default-club member            user 2: default-club admin
--   user 4: becomes the second club's admin user 5: becomes second-club staff
--   user 6: joins the second club later    user 7: platform superadmin, no club role
insert into auth.users (id, email, raw_user_meta_data)
select ('2c000000-0000-4000-8000-00000000000' || n)::uuid, 'two-club-' || n || '@fixture.invalid',
       jsonb_build_object('full_name', 'Two Club User ' || n)
from unnest(array[1, 2, 4, 5, 6, 7]) n;
insert into public.club_staff_roles (club_id, user_id, role)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2c000000-0000-4000-8000-000000000002', 'admin');
insert into public.platform_roles (user_id) values ('2c000000-0000-4000-8000-000000000007');
delete from public.members where user_id = '2c000000-0000-4000-8000-000000000007';
insert into public.venues (id, club_id, slug, name)
values ('2c300000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'two-club-a1', 'Two Club A1');
insert into public.courts (id, club_id, venue_id, name)
values ('2c400000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        '2c300000-0000-4000-8000-000000000001', 'Two Club A1 Court');

-- The second club is created the way production will create it: through the platform.
set local role authenticated;
select set_config('request.headers', '', true);
select set_config('request.jwt.claim.sub', '2c000000-0000-4000-8000-000000000007', true);
select extensions.ok(
  public.platform_provision_club('Two Club Isolation B', 'two-club-isolation-b', 'Davao City', '',
                                 'two-club-b@fixture.invalid', '', 0, 2) is not null,
  'the superadmin sets up the second club through the platform');
select set_config('t2c.club_b',
  (select club_id::text from public.platform_list_clubs() where slug = 'two-club-isolation-b'), true);
-- Its flat booking fee: 32 pesos on each booking or desk rental.
select public.platform_set_booking_fee(current_setting('t2c.club_b')::uuid, 32);
select set_config('t2c.header_b', jsonb_build_object('x-club-id', current_setting('t2c.club_b'))::text, true);
select extensions.throws_ok(
  $$select public.platform_set_club_status(current_setting('t2c.club_b')::uuid, 'active')$$,
  '22023', 'Assign a club admin before activating this club', 'the new club cannot go live without an admin');
select extensions.is(
  public.platform_assign_club_admin(current_setting('t2c.club_b')::uuid, 'two-club-4@fixture.invalid'),
  '2c000000-0000-4000-8000-000000000004'::uuid, 'user 4 becomes the second club''s admin');
select extensions.lives_ok(
  $$select public.platform_set_club_status(current_setting('t2c.club_b')::uuid, 'active')$$,
  'the second club goes live');

-- Fixture, part 2: a join-link sign-up, staff limited to one venue, and charges in both clubs.
set local role postgres;
insert into auth.users (id, email, raw_user_meta_data)
values ('2c000000-0000-4000-8000-000000000003', 'two-club-3@fixture.invalid',
        '{"full_name":"Two Club User 3","club_slug":"two-club-isolation-b"}');
select set_config('t2c.venue_b1',
  (select id::text from public.venues where club_id = current_setting('t2c.club_b')::uuid order by created_at, id limit 1), true);
select set_config('t2c.court_b1',
  (select id::text from public.courts where venue_id = current_setting('t2c.venue_b1')::uuid order by name, id limit 1), true);
insert into public.venues (id, club_id, slug, name)
values ('2c300000-0000-4000-8000-000000000002', current_setting('t2c.club_b')::uuid, 'two-club-b2', 'Two Club B2');
insert into public.courts (id, club_id, venue_id, name)
values ('2c400000-0000-4000-8000-000000000002', current_setting('t2c.club_b')::uuid,
        '2c300000-0000-4000-8000-000000000002', 'Two Club B2 Court');
insert into public.club_staff_roles (club_id, user_id, role)
values (current_setting('t2c.club_b')::uuid, '2c000000-0000-4000-8000-000000000005', 'staff');
insert into public.staff_venue_grants (club_id, user_id, venue_id)
values (current_setting('t2c.club_b')::uuid, '2c000000-0000-4000-8000-000000000005',
        current_setting('t2c.venue_b1')::uuid);
select set_config('t2c.code_u1', (select member_code from public.members
  where user_id = '2c000000-0000-4000-8000-000000000001' and club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), true);
select set_config('t2c.code_u3', (select member_code from public.members
  where user_id = '2c000000-0000-4000-8000-000000000003'), true);
insert into public.transactions (id, club_id, venue_id, amount, type, description) values
  ('2c600000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   '2c300000-0000-4000-8000-000000000001', 300, 'court_rental', 'Two Club A rental'),
  ('2c600000-0000-4000-8000-000000000002', current_setting('t2c.club_b')::uuid,
   current_setting('t2c.venue_b1')::uuid, 400, 'court_rental', 'Two Club B rental');
insert into public.notifications (club_id, user_id, title, body) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2c000000-0000-4000-8000-000000000006', 'Two Club A note', 'A'),
  (current_setting('t2c.club_b')::uuid, '2c000000-0000-4000-8000-000000000006', 'Two Club B note', 'B');
insert into public.open_plays (id, club_id, venue_id, court_id, title, start_at, end_at, capacity) values
  ('2c500000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   '2c300000-0000-4000-8000-000000000001', '2c400000-0000-4000-8000-000000000001',
   'Two Club A play', '2097-02-01 10:00+00', '2097-02-01 11:00+00', 8),
  ('2c500000-0000-4000-8000-000000000002', current_setting('t2c.club_b')::uuid,
   current_setting('t2c.venue_b1')::uuid, current_setting('t2c.court_b1')::uuid,
   'Two Club B play', '2097-02-01 10:00+00', '2097-02-01 11:00+00', 8);

-- User 6 joins the second club through its link.
set local role authenticated;
select set_config('request.headers', '', true);
select set_config('request.jwt.claim.sub', '2c000000-0000-4000-8000-000000000006', true);
select extensions.is(public.join_club('two-club-isolation-b'), current_setting('t2c.club_b')::uuid,
  'user 6 joins the second club through its link');
select extensions.is(
  (select string_agg(slug || ':' || role::text, ',' order by slug) from public.list_my_clubs()),
  'rally-point-gensan:member,two-club-isolation-b:member', 'user 6 now belongs to both clubs');

-- Header resolution.
set local role postgres;
select set_config('request.headers', '', true);
select extensions.is(private.current_club_id(), 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
  'with no header the default club applies');
select set_config('request.headers', current_setting('t2c.header_b'), true);
select extensions.is(private.current_club_id(), current_setting('t2c.club_b')::uuid,
  'the second club''s header selects it');
select set_config('request.headers', '{"x-club-id":"2c999999-0000-4000-8000-000000000000"}', true);
select extensions.is(private.current_club_id(), null::uuid, 'an unknown club header fails closed');
select extensions.is(
  (select string_agg(club_id::text, ',') from public.members where user_id = '2c000000-0000-4000-8000-000000000003'),
  current_setting('t2c.club_b'), 'a join-link sign-up belongs only to the second club');

-- User 1: default-club member.
set local role authenticated;
select set_config('request.jwt.claim.sub', '2c000000-0000-4000-8000-000000000001', true);
select set_config('request.headers', '', true);
select extensions.is((select club_id::text || ':' || role::text from public.get_current_access()),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:member', 'user 1 is a member of the default club');
select set_config('request.headers', current_setting('t2c.header_b'), true);
select extensions.is((select count(*)::int from public.get_current_access()), 0,
  'naming the second club gives user 1 no role there');
select extensions.is(
  (select count(*)::int from public.transactions
   where id in ('2c600000-0000-4000-8000-000000000001', '2c600000-0000-4000-8000-000000000002')),
  0, 'user 1 sees neither club''s charges');

-- User 3: second-club member from the join link.
select set_config('request.jwt.claim.sub', '2c000000-0000-4000-8000-000000000003', true);
select extensions.is((select role::text from public.get_current_access()), 'member',
  'user 3 is a member of the second club');
select set_config('request.headers', '', true);
select extensions.is((select count(*)::int from public.get_current_access()), 0,
  'user 3 has no role in the default club');

-- User 6: member of both clubs.
select set_config('request.jwt.claim.sub', '2c000000-0000-4000-8000-000000000006', true);
select set_config('request.headers', '', true);
select extensions.is((select string_agg(title, ',') from public.notifications where title like 'Two Club % note'),
  'Two Club A note', 'in the default club user 6 sees only that club''s notification');
select set_config('request.headers', current_setting('t2c.header_b'), true);
select extensions.is((select string_agg(title, ',') from public.notifications where title like 'Two Club % note'),
  'Two Club B note', 'in the second club user 6 sees only that club''s notification');
select set_config('request.headers', '{"x-club-id":"2c999999-0000-4000-8000-000000000000"}', true);
select extensions.is((select count(*)::int from public.notifications where title like 'Two Club % note'), 0,
  'an unknown club shows user 6 nothing');

-- User 4: second-club admin, default-club member.
select set_config('request.jwt.claim.sub', '2c000000-0000-4000-8000-000000000004', true);
select set_config('request.headers', current_setting('t2c.header_b'), true);
select extensions.is((select club_id::text || ':' || role::text from public.get_current_access()),
  current_setting('t2c.club_b') || ':admin', 'user 4 administers the second club');
select extensions.is((select count(*)::int from public.member_admin where club_id = current_setting('t2c.club_b')::uuid),
  2, 'the second club''s admin lists its two members');
select extensions.is((select count(*)::int from public.member_admin where club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  0, 'the second club''s admin lists no default-club members');
select extensions.is(
  (select string_agg(id::text, ',') from public.transactions
   where id in ('2c600000-0000-4000-8000-000000000001', '2c600000-0000-4000-8000-000000000002')),
  '2c600000-0000-4000-8000-000000000002', 'the second club''s admin sees only that club''s charge');
select extensions.is(
  (select string_agg(transaction_id::text, ',') from public.platform_commissions
   where transaction_id in ('2c600000-0000-4000-8000-000000000001', '2c600000-0000-4000-8000-000000000002')),
  '2c600000-0000-4000-8000-000000000002', 'and only that club''s commission line');
select set_config('request.headers', '', true);
select extensions.is((select count(*)::int from public.member_admin), 0,
  'in the default club user 4 is only a member and gets no member list');
select extensions.throws_ok(
  $$select public.admin_upsert_venue(null::uuid, 'two-club-probe', 'Two Club Probe', 'Asia/Manila', 6::smallint, 22::smallint, true)$$,
  null::char(5), null::text, 'admin commands refuse user 4 in the default club');
select extensions.throws_ok($$select * from public.platform_list_clubs()$$, '42501', 'Platform access required',
  'a club admin has no platform access');

-- User 2: default-club admin.
select set_config('request.jwt.claim.sub', '2c000000-0000-4000-8000-000000000002', true);
select set_config('request.headers', '', true);
select extensions.is(
  (select string_agg(id::text, ',') from public.transactions
   where id in ('2c600000-0000-4000-8000-000000000001', '2c600000-0000-4000-8000-000000000002')),
  '2c600000-0000-4000-8000-000000000001', 'the default club''s admin sees only its own charge');
select extensions.is(
  (select string_agg(transaction_id::text, ',') from public.platform_commissions
   where transaction_id in ('2c600000-0000-4000-8000-000000000001', '2c600000-0000-4000-8000-000000000002')),
  '2c600000-0000-4000-8000-000000000001', 'and only its own commission line');
select extensions.is((select count(*)::int from public.member_admin where club_id = current_setting('t2c.club_b')::uuid),
  0, 'the default club''s admin lists no second-club members');
select set_config('request.headers', current_setting('t2c.header_b'), true);
select extensions.is((select count(*)::int from public.get_current_access()), 0,
  'naming the second club gives the default club''s admin no role there');

-- User 5: second-club staff assigned to its first venue only.
select set_config('request.jwt.claim.sub', '2c000000-0000-4000-8000-000000000005', true);
select set_config('request.headers', current_setting('t2c.header_b'), true);
select extensions.is((select role::text from public.get_current_access()), 'staff', 'user 5 is staff at the second club');
select extensions.lives_ok(
  $$select public.check_in_qr(current_setting('t2c.code_u3'), current_setting('t2c.venue_b1')::uuid)$$,
  'staff check in their own club''s member at their venue');
select extensions.throws_ok(
  $$select public.check_in_qr(current_setting('t2c.code_u3'), '2c300000-0000-4000-8000-000000000002')$$,
  'P0001', 'member or venue is outside assigned club', 'staff cannot check in at a venue they are not assigned to');
select extensions.throws_ok(
  $$select public.check_in_qr(current_setting('t2c.code_u1'), current_setting('t2c.venue_b1')::uuid)$$,
  'P0001', 'QR not recognized', 'a member code from the other club is not recognised');
select set_config('request.headers', '', true);
select extensions.throws_ok(
  $$select public.check_in_qr(current_setting('t2c.code_u1'), '2c300000-0000-4000-8000-000000000001')$$,
  'P0001', 'member or venue is outside assigned club', 'in the default club user 5 has no desk access');

-- Anonymous TV boards follow the header.
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.headers', current_setting('t2c.header_b'), true);
select extensions.is(
  (select string_agg(id::text, ',') from public.public_schedule
   where id in ('2c500000-0000-4000-8000-000000000001', '2c500000-0000-4000-8000-000000000002')),
  '2c500000-0000-4000-8000-000000000002', 'an anonymous board for the second club shows only its play');
select set_config('request.headers', '', true);
select extensions.is(
  (select string_agg(id::text, ',') from public.public_schedule
   where id in ('2c500000-0000-4000-8000-000000000001', '2c500000-0000-4000-8000-000000000002')),
  '2c500000-0000-4000-8000-000000000001', 'without a header the board shows the default club');
select set_config('request.headers', '{"x-club-id":"2c999999-0000-4000-8000-000000000000"}', true);
select extensions.is(
  (select count(*)::int from public.public_schedule
   where id in ('2c500000-0000-4000-8000-000000000001', '2c500000-0000-4000-8000-000000000002')),
  0, 'an unknown club shows an empty board');

-- Inquiries stay with the club they were raised in. Staff and admins raise them; members do not.
set local role authenticated;
select set_config('request.jwt.claim.sub', '2c000000-0000-4000-8000-000000000003', true);
select set_config('request.headers', current_setting('t2c.header_b'), true);
select extensions.throws_ok(
  $$insert into public.support_inquiries (user_id, category, subject, message)
    values (auth.uid(), 'other', 'Two Club member inquiry', 'Members use Contact Us instead')$$,
  '42501', null, 'members cannot raise inquiries');
select set_config('request.jwt.claim.sub', '2c000000-0000-4000-8000-000000000005', true);
select extensions.lives_ok(
  $$insert into public.support_inquiries (user_id, category, subject, message)
    values (auth.uid(), 'other', 'Two Club inquiry', 'Raised in the second club')$$,
  'second-club staff raise an inquiry in their club');
select set_config('request.jwt.claim.sub', '2c000000-0000-4000-8000-000000000002', true);
select set_config('request.headers', '', true);
select extensions.is((select count(*)::int from public.support_inquiries where subject = 'Two Club inquiry'), 0,
  'the default club''s admin cannot see the second club''s inquiry');
select set_config('request.jwt.claim.sub', '2c000000-0000-4000-8000-000000000004', true);
select set_config('request.headers', current_setting('t2c.header_b'), true);
select extensions.is((select club_id::text from public.support_inquiries where subject = 'Two Club inquiry'),
  current_setting('t2c.club_b'), 'the second club''s admin sees it, filed under that club');

-- User 7: the platform superadmin works only through platform functions.
select set_config('request.jwt.claim.sub', '2c000000-0000-4000-8000-000000000007', true);
select set_config('request.headers', current_setting('t2c.header_b'), true);
select extensions.is(
  (select count(*) from public.member_admin) + (select count(*) from public.transactions)
  + (select count(*) from public.platform_commissions),
  0::bigint, 'the superadmin reads no club rows directly');
select extensions.ok(
  public.platform_start_support_session(current_setting('t2c.club_b')::uuid, 'Two-club isolation rehearsal check', 15) is not null,
  'the superadmin opens a support view of the second club');
select extensions.is(
  (select s -> 'members' ->> 'total'
   from (select public.platform_support_snapshot((select id from public.platform_my_support_sessions() where is_open)) as s) x),
  '2', 'the support view counts only the second club''s members');
select extensions.ok(
  (select position('two-club-3@fixture.invalid' in s::text) = 0 and position(current_setting('t2c.code_u3') in s::text) = 0
   from (select public.platform_support_snapshot((select id from public.platform_my_support_sessions() where is_open)) as s) x),
  'the support view carries no member emails or codes');
select extensions.lives_ok(
  $$select public.platform_end_support_session((select id from public.platform_my_support_sessions() where is_open))$$,
  'the superadmin closes the support view');

-- Suspending the second club closes it everywhere.
select extensions.lives_ok(
  $$select public.platform_set_club_status(current_setting('t2c.club_b')::uuid, 'suspended')$$,
  'the superadmin suspends the second club');
set local role postgres;
select set_config('request.headers', current_setting('t2c.header_b'), true);
select extensions.is(private.current_club_id(), null::uuid, 'a suspended club''s header fails closed');
set local role authenticated;
select set_config('request.jwt.claim.sub', '2c000000-0000-4000-8000-000000000003', true);
select extensions.is((select count(*)::int from public.get_current_access()), 0,
  'members of a suspended club get no role');
select set_config('request.jwt.claim.sub', '2c000000-0000-4000-8000-000000000006', true);
select extensions.is((select string_agg(slug, ',') from public.list_my_clubs()), 'rally-point-gensan',
  'a suspended club drops out of the member''s club list');

-- Protections that must survive the release.
set local role postgres;
select extensions.ok(has_function_privilege('anon', 'private.current_club_id()', 'EXECUTE'),
  'anonymous boards keep EXECUTE on current_club_id');
select extensions.ok(
  not exists (
    select 1
    from unnest(array[
      'public.create_unpaid_desk_booking(uuid, uuid, uuid, uuid, date, integer, integer)',
      'public.create_desk_rental(uuid, uuid, uuid, uuid, text, integer)',
      'public.add_member_to_session(uuid, uuid)', 'public.extend_desk_session(uuid, integer)',
      'public.end_desk_session(uuid)',
      'public.create_open_play_session(uuid, uuid, uuid, text, timestamptz, timestamptz, integer, numeric, public.skill_level, text)',
      'public.join_open_play_session(uuid, uuid)', 'public.leave_open_play_session(uuid, uuid)',
      'public.cancel_booking_reservation(uuid)']) f,
      (values ('anon'), ('authenticated')) r(role)
    where has_function_privilege(r.role, f, 'EXECUTE')),
  'the nine paused booking functions stay paused');
select extensions.is(
  (select string_agg(action, ',' order by created_at) from public.platform_audit_log
   where club_id = current_setting('t2c.club_b')::uuid),
  'club.provision,club.booking_fee,club.admin_assign,club.status,support.start,support.read,support.read,support.end,club.status',
  'every platform change and support look at the second club was logged once');
select extensions.is(
  (select commission_rate::text || ':' || commission_amount::text || ':' || club_net_amount::text
   from public.platform_commissions where transaction_id = '2c600000-0000-4000-8000-000000000002'),
  '0.00:32.00:368.00', 'the second club''s charge records its own flat booking fee');

select * from extensions.finish();
rollback;
