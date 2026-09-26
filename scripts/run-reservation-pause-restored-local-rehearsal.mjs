// One separately approved rehearsal on the restored disposable local database.
// --verify-local is filesystem-only; --verify-readonly-local reads only;
// --execute-approved requires separate approval and always rolls back.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import pg from 'pg'
import { verifyCaptureFiles } from './staging-pause-restore-checks.mjs'
import { selectRows } from '../supabase/verification/pg-query-rows.mjs'
import { verifyReservationPausePostflight } from './reservation-pause-postflight-checks.mjs'
import { localPauseMode, unwrapCapturedReadOnly,
  verifyLocalPauseTarget, verifyRolledBackPause,
  validateLocalContainerPassword, normalizeLocalInventory,
  normalizeLocalActivity } from './reservation-pause-local-rehearsal-checks.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const backup = join(root, 'docs/release-private/staging-pause-backup-20260926-r1')
const restore = join(root, 'docs/release-private/staging-pause-restore-20260926-r1')
const pausePackage = join(root, 'docs/release-private/staging-reservation-pause-20260926-r1')
const scratch = 'rally_pause_backup_restore_20260926'
const pauseVersion = '20260925174111'
const pauseName = `${pauseVersion}_reservation_write_pause.sql`
const manifestHash = 'a5cb6805b281f356bbc31ca857dd2e55fdf473eb33ebe0c0282701a1a2651d0d'
const restoreHash = 'e9c1717958f20899ff4dcd4d2d773b56061a57c94fdc974ce2bba4f7f9172fa4'
const pausePackageHash = '7f8c7f5193c2484b8d6a9b751e120524f67ce27b09c4558ef3b062e695ecd902'
const pauseHash = 'f5a03d8c294efc7902c195f84eeee0af97b81377b5be2a5ccba9243d5e6a44ef'
const auditHash = '4c90aa24f59028f3944ed6297e644f69081417d77774a2b0733f8494252b4e5b'
const labels = ['fingerprint', 'inventory', 'catalog', 'grants', 'sequences', 'activity']
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const hash = path => sha(readFileSync(path))
const json = path => JSON.parse(readFileSync(path, 'utf8'))
const captured = name => join(backup, name)

assert.equal(process.argv.length, 3, 'Use one verification mode')
const mode = localPauseMode(process.argv[2], process.env.RALLY_PAUSE_RESTORE_LOCAL_APPROVED)
assert.equal(hash(captured('capture_manifest.json')), manifestHash, 'Frozen capture manifest changed')
assert.equal(hash(join(restore, 'result.json')), restoreHash, 'Verified restore result changed')
assert.ok(!existsSync(join(restore, 'STOP.json')), 'Restore STOP evidence exists')
assert.equal(hash(join(pausePackage, 'manifest.json')), pausePackageHash,
  'Frozen pause package changed')
const pausePath = join(pausePackage, 'database/supabase/migrations', pauseName)
const auditPath = join(pausePackage, 'checks/reservation_write_pause_readonly.sql')
assert.equal(hash(pausePath), pauseHash, 'Frozen pause migration changed')
assert.equal(hash(auditPath), auditHash, 'Frozen pause audit changed')
const manifest = json(captured('capture_manifest.json'))
verifyCaptureFiles(manifest, name => readFileSync(captured(name)))
const restoreResult = json(join(restore, 'result.json'))
assert.equal(restoreResult.result, 'PASS')
assert.equal(restoreResult.database, scratch)
assert.equal(restoreResult.captureManifestSha256, manifestHash)
assert.equal(restoreResult.stagingContacted, false)
assert.equal(restoreResult.stagingChanged, false)
const packageCheck = spawnSync(process.execPath,
  ['scripts/reservation-pause-package.mjs', '--verify'],
  { cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'] })
assert.equal(packageCheck.status, 0, 'Frozen pause package verification failed')
const packageResult = JSON.parse(packageCheck.stdout)
assert.equal(packageResult.result, 'PASS')
assert.equal(packageResult.pendingMigration, pauseName)
assert.equal(packageResult.enforcementExcluded, true)
const querySql = Object.fromEntries(labels.map(label => [label,
  unwrapCapturedReadOnly(readFileSync(captured(`before_${label}.sql`), 'utf8'))]))
const saved = Object.fromEntries(labels.filter(label => label !== 'activity')
  .map(label => [label, json(captured(`before_${label}.json`))]))
const pauseSql = readFileSync(pausePath, 'utf8')
const auditSql = readFileSync(auditPath, 'utf8')

if (mode === 'files') {
  console.log(JSON.stringify({ result: 'LOCAL_READY_APPROVAL_REQUIRED',
    databaseContacted: false, stagingContacted: false, migrationExecuted: false,
    target: `127.0.0.1:54322/${scratch}`, captureFiles: manifest.files.length,
    migration: pauseName }))
  process.exit(0)
}

const password = validateLocalContainerPassword(process.env.RALLY_PAUSE_RESTORE_DB_PASSWORD)
const evidence = join(root, 'docs/release-private',
  `reservation-pause-restored-${mode}-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${randomBytes(4).toString('hex')}`)
assert.ok(!existsSync(evidence), 'Private evidence folder collision')
mkdirSync(evidence)
const save = (name, value) => writeFileSync(join(evidence, name),
  JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
const client = new pg.Client({ host: '127.0.0.1', port: 54322, database: scratch,
  user: 'postgres', password,
  application_name: `rally_pause_restored_${mode.replace('-', '_')}`, connectionTimeoutMillis: 10000 })
let phase = 'connect'
let inTransaction = false
let connected = false
let rollbackError = null

async function target() {
  const { rows } = await client.query(`select current_database() as database,
    current_setting('server_version') as server_version, current_user as role,
    (select count(*)::int from pg_stat_activity
      where datname = current_database() and pid <> pg_backend_pid()
        and backend_type = 'client backend') as other_clients`)
  assert.equal(rows.length, 1, 'Local target result missing')
  return verifyLocalPauseTarget(rows[0])
}

async function snapshot() {
  await client.query('BEGIN READ ONLY')
  inTransaction = true
  try {
    await client.query("SET LOCAL statement_timeout = '30s'")
    const result = {}
    for (const label of labels) {
      const rows = selectRows(await client.query(querySql[label]), label)
      result[label] = label === 'inventory' ? normalizeLocalInventory(rows)
        : label === 'activity' ? normalizeLocalActivity(rows) : rows
    }
    return result
  } finally {
    await client.query('ROLLBACK')
    inTransaction = false
  }
}

async function denied(sql, label) {
  await client.query('SAVEPOINT denied_attempt')
  try {
    await client.query('SET LOCAL ROLE authenticated')
    await assert.rejects(client.query(sql), error => error.code === '42501', label)
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT denied_attempt')
    await client.query('RELEASE SAVEPOINT denied_attempt')
  }
}

async function deniedReservationWrites() {
  const tables = ['bookings', 'court_sessions', 'open_plays',
    'open_play_signups', 'court_allocations', 'courts']
  for (const table of tables) {
    await denied(`insert into public.${table} default values`, `${table} INSERT`)
    await denied(`update public.${table} set id = id where false`, `${table} UPDATE`)
    await denied(`delete from public.${table} where false`, `${table} DELETE`)
  }
  const calls = [
    'create_unpaid_desk_booking(null::uuid, null::uuid, null::uuid, null::uuid, null::date, null::integer, null::integer)',
    'create_desk_rental(null::uuid, null::uuid, null::uuid, null::uuid, null::text, null::integer)',
    'add_member_to_session(null::uuid, null::uuid)',
    'extend_desk_session(null::uuid, null::integer)',
    'end_desk_session(null::uuid)',
    'create_open_play_session(null::uuid, null::uuid, null::uuid, null::text, null::timestamptz, null::timestamptz, null::integer, null::numeric, null::public.skill_level, null::text)',
    'join_open_play_session(null::uuid, null::uuid)',
    'leave_open_play_session(null::uuid, null::uuid)',
    'cancel_booking_reservation(null::uuid)',
  ]
  for (const call of calls) await denied(`select public.${call}`, `${call} EXECUTE`)
  await client.query('SAVEPOINT allowed_reads')
  try {
    await client.query('SET LOCAL ROLE authenticated')
    for (const table of tables) await client.query(`select count(*) from public.${table}`)
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT allowed_reads')
    await client.query('RELEASE SAVEPOINT allowed_reads')
  }
  return { deniedTableWrites: 18, deniedRpcs: calls.length, preservedTableReads: tables.length }
}

try {
  await client.connect()
  connected = true
  phase = 'local-target'
  await target()
  phase = 'baseline'
  const before = await snapshot()
  for (const label of labels.filter(name => name !== 'activity')) {
    assert.ok(isDeepStrictEqual(before[label], saved[label]),
      `Restored local ${label} differs from frozen capture`)
  }
  assert.equal(before.activity[0]?.other_active_clients, 0, 'Local baseline has another active client')
  assert.equal(before.fingerprint.length, 617)
  assert.equal(before.inventory.length, 54)
  assert.equal(before.catalog[0]?.objects?.length, 1304)
  assert.equal(before.sequences.length, 2)
  if (mode === 'read-only') {
    phase = 'read-only-postflight'
    await target()
    const final = await snapshot()
    const comparison = verifyRolledBackPause(before, final)
    assert.equal(comparison.ledgerCounterInserts, 0,
      'Read-only verification observed a migration-ledger write')
    save('RESULT.json', { result: 'PASS', target: `127.0.0.1:54322/${scratch}`,
      captureManifestSha256: manifestHash, restoreResultSha256: restoreHash,
      fingerprintRows: before.fingerprint.length, inventoryTables: before.inventory.length,
      catalogObjects: before.catalog[0].objects.length, migrationVersions: 13,
      sequences: before.sequences.length, comparison, readOnly: true,
      migrationExecuted: false, stagingContacted: false })
    console.log(JSON.stringify({ result: 'PASS', evidence, readOnly: true,
      migrationExecuted: false, stagingContacted: false }))
  } else {
  phase = 'pause-transaction'
  await client.query('BEGIN')
  inTransaction = true
  await client.query("SET LOCAL statement_timeout = '30s'")
  await client.query(pauseSql)
  await client.query(`insert into supabase_migrations.schema_migrations(version, statements, name)
    values ($1, $2, $3)`, [pauseVersion, [pauseSql], 'reservation_write_pause'])
  phase = 'in-transaction-postflight'
  const after = {}
  for (const label of labels) {
    const rows = selectRows(await client.query(querySql[label]), label)
    after[label] = label === 'inventory' ? normalizeLocalInventory(rows)
      : label === 'activity' ? normalizeLocalActivity(rows) : rows
  }
  const audit = selectRows(await client.query(auditSql), 'reservation pause audit')
  const postflight = verifyReservationPausePostflight({
    beforeInventory: before.inventory, afterInventory: after.inventory,
    beforeGrants: before.grants, afterGrants: after.grants,
    beforeCatalog: before.catalog, afterCatalog: after.catalog,
    beforeSequences: before.sequences, afterSequences: after.sequences,
    beforeActivity: before.activity, afterActivity: after.activity, audit,
  })
  phase = 'denied-writes'
  const attempts = await deniedReservationWrites()
  phase = 'rollback'
  await client.query('ROLLBACK')
  inTransaction = false
  phase = 'unchanged-after-rollback'
  await target()
  const final = await snapshot()
  const rollback = verifyRolledBackPause(before, final)
  save('RESULT.json', { result: 'PASS', target: `127.0.0.1:54322/${scratch}`,
    captureManifestSha256: manifestHash, restoreResultSha256: restoreHash,
    pauseMigrationSha256: pauseHash, pauseAuditSha256: auditHash,
    postflight, attempts, rollback, stagingContacted: false,
    migrationPersisted: false, enforcementApplied: false })
  console.log(JSON.stringify({ result: 'PASS', evidence, ...attempts,
    migrationPersisted: false, stagingContacted: false }))
  }
} catch (error) {
  if (inTransaction) {
    try { await client.query('ROLLBACK'); inTransaction = false }
    catch (rollbackFailure) { rollbackError = rollbackFailure }
  }
  save('STOP.json', { result: 'STOP', phase,
    reason: error instanceof Error ? error.message : 'Unknown local rehearsal failure',
    rollbackSucceeded: !inTransaction && !rollbackError,
    stagingContacted: false, enforcementApplied: false })
  console.error(JSON.stringify({ result: 'STOP', phase, evidence,
    rollbackSucceeded: !inTransaction && !rollbackError }))
  process.exitCode = 1
} finally {
  if (connected) await client.end().catch(() => {})
}
