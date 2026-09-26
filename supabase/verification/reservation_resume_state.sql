select md5(coalesce(string_agg(kind || chr(31) || identity || chr(31) || detail, chr(30)
  order by kind, identity, detail), '')) as snapshot_md5
from (
  select 'relation' as kind, n.nspname || '.' || c.relname as identity,
    jsonb_build_object('kind', c.relkind, 'owner', c.relowner, 'acl', c.relacl,
      'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity, 'options', c.reloptions,
      'view', case when c.relkind in ('v', 'm') then pg_get_viewdef(c.oid, false) end)::text as detail
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private')
  union all
  select 'column', n.nspname || '.' || c.relname || '.' || a.attname,
    jsonb_build_object('type', a.atttypid, 'mod', a.atttypmod, 'not_null', a.attnotnull,
      'acl', a.attacl, 'default', pg_get_expr(d.adbin, d.adrelid))::text
  from pg_attribute a join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where n.nspname in ('public', 'private') and a.attnum > 0 and not a.attisdropped
  union all
  select 'function', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
    jsonb_build_object('definition', pg_get_functiondef(p.oid), 'owner', p.proowner, 'acl', p.proacl)::text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and p.prokind in ('f', 'p')
  union all
  select 'constraint', n.nspname || '.' || c.relname || '.' || k.conname,
    jsonb_build_object('definition', pg_get_constraintdef(k.oid, false), 'validated', k.convalidated)::text
  from pg_constraint k join pg_class c on c.oid = k.conrelid
  join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'private')
  union all
  select 'policy', schemaname || '.' || tablename || '.' || policyname, to_jsonb(p)::text
  from pg_policies p where schemaname in ('public', 'private')
  union all
  select 'index', n.nspname || '.' || c.relname,
    jsonb_build_object('definition', pg_get_indexdef(c.oid), 'valid', i.indisvalid,
      'ready', i.indisready, 'live', i.indislive)::text
  from pg_index i join pg_class c on c.oid = i.indexrelid
  join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'private')
  union all
  select 'trigger', n.nspname || '.' || c.relname || '.' || t.tgname,
    jsonb_build_object('definition', pg_get_triggerdef(t.oid, false), 'enabled', t.tgenabled)::text
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'private')
  union all
  select 'schema', nspname, jsonb_build_object('owner', nspowner, 'acl', nspacl)::text
  from pg_namespace where nspname in ('public', 'private')
  union all
  select 'role', rolname, jsonb_build_object('super', rolsuper, 'inherit', rolinherit,
    'bypass_rls', rolbypassrls, 'login', rolcanlogin)::text from pg_roles
  union all
  select 'membership', roleid::text || ':' || member::text || ':' || grantor::text, to_jsonb(m)::text
  from pg_auth_members m
) resume_catalog;
