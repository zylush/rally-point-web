-- Read-only target inventory for release-gate reconciliation.
-- Returns server identity, migration ledger, and exact row counts without
-- creating objects or exposing application row contents.

select
  current_database() as database_name,
  current_setting('server_version') as server_version,
  current_setting('TimeZone') as timezone;

select version, name
from supabase_migrations.schema_migrations
order by version;

select
  c.relname as table_name,
  (
    xpath(
      '/row/row_count/text()',
      query_to_xml(
        format('select count(*) as row_count from %I.%I', n.nspname, c.relname),
        false,
        true,
        ''
      )
    )
  )[1]::text::bigint as row_count
from pg_catalog.pg_class as c
join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
order by c.relname;
