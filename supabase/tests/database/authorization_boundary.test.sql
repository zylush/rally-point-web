begin;

set local role postgres;

create extension if not exists pgtap with schema extensions;

set local search_path = public, extensions, pg_catalog;

select extensions.plan(11);

select extensions.ok(
  to_regprocedure('private.current_role()') is not null,
  'role lookup lives outside the exposed public schema'
);

select extensions.ok(
  to_regprocedure('public.current_role()') is null,
  'the exposed public role helper is removed'
);

select extensions.ok(
  not has_function_privilege('anon', 'public.handle_new_user()', 'execute'),
  'anonymous clients cannot execute the signup trigger function'
);

select extensions.ok(
  not has_function_privilege('authenticated', 'public.handle_new_user()', 'execute'),
  'signed-in clients cannot execute the signup trigger function'
);

insert into auth.users (id, email, raw_user_meta_data)
values (
  '11111111-1111-4111-8111-111111111111',
  'forged-admin@example.com',
  '{"full_name":"Forged Admin","role":"admin"}'::jsonb
);

select extensions.is(
  (select role::text from public.profiles where id = '11111111-1111-4111-8111-111111111111'),
  'member',
  'signup ignores a forged admin role in user metadata'
);

select extensions.is(
  (select count(*)::integer from public.members where user_id = '11111111-1111-4111-8111-111111111111'),
  1,
  'signup provisions exactly one member row'
);

select extensions.throws_ok(
  'insert into public.members (club_id, user_id, member_code, full_name, email, membership_type, status, join_date, expiry_date, qr_token) values (''aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'', ''11111111-1111-4111-8111-111111111111'', ''RP-DUPLICATE-USER'', ''Duplicate User'', ''duplicate@example.com'', ''standard'', ''active'', current_date, current_date + 30, ''q_duplicate_user'')',
  '23505',
  null,
  'member user_id uniqueness prevents duplicate provisioning'
);

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

select extensions.throws_ok(
  'update public.profiles set role = ''admin'' where id = ''11111111-1111-4111-8111-111111111111''',
  '42501',
  null,
  'a member cannot promote their own profile'
);

select extensions.throws_ok(
  'update public.profiles set full_name = ''Member Updated Name'' where id = ''11111111-1111-4111-8111-111111111111''',
  '42501',
  null,
  'profile identity is read-only through the client boundary'
);

set local role postgres;

insert into auth.users (id, email, raw_user_meta_data)
values (
  '22222222-2222-4222-8222-222222222222',
  'trusted-admin@example.com',
  '{"full_name":"Trusted Admin"}'::jsonb
);

update public.profiles set role = 'admin' where id = '22222222-2222-4222-8222-222222222222';
insert into public.club_staff_roles (club_id, user_id, role)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-4222-8222-222222222222', 'admin');

set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';

select extensions.throws_ok(
  'update public.profiles set role = ''staff'' where id = ''11111111-1111-4111-8111-111111111111''',
  '42501',
  null,
  'authorization role cannot be changed through the profiles table'
);

set local role postgres;

select extensions.is(
  (select role::text from public.get_current_access() where club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'admin',
  'the trusted club assignment resolves the admin role'
);

select * from extensions.finish();
rollback;
