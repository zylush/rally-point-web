// Local-only Gate 2 contract probe. --prepare never connects; --run requires
// separate owner approval and uses rollback-only transactions on 127.0.0.1.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
import pg from 'pg'
import { selectRows, snapshotRows } from './pg-query-rows.mjs'
import {
  assertFrozenBaseline, assertLegacyBaseline, assertLocalRunIntent, assertSqlSuite, parseTapResults,
} from './gate2-client-coexistence-guards.mjs'

const root = new URL('../../', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')
const hash = (value) => createHash('sha256').update(value).digest('hex')
const suites = [
  { name: 'legacy-expanded-backfilled', path: 'supabase/verification/gate2_legacy_client.sql' },
  { name: 'r9-repaired-pre-enforcement', path: 'supabase/verification/gate2_r9_client.sql' },
].map(({ name, path }) => {
  const sql = read(path)
  assertSqlSuite(sql)
  return { name, path, sql, sha256: hash(sql) }
})
const repairFiles = [
  ['20260922011918_tenant_table_grant_repair.sql', '1cad40c513767ec0ccfb138ff7202f7fddd8aef4de11212dbf84a39056afd3fe'],
  ['20260922163027_booking_rpc_alias_repair.sql', 'd1a4bb6c1473cebebe48560f272c5c2eabdbe70c48d6836c37754a72021d97d7'],
  ['20260922163830_booking_cancellation_command.sql', '8b466e22cd773a8ca66710ce28a13bf6589cfa52b3f9f6ef04ce32e85b7a7641'],
  ['20260922164128_rls_member_lookup_repair.sql', 'c79e917897381f3569d5995d9755aaa59f5dfb8767f8dd2f817936331fd5771e'],
  ['20260923053440_member_privacy_repair.sql', '14db7ec6e833d9d63dfd893c03e804e6db97f22db3317b0463114692b52c69ad'],
].map(([name, expected]) => {
  const sql = read(`supabase/migrations/${name}`)
  assert.equal(hash(sql), expected, `${name} differs from frozen release source`)
  return { name, sql, sha256: expected }
})

assert.ok(['--prepare', '--run'].includes(process.argv[2]) && process.argv.length === 3,
  'Use --prepare or --run')
if (process.argv[2] === '--prepare') {
  console.log(JSON.stringify({
    mode: 'prepare', databaseContacted: false,
    targetOnRun: '127.0.0.1:54322/postgres',
    suites: suites.map(({ name, path, sha256 }) => ({ name, path, sha256 })),
    repairs: repairFiles.map(({ name, sha256 }) => ({ name, sha256 })),
  }))
  process.exit(0)
}

const privateDirectory = new URL('docs/release-private/', root)
const candidateName = process.env.RALLY_GATE2_COMPATIBILITY_REPORT
const candidatePath = candidateName && /^gate2-client-coexistence-[0-9]{8}-[a-z0-9-]+\.json$/.test(candidateName)
  ? new URL(candidateName, privateDirectory) : null
const reportName = assertLocalRunIntent(process.env, candidatePath ? existsSync(candidatePath) : false)
const password = process.env.RALLY_GATE2_DB_PASSWORD
assert.ok(password, 'RALLY_GATE2_DB_PASSWORD is required for the local database')
const client = new pg.Client({
  host: '127.0.0.1', port: 54322, database: 'postgres', user: 'postgres', password,
  application_name: 'rally_gate2_rollback_only_compatibility',
})
const schemaSql = read('supabase/verification/schema_fingerprint.sql')
const grantsSql = read('supabase/verification/tenant_grant_snapshot.sql')
const inventorySql = read('supabase/verification/backup_content_inventory.sql')
const metadataSql = `select 'view' as kind, n.nspname || '.' || c.relname as name,
    pg_get_viewdef(c.oid,true) as definition, c.reloptions::text as options
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','private') and c.relkind='v'
  union all
  select 'function', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
    pg_get_functiondef(p.oid), p.proacl::text
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' order by kind,name`

async function assertTarget() {
  const versions = (await client.query('select version from supabase_migrations.schema_migrations order by version'))
    .rows.map((row) => row.version)
  const activity = (await client.query(`select count(*)::int as n from pg_stat_activity
    where datname = current_database() and pid <> pg_backend_pid() and backend_type = 'client backend'`)).rows[0].n
  const enforcement = (await client.query(`select count(*)::int as n from pg_constraint
    where conname = 'court_allocations_no_overlap'`)).rows[0].n
  assertLegacyBaseline(versions, activity, enforcement)
  return versions
}

async function snapshot() {
  await client.query('set local search_path = public, extensions')
  const state = snapshotRows({
    schema: await client.query(schemaSql),
    acl: await client.query(grantsSql),
    metadata: await client.query(metadataSql),
  })
  const data = selectRows(await client.query(inventorySql), 'content inventory')
  return { state, data }
}

async function inTransaction(action, readOnly = false) {
  await client.query(readOnly ? 'begin read only' : 'begin')
  try { return await action() }
  finally { await client.query('rollback') }
}

await client.connect()
try {
  const versions = await assertTarget()
  const baseline = await inTransaction(snapshot, true)
  const baselineMarker = baseline.state.schema.find((row) => row.category === '!fingerprint').details
  assertFrozenBaseline(baselineMarker, baseline.state.schema.length, baseline.data.length)
  const results = []
  for (const suite of suites) {
    const passed = await inTransaction(async () => {
      if (suite.name === 'r9-repaired-pre-enforcement') {
        for (const repair of repairFiles) await client.query(repair.sql)
        const enforcement = (await client.query(`select count(*)::int as n from pg_constraint
          where conname = 'court_allocations_no_overlap'`)).rows[0].n
        assert.equal(enforcement, 0, 'Enforcement appeared in pre-enforcement phase')
      }
      return parseTapResults(await client.query(suite.sql), suite.name)
    })
    results.push({ name: suite.name, passed, suiteSha256: suite.sha256 })
    console.log(JSON.stringify(results.at(-1)))
  }
  const postVersions = await assertTarget()
  const postflight = await inTransaction(snapshot, true)
  assert.ok(isDeepStrictEqual(postVersions, versions), 'Migration ledger changed during rehearsal')
  assert.ok(isDeepStrictEqual(postflight, baseline), 'Local schema, permissions, metadata, or data changed after rollback')
  const report = {
    target: '127.0.0.1:54322/postgres', versions, results,
    repairs: repairFiles.map(({ name, sha256 }) => ({ name, sha256 })),
    baselineFingerprint: baselineMarker,
    localBaselineUnchanged: true,
    scope: 'SQL-level representative client contracts; not browser or hosted acceptance',
  }
  writeFileSync(new URL(reportName, privateDirectory), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
  console.log('PASS: both client contract suites rolled back; local baseline unchanged')
} finally { await client.end() }
