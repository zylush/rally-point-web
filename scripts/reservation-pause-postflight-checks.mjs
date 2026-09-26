// Pure verifier for a pause-only staging migration. No network, DB, or file I/O.
import assert from 'node:assert/strict'

const pause = '20260925174111'
const applied = ['001', '002', '003', '004', '20260803125450', '20260805094557',
  '20260921090000', '20260921110828', '20260922011918', '20260922163027',
  '20260922163830', '20260922164128', '20260923053440']
const tables = ['bookings', 'court_sessions', 'open_plays', 'open_play_signups',
  'court_allocations', 'courts']
const functions = [
  'create_unpaid_desk_booking(uuid, uuid, uuid, uuid, date, integer, integer)',
  'create_desk_rental(uuid, uuid, uuid, uuid, text, integer)',
  'add_member_to_session(uuid, uuid)', 'extend_desk_session(uuid, integer)',
  'end_desk_session(uuid)',
  'create_open_play_session(uuid, uuid, uuid, text, timestamptz, timestamptz, integer, numeric, public.skill_level, text)',
  'join_open_play_session(uuid, uuid)', 'leave_open_play_session(uuid, uuid)',
  'cancel_booking_reservation(uuid)',
]
// pg_get_function_identity_arguments renders named args and unqualified types.
// These are the exact nine frozen target identities in the captured catalog.
const functionIdentities = new Set([
  'public.create_unpaid_desk_booking(p_club_id uuid, p_venue_id uuid, p_court_id uuid, p_member_id uuid, p_date date, p_start_hour integer, p_hours integer)',
  'public.create_desk_rental(p_club_id uuid, p_venue_id uuid, p_court_id uuid, p_member_id uuid, p_guest_name text, p_hours integer)',
  'public.add_member_to_session(p_session_id uuid, p_member_id uuid)',
  'public.extend_desk_session(p_session_id uuid, p_hours integer)',
  'public.end_desk_session(p_session_id uuid)',
  'public.create_open_play_session(p_club_id uuid, p_venue_id uuid, p_court_id uuid, p_title text, p_start_at timestamp with time zone, p_end_at timestamp with time zone, p_capacity integer, p_fee numeric, p_skill_level skill_level, p_notes text)',
  'public.join_open_play_session(p_open_play_id uuid, p_member_id uuid)',
  'public.leave_open_play_session(p_open_play_id uuid, p_member_id uuid)',
  'public.cancel_booking_reservation(p_booking_id uuid)',
])
const roles = ['public', 'anon', 'authenticated', 'service_role']
const writes = ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']
const writeSet = new Set(writes)
const tableSet = new Set(tables)
const revokedRoles = new Set(roles.map(role => role === 'public' ? 'PUBLIC' : role))

function unique(rows, key, label) {
  assert.ok(Array.isArray(rows), `${label}: rows missing`)
  const keys = rows.map(key)
  assert.equal(new Set(keys).size, keys.length, `${label}: duplicate rows`)
}

function byKey(rows, key) {
  return new Map(rows.map(row => [key(row), row]))
}

function sameRows(before, after, key, label, transform = row => row) {
  unique(before, key, `${label} before`)
  unique(after, key, `${label} after`)
  assert.deepEqual(byKey(after, key), byKey(before.map(transform), key), `${label}: unexpected delta`)
}

const inventoryKey = row => `${row.schema_name}.${row.table_name}`
const effectiveKey = row => `${row.relname}:${row.role_name}:${row.privilege}`
const aclKey = row => `${row.relname}:${row.grantee}:${row.grantor}:${row.privilege_type}`
const columnKey = row => `${row.relname}:${row.attname}`
const rlsKey = row => row.table
const sequenceKey = row => `${row.schema_name}.${row.sequence_name}`
const auditKey = row => `${row.kind}:${row.role_name}:${row.target}`
const catalogKey = row => `${row.kind}:${row.identity}`

function verifyInventory(before, after) {
  unique(before, inventoryKey, 'inventory before')
  unique(after, inventoryKey, 'inventory after')
  assert.equal(after.length, before.length, 'inventory: table count changed')
  const prior = byKey(before, inventoryKey)
  for (const row of after) {
    const key = inventoryKey(row)
    assert.ok(prior.has(key), `inventory: unexpected table ${key}`)
    if (key === 'supabase_migrations.schema_migrations') {
      assert.equal(row.row_count, 14, 'migration ledger must have exactly 14 rows')
      assert.equal(prior.get(key).row_count, 13, 'baseline ledger must have exactly 13 rows')
      assert.notEqual(row.content_md5, prior.get(key).content_md5,
        'migration ledger digest did not change')
    } else assert.deepEqual(row, prior.get(key), `inventory: changed contents in ${key}`)
  }
  assert.ok(prior.has('supabase_migrations.schema_migrations'), 'migration ledger missing')
}

function verifyGrants(beforeRows, afterRows) {
  assert.equal(beforeRows?.length, 1, 'baseline grant snapshot missing')
  assert.equal(afterRows?.length, 1, 'postflight grant snapshot missing')
  const before = beforeRows[0].snapshot
  const after = afterRows[0].snapshot
  assert.deepEqual(before?.versions, applied, 'baseline migration history drift')
  assert.deepEqual(after?.versions, [...applied, pause], 'postflight migration history drift')
  sameRows(before.rls, after.rls, rlsKey, 'RLS')
  sameRows(before.column_acl, after.column_acl, columnKey, 'column ACL')
  sameRows(before.effective, after.effective, effectiveKey, 'effective grants', row => {
    if (tableSet.has(row.relname) && writeSet.has(row.privilege) &&
        ['anon', 'authenticated', 'service_role'].includes(row.role_name)) {
      return { ...row, allowed: false }
    }
    return row
  })
  const expectedAcl = before.acl.filter(row => !(tableSet.has(row.relname) &&
    revokedRoles.has(row.grantee) && writeSet.has(row.privilege_type)))
  sameRows(expectedAcl, after.acl, aclKey, 'table ACL')
  for (const table of tables) {
    const read = after.effective.find(row => row.relname === table &&
      row.role_name === 'authenticated' && row.privilege === 'SELECT')
    assert.equal(read?.allowed, true, `authenticated SELECT lost on ${table}`)
  }
}

function verifyCatalog(beforeRows, afterRows) {
  assert.equal(beforeRows?.length, 1, 'baseline catalog missing')
  assert.equal(afterRows?.length, 1, 'postflight catalog missing')
  const before = beforeRows[0].objects
  const after = afterRows[0].objects
  sameRows(before, after, catalogKey, 'catalog', row => {
    const table = row.kind === 'relation' && row.identity.startsWith('public.') &&
      tableSet.has(row.identity.slice('public.'.length))
    const rpc = row.kind === 'function' && functionIdentities.has(row.identity)
    if (!table && !rpc) return row
    assert.ok(Array.isArray(row.details?.acl), `catalog ACL missing: ${row.identity}`)
    const allowed = row.details.acl.filter(entry => !(Array.isArray(entry) &&
      entry.length === 4 && revokedRoles.has(entry[1]) &&
      (table ? writeSet.has(entry[2]) : entry[2] === 'EXECUTE')))
    return { ...row, details: { ...row.details, acl: allowed } }
  })
}

function verifyAudit(rows) {
  const expected = [
    ...roles.flatMap(role_name => tables.map(target => ({ kind: 'table write', role_name, target, violation: false }))),
    ...roles.flatMap(role_name => functions.map(target => ({ kind: 'RPC execute', role_name, target, violation: false }))),
    ...tables.map(target => ({ kind: 'authenticated read', role_name: 'authenticated', target, violation: false })),
  ]
  assert.equal(rows?.length, 66, 'pause audit must return all 66 checks')
  sameRows(expected, rows, auditKey, 'pause audit')
}

export function verifyPauseActivity(beforeRows, afterRows) {
  assert.equal(beforeRows?.length, 1, 'baseline activity missing')
  assert.equal(afterRows?.length, 1, 'postflight activity missing')
  const before = beforeRows[0]
  const after = afterRows[0]
  assert.equal(before.other_active_clients, 0, 'baseline has another active client')
  assert.equal(after.other_active_clients, 0, 'postflight has another active client')
  assert.ok(Array.isArray(before.writes) && before.writes.length > 0,
    'activity counters missing')
  const key = row => `${row.schema}.${row.table}`
  unique(before.writes, key, 'activity before')
  unique(after.writes, key, 'activity after')
  assert.equal(after.writes.length, before.writes.length, 'activity table count changed')
  const prior = byKey(before.writes, key)
  let migrationLedgerInserts = 0
  for (const row of after.writes) {
    const name = key(row)
    assert.ok(prior.has(name), `activity: unexpected table ${name}`)
    if (name === 'supabase_migrations.schema_migrations') {
      const old = prior.get(name)
      migrationLedgerInserts = Number(row.inserted) - Number(old.inserted)
      assert.ok(Number.isInteger(migrationLedgerInserts) &&
        [0, 1].includes(migrationLedgerInserts), 'migration ledger write counter drift')
      assert.equal(row.updated, old.updated, 'migration ledger update counter changed')
      assert.equal(row.deleted, old.deleted, 'migration ledger delete counter changed')
    } else assert.deepEqual(row, prior.get(name), `activity: ${name} write counters changed`)
  }
  assert.ok(prior.has('supabase_migrations.schema_migrations'), 'activity: migration ledger missing')
  return migrationLedgerInserts
}

export function verifyReservationPausePostflight(proof) {
  assert.ok(proof && typeof proof === 'object', 'postflight proof missing')
  verifyInventory(proof.beforeInventory, proof.afterInventory)
  verifyGrants(proof.beforeGrants, proof.afterGrants)
  verifyCatalog(proof.beforeCatalog, proof.afterCatalog)
  verifyAudit(proof.audit)
  sameRows(proof.beforeSequences, proof.afterSequences, sequenceKey, 'sequences')
  const migrationLedgerInserts = verifyPauseActivity(proof.beforeActivity, proof.afterActivity)
  return { result: 'PASS', auditRows: 66, inventoryTables: proof.beforeInventory.length,
    catalogObjects: proof.beforeCatalog[0].objects.length, appliedVersions: 14,
    unchangedSequences: proof.beforeSequences.length,
    operationalActivityUnchanged: true, migrationLedgerInserts }
}
