import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const script = 'supabase/verification/verify_reservation_write_pause.mjs'

function invoke(mode: string, env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [script, mode], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      RALLY_RESERVATION_PAUSE_LOCAL: '',
      RALLY_RESERVATION_PAUSE_REPORT: '',
      RALLY_RESERVATION_PAUSE_DB_PASSWORD: '',
      ...env,
    },
  })
}

describe('rollback-only reservation pause verifier guard', () => {
  it('prepares without opening a database connection', () => {
    const result = invoke('--prepare')
    expect(result.status).toBe(0)
    const report = JSON.parse(result.stdout)
    expect(report.databaseContacted).toBe(false)
    expect(report.targetOnRun).toBe('127.0.0.1:54322/postgres')
    expect(report.orders).toEqual(['pause-then-enforcement', 'enforcement-then-pause'])
  })

  it('refuses run mode without a separate local rollback-only approval guard', () => {
    const result = invoke('--run')
    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/explicit local rollback-only approval guard/)
    expect(result.stdout).not.toMatch(/PASS/)
  })

  it('rejects an invalid evidence path before any database contact', () => {
    const result = invoke('--run', {
      RALLY_RESERVATION_PAUSE_LOCAL: 'rollback-only-approved',
      RALLY_RESERVATION_PAUSE_REPORT: '../outside.json',
    })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/private report name/)
  })
})
