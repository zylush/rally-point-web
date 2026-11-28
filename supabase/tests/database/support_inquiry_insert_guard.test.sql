begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select extensions.plan(24);

-- Fixture (Gensan).
--   user 1: staff     user 2: admin     user 3: a plain member
insert into auth.users (id, email, raw_user_meta_data)
select ('e2a00000-0000-4000-8000-00000000000' || n)::uuid, 'inquiry-guard-' || n || '@fixture.invalid',
       jsonb_build_object('full_name', 'Inquiry Guard ' || n)
from generate_series(1, 3) n;
insert into public.club_staff_roles (club_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'e2a00000-0000-4000-8000-000000000001', 'staff'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'e2a00000-0000-4000-8000-000000000002', 'admin');
select set_config('request.headers', '{"x-club-id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}', true);

-- ---------------------------------------------------------------------------
-- The guard, and unchanged grants and policies
-- ---------------------------------------------------------------------------
select extensions.ok(
  (select t.tgenabled = 'O'
          and pg_get_triggerdef(t.oid) like 'CREATE TRIGGER support_inquiries_insert_guard BEFORE INSERT ON public.support_inquiries FOR EACH ROW %'
          and pg_get_triggerdef(t.oid) like '%(CURRENT_USER = ANY (ARRAY[''anon''::name, ''authenticated''::name]))%'
          and pg_get_triggerdef(t.oid) like '% EXECUTE FUNCTION private.support_inquiry_insert_guard()'
   from pg_trigger t
   where t.tgrelid = 'public.support_inquiries'::regclass and t.tgname = 'support_inquiries_insert_guard'),
  'inserts by anon or authenticated pass through a BEFORE INSERT guard on every row');
select extensions.ok(
  (select p.prosecdef and 'search_path=""' = any(p.proconfig) and pg_get_userbyid(p.proowner) = 'postgres'
          and p.prorettype = 'trigger'::regtype
   from pg_proc p where p.oid = 'private.support_inquiry_insert_guard()'::regprocedure),
  'the guard is a definer trigger function with an empty search path, owned by postgres');
select extensions.ok(
  not exists (select 1 from (values ('public'), ('anon'), ('authenticated'), ('service_role')) r(role)
              where has_function_privilege(r.role, 'private.support_inquiry_insert_guard()', 'EXECUTE')),
  'no API role can call the guard directly');
select extensions.ok(
  has_table_privilege('authenticated', 'public.support_inquiries', 'SELECT')
  and has_table_privilege('authenticated', 'public.support_inquiries', 'INSERT')
  and has_column_privilege('authenticated', 'public.support_inquiries', 'status', 'INSERT')
  and not has_table_privilege('authenticated', 'public.support_inquiries', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.support_inquiries', 'DELETE')
  and not has_table_privilege('anon', 'public.support_inquiries', 'SELECT, INSERT, UPDATE, DELETE'),
  'grants are unchanged: signed-in users read and insert, nobody updates or deletes');
select extensions.is(
  (select string_agg(policyname::text || ':' || cmd::text, ',' order by policyname)
   from pg_policies where schemaname = 'public' and tablename = 'support_inquiries'),
  'inquiries_insert_staff_admin:INSERT,inquiries_read_own_or_admin:SELECT',
  'policies are unchanged');

-- ---------------------------------------------------------------------------
-- Staff: an inquiry always starts open and unanswered
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e2a00000-0000-4000-8000-000000000001', true);
select extensions.lives_ok(
  $$insert into public.support_inquiries
      (id, user_id, category, subject, message, status, response, responded_by, responded_at, created_at)
    values ('e2a10000-0000-4000-8000-000000000001', auth.uid(), 'booking', 'Forged answer', 'Looks answered.',
            'resolved', 'Fixed by admin', 'e2a00000-0000-4000-8000-000000000002', '2026-01-01', '2020-01-01')$$,
  'staff may still insert an inquiry for their own account');
select extensions.is(
  (select status || '|' || coalesce(response, '-') || '|' || coalesce(responded_by::text, '-') || '|'
          || coalesce(responded_at::text, '-')
   from public.support_inquiries where id = 'e2a10000-0000-4000-8000-000000000001'),
  'open|-|-|-', 'the inquiry is stored open, with no response, responder or response time');
select extensions.ok(
  (select created_at = now() from public.support_inquiries where id = 'e2a10000-0000-4000-8000-000000000001'),
  'the inquiry is dated when it was raised, not when the sender says');
select extensions.lives_ok(
  $$insert into public.support_inquiries (id, user_id, category, subject, message, status)
    values ('e2a10000-0000-4000-8000-000000000002', auth.uid(), 'other', 'In progress?', 'One.', 'in_progress'),
           ('e2a10000-0000-4000-8000-000000000003', auth.uid(), 'other', 'Resolved?', 'Two.', 'resolved')$$,
  'staff may insert several inquiries at once');
select extensions.is(
  (select string_agg(status, ',' order by id) from public.support_inquiries
   where id in ('e2a10000-0000-4000-8000-000000000002', 'e2a10000-0000-4000-8000-000000000003')),
  'open,open', 'every row of a multi-row insert starts open');
select extensions.lives_ok(
  $$insert into public.support_inquiries (id, user_id, category, subject, message, response)
    values ('e2a10000-0000-4000-8000-000000000004', auth.uid(), 'other', 'Reply only', 'Three.', 'A reply')$$,
  'a response sent with a new inquiry is dropped instead of stored');
select extensions.is(
  (select coalesce(response, '-') from public.support_inquiries where id = 'e2a10000-0000-4000-8000-000000000004'),
  '-', 'the inquiry has no response');
-- The app's insert (src/lib/api.ts createInquiry).
select extensions.lives_ok(
  $$insert into public.support_inquiries (user_id, category, subject, message, club_id, status)
    values (auth.uid(), 'technical', 'App inquiry', 'Sent from the help screen.',
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'open')$$,
  'the app''s insert works as before');
select extensions.is(
  (select status from public.support_inquiries where subject = 'App inquiry'), 'open',
  'the app''s inquiry is open');

-- The policy still decides who may insert at all.
select extensions.throws_ok(
  $$insert into public.support_inquiries (user_id, category, subject, message, status)
    values ('e2a00000-0000-4000-8000-000000000002', 'other', 'Impersonated', 'Not mine.', 'resolved')$$,
  '42501', null, 'staff still cannot insert an inquiry for another account');
select extensions.throws_ok(
  $$insert into public.support_inquiries (club_id, user_id, category, subject, message)
    values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', auth.uid(), 'other', 'Wrong club', 'Forged club.')$$,
  '42501', null, 'staff still cannot insert an inquiry in another club');
select set_config('request.jwt.claim.sub', 'e2a00000-0000-4000-8000-000000000003', true);
select extensions.throws_ok(
  $$insert into public.support_inquiries (user_id, category, subject, message)
    values (auth.uid(), 'other', 'Member inquiry', 'Members use Contact Us.')$$,
  '42501', null, 'members still cannot raise inquiries');
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select extensions.throws_ok(
  $$insert into public.support_inquiries (user_id, category, subject, message)
    values ('e2a00000-0000-4000-8000-000000000001', 'other', 'Visitor', 'No account.')$$,
  '42501', null, 'visitors still cannot raise inquiries');

-- ---------------------------------------------------------------------------
-- Admins: their own inquiries start open too, and only the update operation answers
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e2a00000-0000-4000-8000-000000000002', true);
select extensions.is(
  (select count(*)::int from public.support_inquiries where id = 'e2a10000-0000-4000-8000-000000000001'),
  1, 'the admin sees the staff inquiry');
select extensions.lives_ok(
  $$select * from public.admin_update_support_inquiry('e2a10000-0000-4000-8000-000000000001', 'resolved', 'Real answer')$$,
  'the admin answers through admin_update_support_inquiry');
select extensions.is(
  (select status || '|' || response || '|' || responded_by::text || '|' || (responded_at is not null)::text
   from public.support_inquiries where id = 'e2a10000-0000-4000-8000-000000000001'),
  'resolved|Real answer|e2a00000-0000-4000-8000-000000000002|true',
  'the real answer is saved with the admin as responder');
select extensions.lives_ok(
  $$insert into public.support_inquiries (id, user_id, category, subject, message, status, response, responded_by, responded_at)
    values ('e2a10000-0000-4000-8000-000000000005', auth.uid(), 'payment', 'Admin forged', 'Mine.',
            'resolved', 'Self answer', auth.uid(), now())$$,
  'an admin may insert their own inquiry');
select extensions.is(
  (select status || '|' || coalesce(response, '-') from public.support_inquiries
   where id = 'e2a10000-0000-4000-8000-000000000005'),
  'open|-', 'an admin''s own new inquiry starts open and unanswered too');

-- Trusted writers (the table owner here; definer functions and restores alike) keep their values.
reset role;
insert into public.support_inquiries (id, club_id, user_id, category, subject, message, status, response,
                                      responded_by, responded_at, created_at)
values ('e2a10000-0000-4000-8000-000000000006', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'e2a00000-0000-4000-8000-000000000001', 'other', 'Restored', 'From a backup.', 'resolved', 'Old answer',
        'e2a00000-0000-4000-8000-000000000002', '2026-01-02 10:00+08', '2026-01-01 09:00+08');
select extensions.is(
  (select status || '|' || response || '|' || (created_at = '2026-01-01 09:00+08')::text
   from public.support_inquiries where id = 'e2a10000-0000-4000-8000-000000000006'),
  'resolved|Old answer|true', 'rows written by the table owner keep the values given');

select * from extensions.finish();
rollback;
