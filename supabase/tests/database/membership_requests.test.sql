begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select extensions.plan(88);

-- Fixture. Signing up gives every new account a Gensan membership row (standard,
-- active for 30 days), so each user below is a Gensan member unless changed here.
--   user 1: player (no membership) at Gensan and at the synthetic second club
--   user 2: Gensan staff
--   user 3: Gensan admin
--   user 4: admin of the synthetic second club only (a plain member at Gensan)
--   user 5: Gensan member with an active membership, not in the second club
--   user 6: platform superadmin (keeps the Gensan row sign-up gave them)
-- Request ids are kept in test.* settings r1 to r6.
insert into auth.users (id, email, raw_user_meta_data)
select ('f1000000-0000-4000-8000-00000000000' || n)::uuid, 'mreq-' || n || '@fixture.invalid',
       jsonb_build_object('full_name', 'Request User ' || n)
from generate_series(1, 6) n;
update public.members set membership_type = null, expiry_date = null
where user_id = 'f1000000-0000-4000-8000-000000000001' and club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
-- The second club's row has no QR token yet, so the wallet must give it one.
insert into public.members (club_id, user_id, member_code, full_name, membership_type, status, join_date, expiry_date, qr_token)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'f1000000-0000-4000-8000-000000000001', 'MR-1', 'Request User 1',
        null, 'active', current_date, null, null);
insert into public.club_staff_roles (club_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'f1000000-0000-4000-8000-000000000002', 'staff'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'f1000000-0000-4000-8000-000000000003', 'admin'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'f1000000-0000-4000-8000-000000000004', 'admin');
insert into public.platform_roles (user_id) values ('f1000000-0000-4000-8000-000000000006');
-- Staff decide memberships only with an active venue of the club (owner decision, 2026-11-25).
-- User 2 works the Gensan venue; user 7 is Gensan staff with no venue.
insert into public.staff_venue_grants (club_id, user_id, venue_id, is_active) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'f1000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac', true);
insert into auth.users (id, email, raw_user_meta_data)
values ('f1000000-0000-4000-8000-000000000007', 'mreq-7@fixture.invalid', jsonb_build_object('full_name', 'Request User 7'));
insert into public.club_staff_roles (club_id, user_id, role)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'f1000000-0000-4000-8000-000000000007', 'staff');
update public.club_accounts set status = 'active', commission_rate = 5
where club_id in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
select set_config('test.code1', (select member_code from public.members
  where user_id = 'f1000000-0000-4000-8000-000000000001' and club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), true);
select set_config('test.today', (now() at time zone 'Asia/Manila')::date::text, true);
select set_config('test.exp5', (select expiry_date::text from public.members
  where user_id = 'f1000000-0000-4000-8000-000000000005' and club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), true);

-- ---------------------------------------------------------------------------
-- Structure and privileges
-- ---------------------------------------------------------------------------
select extensions.ok(
  (select relrowsecurity from pg_class where oid = 'public.membership_requests'::regclass)
  and not has_table_privilege('anon', 'public.membership_requests', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE')
  and not has_table_privilege('authenticated', 'public.membership_requests', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE'),
  'membership_requests has row security and no direct API access');
select extensions.is(
  (select string_agg(policyname || ':' || permissive || ':' || cmd || ':' || qual, ',') from pg_policies
   where schemaname = 'public' and tablename = 'membership_requests'),
  'no_direct_api_access:RESTRICTIVE:ALL:false',
  'one restrictive deny policy, like the other closed tables');
select extensions.ok(
  (select count(*) = 7 and bool_and(p.prosecdef and 'search_path=""' = any(p.proconfig))
   from unnest(array[
     'public.list_my_member_passes()', 'public.request_club_membership(uuid)',
     'public.cancel_my_membership_request(uuid)', 'public.staff_list_membership_requests(text)',
     'public.staff_approve_membership_request(uuid, public.membership_type, numeric)',
     'public.staff_decline_membership_request(uuid, text)', 'public.check_in_qr(text, uuid)']) f
   join pg_proc p on p.oid = to_regprocedure(f)::oid),
  'the request, wallet and check-in functions run with definer rights and an empty search path');
select extensions.ok(
  (select bool_and(not has_function_privilege('anon', f, 'EXECUTE')
                   and not has_function_privilege('public', f, 'EXECUTE')
                   and has_function_privilege('authenticated', f, 'EXECUTE'))
   from unnest(array[
     'public.list_my_member_passes()', 'public.request_club_membership(uuid)',
     'public.cancel_my_membership_request(uuid)', 'public.staff_list_membership_requests(text)',
     'public.staff_approve_membership_request(uuid, public.membership_type, numeric)',
     'public.staff_decline_membership_request(uuid, text)', 'public.check_in_qr(text, uuid)']) f),
  'only signed-in callers reach them, and each checks the caller inside');
select extensions.ok(
  (select bool_and(not has_function_privilege('authenticated', f, 'EXECUTE') and not has_function_privilege('anon', f, 'EXECUTE'))
   from unnest(array[
     'private.membership_is_active(public.membership_type, public.member_status, date)',
     'private.require_membership_desk()', 'private.pending_membership_request(uuid, uuid)']) f),
  'the helpers stay private');
select extensions.ok(
  (select i.indisunique and pg_get_expr(i.indpred, i.indrelid) ~ 'pending'
   from pg_index i where i.indexrelid = 'public.membership_requests_one_pending'::regclass),
  'a partial unique index allows one pending request per person per club');
select extensions.is(
  (select count(*)::int from pg_constraint c
   where c.conrelid = 'public.membership_requests'::regclass and c.contype = 'f'
     and not exists (
       select 1 from pg_index i
       where i.indrelid = c.conrelid and i.indpred is null
         and (i.indkey::int2[])[0:cardinality(c.conkey) - 1] = c.conkey::int2[])),
  0, 'every membership_requests foreign key has an index in its own column order');
select extensions.ok(
  not has_table_privilege('authenticated', 'public.members', 'INSERT, UPDATE, DELETE')
  and not has_table_privilege('authenticated', 'public.transactions', 'INSERT, UPDATE, DELETE')
  and not has_table_privilege('authenticated', 'public.bookings', 'INSERT, UPDATE, DELETE')
  and not has_table_privilege('authenticated', 'public.court_allocations', 'INSERT, UPDATE, DELETE'),
  'members, charges and the paused booking tables stay closed to direct writes');

-- ---------------------------------------------------------------------------
-- Visitors
-- ---------------------------------------------------------------------------
select set_config('request.headers', '', true);
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select extensions.throws_ok($$select * from public.list_my_member_passes()$$, '42501', null,
  'a visitor has no passes');
select extensions.throws_ok($$select public.request_club_membership('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')$$, '42501', null,
  'a visitor cannot ask for a membership');
select extensions.throws_ok($$select * from public.staff_list_membership_requests('pending')$$, '42501', null,
  'a visitor cannot list requests');
select extensions.throws_ok($$select count(*) from public.membership_requests$$, '42501', null,
  'a visitor cannot read the table');

-- ---------------------------------------------------------------------------
-- User 1: a player at two clubs
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000001', true);
select set_config('request.headers', '{"x-club-id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}', true);

select extensions.throws_ok($$select count(*) from public.membership_requests$$, '42501', null,
  'a signed-in person cannot read the table directly');
select extensions.throws_ok(
  $$insert into public.membership_requests (club_id, user_id, member_id)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'f1000000-0000-4000-8000-000000000001',
            gen_random_uuid())$$,
  '42501', null, 'a signed-in person cannot write the table directly');

select extensions.is(
  (select count(*)::int from public.list_my_member_passes()),
  2, 'with the second club active, the wallet still holds both clubs'' passes');
select extensions.ok(
  (select count(distinct qr_token) = 2 and bool_and(qr_token ~ '^q_[0-9a-f]{24}$')
   from public.list_my_member_passes()),
  'each pass has its own QR token, and the missing one was filled in');
select set_config('request.headers', '', true);
select extensions.is(
  (select array_agg(club_id::text || ':' || is_active_member::text order by club_name) from public.list_my_member_passes()),
  array['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:false', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb:false'],
  'without a header the same two passes come back, ordered by club name, neither an active membership');
select extensions.is(
  (select count(*)::int from public.list_my_member_passes() where request_id is not null),
  0, 'no pass has a request yet');

select extensions.lives_ok(
  $$select set_config('test.r1', public.request_club_membership('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')::text, true)$$,
  'the player asks Gensan for a membership');
select extensions.throws_ok(
  $$select public.request_club_membership('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')$$,
  '23505', 'You already asked this club. Staff will confirm it at the desk.', 'one open request per club');
select extensions.is(
  (select request_id::text || ':' || request_status from public.list_my_member_passes()
   where club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  current_setting('test.r1') || ':pending', 'the Gensan pass shows the pending request');

select extensions.throws_ok($$select * from public.staff_list_membership_requests('pending')$$,
  '42501', 'Only club staff can manage membership requests', 'a player cannot list requests');
select extensions.throws_ok(
  $$select public.staff_approve_membership_request(current_setting('test.r1')::uuid, 'premium', 0)$$,
  '42501', 'Only club staff can manage membership requests', 'a player cannot approve their own request');
select extensions.throws_ok(
  $$select public.staff_decline_membership_request(current_setting('test.r1')::uuid, 'no')$$,
  '42501', 'Only club staff can manage membership requests', 'a player cannot decline a request');

-- ---------------------------------------------------------------------------
-- User 4: admin of the second club only
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000004', true);
select extensions.throws_ok($$select * from public.staff_list_membership_requests('pending')$$,
  '42501', 'Only club staff can manage membership requests', 'naming Gensan does not make another club''s admin its staff');
select extensions.throws_ok(
  $$select public.staff_approve_membership_request(current_setting('test.r1')::uuid, 'premium', 0)$$,
  '42501', 'Only club staff can manage membership requests', 'another club''s admin cannot approve for Gensan');
select set_config('request.headers', '{"x-club-id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}', true);
select extensions.is(
  (select count(*)::int from public.staff_list_membership_requests('pending')),
  0, 'in their own club, Gensan''s request is not listed');
select extensions.throws_ok(
  $$select public.staff_approve_membership_request(current_setting('test.r1')::uuid, 'premium', 0)$$,
  'P0002', 'Membership request not found', 'from their own club, Gensan''s request is not found to approve');
select extensions.throws_ok(
  $$select public.staff_decline_membership_request(current_setting('test.r1')::uuid, 'no')$$,
  'P0002', 'Membership request not found', 'or to decline');

-- User 6: platform superadmin.
select set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000006', true);
select set_config('request.headers', '', true);
select extensions.throws_ok(
  $$select public.staff_approve_membership_request(current_setting('test.r1')::uuid, 'premium', 0)$$,
  '42501', 'Platform accounts cannot manage membership requests', 'a platform account cannot decide memberships');
select extensions.throws_ok(
  $$select public.request_club_membership('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')$$,
  '42501', 'Platform accounts cannot ask for memberships', 'or ask for one');

-- ---------------------------------------------------------------------------
-- User 2: Gensan staff approves a new membership
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000002', true);
select extensions.is(
  (select member_code || '|' || full_name || '|' || coalesce(membership_type::text, 'none') || '|' || status
   from public.staff_list_membership_requests('pending') where id = current_setting('test.r1')::uuid),
  current_setting('test.code1') || '|Request User 1|none|pending',
  'Gensan staff see the request with the player''s card');
select extensions.throws_ok(
  $$select public.staff_approve_membership_request(current_setting('test.r1')::uuid, null, 500)$$,
  '22023', 'Choose a membership plan', 'a plan is needed');
select extensions.throws_ok(
  $$select public.staff_approve_membership_request(current_setting('test.r1')::uuid, 'standard', -1)$$,
  '22023', 'Enter the amount received (0 or more)', 'the amount cannot be negative');
select extensions.throws_ok(
  $$select public.staff_approve_membership_request(current_setting('test.r1')::uuid, 'standard', 1000001)$$,
  '22023', 'Enter the amount received (0 or more)', 'the amount has an upper limit');
select extensions.lives_ok(
  $$select public.staff_approve_membership_request(current_setting('test.r1')::uuid, 'standard', 500)$$,
  'staff approve the request with the amount received');
select extensions.throws_ok(
  $$select public.staff_approve_membership_request(current_setting('test.r1')::uuid, 'standard', 500)$$,
  '55000', 'This request has already been decided', 'a decided request cannot be approved again');
select extensions.throws_ok(
  $$select public.staff_decline_membership_request(current_setting('test.r1')::uuid, 'late')$$,
  '55000', 'This request has already been decided', 'or declined afterwards');

reset role;
select extensions.is(
  (select membership_type::text || '|' || status::text || '|' || expiry_date::text from public.members
   where user_id = 'f1000000-0000-4000-8000-000000000001' and club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'standard|active|' || (current_setting('test.today')::date + 30)::text,
  'the Gensan card has the plan, is active, and runs 30 days from today (Philippine date)');
select extensions.is(
  (select coalesce(membership_type::text, 'none') from public.members
   where user_id = 'f1000000-0000-4000-8000-000000000001' and club_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  'none', 'the second club''s card is unchanged');
select extensions.is(
  (select t.type::text || '|' || t.amount::text || '|' || t.description || '|' || t.verification_status || '|'
          || (t.created_by = 'f1000000-0000-4000-8000-000000000002')::text
   from public.transactions t
   join public.membership_requests r on r.transaction_id = t.id
   where r.id = current_setting('test.r1')::uuid),
  'membership|500.00|New membership (confirmed by staff)|unverified|true',
  'the amount received is recorded as an unverified membership charge by the staff member');
select extensions.is(
  (select count(*)::int from public.platform_commissions c
   join public.membership_requests r on r.transaction_id = c.transaction_id
   where r.id = current_setting('test.r1')::uuid),
  0, 'a membership charge earns no platform commission');
select extensions.is(
  (select status || '|' || membership_type::text || '|' || amount::text || '|'
          || (decided_by = 'f1000000-0000-4000-8000-000000000002')::text
   from public.membership_requests where id = current_setting('test.r1')::uuid),
  'approved|standard|500.00|true', 'the request records the decision');
select extensions.is(
  (select title || '|' || body from public.notifications
   where user_id = 'f1000000-0000-4000-8000-000000000001' and club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
     and title = 'Membership approved'),
  'Membership approved|Your membership is active until ' || (current_setting('test.today')::date + 30)::text
    || '. You now pay the member rate where a court has one.',
  'the player is told');

-- ---------------------------------------------------------------------------
-- User 1: renew, withdraw, and the daily limit
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000001', true);
select extensions.is(
  (select is_active_member::text || '|' || request_status from public.list_my_member_passes()
   where club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'true|approved', 'the Gensan pass now shows an active membership and the approved request');
select extensions.lives_ok(
  $$select set_config('test.r2', public.request_club_membership('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')::text, true)$$,
  'a member asks to renew');
select extensions.lives_ok(
  $$select public.cancel_my_membership_request(current_setting('test.r2')::uuid)$$,
  'and withdraws it');
select extensions.throws_ok(
  $$select public.cancel_my_membership_request(current_setting('test.r2')::uuid)$$,
  '55000', 'This request has already been decided', 'a withdrawn request cannot be withdrawn again');
select extensions.lives_ok(
  $$select set_config('test.r3', public.request_club_membership('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')::text, true)$$,
  'they ask to renew again');
select extensions.lives_ok(
  $$select set_config('test.r4', public.request_club_membership('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')::text, true)$$,
  'and ask the second club too: a fourth request today');
select extensions.lives_ok(
  $$select public.cancel_my_membership_request(current_setting('test.r4')::uuid)$$,
  'they withdraw the second club''s request');
select extensions.lives_ok(
  $$select set_config('test.r6', public.request_club_membership('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')::text, true)$$,
  'a fifth request today is still allowed');
select extensions.lives_ok(
  $$select public.cancel_my_membership_request(current_setting('test.r6')::uuid)$$,
  'and withdrawn');
select extensions.throws_ok(
  $$select public.request_club_membership('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')$$,
  '54000', 'You have asked for a membership many times today. Please try again tomorrow.',
  'a sixth request in a day is refused');

-- User 5 cannot ask a club they do not belong to, but asks their own.
select set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000005', true);
select extensions.throws_ok(
  $$select public.request_club_membership('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')$$,
  '42501', 'Join this club before asking for a membership', 'only a club the person already belongs to');
select extensions.lives_ok(
  $$select set_config('test.r5', public.request_club_membership('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')::text, true)$$,
  'a member asks Gensan to renew');
select extensions.throws_ok(
  $$select public.cancel_my_membership_request(current_setting('test.r3')::uuid)$$,
  'P0002', 'Membership request not found', 'nobody can withdraw someone else''s request');

-- ---------------------------------------------------------------------------
-- User 2: a renewal at no charge, and a decline
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000002', true);
select extensions.is(
  (select array_agg(id::text order by requested_at) from public.staff_list_membership_requests('pending')),
  array[current_setting('test.r3'), current_setting('test.r5')],
  'pending requests come oldest first, and cancelled ones are not listed');
select extensions.lives_ok(
  $$select public.staff_approve_membership_request(current_setting('test.r3')::uuid, 'premium', 0)$$,
  'staff approve a renewal given at no charge');
select extensions.throws_ok(
  $$select public.staff_decline_membership_request(current_setting('test.r5')::uuid, E'  \n ')$$,
  '22023', 'Please give a reason the player will see', 'a decline needs a reason');
select extensions.throws_ok(
  $$select public.staff_decline_membership_request(current_setting('test.r5')::uuid, repeat('x', 301))$$,
  '22023', 'The reason is limited to 300 characters', 'the reason has a length limit');
select extensions.lives_ok(
  $$select public.staff_decline_membership_request(current_setting('test.r5')::uuid, '  No payment received  ')$$,
  'staff decline a request with a reason');
select extensions.is(
  (select array_agg(id::text order by decided_at desc) from public.staff_list_membership_requests('decided')),
  array[current_setting('test.r5'), current_setting('test.r3'), current_setting('test.r1')],
  'decided requests come newest first, approved and declined only');
select extensions.throws_ok($$select * from public.staff_list_membership_requests('everything')$$,
  '22023', 'Choose pending or decided requests', 'only the two lists exist');

reset role;
select extensions.is(
  (select membership_type::text || '|' || status::text || '|' || expiry_date::text from public.members
   where user_id = 'f1000000-0000-4000-8000-000000000001' and club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'premium|active|' || (current_setting('test.today')::date + 60)::text,
  'a renewal extends 30 days from the current expiry, not from today');
select extensions.is(
  (select count(*)::int from public.transactions
   where member_id in (select id from public.members where user_id = 'f1000000-0000-4000-8000-000000000001')),
  1, 'a renewal at no charge records no charge');
select extensions.is(
  (select count(*)::int from public.notifications
   where user_id = 'f1000000-0000-4000-8000-000000000001' and club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
     and title = 'Membership renewed'
     and body like 'Your membership is active until ' || (current_setting('test.today')::date + 60)::text || '.%'),
  1, 'the player is told it was renewed');
select extensions.is(
  (select status || '|' || decline_reason from public.membership_requests where id = current_setting('test.r5')::uuid),
  'declined|No payment received', 'the decline keeps the trimmed reason');
select extensions.is(
  (select title || '|' || body from public.notifications
   where user_id = 'f1000000-0000-4000-8000-000000000005' and club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
     and title = 'Membership request declined'),
  'Membership request declined|No payment received', 'the declined player is told why');
select extensions.is(
  (select expiry_date::text from public.members
   where user_id = 'f1000000-0000-4000-8000-000000000005' and club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  current_setting('test.exp5'), 'a declined request leaves the card as it was');
select extensions.ok(
  (select count(*) = 0 from public.membership_requests r where r.status = 'pending'
     and r.user_id = 'f1000000-0000-4000-8000-000000000001'),
  'user 1 has no open request left');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000005', true);
select extensions.is(
  (select request_status || '|' || request_decline_reason || '|' || (request_decided_at is not null)::text
   from public.list_my_member_passes() where club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'declined|No payment received|true', 'the player''s pass shows the decline and its reason');

-- ---------------------------------------------------------------------------
-- QR check-in: the desk sees who it is, and each pass works at its own club only
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000001', true);
select extensions.lives_ok(
  $$select public.update_my_account('Request User 1', 'Tiki')$$,
  'the player sets a nickname');
select set_config('test.token1b', (select qr_token from public.list_my_member_passes()
  where club_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), true);

select set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000003', true);
select set_config('request.headers', '', true);
select extensions.lives_ok(
  $$select set_config('test.checkin', public.check_in_qr('RP1|' || current_setting('test.code1') || '|x',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac')::text, true)$$,
  'the Gensan admin scans the player''s Gensan pass');
select extensions.is(
  (select array_agg(k order by k) from jsonb_object_keys(current_setting('test.checkin')::jsonb -> 'member') k),
  array['club_id', 'expiry_date', 'full_name', 'id', 'is_active_member', 'member_code', 'membership_type',
        'nickname', 'photo_path', 'status'],
  'the member object keeps its keys and gains nickname, photo_path and is_active_member');
select extensions.is(
  (select (m ->> 'nickname') || '|' || coalesce(m ->> 'photo_path', 'none') || '|' || (m ->> 'is_active_member')
          || '|' || (m ->> 'membership_type')
   from (select current_setting('test.checkin')::jsonb -> 'member' as m) s),
  'Tiki|none|true|premium', 'the desk sees the nickname, the photo (none yet) and an active membership');
select extensions.ok(
  (current_setting('test.checkin')::jsonb -> 'checkin') ? 'id',
  'the check-in itself is still returned');
select extensions.throws_ok(
  $$select public.check_in_qr(current_setting('test.token1b'), 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac')$$,
  'P0001', 'QR not recognized', 'the second club''s pass does not work at Gensan');
select set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000001', true);
select extensions.throws_ok(
  $$select public.check_in_qr(current_setting('test.code1'), 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac')$$,
  'P0001', 'member or venue is outside assigned club', 'a player cannot check themselves in');

-- ---------------------------------------------------------------------------
-- Nobody decides their own request (owner decision, 2026-11-25)
-- ---------------------------------------------------------------------------
select set_config('request.headers', '', true);
select set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000002', true);
select extensions.lives_ok(
  $$select set_config('test.r7', public.request_club_membership('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')::text, true)$$,
  'a Gensan staff member who plays there may ask for a membership');
select extensions.throws_ok(
  $$select public.staff_approve_membership_request(current_setting('test.r7')::uuid, 'premium', 0)$$,
  '42501', 'You cannot decide your own membership request. Ask another staff member or admin.',
  'staff cannot approve their own request');
select extensions.throws_ok(
  $$select public.staff_decline_membership_request(current_setting('test.r7')::uuid, 'Mine')$$,
  '42501', 'You cannot decide your own membership request. Ask another staff member or admin.',
  'staff cannot decline their own request either');
select set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000003', true);
select extensions.lives_ok(
  $$select public.staff_approve_membership_request(current_setting('test.r7')::uuid, 'standard', 1500)$$,
  'another of the club''s staff (the Gensan admin) can approve it');

-- ---------------------------------------------------------------------------
-- A suspension is not lifted by asking or approving (security review, 2026-11-25)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000005', true);
select extensions.lives_ok(
  $$select set_config('test.r8', public.request_club_membership('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')::text, true)$$,
  'a member asks while in good standing');
reset role;
update public.members set status = 'suspended'
where user_id = 'f1000000-0000-4000-8000-000000000005' and club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000003', true);
select extensions.throws_ok(
  $$select public.staff_approve_membership_request(current_setting('test.r8')::uuid, 'standard', 0)$$,
  '55000', 'This member is suspended. Lift the suspension in Members first.',
  'approving does not lift a suspension');
select set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000005', true);
select public.cancel_my_membership_request(current_setting('test.r8')::uuid);
select extensions.throws_ok(
  $$select public.request_club_membership('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')$$,
  '42501', 'Your account at this club is on hold. Please talk to the club.',
  'a suspended member cannot ask for a membership');

-- ---------------------------------------------------------------------------
-- Staff need a venue of the club to decide memberships (owner decision, 2026-11-25)
-- ---------------------------------------------------------------------------
select set_config('request.headers', '', true);
select set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000007', true);
select extensions.throws_ok(
  $$select * from public.staff_list_membership_requests('pending')$$,
  '42501', 'Only staff assigned to one of this club''s venues can manage membership requests',
  'staff with no venue cannot see membership requests');
select extensions.throws_ok(
  $$select public.staff_decline_membership_request(current_setting('test.r8')::uuid, 'No')$$,
  '42501', 'Only staff assigned to one of this club''s venues can manage membership requests',
  'staff with no venue cannot decide one');

reset role;
select * from extensions.finish();
rollback;
