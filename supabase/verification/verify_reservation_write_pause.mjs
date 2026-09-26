// --prepare is file-only. --run is a separately approved, rollback-only local
// Gate 2 rehearsal; it never accepts a linked or remote database target.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
import pg from 'pg'
import { selectRows } from './pg-query-rows.mjs'

const root = new URL('../../', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')
const hash = (value) => createHash('sha256').update(value).digest('hex')
const migrationNames = [
  ['20260922011918_tenant_table_grant_repair.sql', '1cad40c513767ec0ccfb138ff7202f7fddd8aef4de11212dbf84a39056afd3fe'],
  ['20260922163027_booking_rpc_alias_repair.sql', 'd1a4bb6c1473cebebe48560f272c5c2eabdbe70c48d6836c37754a72021d97d7'],
  ['20260922163830_booking_cancellation_command.sql', '8b466e22cd773a8ca66710ce28a13bf6589cfa52b3f9f6ef04ce32e85b7a7641'],
  ['20260922164128_rls_member_lookup_repair.sql', 'c79e917897381f3569d5995d9755aaa59f5dfb8767f8dd2f817936331fd5771e'],
  ['20260923053440_member_privacy_repair.sql', '14db7ec6e833d9d63dfd893c03e804e6db97f22db3317b0463114692b52c69ad'],
  ['20260921111105_tenant_enforcement.sql', 'a9c4163547febe3d9b8b1c68bbd57c9e3a39ad66afd92d5489ffa83fd576954b'],
  ['20260925174111_reservation_write_pause.sql', 'f5a03d8c294efc7902c195f84eeee0af97b81377b5be2a5ccba9243d5e6a44ef'],
]
const migrations = new Map(migrationNames.map(([name, expected]) => {
  const sql = read('supabase/migrations/' + name)
  assert.equal(hash(sql), expected, `${name} differs from reviewed local source`)
  return [name, sql]
}))
const auditSql = read('supabase/verification/reservation_write_pause_readonly.sql')
assert.equal(hash(auditSql), '4c90aa24f59028f3944ed6297e644f69081417d77774a2b0733f8494252b4e5b',
  'Read-only privilege audit differs from reviewed local source')

assert.ok(['--prepare', '--run'].includes(process.argv[2]) && process.argv.length === 3,
  'Use --prepare or --run')
const orders = ['pause-then-enforcement', 'enforcement-then-pause']
if (process.argv[2] === '--prepare') {
  console.log(JSON.stringify({ mode: 'prepare', databaseContacted: false,
    targetOnRun: '127.0.0.1:54322/postgres', orders,
    files: migrationNames.map(([name, sha256]) => ({ name, sha256 })) }))
  process.exit(0)
}

assert.equal(process.env.RALLY_RESERVATION_PAUSE_LOCAL, 'rollback-only-approved',
  'An explicit local rollback-only approval guard is required')
const reportName = process.env.RALLY_RESERVATION_PAUSE_REPORT ?? ''
assert.match(reportName, /^reservation-write-pause-[0-9]{8}-[a-z0-9-]+\.json$/,
  'A new private report name is required')
const privateDir = new URL('docs/release-private/', root)
const reportPath = new URL(reportName, privateDir)
assert.ok(!existsSync(reportPath), 'Refusing to overwrite existing private report')
assert.ok(process.env.RALLY_RESERVATION_PAUSE_DB_PASSWORD,
  'RALLY_RESERVATION_PAUSE_DB_PASSWORD is required')

const client = new pg.Client({ host: '127.0.0.1', port: 54322, database: 'postgres',
  user: 'postgres', password: process.env.RALLY_RESERVATION_PAUSE_DB_PASSWORD,
  application_name: 'rally_gate2_rollback_only_reservation_pause' })
const expectedVersions = ['001', '002', '003', '004', '20260803125450',
  '20260805094557', '20260921090000', '20260921110828']
const schemaSql = read('supabase/verification/schema_fingerprint.sql')
const aclSql = read('supabase/verification/tenant_grant_snapshot.sql')
const contentSql = read('supabase/verification/backup_content_inventory.sql')
const pauseName = '20260925174111_reservation_write_pause.sql'
const enforcementName = '20260921111105_tenant_enforcement.sql'
const repairs = migrationNames.slice(0, 5).map(([name]) => migrations.get(name))

async function targetState() {
  const versions = (await client.query('select version from supabase_migrations.schema_migrations order by version'))
    .rows.map((row) => row.version)
  const activity = (await client.query(`select count(*)::int as n from pg_stat_activity
    where datname = current_database() and pid <> pg_backend_pid() and backend_type = 'client backend'`)).rows[0].n
  const constraints = (await client.query(`select count(*)::int as n from pg_constraint
    where conname = 'court_allocations_no_overlap'`)).rows[0].n
  assert.deepEqual(versions, expectedVersions, 'Local migration ledger drifted')
  assert.equal(activity, 0, 'Another client is connected to the local test database')
  assert.equal(constraints, 0, 'Local database is already enforced')
  return versions
}

async function snapshotReadOnly() {
  await client.query('begin read only')
  try {
    await client.query('set local search_path = public, extensions')
    return {
      schema: selectRows(await client.query(schemaSql), 'schema fingerprint'),
      acl: selectRows(await client.query(aclSql), 'grant snapshot'),
      content: selectRows(await client.query(contentSql), 'content inventory'),
    }
  } finally { await client.query('rollback') }
}

async function audit(stage) {
  const rows = selectRows(await client.query(auditSql), 'reservation pause audit')
  assert.equal(rows.length, 66, `${stage}: unexpected pause audit target count`)
  assert.deepEqual(rows.filter((row) => row.violation), [], `${stage}: reservation privilege remains`)
}

async function denied(sql, label) {
  await client.query('savepoint denied_attempt')
  try {
    await client.query('set local role authenticated')
    await assert.rejects(client.query(sql), (error) => error.code === '42501', label)
  } finally {
    await client.query('rollback to savepoint denied_attempt')
    await client.query('release savepoint denied_attempt')
  }
}

async function deniedWrites(stage) {
  const tables = ['bookings', 'court_sessions', 'open_plays',
    'open_play_signups', 'court_allocations', 'courts']
  for (const table of tables) {
    await denied(`insert into public.${table} default values`, `${stage}: ${table} INSERT`)
    await denied(`update public.${table} set id = id where false`, `${stage}: ${table} UPDATE`)
    await denied(`delete from public.${table} where false`, `${stage}: ${table} DELETE`)
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
  for (const call of calls) await denied(`select public.${call}`, `${stage}: ${call}`)

  await client.query('savepoint allowed_reads')
  try {
    await client.query('set local role authenticated')
    for (const table of tables) await client.query(`select count(*) from public.${table}`)
  } finally {
    await client.query('rollback to savepoint allowed_reads')
    await client.query('release savepoint allowed_reads')
  }
  await client.query('savepoint public_read')
  try {
    await client.query('set local role anon')
    await client.query('select count(*) from public.public_schedule')
  } finally {
    await client.query('rollback to savepoint public_read')
    await client.query('release savepoint public_read')
  }
  assert.equal((await client.query('select current_user as role')).rows[0].role, 'postgres',
    `${stage}: session role was not restored`)
}

let connected = false
const report = { target: '127.0.0.1:54322/postgres', scope: 'rollback-only local Gate 2 pause rehearsal',
  files: migrationNames.map(([name, sha256]) => ({ name, sha256 })), orders: [], status: 'STOP' }
try {
  await client.connect()
  connected = true
  report.versions = await targetState()
  const baseline = await snapshotReadOnly()
  assert.equal(baseline.schema.length, 604, 'Local schema fingerprint row count drifted')
  assert.equal(baseline.content.length, 52, 'Local content inventory drifted')
  assert.equal(baseline.schema.find((row) => row.category === '!fingerprint')?.details,
    '84b7d8e1718ce03e130af200b62def46', 'Local schema fingerprint drifted')

  for (const order of orders) {
    await client.query('begin')
    try {
      await client.query('set local search_path = public, extensions')
      for (const sql of repairs) await client.query(sql)
      if (order === 'pause-then-enforcement') {
        await client.query(migrations.get(pauseName))
        await audit(order + ': before enforcement')
        await deniedWrites(order + ': before enforcement')
        await client.query(migrations.get(enforcementName))
      } else {
        await client.query(migrations.get(enforcementName))
        await client.query(migrations.get(pauseName))
      }
      const constraint = (await client.query(`select count(*)::int as n from pg_constraint
        where conname = 'court_allocations_no_overlap'`)).rows[0].n
      assert.equal(constraint, 1, `${order}: enforcement constraint missing`)
      await audit(order + ': after enforcement')
      await deniedWrites(order + ': after enforcement')
      report.orders.push({ order, status: 'PASS', deniedTableCalls: order === orders[0] ? 36 : 18,
        deniedRpcCalls: order === orders[0] ? 18 : 9 })
    } finally { await client.query('rollback') }
    assert.deepEqual(await targetState(), expectedVersions)
    assert.ok(isDeepStrictEqual(await snapshotReadOnly(), baseline), `${order}: rollback left drift`)
  }
  report.status = 'PASS'
  report.localBaselineUnchanged = true
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error)
  throw error
} finally {
  if (connected) await client.end()
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
}
console.log('PASS: both pause/enforcement orders denied reservation writes and rolled back')
