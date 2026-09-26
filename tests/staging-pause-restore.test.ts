// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertRestoreApproval,
  validateCaptureManifest,
  verifyCaptureFiles,
} from '../scripts/staging-pause-restore-checks.mjs'

const backupDir = 'docs/release-private/staging-pause-backup-20260926-r1'
const restoreScript = 'docs/release-private/staging-pause-restore-20260926-r1/restore.mjs'
const manifest = JSON.parse(readFileSync(join(backupDir, 'capture_manifest.json'), 'utf8'))
const clone = () => structuredClone(manifest)

describe('fresh staging capture restore guards', () => {
  it('accepts the captured target, version, scope, and terminal state', () => {
    expect(validateCaptureManifest(manifest)).toEqual({ files: 67, tables: 54, versions: 13 })
  })

  it.each([
    ['wrong project', { project: 'another-project' }],
    ['different PostgreSQL version', { sourceVersion: '17.11' }],
    ['nonempty Storage', { storageObjects: 1 }],
    ['active clients', { activeClientsObserved: 1 }],
    ['write-counter drift', { writeCounterChanges: 1 }],
    ['restore already approved', { restoreApproved: true }],
  ])('rejects %s metadata before any database action', (_case, fields) => {
    expect(() => validateCaptureManifest({ ...clone(), ...fields })).toThrow()
  })

  it('rejects missing or forged migration history and unsafe filenames', () => {
    const missingVersion = clone()
    missingVersion.versions.pop()
    expect(() => validateCaptureManifest(missingVersion)).toThrow()
    const traversal = clone()
    traversal.files[0].file = '../outside.sql'
    expect(() => validateCaptureManifest(traversal)).toThrow()
    const duplicate = clone()
    duplicate.files[1].file = duplicate.files[0].file
    expect(() => validateCaptureManifest(duplicate)).toThrow()
  })

  it('verifies every captured byte and rejects altered data without exposing it', () => {
    expect(verifyCaptureFiles(manifest, file => readFileSync(join(backupDir, file)))).toBe(67)
    expect(() => verifyCaptureFiles(manifest, file => file === 'data.sql'
      ? Buffer.from('private-value') : readFileSync(join(backupDir, file))))
      .toThrow(/Capture file mismatch: data.sql/)
  })

  it('requires a separate explicit approval token for local restore', () => {
    expect(() => assertRestoreApproval(undefined)).toThrow(/separate approval/)
    expect(() => assertRestoreApproval('paused-and-approved')).toThrow(/separate approval/)
    expect(() => assertRestoreApproval('disposable-local-restore-approved')).not.toThrow()
  })

  it('prepares a restore plan without staging, Docker, or database access', () => {
    const result = spawnSync(process.execPath, [restoreScript, '--verify-local'], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 10_000,
      env: { ...process.env, RALLY_DISPOSABLE_RESTORE_APPROVED: '' },
    })
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      result: 'LOCAL_READY_RESTORE_PENDING', project: 'iclrvvsiwypxlwrwgqia',
      files: 67, tables: 54, versions: 13, databaseConnected: false,
      stagingContacted: false, restoreExecuted: false,
    })
  })

  it('refuses execution without separate approval before contacting a database', () => {
    const resultPath = 'docs/release-private/staging-pause-restore-20260926-r1/result.json'
    const before = createHash('sha256').update(readFileSync(resultPath)).digest('hex')
    const result = spawnSync(process.execPath, [restoreScript, '--execute-approved'], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 10_000,
      env: { ...process.env, RALLY_DISPOSABLE_RESTORE_APPROVED: '' },
    })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('requires separate approval')
    expect(existsSync('docs/release-private/staging-pause-restore-20260926-r1/STOP.json')).toBe(false)
    expect(createHash('sha256').update(readFileSync(resultPath)).digest('hex')).toBe(before)
  })
})
