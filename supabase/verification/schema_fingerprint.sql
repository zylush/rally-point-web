-- Read-only public-schema fingerprint for migration-history reconciliation.
-- Returns canonical rows only; it does not inspect or emit application data.

with fingerprint as (
  select
    'table'::text as category,
    c.relname::text as identity,
    jsonb_build_object(
      'kind', c.relkind,
      'rls', c.relrowsecurity,
      'force_rls', c.relforcerowsecurity
    )::text as details
  from pg_catalog.pg_class as c
  join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')

  union all

  select
    'column',
    format('%I.%I', columns.table_name, columns.column_name),
    jsonb_build_object(
      'ordinal', columns.ordinal_position,
      'type', columns.data_type,
      'udt_schema', columns.udt_schema,
      'udt_name', columns.udt_name,
      'nullable', columns.is_nullable,
      'default', columns.column_default,
      'identity', columns.is_identity,
      'generated', columns.is_generated
    )::text
  from information_schema.columns
  where columns.table_schema = 'public'

  union all

  select
    'enum',
    t.typname,
    jsonb_agg(e.enumlabel order by e.enumsortorder)::text
  from pg_catalog.pg_type as t
  join pg_catalog.pg_namespace as n on n.oid = t.typnamespace
  join pg_catalog.pg_enum as e on e.enumtypid = t.oid
  where n.nspname = 'public'
  group by t.typname

  union all

  select
    'function',
    format('%I(%s)', p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid)),
    jsonb_build_object(
      'returns', pg_catalog.pg_get_function_result(p.oid),
      'language', l.lanname,
      'owner', owner_role.rolname,
      'security_definer', p.prosecdef,
      'volatility', p.provolatile,
      'config', p.proconfig,
      'execute_anon', pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE'),
      'execute_authenticated', pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'),
      'execute_auth_admin', pg_catalog.has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE'),
      'definition', regexp_replace(pg_catalog.pg_get_functiondef(p.oid), '\s+', ' ', 'g')
    )::text
  from pg_catalog.pg_proc as p
  join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
  join pg_catalog.pg_language as l on l.oid = p.prolang
  join pg_catalog.pg_roles as owner_role on owner_role.oid = p.proowner
  where n.nspname = 'public'

  union all

  select
    'trigger',
    format('%I.%I.%I', n.nspname, c.relname, t.tgname),
    jsonb_build_object(
      'enabled', t.tgenabled,
      'function', format('%I.%I', function_namespace.nspname, function_row.proname),
      'definition', regexp_replace(pg_catalog.pg_get_triggerdef(t.oid, true), '\s+', ' ', 'g')
    )::text
  from pg_catalog.pg_trigger as t
  join pg_catalog.pg_class as c on c.oid = t.tgrelid
  join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
  join pg_catalog.pg_proc as function_row on function_row.oid = t.tgfoid
  join pg_catalog.pg_namespace as function_namespace on function_namespace.oid = function_row.pronamespace
  where (n.nspname = 'public' or function_namespace.nspname = 'public')
    and not t.tgisinternal

  union all

  select
    'schema',
    schema_row.nspname,
    jsonb_build_object(
      'owner', owner_role.rolname,
      'usage_anon', pg_catalog.has_schema_privilege('anon', schema_row.oid, 'USAGE'),
      'usage_authenticated', pg_catalog.has_schema_privilege('authenticated', schema_row.oid, 'USAGE'),
      'create_anon', pg_catalog.has_schema_privilege('anon', schema_row.oid, 'CREATE'),
      'create_authenticated', pg_catalog.has_schema_privilege('authenticated', schema_row.oid, 'CREATE')
    )::text
  from pg_catalog.pg_namespace as schema_row
  join pg_catalog.pg_roles as owner_role on owner_role.oid = schema_row.nspowner
  where schema_row.nspname = 'public'

  union all

  select
    'policy',
    format('%I.%I', policies.tablename, policies.policyname),
    jsonb_build_object(
      'permissive', policies.permissive,
      'roles', policies.roles,
      'command', policies.cmd,
      'using', policies.qual,
      'with_check', policies.with_check
    )::text
  from pg_catalog.pg_policies as policies
  where policies.schemaname = 'public'

  union all

  select
    'grant',
    format('%I.%I:%I', grants.table_schema, grants.table_name, grants.grantee),
    jsonb_agg(grants.privilege_type order by grants.privilege_type)::text
  from information_schema.table_privileges as grants
  where grants.table_schema = 'public'
    and grants.grantee in ('PUBLIC', 'anon', 'authenticated')
  group by grants.table_schema, grants.table_name, grants.grantee

  union all

  select
    'constraint',
    format('%I.%I', c.relname, constraint_row.conname),
    jsonb_build_object(
      'type', constraint_row.contype,
      'definition', pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
    )::text
  from pg_catalog.pg_constraint as constraint_row
  join pg_catalog.pg_class as c on c.oid = constraint_row.conrelid
  join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
  where n.nspname = 'public'

  union all

  select
    'index',
    format('%I.%I', indexes.tablename, indexes.indexname),
    regexp_replace(indexes.indexdef, '\s+', ' ', 'g')
  from pg_catalog.pg_indexes as indexes
  where indexes.schemaname = 'public'
)
select category, identity, details
from fingerprint
order by category, identity, details;
