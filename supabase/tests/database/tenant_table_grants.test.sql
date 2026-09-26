-- Runs at both the repaired backfill boundary and after enforcement.
begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select extensions.plan(115);

create temp table grant_targets (name text primary key);
insert into grant_targets values
  ('clubs'), ('venues'), ('club_staff_roles'),
  ('staff_venue_grants'), ('court_allocations');
grant select on grant_targets to anon, authenticated;

-- Check effective permissions, including PUBLIC/inherited privileges, not just ACL text.
select extensions.is(
  has_table_privilege(r.name, format('public.%I', t.name), p.name),
  r.name = 'authenticated' and p.name = 'SELECT',
  format('%s %s on %s has exact expected access', r.name, p.name, t.name)
)
from grant_targets t
cross join (values ('anon'), ('authenticated')) r(name)
cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
  ('REFERENCES'), ('TRIGGER'), ('TRUNCATE'), ('MAINTAIN')) p(name)
order by t.name, r.name, p.name;

select extensions.ok(not exists (
  select 1 from pg_class c, lateral aclexplode(c.relacl) a
  where c.oid = format('public.%I', t.name)::regclass and a.grantee = 0
), t.name || ' has no PUBLIC grants') from grant_targets t order by t.name;

select extensions.ok(c.relrowsecurity, t.name || ' keeps RLS enabled')
from grant_targets t join pg_class c on c.oid = format('public.%I', t.name)::regclass
order by t.name;

select extensions.ok(not exists (
  select 1 from pg_attribute a, lateral aclexplode(a.attacl) acl
  where a.attrelid = format('public.%I', t.name)::regclass
    and acl.grantee in (0, 'anon'::regrole::oid, 'authenticated'::regrole::oid)
), t.name || ' has no column-grant bypass') from grant_targets t order by t.name;

set local role anon;
select extensions.throws_ok(format('select * from public.%I', name),
  '42501', null, name || ' denies anonymous SELECT') from grant_targets order by name;

set local role authenticated;
select extensions.throws_ok(format('insert into public.%I default values', name),
  '42501', null, name || ' denies direct INSERT') from grant_targets order by name;
select extensions.throws_ok(format('update public.%I set id = id where false', name),
  '42501', null, name || ' denies direct UPDATE')
from grant_targets where name not in ('club_staff_roles', 'staff_venue_grants') order by name;
select extensions.throws_ok(format('update public.%I set club_id = club_id where false', name),
  '42501', null, name || ' denies direct UPDATE')
from grant_targets where name in ('club_staff_roles', 'staff_venue_grants') order by name;
select extensions.throws_ok(format('delete from public.%I where false', name),
  '42501', null, name || ' denies direct DELETE') from grant_targets order by name;
select * from extensions.finish();
rollback;
