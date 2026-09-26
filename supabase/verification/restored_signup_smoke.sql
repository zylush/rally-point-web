-- Local restore verification only; synthetic rows are always rolled back.
begin;
do $$
begin
  if current_database() <> 'rally_restore_verify_20260921' then
    raise exception 'Restore smoke test is restricted to the disposable database';
  end if;
end;
$$;

insert into auth.users (id, email, raw_user_meta_data)
values (
  '66666666-1111-4111-8111-111111111111',
  'restore-check@example.invalid',
  '{"full_name":"Restore Check","role":"admin"}'::jsonb
);

do $$
begin
  if (select role::text from public.profiles
      where id = '66666666-1111-4111-8111-111111111111') is distinct from 'member' then
    raise exception 'Restored signup did not create a member-only profile';
  end if;
  if (select count(*) from public.members
      where user_id = '66666666-1111-4111-8111-111111111111') <> 1 then
    raise exception 'Restored signup did not create exactly one membership';
  end if;
  raise notice 'PASS: restored signup creates exactly one member and ignores forged admin metadata';
end;
$$;
rollback;
