// Pure preparation/evidence checks. No filesystem, CLI, network, or DB access.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

export const reservationTables = ['bookings', 'court_sessions', 'open_plays',
  'open_play_signups', 'court_allocations', 'courts']
export const reservationRpcs = [
  'create_unpaid_desk_booking(uuid, uuid, uuid, uuid, date, integer, integer)',
  'create_desk_rental(uuid, uuid, uuid, uuid, text, integer)',
  'add_member_to_session(uuid, uuid)', 'extend_desk_session(uuid, integer)',
  'end_desk_session(uuid)',
  'create_open_play_session(uuid, uuid, uuid, text, timestamptz, timestamptz, integer, numeric, public.skill_level, text)',
  'join_open_play_session(uuid, uuid)', 'leave_open_play_session(uuid, uuid)',
  'cancel_booking_reservation(uuid)',
]
export const baseMigrations = [
  '001_rally_point.sql', '002_bookings.sql', '003_open_play_qr.sql', '004_member_signup.sql',
  '20260803125450_authorization_boundary.sql', '20260805094557_auth_rate_limits.sql',
  '20260921090000_tenant_ready.sql', '20260921110828_tenant_backfill.sql',
  '20260921111105_tenant_enforcement.sql', '20260922011918_tenant_table_grant_repair.sql',
  '20260922163027_booking_rpc_alias_repair.sql', '20260922163830_booking_cancellation_command.sql',
  '20260922164128_rls_member_lookup_repair.sql', '20260923053440_member_privacy_repair.sql',
  '20260925174111_reservation_write_pause.sql',
]
export const authorizationCases = ['member-own', 'same-club-private', 'staff-assigned-venue',
  'staff-unassigned-venue', 'admin-own-club', 'cross-club', 'forged-ids', 'revoked-staff-grant',
  'anonymous-denial', 'safe-tv', 'limited-roster', 'legacy-direct-write-denial']
export const concurrencyCases = ['same-court-one-winner', 'adjacent-both-succeed',
  'different-courts-both-succeed', 'booking-rental-open-play-shared-rule',
  'cancellation-releases', 'completion-releases', 'retry-no-duplicates', 'pause-restored-after-probe']
export const orderNames = ['pause-enforcement-resume', 'enforcement-pause-resume']
export const resumeCatalogIdentities = [
  'public.create_unpaid_desk_booking(p_club_id uuid, p_venue_id uuid, p_court_id uuid, p_member_id uuid, p_date date, p_start_hour integer, p_hours integer)',
  'public.create_desk_rental(p_club_id uuid, p_venue_id uuid, p_court_id uuid, p_member_id uuid, p_guest_name text, p_hours integer)',
  'public.add_member_to_session(p_session_id uuid, p_member_id uuid)',
  'public.extend_desk_session(p_session_id uuid, p_hours integer)',
  'public.end_desk_session(p_session_id uuid)',
  'public.create_open_play_session(p_club_id uuid, p_venue_id uuid, p_court_id uuid, p_title text, p_start_at timestamp with time zone, p_end_at timestamp with time zone, p_capacity integer, p_fee numeric, p_skill_level skill_level, p_notes text)',
  'public.join_open_play_session(p_open_play_id uuid, p_member_id uuid)',
  'public.leave_open_play_session(p_open_play_id uuid, p_member_id uuid)',
  'public.cancel_booking_reservation(p_booking_id uuid)',
]
const same = (a, b, label) => assert.ok(isDeepStrictEqual(a, b), label)
const hex = (value, length) => typeof value === 'string' && new RegExp(`^[a-f0-9]{${length}}$`).test(value)
const sha = text => createHash('sha256').update(text).digest('hex')

export function makeResumeOrders(names, draft) {
  assert.ok(Array.isArray(names), 'Migration inventory missing')
  same([...names].sort(), baseMigrations, 'Unreviewed or missing migration')
  assert.ok(typeof draft === 'string' && /^\d{14}_reservation_rpc_resume\.sql$/.test(draft) &&
    draft.slice(0, 14) > '20260925174111', 'Invalid resume migration name')
  const enforcement = '20260921111105_tenant_enforcement.sql'
  return [
    { order: orderNames[0], migrations: [...names.filter(n => n !== enforcement).sort(), enforcement, draft] },
    { order: orderNames[1], migrations: [...names].sort().concat(draft) },
  ]
}

function verifyCases(observed, required) {
  assert.ok(observed && typeof observed === 'object' && !Array.isArray(observed), 'Case evidence missing')
  same(Object.keys(observed).sort(), [...required].sort(), 'Missing, extra, or renamed scenario')
  assert.ok(required.every(name => observed[name] === true), 'A required scenario did not pass')
}

// The future approved operator must pin proofSha256 from REVIEWED, independently
// produced raw evidence. A hash or this shape validator alone is not proof that
// a database test ran. Never generate PASS evidence from these mocked unit tests.
export function validateResumeProof(raw, expected) {
  assert.ok(expected && typeof expected === 'object', 'Expected evidence pins missing')
  for (const key of ['proofSha256', 'packageSha256', 'schemaSha256', 'baselineSha256']) {
    assert.ok(hex(expected[key], 64), 'Expected digest missing')
  }
  assert.ok(hex(expected.snapshotMd5, 32), 'Target catalog signature missing')
  assert.ok(Number.isSafeInteger(expected.backendPid) && expected.backendPid > 0 &&
    typeof expected.transactionId === 'string' && /^[1-9]\d*$/.test(expected.transactionId),
  'Current transaction identity missing')
  assert.ok(Array.isArray(expected.sqlSuites) && expected.sqlSuites.length >= 8 &&
    new Set(expected.sqlSuites).size === expected.sqlSuites.length &&
    expected.sqlSuites.every(n => /^[a-z_]+\.test\.sql$/.test(n)), 'Expected SQL suites missing')
  assert.ok(typeof expected.database === 'string' && /^[a-z][a-z0-9_]+$/.test(expected.database) &&
    typeof expected.target === 'string' && /^(local:[a-z][a-z0-9_]+|iclrvvsiwypxlwrwgqia)$/.test(expected.target),
  'Explicit target missing')
  assert.ok(typeof raw === 'string' && raw.length < 100000 && sha(raw) === expected.proofSha256,
    'Proof bytes are not approved')
  let proof
  try { proof = JSON.parse(raw) } catch { throw new Error('Malformed resume proof') }
  assert.ok(proof?.kind === 'reservation-rpc-resume-proof-v1' &&
    proof.approval === 'scoped-reservation-rpc-resume-approved', 'Separate resume approval missing')
  for (const key of ['packageSha256', 'schemaSha256', 'baselineSha256', 'snapshotMd5', 'target', 'database']) {
    same(proof[key], expected[key], 'Resume evidence binding differs')
  }
  for (const key of ['stagingPaused', 'enforced', 'paused', 'unrelatedStateUnchanged']) {
    assert.equal(proof[key], true, 'Resume prerequisite missing')
  }
  assert.ok(Array.isArray(proof.orders), 'Order evidence missing')
  same(proof.orders.map(r => r?.order), orderNames, 'Both complete migration orders are required')
  for (const row of proof.orders) {
    assert.ok(row.result === 'PASS' && row.environment === 'disposable-local' &&
      row.syntheticOnly === true && row.baselineRestored === true, 'Unsafe or failed rehearsal')
    same(row.packageSha256, expected.packageSha256, 'Rehearsal package differs')
    same(row.schemaSha256, expected.schemaSha256, 'Rehearsal schemas did not converge')
    assert.ok(hex(row.rawEvidenceSha256, 64), 'Raw rehearsal evidence reference missing')
    assert.ok(Number.isSafeInteger(row.independentConnections) && row.independentConnections >= 2,
      'Independent connection contention test missing')
    verifyCases(row.authorization, authorizationCases)
    verifyCases(row.concurrency, concurrencyCases)
    assert.ok(Array.isArray(row.sqlSuites), 'SQL suite evidence missing')
    same(row.sqlSuites.map(r => r?.name).sort(), [...expected.sqlSuites].sort(), 'SQL suite inventory differs')
    assert.ok(row.sqlSuites.every(r => Number.isSafeInteger(r.planned) && r.planned > 0 &&
      r.passed === r.planned && r.failed === 0 && r.skipped === 0), 'SQL tests incomplete')
  }
  return { database: expected.database, backend_pid: expected.backendPid, transaction_id: expected.transactionId,
    proof_sha256: expected.proofSha256, package_sha256: expected.packageSha256,
    snapshot_md5: expected.snapshotMd5, enforcement_verified: true,
    authorization_verified: true, concurrency_verified: true, orders_verified: 2 }
}

function keyed(rows, key) {
  assert.ok(Array.isArray(rows) && rows.length > 0, 'Snapshot rows missing')
  const entries = rows.map(row => [key(row), row]).sort(([a], [b]) => a.localeCompare(b))
  assert.equal(new Set(entries.map(([name]) => name)).size, rows.length, 'Duplicate snapshot rows')
  return new Map(entries)
}

// Consume complete outputs from the pinned catalog/inventory/history queries.
// Reject every delta except the nine grants and the one appended ledger row.
export function verifyResumeDelta(before, after, version) {
  assert.ok(/^\d{14}$/.test(version) && version > '20260925174111', 'Invalid resume version')
  assert.ok(before && after && before.catalog?.length === 1 && after.catalog?.length === 1,
    'Full catalog snapshots required')
  const objects = before.catalog[0].objects
  const target = new Set(resumeCatalogIdentities)
  assert.equal(objects.filter(row => row.kind === 'function' && target.has(row.identity)).length, 9,
    'All nine original RPCs are required')
  const sortAcl = entries => [...entries].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  const normalize = row => Array.isArray(row.details?.acl)
    ? { ...row, details: { ...row.details, acl: sortAcl(row.details.acl) } } : row
  const expectedObjects = objects.map(row => {
    if (row.kind !== 'function' || !target.has(row.identity)) return normalize(row)
    assert.ok(Array.isArray(row.details?.acl) && row.details.owner === 'postgres' &&
      !row.details.acl.some(entry => ['PUBLIC', 'anon', 'authenticated', 'service_role'].includes(entry[1])),
    'Original RPC was not paused')
    return normalize({ ...row, details: { ...row.details,
      acl: [...row.details.acl, ['postgres', 'authenticated', 'EXECUTE', false]] } })
  })
  const objectKey = row => `${row.kind}:${row.identity}`
  same(keyed(after.catalog[0].objects.map(normalize), objectKey), keyed(expectedObjects, objectKey),
    'Unexpected catalog or permission delta')
  const invKey = row => `${row.schema_name}.${row.table_name}`
  const oldInventory = keyed(before.inventory, invKey)
  const newInventory = keyed(after.inventory, invKey)
  const ledger = 'supabase_migrations.schema_migrations'
  assert.equal(oldInventory.size, newInventory.size, 'Inventory changed')
  assert.equal(Number(oldInventory.get(ledger)?.row_count), 15, 'Baseline ledger count differs')
  assert.equal(Number(newInventory.get(ledger)?.row_count), 16, 'Resume ledger count differs')
  assert.notEqual(oldInventory.get(ledger).content_md5, newInventory.get(ledger).content_md5, 'Ledger digest unchanged')
  oldInventory.delete(ledger); newInventory.delete(ledger)
  same(newInventory, oldInventory, 'Unrelated contents changed')
  const versions = baseMigrations.map(n => n.split('_')[0])
  same(before.history?.map(r => r.version), versions, 'Baseline history differs')
  same(after.history?.slice(0, 15), before.history, 'Historical ledger rows changed')
  assert.equal(after.history?.length, 16, 'New ledger size differs')
  const added = after.history[15]
  assert.ok(added.version === version && added.name === 'reservation_rpc_resume' &&
    Array.isArray(added.statements) && added.statements.length > 0 &&
    added.statements.every(s => typeof s === 'string' && s.trim()), 'Resume ledger entry missing')
  assert.equal(before.grants?.length, 1, 'Baseline grants missing')
  same(before.grants[0].snapshot.versions, versions, 'Grant snapshot history differs')
  same(after.grants, [{ snapshot: { ...before.grants[0].snapshot, versions: [...versions, version] } }],
    'Unrelated table/column grants changed')
  assert.ok(Array.isArray(before.sequences) && before.sequences.length > 0, 'Sequence evidence missing')
  same(after.sequences, before.sequences, 'Sequence changed')
  assert.equal(before.activity?.length, 1, 'Baseline activity missing')
  assert.equal(after.activity?.length, 1, 'Postflight activity missing')
  assert.equal(Number(before.activity[0].other_active_clients), 0, 'Another client observed')
  assert.equal(Number(after.activity[0].other_active_clients), 0, 'Another client observed')
  const activityKey = row => `${row.schema}.${row.table}`
  const previous = keyed(before.activity[0].writes, activityKey)
  const observed = keyed(after.activity[0].writes, activityKey)
  const oldLedger = previous.get(ledger), newLedger = observed.get(ledger)
  assert.ok(oldLedger && newLedger && [0, 1].includes(Number(newLedger.inserted) - Number(oldLedger.inserted)),
    'Unexpected ledger insert activity')
  same({ ...newLedger, inserted: oldLedger.inserted }, oldLedger, 'Unexpected ledger update/delete')
  previous.delete(ledger); observed.delete(ledger)
  same(observed, previous, 'Unrelated write activity')
  const roles = ['public', 'anon', 'authenticated', 'service_role']
  const expectedAudit = [
    ...roles.flatMap(role_name => reservationTables.map(target => ({ kind: 'table write', role_name, target, violation: false }))),
    ...roles.flatMap(role_name => reservationRpcs.map(target => ({ kind: 'RPC execute', role_name, target, violation: false }))),
    ...reservationTables.map(target => ({ kind: 'authenticated read', role_name: 'authenticated', target, violation: false })),
  ]
  const auditKey = row => `${row.kind}:${row.role_name}:${row.target}`
  same(keyed(after.audit, auditKey), keyed(expectedAudit, auditKey), 'Resume permission audit differs')
  return { result: 'PASS', rpcGrantsAdded: 9, auditRows: 66, appliedVersions: 16,
    unchangedSequences: before.sequences.length, operationalAndAuthUnchanged: true }
}
