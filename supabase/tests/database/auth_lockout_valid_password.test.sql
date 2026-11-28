begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select extensions.plan(20);

-- Login lockout (20261128100100_login_lockout_valid_password.sql): once an account has 5 failed
-- sign-ins in 5 minutes, the right password is refused too (the same 429 answer), and the
-- failures are kept until they age out. Under the limit, the right password still clears them.
-- Only hashes of these made-up user ids are stored; no auth.users rows are needed.
--   e3...a1: locked by 5 recent failures
--   e3...a2: 4 recent failures (one under the limit)
--   e3...a3: 5 failures, the oldest already more than 5 minutes old
--   e3...a4: locked; its oldest failure is 4 minutes old (about 1 minute to wait)
--   e3...a5: no failures
create temporary table lockout_subject (id text primary key, hash text not null) on commit drop;
insert into lockout_subject (id, hash)
select 'e3000000-0000-4000-8000-0000000000a' || n,
       private.auth_rate_limit_hash('login-account', 'e3000000-0000-4000-8000-0000000000a' || n)
from generate_series(1, 5) n;
delete from private.auth_rate_limit_events where subject_hash in (select hash from lockout_subject);

insert into private.auth_rate_limit_events (action, subject_hash, attempted_at)
select 'login', s.hash, clock_timestamp() - interval '1 minute'
from lockout_subject s, generate_series(1, 5)
where s.id = 'e3000000-0000-4000-8000-0000000000a1';
insert into private.auth_rate_limit_events (action, subject_hash, attempted_at)
select 'login', s.hash, clock_timestamp() - interval '1 minute'
from lockout_subject s, generate_series(1, 4)
where s.id = 'e3000000-0000-4000-8000-0000000000a2';
insert into private.auth_rate_limit_events (action, subject_hash, attempted_at)
select 'login', s.hash, clock_timestamp() - interval '5 minutes 1 second'
from lockout_subject s where s.id = 'e3000000-0000-4000-8000-0000000000a3';
insert into private.auth_rate_limit_events (action, subject_hash, attempted_at)
select 'login', s.hash, clock_timestamp() - interval '1 minute'
from lockout_subject s, generate_series(1, 4)
where s.id = 'e3000000-0000-4000-8000-0000000000a3';
insert into private.auth_rate_limit_events (action, subject_hash, attempted_at)
select 'login', s.hash, clock_timestamp() - interval '4 minutes'
from lockout_subject s, generate_series(1, 5)
where s.id = 'e3000000-0000-4000-8000-0000000000a4';

create function pg_temp.login_failures(p_id text) returns integer
language sql as $$
  select count(*)::integer from private.auth_rate_limit_events e
  join lockout_subject s on s.hash = e.subject_hash
  where s.id = p_id and e.action = 'login'
$$;

-- ---------------------------------------------------------------------------
-- Structure and privileges
-- ---------------------------------------------------------------------------
select extensions.ok(
  (select p.prosecdef and 'search_path=""' = any(coalesce(p.proconfig, '{}')) and pg_get_userbyid(p.proowner) = 'postgres'
   from pg_proc p where p.oid = 'private.auth_rate_limit_password_verification(jsonb)'::regprocedure),
  'the password hook stays a definer function with an empty search path, owned by postgres');
select extensions.ok(
  has_function_privilege('supabase_auth_admin', 'private.auth_rate_limit_password_verification(jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'private.auth_rate_limit_password_verification(jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.auth_rate_limit_password_verification(jsonb)', 'EXECUTE')
  and not has_function_privilege('public', 'private.auth_rate_limit_password_verification(jsonb)', 'EXECUTE'),
  'only Supabase Auth runs the password hook, as before');
select extensions.ok(
  (select not p.prosecdef and 'search_path=""' = any(coalesce(p.proconfig, '{}')) and pg_get_userbyid(p.proowner) = 'postgres'
   from pg_proc p where p.oid = 'private.auth_rate_limit_status(text, text, timestamptz)'::regprocedure),
  'the lock check runs with the hook''s rights and an empty search path, owned by postgres');
select extensions.ok(
  not has_function_privilege('anon', 'private.auth_rate_limit_status(text, text, timestamptz)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.auth_rate_limit_status(text, text, timestamptz)', 'EXECUTE')
  and not has_function_privilege('public', 'private.auth_rate_limit_status(text, text, timestamptz)', 'EXECUTE'),
  'no API role can run the lock check');

-- ---------------------------------------------------------------------------
-- The lock check only reads
-- ---------------------------------------------------------------------------
select extensions.is(
  private.auth_rate_limit_status('login', (select hash from lockout_subject where id = 'e3000000-0000-4000-8000-0000000000a1'))
    ->> 'allowed',
  'false', 'the lock check sees a locked account');
select extensions.is(
  private.auth_rate_limit_status('login', (select hash from lockout_subject where id = 'e3000000-0000-4000-8000-0000000000a5'))
    ->> 'allowed',
  'true', 'the lock check sees an account with no failures as free');
select extensions.is(pg_temp.login_failures('e3000000-0000-4000-8000-0000000000a5'), 0,
  'and records nothing for it');

-- ---------------------------------------------------------------------------
-- The right password while locked
-- ---------------------------------------------------------------------------
select extensions.is(
  private.auth_rate_limit_password_verification(
    jsonb_build_object('user_id', 'e3000000-0000-4000-8000-0000000000a1', 'valid', true)) #>> '{error,http_code}',
  '429', 'after 5 failed sign-ins the right password is refused too');
select extensions.is(
  private.auth_rate_limit_password_verification(
    jsonb_build_object('user_id', 'e3000000-0000-4000-8000-0000000000a1', 'valid', true)) ->> 'decision',
  null, 'it does not continue to a session');
select extensions.is(pg_temp.login_failures('e3000000-0000-4000-8000-0000000000a1'), 5,
  'the failures are kept, and the refused right password adds none');
select extensions.is(
  private.auth_rate_limit_password_verification(
    jsonb_build_object('user_id', 'e3000000-0000-4000-8000-0000000000a1', 'valid', true)),
  private.auth_rate_limit_password_verification(
    jsonb_build_object('user_id', 'e3000000-0000-4000-8000-0000000000a1', 'valid', false)),
  'the right password gets the same answer as a wrong one while locked');
select extensions.is(
  private.auth_rate_limit_password_verification(
    jsonb_build_object('user_id', 'e3000000-0000-4000-8000-0000000000a1', 'valid', true)) #>> '{error,message}',
  'Too many attempts. Please try again in about 4 minutes.',
  'the message says how long to wait (oldest failure 1 minute ago)');
select extensions.is(
  private.auth_rate_limit_password_verification(
    jsonb_build_object('user_id', 'e3000000-0000-4000-8000-0000000000a4', 'valid', true)) #>> '{error,message}',
  'Too many attempts. Please try again in about 1 minute.',
  'the wait counts from the oldest failure (4 minutes ago)');

-- ---------------------------------------------------------------------------
-- The right password when not locked: as before
-- ---------------------------------------------------------------------------
select extensions.is(
  private.auth_rate_limit_password_verification(
    jsonb_build_object('user_id', 'e3000000-0000-4000-8000-0000000000a2', 'valid', true)) ->> 'decision',
  'continue', 'with 4 failures (one under the limit) the right password signs in');
select extensions.is(pg_temp.login_failures('e3000000-0000-4000-8000-0000000000a2'), 0,
  'and clears the failures');
select extensions.is(
  private.auth_rate_limit_password_verification(
    jsonb_build_object('user_id', 'e3000000-0000-4000-8000-0000000000a3', 'valid', true)) ->> 'decision',
  'continue', 'once the oldest of 5 failures is over 5 minutes old, the right password signs in');
select extensions.is(pg_temp.login_failures('e3000000-0000-4000-8000-0000000000a3'), 0,
  'and clears every failure of the account');
select extensions.is(
  private.auth_rate_limit_password_verification(
    jsonb_build_object('user_id', 'e3000000-0000-4000-8000-0000000000a5', 'valid', true)) ->> 'decision',
  'continue', 'an account with no failures signs in');

-- ---------------------------------------------------------------------------
-- Unchanged: wrong passwords and a missing user
-- ---------------------------------------------------------------------------
select extensions.is(
  private.auth_rate_limit_password_verification(
    jsonb_build_object('user_id', 'e3000000-0000-4000-8000-0000000000a5', 'valid', false)) ->> 'decision',
  'continue', 'a first wrong password is still allowed through to the usual "wrong password" answer');
select extensions.is(
  private.auth_rate_limit_password_verification(jsonb_build_object('valid', true)) #>> '{error,http_code}',
  '400', 'an event without a user is still refused');

select * from extensions.finish();
rollback;
