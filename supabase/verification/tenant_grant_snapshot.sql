-- Read-only effective grants and recoverable ACL entries. No row contents.
with tables as (
  select c.oid, c.relname, c.relacl, c.relowner, c.relrowsecurity
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r','p','v')
), privileges as (
  select t.relname, r.name as role_name, p.name as privilege,
    has_table_privilege(r.name, t.oid, p.name) as allowed
  from tables t
  cross join (values ('anon'), ('authenticated'), ('service_role')) r(name)
  cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),
    ('REFERENCES'),('TRIGGER'),('TRUNCATE'),('MAINTAIN')) p(name)
), acl as (
  select t.relname, pg_get_userbyid(a.grantor) as grantor,
    case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee,
    a.privilege_type, a.is_grantable
  from tables t, lateral aclexplode(coalesce(t.relacl, acldefault('r',t.relowner))) a
), columns as (
  select t.relname, att.attname, att.attacl::text
  from tables t join pg_attribute att on att.attrelid = t.oid
  where att.attnum > 0 and not att.attisdropped and att.attacl is not null
)
select jsonb_build_object(
  'effective', (select jsonb_agg(to_jsonb(p) order by relname,role_name,privilege) from privileges p),
  'acl', (select jsonb_agg(to_jsonb(a) order by relname,grantee,privilege_type,grantor) from acl a),
  'column_acl', (select coalesce(jsonb_agg(to_jsonb(c) order by relname,attname),'[]') from columns c),
  'rls', (select jsonb_agg(jsonb_build_object('table',relname,'enabled',relrowsecurity) order by relname) from tables),
  'versions', (select jsonb_agg(version order by version) from supabase_migrations.schema_migrations)
) as snapshot;
