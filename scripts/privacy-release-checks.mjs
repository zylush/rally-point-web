import assert from 'node:assert/strict'

export const PROJECT = 'iclrvvsiwypxlwrwgqia'
export const REPAIR = '20260923053440_member_privacy_repair.sql'
export const ENFORCEMENT = '20260921111105_tenant_enforcement.sql'

export function verifyMigrationSet(actual, baseline) {
  assert.ok(!actual.includes(ENFORCEMENT), 'Enforcement is excluded from this package')
  assert.deepEqual([...actual].sort(), [...baseline, REPAIR].sort(), 'Unexpected migration inventory')
}

export function verifyBrowserBundle(bundle) {
  const hosts = [...new Set(bundle.match(/https:\/\/[a-z0-9]+\.supabase\.co/g) ?? [])]
  assert.deepEqual(hosts, [`https://${PROJECT}.supabase.co`], 'Bundle must reference only approved staging')
  for (const capability of ['public_schedule', 'open_play_seat_counts', '/rally-point-web/']) {
    assert.ok(bundle.includes(capability), 'Required safe-read capability or Pages base missing')
  }
  // The SDK contains startsWith('sb_secret_'); reject values, not that literal.
  assert.ok(!/sb_secret_[A-Za-z0-9_-]+|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|postgres(?:ql)?:\/\//i.test(bundle), 'Privileged credential pattern in browser artifact')
  for (const token of bundle.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) ?? []) {
    let payload
    try { payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) } catch { assert.fail('Malformed browser JWT') }
    assert.ok(payload.role === 'anon' && payload.ref === PROJECT, 'Only staging anon JWTs may be embedded')
  }
}
