-- Login lockout: a locked account stays locked, even for the right password.
--
-- Security fix (owner-approved, 2026-11-28). private.auth_rate_limit_password_verification is the
-- Supabase Auth password-verification hook (supabase/config.toml,
-- [auth.hook.password_verification_attempt]). After 5 failed sign-ins in 5 minutes it refuses
-- further wrong passwords with 429, but a valid password cleared the failures and went through
-- before the lock was looked at. So an attacker could keep guessing past the limit (every wrong
-- guess got 429, the right one signed in), which made the limit no limit at all.
--
-- Now, when Supabase Auth reports a valid password, the hook first looks at the lock without
-- recording anything (private.auth_rate_limit_status, below): the same rule as
-- private.auth_rate_limit_check (5 attempts in a rolling 5 minutes; retry once the oldest of them
-- is 5 minutes old). A locked account gets the same 429 answer as a wrong password, and its
-- failures are kept until they age out. An account that is not locked clears its failures and
-- signs in, as before. Wrong passwords are handled exactly as before.
--
-- Trade-off: anyone who knows an account's email can keep that account locked by repeating
-- 5 wrong guesses every 5 minutes; the owner's right password no longer gets through meanwhile.
-- (The password-reset email does not go through this hook.)
--
-- The hook keeps its signature, definer rights, empty search path, owner and grants (only
-- supabase_auth_admin may run it; create or replace keeps them). The helper is private, runs with
-- the caller's rights (the hook's), and no API role may run it. The September migration
-- 20260805094557_auth_rate_limits.sql and its pinned suite are unchanged.

create or replace function private.auth_rate_limit_status(
  p_action text,
  p_subject_hash text,
  p_at timestamptz default pg_catalog.clock_timestamp()
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_attempt_count integer;
  v_oldest_attempt timestamptz;
begin
  if p_action not in ('login', 'signup') then
    raise exception using
      errcode = '22023',
      message = 'Unsupported authentication rate-limit action';
  end if;

  if p_subject_hash !~ '^[0-9a-f]{64}$' then
    raise exception using
      errcode = '22023',
      message = 'Invalid authentication rate-limit subject';
  end if;

  -- The same lock as private.auth_rate_limit_check, so a failure being recorded at this moment
  -- is counted.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_action || ':' || p_subject_hash, 0)
  );

  select
    count(*)::integer,
    min(attempted_at)
  into
    v_attempt_count,
    v_oldest_attempt
  from private.auth_rate_limit_events
  where action = p_action
    and subject_hash = p_subject_hash
    and attempted_at > p_at - interval '5 minutes';

  if v_attempt_count >= 5 then
    return pg_catalog.jsonb_build_object(
      'allowed', false,
      'retry_after_seconds', greatest(
        1,
        ceil(
          extract(epoch from (v_oldest_attempt + interval '5 minutes' - p_at))
        )::integer
      )
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'allowed', true,
    'retry_after_seconds', 0
  );
end;
$$;

create or replace function private.auth_rate_limit_password_verification(
  event jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id text;
  v_subject_hash text;
  v_result jsonb;
  v_retry_after_seconds integer;
begin
  v_user_id := nullif(btrim(event ->> 'user_id'), '');

  if v_user_id is null then
    return pg_catalog.jsonb_build_object(
      'error',
      pg_catalog.jsonb_build_object(
        'http_code', 400,
        'message', 'Unable to sign in. Please try again.'
      )
    );
  end if;

  v_subject_hash := private.auth_rate_limit_hash('login-account', v_user_id);

  if event -> 'valid' = 'true'::jsonb then
    -- Supabase Auth has already verified the password. A locked account stays locked, even for
    -- the right password: look without recording anything, and keep the failures. Otherwise a
    -- valid password clears prior failures before issuing the session, as recommended for this
    -- hook.
    v_result := private.auth_rate_limit_status(
      'login',
      v_subject_hash,
      pg_catalog.clock_timestamp()
    );

    if (v_result ->> 'allowed')::boolean then
      delete from private.auth_rate_limit_events
      where action = 'login'
        and subject_hash = v_subject_hash;

      return pg_catalog.jsonb_build_object('decision', 'continue');
    end if;
  else
    v_result := private.auth_rate_limit_check(
      'login',
      v_subject_hash,
      pg_catalog.clock_timestamp()
    );

    if (v_result ->> 'allowed')::boolean then
      return pg_catalog.jsonb_build_object('decision', 'continue');
    end if;
  end if;

  v_retry_after_seconds := (v_result ->> 'retry_after_seconds')::integer;

  return pg_catalog.jsonb_build_object(
    'error',
    pg_catalog.jsonb_build_object(
      'http_code', 429,
      'message', private.auth_rate_limit_message(v_retry_after_seconds)
    )
  );
end;
$$;

alter function private.auth_rate_limit_status(text, text, timestamptz) owner to postgres;
alter function private.auth_rate_limit_password_verification(jsonb) owner to postgres;

revoke all on function private.auth_rate_limit_status(text, text, timestamptz) from public;
revoke all on function private.auth_rate_limit_status(text, text, timestamptz) from anon;
revoke all on function private.auth_rate_limit_status(text, text, timestamptz) from authenticated;

comment on function private.auth_rate_limit_status(text, text, timestamptz) is
  'Read-only twin of auth_rate_limit_check: whether the subject is rate-limited now, recording nothing. Used by the password-verification hook for valid passwords.';
