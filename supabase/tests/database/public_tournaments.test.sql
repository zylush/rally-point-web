begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select extensions.plan(11);

-- Fixture: both seeded clubs active. Gensan has a live, an upcoming and a cancelled
-- tournament; the second club has a finished one.
update public.club_accounts set status = 'active'
where club_id in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
select set_config('test.club_b_city',
  coalesce((select city from public.club_accounts where club_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), ''), true);

insert into public.club_tournaments (id, club_id, title, format, team_size, status, created_at) values
  ('3d000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Gensan Live Open', 'random_queue', 2, 'live', now() - interval '3 days'),
  ('3d000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Gensan Next Week', 'single_elimination', 1, 'setup', now() - interval '1 day'),
  ('3d000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Gensan Called Off', 'random_queue', 2, 'cancelled', now()),
  ('3d000000-0000-4000-8000-000000000004', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Second Club Cup', 'single_elimination', 2, 'completed', now() - interval '2 days');

-- 1-2: definer, pinned search path, owner, grants
select extensions.ok(
  (select p.prosecdef and 'search_path=""' = any(p.proconfig) and pg_get_userbyid(p.proowner) = 'postgres'
   from pg_proc p where p.oid = to_regprocedure('public.list_public_tournaments(text, integer)')),
  'list_public_tournaments is a definer function with an empty search path, owned by postgres');

select extensions.ok(
  has_function_privilege('anon', 'public.list_public_tournaments(text, integer)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.list_public_tournaments(text, integer)', 'EXECUTE')
  and not has_function_privilege('public', 'public.list_public_tournaments(text, integer)', 'EXECUTE'),
  'visitors and signed-in callers can list tournaments; PUBLIC has no grant');

-- 3-9: as a visitor, with no club header
select set_config('request.headers', '', true);
set local role anon;
select set_config('request.jwt.claim.sub', '', true);

select extensions.is(
  jsonb_array_length(public.list_public_tournaments()),
  3, 'lists tournaments from every active club, leaving out cancelled ones');

select extensions.is(
  (select array_agg(e ->> 'title' order by ord) from jsonb_array_elements(public.list_public_tournaments()) with ordinality x(e, ord)),
  array['Gensan Live Open', 'Gensan Next Week', 'Second Club Cup'],
  'live first, then upcoming, then finished');

select extensions.is(
  (select e -> 'club' from jsonb_array_elements(public.list_public_tournaments()) e where e ->> 'title' = 'Second Club Cup'),
  jsonb_build_object('slug', 'synthetic-second-club', 'name', 'Synthetic Second Club',
    'city', nullif(current_setting('test.club_b_city'), '')),
  'each tournament names its club: slug, name and city only');

select extensions.is(
  (select array_agg(e ->> 'title') from jsonb_array_elements(public.list_public_tournaments('LIVE')) e),
  array['Gensan Live Open'], 'a status filter (any case) narrows the list');

select extensions.throws_ok(
  $$select public.list_public_tournaments('cancelled')$$,
  '22023', null, 'cancelled and unknown statuses are refused');

select extensions.is(
  jsonb_array_length(public.list_public_tournaments(null, 1)), 1, 'the limit is applied');

select extensions.ok(
  not exists (
    select 1 from jsonb_array_elements(public.list_public_tournaments(null, 500)) e
    where e ?| array['email', 'phone', 'member_code', 'qr_token', 'user_id', 'created_by']),
  'no contact, code or account keys in the public list');

-- 10-11: clubs that are not active drop out
set local role postgres;
update public.club_accounts set status = 'suspended' where club_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
set local role anon;
select extensions.is(
  (select array_agg(e ->> 'title' order by ord) from jsonb_array_elements(public.list_public_tournaments()) with ordinality x(e, ord)),
  array['Gensan Live Open', 'Gensan Next Week'], 'a suspended club''s tournaments are not listed');

set local role postgres;
update public.club_accounts set status = 'active' where club_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
update public.clubs set is_active = false where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
set local role anon;
select extensions.is(
  jsonb_array_length(public.list_public_tournaments()), 2, 'an inactive club''s tournaments are not listed');

select * from extensions.finish();
rollback;
