-- Logical restore comparison: text identities must never truncate to pg_catalog.name.
-- Rank live columns so removed physical slots do not change logical order.
-- Read-only, portable catalog evidence; no object OIDs or table contents.
set search_path = public, extensions;
with objects as (
  select 'schema' as kind, n.nspname::text as identity,
    jsonb_build_object('owner',pg_get_userbyid(n.nspowner),'acl',
      (select jsonb_agg(jsonb_build_array(pg_get_userbyid(a.grantor),case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,a.privilege_type,a.is_grantable) order by a.grantee::regrole::text,a.privilege_type)
       from aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a)) as details
  from pg_namespace n where n.nspname in ('public','private','auth','storage','supabase_migrations')
  union all
  select 'relation', format('%I.%I',n.nspname,c.relname),
    jsonb_build_object('kind',c.relkind,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'force',c.relforcerowsecurity,'options',c.reloptions,
      'view',case when c.relkind in ('v','m') then pg_get_viewdef(c.oid,true) end,
      'acl',(select jsonb_agg(jsonb_build_array(pg_get_userbyid(a.grantor),case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,a.privilege_type,a.is_grantable) order by a.grantee::regrole::text,a.privilege_type)
       from aclexplode(coalesce(c.relacl,acldefault(case when c.relkind='S' then 'S'::"char" else 'r'::"char" end,c.relowner))) a))
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','private','auth','storage','supabase_migrations') and c.relkind in ('r','p','v','m','S')
  union all
  select 'column',format('%I.%I.%I',n.nspname,c.relname,a.attname),
    jsonb_build_object('position',row_number() over (partition by a.attrelid order by a.attnum),'type',format_type(a.atttypid,a.atttypmod),'nullable',not a.attnotnull,
      'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated,'acl',a.attacl::text)
  from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
    left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where n.nspname in ('public','private','auth','storage','supabase_migrations') and c.relkind in ('r','p','v','m') and a.attnum>0 and not a.attisdropped
  union all
  select 'function',format('%I.%I(%s)',n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),
    jsonb_build_object('definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),
      'acl',(select jsonb_agg(jsonb_build_array(pg_get_userbyid(a.grantor),case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,a.privilege_type,a.is_grantable) order by a.grantee::regrole::text,a.privilege_type)
       from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a))
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private','auth','storage','supabase_migrations') and p.prokind in ('f','p')
  union all
  select 'constraint',format('%I.%I.%I',n.nspname,c.relname,k.conname),jsonb_build_object('definition',pg_get_constraintdef(k.oid,true),'validated',k.convalidated)
  from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','private','auth','storage','supabase_migrations')
  union all
  select 'index',format('%I.%I',schemaname,indexname),to_jsonb(indexdef) from pg_indexes where schemaname in ('public','private','auth','storage','supabase_migrations')
  union all
  select 'trigger',format('%I.%I.%I',n.nspname,c.relname,t.tgname),jsonb_build_object('definition',pg_get_triggerdef(t.oid,true),'enabled',t.tgenabled)
  from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','private','auth','storage','supabase_migrations') and not t.tgisinternal
  union all
  select 'policy',format('%I.%I.%I',schemaname,tablename,policyname),to_jsonb(p) from pg_policies p where schemaname in ('public','private','auth','storage','supabase_migrations')
  union all
  select 'default_acl',format('%I:%I:%s',pg_get_userbyid(d.defaclrole),coalesce(n.nspname,'*'),d.defaclobjtype),
    (select jsonb_agg(jsonb_build_array(pg_get_userbyid(a.grantor),case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,a.privilege_type,a.is_grantable) order by a.grantee::regrole::text,a.privilege_type)
     from aclexplode(d.defaclacl) a)
  from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace
  where n.nspname in ('public','private','auth','storage','supabase_migrations')
)
select coalesce(jsonb_agg(to_jsonb(o) order by kind,identity),'[]') as objects from objects o;
