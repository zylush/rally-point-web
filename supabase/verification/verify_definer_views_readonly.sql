-- Read-only regression for the intentionally owner-executed admin views.
-- Run only against the populated disposable Gate 6 fixture. Never against a
-- linked staging or production database.
\set ON_ERROR_STOP on

begin read only;

do $assert$
begin
  if current_database() <> 'rally_gate6_fixture_20260923' then
    raise exception 'wrong database for definer-view regression';
  end if;
  if (select count(*) from public.members
      where club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> 3
     or (select count(*) from public.club_staff_roles
         where club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
           and is_active) <> 2
     or not exists (select 1 from public.members
                    where club_id <> 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') then
    raise exception 'populated Gate 6 fixture is missing or changed';
  end if;
  if not has_table_privilege('authenticated', 'public.member_admin', 'select')
     or not has_table_privilege('authenticated', 'public.staff_accounts', 'select')
     or has_table_privilege('anon', 'public.member_admin', 'select')
     or has_table_privilege('anon', 'public.staff_accounts', 'select') then
    raise exception 'admin-view grants differ from the approved boundary';
  end if;
end
$assert$;

set local role authenticated;
set local request.jwt.claim.sub = '91000000-0000-4000-8000-000000000001';
do $assert$
begin
  if (select count(*) from public.member_admin) <> 0
     or (select count(*) from public.staff_accounts) <> 0 then
    raise exception 'Rally member can read admin-only views';
  end if;
end
$assert$;

set local request.jwt.claim.sub = '91000000-0000-4000-8000-000000000003';
do $assert$
begin
  if (select count(*) from public.member_admin) <> 0
     or (select count(*) from public.staff_accounts) <> 0 then
    raise exception 'Rally staff can read admin-only views';
  end if;
end
$assert$;

set local request.jwt.claim.sub = '91000000-0000-4000-8000-000000000002';
do $assert$
begin
  if (select count(*) from public.member_admin) <> 3
     or (select count(*) from public.staff_accounts) <> 2
     or exists (select 1 from public.member_admin
                where club_id <> 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
     or exists (select 1 from public.staff_accounts
                where club_id <> 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') then
    raise exception 'Rally admin view scope is incorrect';
  end if;
end
$assert$;

set local request.jwt.claim.sub = '92000000-0000-4000-8000-000000000001';
do $assert$
begin
  if (select count(*) from public.member_admin) <> 0
     or (select count(*) from public.staff_accounts) <> 0 then
    raise exception 'second-club member can read Rally admin views';
  end if;
end
$assert$;

set local request.jwt.claim.sub = '92000000-0000-4000-8000-000000000002';
do $assert$
begin
  if (select count(*) from public.member_admin) <> 0
     or (select count(*) from public.staff_accounts) <> 0 then
    raise exception 'second-club admin can read Rally admin views';
  end if;
end
$assert$;

set local request.jwt.claim.sub = '92000000-0000-4000-8000-000000000003';
do $assert$
begin
  if (select count(*) from public.member_admin) <> 0
     or (select count(*) from public.staff_accounts) <> 0 then
    raise exception 'second-club staff can read Rally admin views';
  end if;
end
$assert$;

set local request.jwt.claim.sub = '';
do $assert$
begin
  if (select count(*) from public.member_admin) <> 0
     or (select count(*) from public.staff_accounts) <> 0 then
    raise exception 'missing identity can read admin-only views';
  end if;
end
$assert$;

set local role anon;
do $assert$
begin
  begin
    perform count(*) from public.member_admin;
    raise exception 'anonymous member_admin read unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform count(*) from public.staff_accounts;
    raise exception 'anonymous staff_accounts read unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;
end
$assert$;

rollback;
