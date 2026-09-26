// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { verifyBrowserBundle, verifyMigrationSet, PROJECT, REPAIR, ENFORCEMENT } from '../scripts/privacy-release-checks.mjs'

const baseline = ['001_rally_point.sql', '002_bookings.sql']
const bundle = `https://${PROJECT}.supabase.co /rally-point-web/assets/app.js public_schedule open_play_seat_counts sb_publishable_test`

describe('privacy release package fail-closed guards', () => {
  it('hashes each shipped SQL check source for the frozen package', () => {
    const packager = readFileSync(new URL('../scripts/prepare-privacy-release.mjs', import.meta.url), 'utf8')
    const sourceList = packager.match(/const sourcePaths = ([\s\S]*?)\r?\n\s*const sourceFiles/)?.[1]
    expect(sourceList).toBeDefined()
    for (const file of ['schema_fingerprint.sql', 'tenant_grant_snapshot.sql', 'backup_content_inventory.sql', 'staging_privacy_readonly_preflight.sql']) {
      expect(sourceList).toContain(`'supabase/verification/${file}'`)
    }
  })

  it('packages the read-only fixture-aware preflight instead of the old single-venue check', () => {
    const packager = readFileSync(new URL('../scripts/prepare-privacy-release.mjs', import.meta.url), 'utf8')
    const preflight = readFileSync(new URL('../supabase/verification/staging_privacy_readonly_preflight.sql', import.meta.url), 'utf8')
    expect(packager).toContain("'supabase/verification/staging_privacy_readonly_preflight.sql'")
    expect(packager).toContain("join(packet, 'checks/staging_privacy_readonly_preflight.sql')")
    expect(packager).not.toContain("'staging_backfill_postflight.sql'")
    expect(preflight).not.toMatch(/^\s*(?:insert|update|delete|alter|drop|create|do|grant|revoke)\b/gim)
    expect(preflight).not.toContain('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    for (const check of ['court_venue_mismatch', 'booking_relationship_mismatch', 'allocation_relationship_mismatch', 'active_allocation_overlap', 'financial_entry_not_unverified']) {
      expect(preflight).toContain(check)
    }
  })
  it('accepts only the frozen baseline and single approved repair', () => {
    expect(() => verifyMigrationSet([...baseline, REPAIR], baseline)).not.toThrow()
  })
  it.each([
    [...baseline, REPAIR, ENFORCEMENT],
    [...baseline, REPAIR, '20260924000000_unreviewed.sql'],
    [...baseline],
    [baseline[0], REPAIR],
    [...baseline, REPAIR, REPAIR],
  ])('rejects extra, missing, enforcement and duplicate migrations', (files) => {
    expect(() => verifyMigrationSet(files, baseline)).toThrow()
  })
  it('accepts the staging-only safe-read browser bundle', () => {
    expect(() => verifyBrowserBundle(bundle)).not.toThrow()
  })
  it('accepts the SDK literal secret-key prefix without accepting an actual key value', () => {
    expect(() => verifyBrowserBundle(bundle + ' key.startsWith("sb_secret_")')).not.toThrow()
  })
  it.each([
    bundle.replace(PROJECT, 'ausgoiwwhevrplfetccm'),
    bundle.replace('open_play_seat_counts', ''),
    bundle + ' https://ausgoiwwhevrplfetccm.supabase.co',
    bundle + ' sb_secret_never_ship',
    bundle + ' -----BEGIN PRIVATE KEY-----',
    bundle + ' postgres://admin:secret@localhost/db',
    bundle + ' eyJhbGciOiJIUzI1NiJ9.' + Buffer.from(JSON.stringify({ role: 'service_role', ref: PROJECT })).toString('base64url') + '.signature',
    bundle + ' eyJhbGciOiJIUzI1NiJ9.' + Buffer.from(JSON.stringify({ role: 'anon', ref: 'foreign' })).toString('base64url') + '.signature',
  ])('rejects foreign projects, missing capability and privileged secrets without echoing them', (value) => {
    expect(() => verifyBrowserBundle(value)).toThrow()
    try { verifyBrowserBundle(value) } catch (error) {
      expect(String(error)).not.toContain('never_ship')
      expect(String(error)).not.toContain('admin:secret')
    }
  })
})
