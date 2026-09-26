-- Denied-access preflight for the exact approved staging migration set.
-- Run only in the disposable legacy restore. All changes roll back, including
-- on failure (psql ON_ERROR_STOP closes the uncommitted connection).
\set ON_ERROR_STOP on
begin;
do $$
begin
  if current_database() <> 'rally_restore_verify_20260921' then
    raise exception 'Preflight is restricted to the disposable restore database';
  end if;
end;
$$;
\ir /tmp/rally_null_role_preflight/20260805094557_auth_rate_limits.sql
\ir /tmp/rally_null_role_preflight/20260921090000_tenant_ready.sql
\ir /tmp/rally_null_role_preflight/20260921110828_tenant_backfill.sql

-- A valid Auth identity without current club membership or staff assignment.
insert into auth.users (id, email, raw_user_meta_data)
values ('77777777-1111-4111-8111-111111111111',
        'unassigned-restore-test@example.invalid',
        '{"full_name":"Unassigned preflight identity"}'::jsonb);
delete from public.members
where user_id = '77777777-1111-4111-8111-111111111111';

set local role authenticated;
set local request.jwt.claim.sub = '77777777-1111-4111-8111-111111111111';
do $$
declare v_id uuid;
begin
  if private.current_club_role('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') is not null then
    raise exception 'Invalid fixture: caller must have no club role';
  end if;
  begin
    select id into v_id from public.admin_upsert_venue(
      null, 'unauthorized-preflight', 'Unauthorized preflight venue',
      'Asia/Manila', 6::smallint, 22::smallint, true
    );
  exception when others then
    if sqlerrm <> 'admin access required' then raise; end if;
    raise notice 'PASS: admin command rejects caller with NULL club role';
    return;
  end;
  raise exception 'FAIL: authenticated caller with NULL club role created venue % through admin_upsert_venue', v_id;
end;
$$;
rollback;
