import assert from 'node:assert/strict'

export const EXPANDED_BACKFILLED_VERSIONS = [
  '001', '002', '003', '004', '20260803125450', '20260805094557',
  '20260921090000', '20260921110828',
]

export function assertLocalRunIntent(env, reportExists) {
  assert.equal(env.RALLY_GATE2_LOCAL_COMPATIBILITY, 'rollback-only-approved',
    'Gate 2 compatibility requires an explicit local approval guard')
  const name = env.RALLY_GATE2_COMPATIBILITY_REPORT
  assert.match(name ?? '', /^gate2-client-coexistence-[0-9]{8}-[a-z0-9-]+\.json$/,
    'Expected a new private report name')
  assert.ok(!reportExists, 'Refusing to overwrite Gate 2 compatibility evidence')
  return name
}

export function assertLegacyBaseline(versions, otherClients, enforcementConstraints) {
  assert.deepEqual(versions, EXPANDED_BACKFILLED_VERSIONS,
    'Expanded/backfilled local migration ledger differs from the approved baseline')
  assert.equal(otherClients, 0, 'Local database has another client backend')
  assert.equal(enforcementConstraints, 0, 'Tenant enforcement is already present')
}

export function assertFrozenBaseline(marker, fingerprintRows, inventoryRows) {
  assert.equal(marker, '84b7d8e1718ce03e130af200b62def46',
    'Local schema fingerprint differs from the verified expanded/backfilled baseline')
  assert.equal(fingerprintRows, 604, 'Local fingerprint rows differ from the verified baseline')
  assert.equal(inventoryRows, 52, 'Local inventory rows differ from the verified baseline')
}

export function assertSqlSuite(sql) {
  assert.doesNotMatch(sql, /\b(?:begin|commit|rollback|savepoint|release)\s*;/i,
    'SQL suite must not contain transaction control; the runner owns rollback')
  assert.match(sql, /select\s+extensions\.plan\s*\(\s*\d+\s*\)/i, 'SQL suite needs a TAP plan')
  assert.match(sql, /select\s+\*\s+from\s+extensions\.finish\s*\(\s*\)/i,
    'SQL suite needs TAP finish')
}

export function parseTapResults(queryResult, label) {
  const results = Array.isArray(queryResult) ? queryResult : [queryResult]
  const lines = results.flatMap((result) => (result?.rows ?? [])
    .flatMap((row) => Object.values(row))
    .filter((value) => typeof value === 'string'))
  assert.equal(lines.filter((line) => /^not ok\s+\d+\b|^# Looks like you failed/i.test(line)).length,
    0, `${label}: failed TAP assertion`)
  const plans = lines.filter((line) => /^1\.\.\d+$/.test(line))
  assert.equal(plans.length, 1, `${label}: expected one TAP plan`)
  const expected = Number(plans[0].slice(3))
  const passed = lines.filter((line) => /^ok\s+\d+\b/.test(line)).length
  assert.equal(passed, expected, `${label}: TAP count mismatch`)
  return passed
}
