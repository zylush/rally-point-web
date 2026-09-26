// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { makePausePlan, validatePauseInventory } from '../scripts/reservation-pause-package.mjs'

const applied = [
  '001_rally_point.sql', '002_bookings.sql', '003_open_play_qr.sql',
  '004_member_signup.sql', '20260803125450_authorization_boundary.sql',
  '20260805094557_auth_rate_limits.sql', '20260921090000_tenant_ready.sql',
  '20260921110828_tenant_backfill.sql',
  '20260922011918_tenant_table_grant_repair.sql',
  '20260922163027_booking_rpc_alias_repair.sql',
  '20260922163830_booking_cancellation_command.sql',
  '20260922164128_rls_member_lookup_repair.sql',
  '20260923053440_member_privacy_repair.sql',
]
const pause = '20260925174111_reservation_write_pause.sql'
const enforcement = '20260921111105_tenant_enforcement.sql'

describe('isolated reservation pause package', () => {
  it('accepts only 13 applied migrations plus the single pending pause', () => {
    expect(validatePauseInventory([...applied, pause])).toEqual({
      appliedVersions: applied.map((name) => name.split('_')[0]),
      pendingMigration: pause,
    })
  })

  it.each([
    [...applied, pause, enforcement],
    [...applied, enforcement, pause],
    [...applied],
    [...applied.slice(1), pause],
    [...applied, pause, pause],
    [...applied, pause, '20260926000000_unreviewed.sql'],
  ])('rejects missing, duplicate, enforcement, or unreviewed SQL', (names) => {
    expect(() => validatePauseInventory(names)).toThrow()
  })

  it('plans a local-only, unapproved package without private evidence files', () => {
    const plan = makePausePlan([...applied, pause])
    expect(plan.databaseContacted).toBe(false)
    expect(plan.appliedVersions).toEqual(applied.map((name) => name.split('_')[0]))
    expect(plan.pendingMigration).toBe(pause)
    expect(plan.excludedMigration).toBe(enforcement)
    expect(plan.stagingApplyAuthorized).toBe(false)
  })
})
