// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { verifyReservationPauseDryRun } from '../scripts/reservation-pause-dry-run-checks.mjs'

const pause = '20260925174111_reservation_write_pause.sql'
const enforcement = '20260921111105_tenant_enforcement.sql'
const output = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  upToDate: false, dryRun: true, migrations: [pause], seeds: [], roles: [],
  message: 'Finished supabase db push.', ...overrides,
})
const stderr = `DRY RUN: migrations will *not* be pushed to the database.\nWould push these migrations:\n • \u001b[1m${pause}\u001b[22m\n`

describe('reservation pause CLI dry-run result', () => {
  it('accepts only the pause migration in JSON and human output', () => {
    expect(verifyReservationPauseDryRun(output(), stderr, 0)).toEqual({
      result: 'PASS', dryRun: true, pending: [pause],
    })
  })

  it.each([
    [output({ dryRun: false }), stderr, 0],
    [output({ upToDate: true }), stderr, 0],
    [output({ migrations: [] }), stderr, 0],
    [output({ migrations: [pause, enforcement] }), stderr, 0],
    [output({ migrations: [pause, pause] }), stderr, 0],
    [output({ seeds: ['seed.sql'] }), stderr, 0],
    [output({ roles: ['roles.sql'] }), stderr, 0],
    [output(), stderr.replace('DRY RUN:', 'RUN:'), 0],
    [output(), stderr.replace(pause, enforcement), 0],
    [output(), stderr + `Would push ${enforcement}\n`, 0],
    [output(), stderr, 1],
    ['not json', stderr, 0],
  ])('stops on failed command, malformed result, or extra migration/seed/role', (stdout, err, code) => {
    expect(() => verifyReservationPauseDryRun(stdout, err, code)).toThrow()
  })

  it('does not echo raw CLI output in an error', () => {
    expect(() => verifyReservationPauseDryRun('secret-value', stderr, 0)).toThrow()
    try { verifyReservationPauseDryRun('secret-value', stderr, 0) } catch (error) {
      expect(String(error)).not.toContain('secret-value')
    }
  })
})
