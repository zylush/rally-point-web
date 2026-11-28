begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select extensions.plan(13);

-- New member codes start with BR- (bRineLy); the functions otherwise keep their settings.

-- 1-4: every code-making function uses the new prefix and no longer the old one.
select extensions.ok(
  pg_get_functiondef(p.oid) like '%''BR-''%' and pg_get_functiondef(p.oid) not like '%''RP-''%',
  format('%s makes BR- codes', p.oid::regprocedure)
)
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('handle_new_user', 'admin_upsert_member', 'join_club', 'join_club_as_player')
order by p.proname;

-- 5-8: each is still security definer with a fixed search_path.
select extensions.ok(
  p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'),
  format('%s stays security definer with a fixed search_path', p.oid::regprocedure)
)
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('handle_new_user', 'admin_upsert_member', 'join_club', 'join_club_as_player')
order by p.proname;

-- 9-12: each is still owned by postgres.
select extensions.is(
  pg_get_userbyid(p.proowner)::text, 'postgres',
  format('%s is owned by postgres', p.oid::regprocedure)
)
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('handle_new_user', 'admin_upsert_member', 'join_club', 'join_club_as_player')
order by p.proname;

-- 13: a new sign-up gets a BR- code at the default club.
insert into auth.users (id, email, raw_user_meta_data)
values ('c8000000-0000-4000-8000-000000000001', 'br-prefix@fixture.invalid', jsonb_build_object('full_name', 'Prefix Player'));

select extensions.ok(
  (select member_code from public.members where user_id = 'c8000000-0000-4000-8000-000000000001') ~ '^BR-[0-9A-F]{8}$',
  'a new sign-up gets a BR- member code'
);

select * from extensions.finish();
rollback;
