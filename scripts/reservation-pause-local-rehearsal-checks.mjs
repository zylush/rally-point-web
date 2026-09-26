// Pure guards for a separately approved, rollback-only disposable DB rehearsal.
import assert from 'node:assert/strict'
import { verifyPauseActivity } from './reservation-pause-postflight-checks.mjs'

const database = 'rally_pause_backup_restore_20260926'

export function localPauseMode(flag, approval) {
  if (flag === '--verify-local') return 'files'
  if (flag === '--verify-readonly-local') return 'read-only'
  if (flag === '--execute-approved') {
    assertLocalPauseRehearsalApproval(approval)
    return 'rollback-only'
  }
  throw new Error('Unsupported local pause verification mode')
}

export function assertLocalPauseRehearsalApproval(value) {
  assert.equal(value, 'rollback-only-local-approved',
    'A separate disposable-local rollback-only approval is required')
  return true
}

export function validateLocalContainerPassword(value) {
  assert.ok(typeof value === 'string' && value.length > 0 &&
    !/[\r\n]/.test(value), 'Local container password is unavailable or malformed')
  return value
}

export function normalizeLocalInventory(rows) {
  assert.ok(Array.isArray(rows), 'Local inventory rows missing')
  return rows.map(row => {
    const value = row?.row_count
    assert.ok((typeof value === 'number' ||
      (typeof value === 'string' && /^\d+$/.test(value))) &&
      Number.isSafeInteger(Number(value)) && Number(value) >= 0,
    'Local inventory count is invalid')
    return { ...row, row_count: Number(value) }
  })
}

export function normalizeLocalActivity(rows) {
  assert.ok(Array.isArray(rows) && rows.length === 1,
    'Local activity result is missing or duplicated')
  const value = rows[0]?.other_active_clients
  assert.ok((typeof value === 'number' ||
    (typeof value === 'string' && /^\d+$/.test(value))) &&
    Number.isSafeInteger(Number(value)) && Number(value) >= 0,
  'Local active-client count is invalid')
  assert.ok(Array.isArray(rows[0].writes), 'Local write counters are missing')
  return [{ ...rows[0], other_active_clients: Number(value) }]
}

export function unwrapCapturedReadOnly(sql) {
  assert.equal(typeof sql, 'string', 'Captured query must be text')
  const match = /^begin read only;\s*([\s\S]*?)\s*commit;\s*$/i.exec(sql.trim())
  assert.ok(match && match[1].trim(), 'Captured query must be one read-only transaction')
  return match[1].trim()
}

export function verifyLocalPauseTarget(row) {
  assert.equal(row?.database, database, 'Wrong disposable local database')
  assert.equal(row?.server_version, '17.6', 'Wrong local PostgreSQL version')
  assert.equal(row?.role, 'postgres', 'Wrong local migration role')
  assert.equal(row?.other_clients, 0, 'Another client is connected to the disposable database')
  return { result: 'PASS', ...row }
}

export function verifyRolledBackPause(before, after) {
  assert.ok(before && after, 'Rollback snapshots missing')
  for (const name of ['fingerprint', 'inventory', 'catalog', 'grants', 'sequences']) {
    assert.deepEqual(after[name], before[name], `Rollback changed ${name}`)
  }
  const ledgerCounterInserts = verifyPauseActivity(before.activity, after.activity)
  return { result: 'PASS', ledgerCounterInserts, persistentDataChanged: false }
}
