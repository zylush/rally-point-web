-- Read-only recovery supplement: Supabase's filtered dump assumes platform ACL defaults.
-- Capture exact object ACLs for replay AFTER that dump in a disposable rehearsal.
with objects as (
  select 'TABLE' as kind, format('%I.%I',n.nspname,c.relname) as identity,
    coalesce(c.relacl,acldefault('r',c.relowner)) as acl
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','private') and c.relkind in ('r','p','v')
  union all
  select 'FUNCTION', format('%I.%I(%s)',n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),
    coalesce(p.proacl,acldefault('f',p.proowner))
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private')
  union all
  select 'SCHEMA',quote_ident(n.nspname),coalesce(n.nspacl,acldefault('n',n.nspowner))
  from pg_namespace n where n.nspname in ('public','private')
), commands as (
  select kind,identity,0 as seq,
    format('REVOKE ALL ON %s %s FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, postgres;',kind,identity) as sql
  from objects
  union all
  select kind,identity,1,
    format('GRANT %s ON %s %s TO %s%s;',a.privilege_type,kind,identity,
      case when a.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(a.grantee)) end,
      case when a.is_grantable then ' WITH GRANT OPTION' else '' end)
  from objects o, lateral aclexplode(o.acl) a
)
select string_agg(sql,chr(10) order by kind,identity,seq,sql) as restore_sql from commands;
