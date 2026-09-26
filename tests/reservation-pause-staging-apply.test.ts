// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  pauseApplyMode, verifyPauseApplyReadiness, pauseApplyArguments,
} from '../scripts/reservation-pause-staging-apply-checks.mjs'

const project = 'iclrvvsiwypxlwrwgqia'
const pause = '20260925174111_reservation_write_pause.sql'
const versions = ['001', '002', '003', '004', '20260803125450',
  '20260805094557', '20260921090000', '20260921110828',
  '20260922011918', '20260922163027', '20260922163830',
  '20260922164128', '20260923053440']

function evidence() {
  return {
    now: '2026-09-25T20:15:00.000Z',
    backup: { result: 'CAPTURE_PASS_RESTORE_PENDING', project,
      endedAt: '2026-09-25T20:00:00.000Z', publicFingerprint: '7f18a8fafb767f4fdd1a5a37401a6471',
      tables: 54, versions, activeClientsObserved: 0, writeCounterChanges: 0,
      storageObjects: 0,
      baselineReferenceSha256: '9e4d28231aa924aa991c5a5ea8d64e6e3920af0756733eeaa742260f7fa62338',
      pausePackageManifestSha256: '7f8c7f5193c2484b8d6a9b751e120524f67ce27b09c4558ef3b062e695ecd902' },
    backupSha256: 'a'.repeat(64),
    restore: { result: 'PASS', project, database: 'rally_pause_backup_restore_20260926',
      captureManifestSha256: 'a'.repeat(64), stagingContacted: false,
      stagingChanged: false },
    dryRun: { result: 'PASS', project, at: '2026-09-25T20:10:00.000Z',
      dryRun: true, pending: [pause], noMigrationApplied: true,
      stagingActivityResumed: false },
    baseline: { result: 'PASS', project, at: '2026-09-25T20:14:00.000Z',
      appliedVersions: versions, fingerprintRows: 617,
      marker: '7f18a8fafb767f4fdd1a5a37401a6471',
      baselineAndPostflightExact: true, noOtherClientsObserved: true,
      noStagingWrites: true },
    packageManifestSha256: '7f8c7f5193c2484b8d6a9b751e120524f67ce27b09c4558ef3b062e695ecd902',
  }
}

describe('staging reservation pause apply guards', () => {
  it('requires a distinct staging apply approval', () => {
    expect(pauseApplyMode('--verify-local', undefined)).toBe('files')
    expect(() => pauseApplyMode('--apply-approved', undefined)).toThrow()
    expect(() => pauseApplyMode('--apply-approved', 'rollback-only-local-approved')).toThrow()
    expect(pauseApplyMode('--apply-approved', 'staging-pause-only-approved')).toBe('apply')
    expect(() => pauseApplyMode('--linked', 'staging-pause-only-approved')).toThrow()
  })

  it('accepts a fresh exact baseline after a verified backup and sole dry run', () => {
    expect(verifyPauseApplyReadiness(evidence())).toEqual({ result: 'READY',
      project, migration: pause })
  })

  it('rejects target, backup, restore, baseline, or dry-run drift', () => {
    for (const change of [
      { baseline: { project: 'other-project' } },
      { backup: { versions: versions.slice(1) } },
      { backup: { storageObjects: 1 } },
      { backup: { baselineReferenceSha256: 'b'.repeat(64) } },
      { backup: { pausePackageManifestSha256: 'b'.repeat(64) } },
      { restore: { captureManifestSha256: 'b'.repeat(64) } },
      { dryRun: { pending: ['20260921111105_tenant_enforcement.sql'] } },
      { dryRun: { noMigrationApplied: false } },
      { baseline: { appliedVersions: [...versions, '20260925174111'] } },
      { baseline: { noOtherClientsObserved: false } },
      { baseline: { noStagingWrites: false } },
      { packageManifestSha256: 'b'.repeat(64) },
    ]) {
      const input = evidence()
      for (const [key, value] of Object.entries(change)) {
        if (key === 'packageManifestSha256') input.packageManifestSha256 = value as string
        else Object.assign(input[key as 'backup' | 'restore' | 'dryRun' | 'baseline'], value)
      }
      expect(() => verifyPauseApplyReadiness(input)).toThrow()
    }
  })

  it('rejects stale or out-of-order evidence', () => {
    const stale = evidence()
    stale.baseline.at = '2026-09-25T19:59:00.000Z'
    expect(() => verifyPauseApplyReadiness(stale)).toThrow()
    const oldDryRun = evidence()
    oldDryRun.dryRun.at = '2026-09-25T19:59:00.000Z'
    expect(() => verifyPauseApplyReadiness(oldDryRun)).toThrow()
    const future = evidence()
    future.baseline.at = '2026-09-25T20:16:00.000Z'
    expect(() => verifyPauseApplyReadiness(future)).toThrow()
  })

  it('builds only a linked single-package push without broadening flags', () => {
    const args = pauseApplyArguments('C:/private/operator')
    expect(args).toEqual(['db', 'push', '--linked', '--workdir',
      'C:/private/operator', '--output-format', 'json', '--yes'])
    expect(args).not.toContain('--include-all')
    expect(args).not.toContain('--include-seed')
    expect(args).not.toContain('--include-roles')
    expect(args).not.toContain('--dry-run')
  })
})
