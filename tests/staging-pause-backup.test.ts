import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const script = 'docs/release-private/staging-pause-backup-20260926-r1/capture.mjs'
const manifestPath = 'docs/release-private/staging-pause-backup-20260926-r1/capture_manifest.json'
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')

function run(mode: string) {
  return spawnSync(process.execPath, [script, mode], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, RALLY_STAGING_BACKUP_CAPTURE_APPROVED: '' },
  })
}

describe('completed staging pause backup capture', () => {
  it('preserves the approved script and captured manifest', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    expect(hash(script).toUpperCase()).toBe('BB0066B6DEA5E1D621F50C6BE1CEC05C7EC7CCDF04E6620B8D10989FEEDFDF02')
    expect(manifest).toMatchObject({
      result: 'CAPTURE_PASS_RESTORE_PENDING', project: 'iclrvvsiwypxlwrwgqia',
      sourceVersion: '17.6.1.147', tables: 54, storageObjects: 0,
      activeClientsObserved: 0, writeCounterChanges: 0, restoreApproved: false,
    })
    expect(manifest.versions).toHaveLength(13)
    expect(manifest.files).toHaveLength(67)
  })

  it.each(['--verify-local', '--approved-capture'])('refuses reuse in %s mode without altering evidence', mode => {
    const before = hash(manifestPath)
    const result = run(mode)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Backup capture folder already used')
    expect(hash(manifestPath)).toBe(before)
    expect(existsSync('docs/release-private/staging-pause-backup-20260926-r1/STOP.json')).toBe(false)
  })
})
