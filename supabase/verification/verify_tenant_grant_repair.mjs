// Disposable local database only. Never accepts a remote connection string.
import { readFileSync, readdirSync } from 'node:fs'
import pg from 'pg'

const root = new URL('../../', import.meta.url)
const sql = (path) => readFileSync(new URL(path, root), 'utf8')
const targets = 'public.clubs, public.venues, public.club_staff_roles, public.staff_venue_grants, public.court_allocations'
const client = new pg.Client({ host: '127.0.0.1', port: 54322,
  user: 'postgres', password: 'postgres', database: 'postgres' })
const red = process.argv.includes('--red')
const deferredEnforcement = process.argv.includes('--deferred-enforcement')
const files = readdirSync(new URL('supabase/migrations/', root))
const repairs = files.filter((name) => name.endsWith('_tenant_table_grant_repair.sql'))
if (!red && repairs.length !== 1) throw new Error('Expected exactly one grant repair migration')
const snapshotQuery = `select c.relname, c.relacl::text, c.relrowsecurity
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r','p','v')
    and c.relname not in ('clubs','venues','club_staff_roles','staff_venue_grants','court_allocations')
  order by c.relname`
let failed = false
await client.connect()
try {
  const { rows } = await client.query('select version from supabase_migrations.schema_migrations order by version')
  if (!rows.some((r) => r.version === '20260921110828') || rows.some((r) => r.version === '20260921111105')) {
    throw new Error('This fixture runner requires the disposable backfill boundary without enforcement')
  }
  for (const mode of deferredEnforcement ? ['deferred-enforcement'] : ['local', 'staging', 'public-inherited']) {
    await client.query('begin')
    try {
      const before = (await client.query(snapshotQuery)).rows
      if (mode !== 'local') {
        await client.query(`grant select, insert, update, delete, references, trigger, truncate on ${targets} to anon, authenticated`)
      }
      if (mode === 'public-inherited') await client.query(`grant all on ${targets} to public`)
      if (!red) {
        await client.query(sql(`supabase/migrations/${repairs[0]}`))
        // A second execution must be harmless; both applications stay in this rollback-only fixture.
        await client.query(sql(`supabase/migrations/${repairs[0]}`))
      }
      const after = (await client.query(snapshotQuery)).rows
      if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Legacy table/view ACL or RLS changed')
      if (deferredEnforcement) {
        // Model staging's future order, not merely clean filename-order replay.
        await client.query(sql('supabase/migrations/20260921111105_tenant_enforcement.sql'))
      }
      const result = await client.query(sql('supabase/tests/database/tenant_table_grants.test.sql'))
      const lines = result.flatMap((r) => r.rows.flatMap((row) => Object.values(row))).filter((v) => typeof v === 'string')
      const bad = lines.filter((line) => /^not ok|^# Looks like/i.test(line))
      const passed = lines.filter((line) => /^ok \d+/.test(line)).length
      console.log(JSON.stringify({ mode, passed, failed: lines.filter((line) => /^not ok/.test(line)).length,
        legacyAclUnchangedByRepair: true, failures: bad.slice(0, 2) }))
      if (bad.length || passed !== 115) failed = true
    } finally {
      await client.query('rollback')
    }
  }
} finally {
  await client.end()
}
process.exitCode = failed ? 1 : 0
