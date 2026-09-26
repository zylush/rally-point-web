-- Local-only regression probe. No hosted target is accepted.
-- Reassign one existing synthetic charge to a DIFFERENT member in the same
-- club, then require the original member to be unable to read that charge.
-- ON_ERROR_STOP closes the connection on failure, rolling back this transaction.
begin;
set local statement_timeout = '15s';
set local lock_timeout = '5s';
set local role postgres;

do $preflight$
begin
  if current_database() <> 'rally_gate6_fixture_20260923'
     or not exists (select 1 from pg_constraint where conname = 'court_allocations_no_overlap') then
    raise exception 'probe requires the enforced disposable Gate 6 database';
  end if;
  if (select count(*) from public.transactions t join public.members m on m.id = t.member_id
      where t.id = '71000000-0000-4000-8900-000000000001'
        and t.club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
        and m.user_id = '91000000-0000-4000-8000-000000000001'
        and t.description like '%[tenant-fixture-v1]%') <> 1 then
    raise exception 'probe requires the original tagged member charge';
  end if;
  if (select count(*) from public.members where club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and user_id = '91000000-0000-4000-8000-000000000002') <> 1 then
    raise exception 'probe requires another same-club membership';
  end if;
end
$preflight$;

update public.transactions
set member_id = (select id from public.members
                where club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
                  and user_id = '91000000-0000-4000-8000-000000000002')
where id = '71000000-0000-4000-8900-000000000001';

set local role authenticated;
set local request.jwt.claim.sub = '91000000-0000-4000-8000-000000000001';

do $denied_access$
declare v_visible integer;
begin
  if private.current_club_role('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') is distinct from 'member'::public.user_role then
    raise exception 'probe identity must resolve to member';
  end if;
  select count(*) into v_visible from public.transactions
  where id = '71000000-0000-4000-8900-000000000001';
  if v_visible <> 0 then
    raise exception 'FAIL: ordinary member read % other-member financial row(s) in the same club after enforcement', v_visible;
  end if;
end
$denied_access$;
rollback;
