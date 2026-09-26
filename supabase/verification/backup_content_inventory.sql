-- Read-only content comparison. Emit counts and digests, never row contents.
-- Intended for the small, confirmed staging baseline and its restore rehearsal.
with inventories as materialized (
  select n.nspname as schema_name, c.relname as table_name,
    query_to_xml(format(
      'select count(*) as row_count, md5(coalesce(string_agg(to_jsonb(t)::text, chr(10) order by to_jsonb(t)::text collate "C"), '''')) as content_md5 from %I.%I t',
      n.nspname, c.relname
    ), false, true, '') as result
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private', 'auth', 'storage', 'supabase_migrations')
    and c.relkind in ('r', 'p')
)
select schema_name, table_name,
  (xpath('/row/row_count/text()', result))[1]::text::bigint as row_count,
  (xpath('/row/content_md5/text()', result))[1]::text as content_md5
from inventories
order by schema_name, table_name;
