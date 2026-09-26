// Both deployment orders, using rollback-only transactions on the local backfill DB.
// Fixed loopback connection: no linked project or remote URL is accepted.
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { isDeepStrictEqual } from 'node:util'
import pg from 'pg'
import { selectRows, snapshotRows } from './pg-query-rows.mjs'

const VERIFY_DB_PORT = Number.parseInt(process.env.RALLY_VERIFY_DB_PORT ?? '54322', 10)
assert.ok(Number.isInteger(VERIFY_DB_PORT) && VERIFY_DB_PORT > 0 && VERIFY_DB_PORT <= 65_535,
  'RALLY_VERIFY_DB_PORT must be a valid local TCP port')

const root = new URL('../../', import.meta.url)
const reportName = process.env.RALLY_MIGRATION_ORDER_REPORT ?? 'deferred-enforcement-orders.json'
assert.match(reportName, /^deferred-enforcement-orders(?:-[0-9]{8}-[a-z0-9-]+)?\.json$/,
  'Report name must stay inside the private release evidence folder')
const output = new URL('docs/release-private/', root)
const reportPath = new URL(reportName, output)
assert.ok(!existsSync(reportPath), 'Refusing to overwrite migration-order evidence')
const read = (path) => readFileSync(new URL(path, root), 'utf8')
const enforcementName = '20260921111105_tenant_enforcement.sql'
const repairName = '20260922011918_tenant_table_grant_repair.sql'
const bookingRepairName = '20260922163027_booking_rpc_alias_repair.sql'
const cancellationName = '20260922163830_booking_cancellation_command.sql'
const memberLookupRepairName = '20260922164128_rls_member_lookup_repair.sql'
const privacyRepairName = '20260923053440_member_privacy_repair.sql'
const enforcement = read('supabase/migrations/' + enforcementName)
const repair = read('supabase/migrations/' + repairName)
const bookingRepair = read('supabase/migrations/' + bookingRepairName)
const cancellation = read('supabase/migrations/' + cancellationName)
const memberLookupRepair = read('supabase/migrations/' + memberLookupRepairName)
const privacyRepair = read('supabase/migrations/' + privacyRepairName)
const hash = (value) => createHash('sha256').update(value).digest('hex')
const client = new pg.Client({ host: '127.0.0.1', port: VERIFY_DB_PORT,
  user: 'postgres', password: 'postgres', database: 'postgres' })
const report = { migrationHashes: {
  [enforcementName]: hash(enforcement),
  [repairName]: hash(repair),
  [bookingRepairName]: hash(bookingRepair),
  [cancellationName]: hash(cancellation),
  [memberLookupRepairName]: hash(memberLookupRepair),
  [privacyRepairName]: hash(privacyRepair),
}, orders: [] }
const tests = readdirSync(new URL('supabase/tests/database/', root)).filter((n) => n.endsWith('.sql')).sort()
const metadataQuery = `select 'view' as kind, n.nspname || '.' || c.relname as name,
    pg_get_viewdef(c.oid,true) as definition, c.reloptions::text as options
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','private') and c.relkind='v'
  union all
  select 'function', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
    pg_get_functiondef(p.oid), p.proacl::text
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' order by kind,name`

async function snapshot() {
  await client.query('set local search_path = public, extensions')
  return snapshotRows({
    schema: await client.query(read('supabase/verification/schema_fingerprint.sql')),
    acl: await client.query(read('supabase/verification/tenant_grant_snapshot.sql')),
    metadata: await client.query(metadataQuery),
  })
}

async function runSqlTest(file, stage) {
  const wrapped = read('supabase/tests/database/' + file)
  assert.match(wrapped, /^(?:\s|--[^\n]*\n)*begin;/i, file + ' requires BEGIN wrapper')
  assert.match(wrapped, /rollback;\s*$/i, file + ' requires ROLLBACK wrapper')
  const body = wrapped.replace(/^(?:\s|--[^\n]*\n)*begin;/i, '').replace(/rollback;\s*$/i, '')
  await client.query('savepoint sql_test')
  try {
    const raw = await client.query(body)
    const lines = raw.flatMap((r) => r.rows.flatMap((row) => Object.values(row))).filter((v) => typeof v === 'string')
    assert.deepEqual(lines.filter((line) => /^not ok|^# Looks like/i.test(line)), [], `${stage}: ${file}`)
    const plan = lines.filter((line) => /^1\.\.\d+$/.test(line))
    assert.equal(plan.length, 1, file + ' TAP plan')
    const passed = lines.filter((line) => /^ok \d+/.test(line)).length
    assert.equal(passed, Number(plan[0].slice(3)), file + ' TAP count')
    return { file, passed }
  } finally {
    await client.query('rollback to savepoint sql_test')
    await client.query('release savepoint sql_test')
  }
}
await client.connect()
try {
  const versions = (await client.query('select version from supabase_migrations.schema_migrations order by version')).rows.map((r) => r.version)
  assert.deepEqual(versions, ['001','002','003','004','20260803125450','20260805094557','20260921090000','20260921110828'])
  const otherClients = (await client.query(`select count(*)::int as n from pg_stat_activity
    where datname = current_database() and pid <> pg_backend_pid() and backend_type = 'client backend'`)).rows[0].n
  assert.equal(otherClients, 0, 'Local backfill database has another active client')
  await client.query('begin')
  const baseline = await snapshot()
  const contentBefore = selectRows(await client.query(read('supabase/verification/backup_content_inventory.sql')), 'baseline content inventory')
  await client.query('rollback')
  let firstState
  for (const order of [
    'enforcement-then-forward-repairs',
    'forward-repairs-then-enforcement',
  ]) {
    await client.query('begin')
    try {
      const statements = order.startsWith('enforcement')
        ? [enforcement, repair, bookingRepair, cancellation, memberLookupRepair, privacyRepair]
        : [repair, bookingRepair, cancellation, memberLookupRepair, privacyRepair, enforcement]
      for (const statement of statements) {
        await client.query(statement)
        if (statement === privacyRepair && !order.startsWith('enforcement')) {
          // Prove the forward repair also fences legacy permissive policies,
          // without pretending that the later enforcement has already run.
          const privileges = (await client.query(read('supabase/verification/tenant_grant_snapshot.sql'))).rows[0].snapshot
          const beforePrivileges = baseline.acl[0].snapshot
          const legacyTables = ['bookings', 'court_sessions', 'members', 'transactions']
          const writes = (entries) => entries.filter((row) => legacyTables.includes(row.relname)
            && ['INSERT','UPDATE','DELETE'].includes(row.privilege))
          assert.deepEqual(writes(privileges.effective), writes(beforePrivileges.effective), 'Legacy table write grants remain unchanged')
          assert.equal((await client.query("select count(*)::int as n from pg_constraint where conname = 'court_allocations_no_overlap'")).rows[0].n, 0)
          await client.query('savepoint privacy_compatibility')
          await client.query(read('supabase/seed.sql'))
          report.preEnforcementPrivacy = await runSqlTest('same_club_privacy.test.sql', 'forward repair before enforcement')
          await client.query('rollback to savepoint privacy_compatibility')
          await client.query('release savepoint privacy_compatibility')
        }
      }
      const state = await snapshot()
      if (firstState) assert.ok(isDeepStrictEqual(state, firstState), 'Both orders must converge to identical schema, effective grants, views, and private helpers')
      else firstState = state
      await client.query(read('supabase/seed.sql'))
      const results = []
      for (const file of tests) {
        results.push(await runSqlTest(file, order))
      }
      const result = { order, tests: results, passed: results.reduce((n, r) => n + r.passed, 0),
        schemaFingerprint: state.schema.find((r) => r.category === '!fingerprint').details }
      report.orders.push(result)
      console.log(JSON.stringify(result))
    } finally { await client.query('rollback') }
  }
  await client.query('begin')
  assert.deepEqual(await snapshot(), baseline, 'Local schema and ledger must be unchanged after rollback')
  assert.deepEqual(selectRows(await client.query(read('supabase/verification/backup_content_inventory.sql')), 'postflight content inventory'), contentBefore,
    'All local application/Auth/Storage/migration data must be unchanged after rollback')
  await client.query('rollback')
  report.identicalFinalState = true
  report.localBaselineUnchanged = true
  mkdirSync(output, { recursive: true })
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
  console.log('PASS: both orders converge; local schema, ledger, and data restored; no remote connection used')
} finally { await client.end() }
