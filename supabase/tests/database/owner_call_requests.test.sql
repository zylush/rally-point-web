begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select extensions.plan(27);

-- Fixture:
--   user 61: platform superadmin with no club role
--   user 62: Gensan member
insert into auth.users (id, email, raw_user_meta_data)
select ('c1000000-0000-4000-8000-0000000000' || n)::uuid, 'owner-req-' || n || '@fixture.invalid',
       jsonb_build_object('full_name', 'Owner Request User ' || n)
from generate_series(61, 62) n;
insert into public.platform_roles (user_id) values ('c1000000-0000-4000-8000-000000000061');
delete from public.members where user_id = 'c1000000-0000-4000-8000-000000000061';
select set_config('test.tomorrow', ((now() at time zone 'Asia/Manila')::date + 1)::text, true);

-- Structure and privileges.
select extensions.ok(
  (select relrowsecurity from pg_class where oid = 'public.owner_call_requests'::regclass),
  'row security is on for owner call requests');
select extensions.ok(
  not exists (
    select 1 from (values ('anon'), ('authenticated')) r(role)
    where has_table_privilege(r.role, 'public.owner_call_requests', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')),
  'API roles have no direct access to owner call requests');
select extensions.ok(
  has_function_privilege('anon', 'public.request_owner_call(text, text, text, integer, text, text, date, text, text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.request_owner_call(text, text, text, integer, text, text, date, text, text)', 'EXECUTE'),
  'visitors and signed-in people can send a request');
select extensions.ok(
  (select bool_and(has_function_privilege('authenticated', f, 'EXECUTE') and not has_function_privilege('anon', f, 'EXECUTE'))
   from unnest(array['public.platform_owner_call_requests(text, integer)', 'public.platform_set_owner_call_status(uuid, text)']) f),
  'the follow-up functions need a signed-in caller and check the platform role themselves');
select extensions.ok(
  (select bool_and(prosecdef and 'search_path=""' = any(proconfig)) from pg_proc
   where oid in ('public.request_owner_call(text, text, text, integer, text, text, date, text, text)'::regprocedure,
                 'public.platform_owner_call_requests(text, integer)'::regprocedure,
                 'public.platform_set_owner_call_status(uuid, text)'::regprocedure)),
  'every new function runs with a fixed, empty search path');

-- A visitor sends a request.
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select extensions.ok(
  public.request_owner_call(' Ana Reyes ', ' Lagao Smash Courts ', ' General Santos City ', 4,
                            '0917 555 0101', ' Ana@Example.INVALID ', current_setting('test.tomorrow')::date, 'morning',
                            ' Indoor courts, open since 2025. ') is not null,
  'a visitor can send a request without an account');
select extensions.throws_ok(
  $$select * from public.owner_call_requests$$, '42501', null, 'a visitor cannot read the requests');

set local role postgres;
select extensions.is(
  (select row(full_name, club_name, city, court_count, email, message, status)::text
   from public.owner_call_requests where phone = '0917 555 0101'),
  row('Ana Reyes', 'Lagao Smash Courts', 'General Santos City', 4, 'ana@example.invalid',
      'Indoor courts, open since 2025.', 'new')::text,
  'the request is stored trimmed, with the email in lower case and the status new');

-- Checks, with plain messages.
set local role anon;
select extensions.throws_ok(
  $$select public.request_owner_call('Ben', 'Ben Courts', 'Davao City', 2, '', '', current_setting('test.tomorrow')::date, 'evening', null)$$,
  '22023', 'Give a mobile number or an email so we can reach you', 'a request needs a phone number or an email');
select extensions.throws_ok(
  $$select public.request_owner_call('Ben', 'Ben Courts', 'Davao City', 2, 'call me', null, current_setting('test.tomorrow')::date, 'evening', null)$$,
  '22023', 'Enter a mobile number like 0917 123 4567', 'a phone number must look like one');
select extensions.throws_ok(
  $$select public.request_owner_call('Ben', 'Ben Courts', 'Davao City', 2, null, 'not-an-email', current_setting('test.tomorrow')::date, 'evening', null)$$,
  '22023', 'Enter an email like name@example.com', 'an email must look like one');
select extensions.throws_ok(
  $$select public.request_owner_call('Ben', 'Ben Courts', 'Davao City', 2, '0917 555 0102', null, current_setting('test.tomorrow')::date - 2, 'evening', null)$$,
  '22023', 'Choose a day from today to 60 days ahead', 'a past day is refused');
select extensions.throws_ok(
  $$select public.request_owner_call('Ben', 'Ben Courts', 'Davao City', 2, '0917 555 0102', null, current_setting('test.tomorrow')::date + 60, 'evening', null)$$,
  '22023', 'Choose a day from today to 60 days ahead', 'a day more than 60 days ahead is refused');
select extensions.throws_ok(
  $$select public.request_owner_call('Ben', 'Ben Courts', 'Davao City', 2, '0917 555 0102', null, current_setting('test.tomorrow')::date, 'midnight', null)$$,
  '22023', 'Choose morning, afternoon or evening', 'only morning, afternoon or evening');
select extensions.throws_ok(
  $$select public.request_owner_call('Ben', 'Ben Courts', 'Davao City', 0, '0917 555 0102', null, current_setting('test.tomorrow')::date, 'evening', null)$$,
  '22023', 'Enter how many courts you have (1 to 50)', 'the number of courts must be 1 to 50');

-- At most 3 a day from the same phone, however it is written, or the same email.
select public.request_owner_call('Ana Reyes', 'Lagao Smash Courts', 'General Santos City', 4, '(0917) 555-0101', null, current_setting('test.tomorrow')::date, 'afternoon', null);
select extensions.lives_ok(
  $$select public.request_owner_call('Ana Reyes', 'Lagao Smash Courts', 'General Santos City', 4, '09175550101', null, current_setting('test.tomorrow')::date, 'afternoon', null)$$,
  'a third request from the same phone in a day is still accepted');
select extensions.throws_ok(
  $$select public.request_owner_call('Ana Reyes', 'Lagao Smash Courts', 'General Santos City', 4, '0917 555 0101', null, current_setting('test.tomorrow')::date, 'afternoon', null)$$,
  '54000', 'You already asked us to call. We will contact you soon.', 'a fourth request from the same phone, written differently, is refused');
select public.request_owner_call('Ana Reyes', 'Lagao Smash Courts', 'General Santos City', 4, null, 'ana@example.invalid', current_setting('test.tomorrow')::date, 'afternoon', null);
select public.request_owner_call('Ana Reyes', 'Lagao Smash Courts', 'General Santos City', 4, null, 'ana@example.invalid', current_setting('test.tomorrow')::date, 'afternoon', null);
select extensions.throws_ok(
  $$select public.request_owner_call('Ana Reyes', 'Lagao Smash Courts', 'General Santos City', 4, null, 'ANA@example.invalid', current_setting('test.tomorrow')::date, 'afternoon', null)$$,
  '54000', 'You already asked us to call. We will contact you soon.', 'the same limit applies to the same email');

-- At most 30 an hour from everyone.
set local role postgres;
insert into public.owner_call_requests (full_name, club_name, city, court_count, phone, preferred_date, preferred_time)
select 'Flood ' || n, 'Flood Club ' || n, 'Davao City', 2, '0918 000 ' || lpad(n::text, 4, '0'),
       current_setting('test.tomorrow')::date, 'morning'
from generate_series(1, 30 - (select count(*)::int from public.owner_call_requests)) n;
set local role anon;
select extensions.throws_ok(
  $$select public.request_owner_call('Cara', 'Cara Courts', 'Davao City', 2, '0919 555 0199', null, current_setting('test.tomorrow')::date, 'morning', null)$$,
  '54000', 'We are getting many requests right now. Please try again in an hour.', 'more than 30 requests in an hour are refused');

-- A member is refused the follow-up functions.
set local role authenticated;
select set_config('request.headers', '', true);
select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000062', true);
select extensions.throws_ok($$select * from public.platform_owner_call_requests()$$, '42501', 'Platform access required',
  'members cannot read owner requests');
select extensions.throws_ok(
  $$select public.platform_set_owner_call_status('c3000000-0000-4000-8000-000000000001', 'closed')$$,
  '42501', 'Platform access required', 'members cannot change owner requests');

-- The superadmin follows up.
select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000061', true);
select extensions.is((select count(*)::int from public.platform_owner_call_requests('new', 500)), 30,
  'the superadmin sees every new request');
select set_config('test.request', (select id::text from public.platform_owner_call_requests() where phone = '0917 555 0101'), true);
select public.platform_set_owner_call_status(current_setting('test.request')::uuid, 'called');
select extensions.is(
  (select row(status, handled_by_email)::text from public.platform_owner_call_requests('called')),
  row('called', 'owner-req-61@fixture.invalid')::text,
  'marking a request as called records who handled it');
select extensions.throws_ok(
  $$select public.platform_set_owner_call_status(current_setting('test.request')::uuid, 'lost')$$,
  '22023', 'Unknown request status', 'only new, called or closed');
select extensions.throws_ok(
  $$select public.platform_set_owner_call_status('c3000000-0000-4000-8000-000000000001', 'closed')$$,
  'P0002', 'Request not found', 'an unknown request is reported plainly');

set local role postgres;
select extensions.is(
  (select details from public.platform_audit_log where action = 'owner_request.status' order by created_at desc limit 1),
  jsonb_build_object('request_id', current_setting('test.request')::uuid, 'from', 'new', 'to', 'called'),
  'the audit log keeps the request id and status only, not the owner''s contact details');

set local role authenticated;
select public.platform_set_owner_call_status(current_setting('test.request')::uuid, 'new');
select extensions.is(
  (select row(status, handled_at, handled_by_email)::text from public.platform_owner_call_requests()
   where id = current_setting('test.request')::uuid),
  row('new', null::timestamptz, null::text)::text,
  'setting a request back to new clears who handled it');

select * from extensions.finish();
rollback;
