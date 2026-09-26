// Compares saved read-only staging snapshots; no database writes/connections.
import { readFileSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'
const root = new URL('../../docs/release-private/staging-backup-20260921/', import.meta.url)
const read = (name) => JSON.parse(readFileSync(new URL(name, root), 'utf8').replace(/^\uFEFF/, ''))
const before = read('grant_repair_before_acl.json').rows[0].snapshot
const after = read('grant_repair_after_acl.json').rows[0].snapshot
const rehearsal = read('grant_repair_rehearsal.json')
const targets = ['clubs','venues','club_staff_roles','staff_venue_grants','court_allocations']
const legacy = (rows) => rows.filter((r) => !targets.includes(r.relname))
assert.deepEqual(after.effective, rehearsal.expectedAcl.effective)
assert.deepEqual(after.acl, rehearsal.expectedAcl.acl)
assert.deepEqual(after.column_acl, before.column_acl)
assert.deepEqual(after.rls, before.rls)
assert.deepEqual(legacy(after.effective), legacy(before.effective))
assert.deepEqual(legacy(after.acl), legacy(before.acl))
assert.deepEqual(after.versions, [...before.versions, '20260922011918'])
const fingerprint = read('grant_repair_after_fingerprint.json').rows[0].fingerprints
assert.deepEqual(fingerprint, rehearsal.expectedFingerprint)
const data = (name) => read(name).rows.filter((r) => r.schema_name !== 'supabase_migrations')
assert.deepEqual(data('grant_repair_after_content.json'), data('grant_repair_before_content.json'))
const postflight = read('grant_repair_after_postflight.json').rows[0].postflight
for (const field of ['incorrect_court_ownership','court_venue_mismatches','overlaps','verified_historical_charges']) assert.equal(postflight[field], 0, field)
for (const field of ['legacy_booking_insert','legacy_member_update','legacy_transaction_insert','ownership_still_nullable']) assert.equal(postflight[field], true, field)
assert.equal(postflight.enforcement_constraint_present, false)
assert.equal(postflight.club_count, 1)
assert.equal(postflight.venue_count, 1)
assert.equal(postflight.courts, 4)
const summary = {
  migration: '20260922011918_tenant_table_grant_repair.sql',
  fingerprintEntriesMatch: fingerprint.length,
  unchangedDataTables: data('grant_repair_after_content.json').length,
  targetEffectivePrivilegesChecked: after.effective.filter((r) => targets.includes(r.relname)).length,
  legacyAclUnchanged: true, rlsUnchanged: true, columnAclUnchanged: true,
  enforcementApplied: false, result: 'PASS',
}
writeFileSync(new URL('grant_repair_postflight_result.json', root), JSON.stringify(summary, null, 2) + '\n')
console.log(JSON.stringify(summary))
