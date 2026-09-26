// Pure checks for a separately approved pause-only staging application.
// This module has no database, network, or filesystem operations.
import assert from 'node:assert/strict'

const project = 'iclrvvsiwypxlwrwgqia'
const migration = '20260925174111_reservation_write_pause.sql'
const marker = '7f18a8fafb767f4fdd1a5a37401a6471'
const referenceHash = '9e4d28231aa924aa991c5a5ea8d64e6e3920af0756733eeaa742260f7fa62338'
const packageHash = '7f8c7f5193c2484b8d6a9b751e120524f67ce27b09c4558ef3b062e695ecd902'
const versions = ['001', '002', '003', '004', '20260803125450',
  '20260805094557', '20260921090000', '20260921110828',
  '20260922011918', '20260922163027', '20260922163830',
  '20260922164128', '20260923053440']
const freshnessMs = 15 * 60 * 1000

export function pauseApplyMode(flag, approval) {
  if (flag === '--verify-local') return 'files'
  if (flag === '--apply-approved') {
    assert.equal(approval, 'staging-pause-only-approved',
      'A separate staging pause-only approval is required')
    return 'apply'
  }
  throw new Error('Unsupported staging pause apply mode')
}

function timestamp(value, label) {
  assert.ok(typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value),
    `${label} timestamp missing`)
  const parsed = Date.parse(value)
  assert.ok(Number.isFinite(parsed) && new Date(parsed).toISOString() === value,
    `${label} timestamp invalid`)
  return parsed
}

export function verifyPauseApplyReadiness(input) {
  assert.ok(input && typeof input === 'object', 'Apply evidence missing')
  const { backup, backupSha256, restore, dryRun, baseline,
    packageManifestSha256 } = input
  assert.ok(backup && restore && dryRun && baseline, 'Apply evidence incomplete')
  assert.equal(backup.result, 'CAPTURE_PASS_RESTORE_PENDING', 'Backup capture did not pass')
  assert.equal(backup.project, project, 'Backup targets another project')
  assert.equal(backup.publicFingerprint, marker, 'Backup fingerprint drift')
  assert.equal(backup.tables, 54, 'Backup inventory drift')
  assert.deepEqual(backup.versions, versions, 'Backup migration history drift')
  assert.equal(backup.activeClientsObserved, 0, 'Backup observed another client')
  assert.equal(backup.writeCounterChanges, 0, 'Backup observed writes')
  assert.equal(backup.storageObjects, 0, 'Backup Storage objects are nonempty')
  assert.equal(backup.baselineReferenceSha256, referenceHash,
    'Backup canonical reference drift')
  assert.equal(backup.pausePackageManifestSha256, packageHash,
    'Backup pause package drift')
  assert.match(backupSha256, /^[a-f0-9]{64}$/i, 'Backup digest missing')
  assert.equal(restore.result, 'PASS', 'Disposable backup restore did not pass')
  assert.equal(restore.project, project, 'Restore refers to another project')
  assert.equal(restore.database, 'rally_pause_backup_restore_20260926',
    'Restore refers to another database')
  assert.equal(restore.captureManifestSha256.toLowerCase(), backupSha256.toLowerCase(),
    'Restore does not match backup')
  assert.equal(restore.stagingContacted, false, 'Restore contacted staging')
  assert.equal(restore.stagingChanged, false, 'Restore changed staging')
  assert.equal(dryRun.result, 'PASS', 'Dry run did not pass')
  assert.equal(dryRun.project, project, 'Dry run targets another project')
  assert.equal(dryRun.dryRun, true, 'Dry run flag missing')
  assert.deepEqual(dryRun.pending, [migration], 'Dry run is not pause-only')
  assert.equal(dryRun.noMigrationApplied, true, 'Dry run applied a migration')
  assert.equal(dryRun.stagingActivityResumed, false, 'Staging activity resumed')
  assert.equal(baseline.result, 'PASS', 'Fresh staging baseline did not pass')
  assert.equal(baseline.project, project, 'Baseline targets another project')
  assert.deepEqual(baseline.appliedVersions, versions, 'Baseline migration history drift')
  assert.equal(baseline.fingerprintRows, 617, 'Baseline fingerprint row drift')
  assert.equal(baseline.marker, marker, 'Baseline fingerprint drift')
  assert.equal(baseline.baselineAndPostflightExact, true,
    'Baseline and read-only postflight differ')
  assert.equal(baseline.noOtherClientsObserved, true, 'Another staging client observed')
  assert.equal(baseline.noStagingWrites, true, 'Staging writes observed')
  assert.equal(packageManifestSha256, packageHash, 'Pause package changed')
  const backupAt = timestamp(backup.endedAt, 'Backup')
  const dryRunAt = timestamp(dryRun.at, 'Dry run')
  const baselineAt = timestamp(baseline.at, 'Baseline')
  const now = timestamp(input.now, 'Current time')
  assert.ok(backupAt <= dryRunAt && dryRunAt <= baselineAt && baselineAt <= now,
    'Apply evidence is out of order')
  assert.ok(now - dryRunAt <= freshnessMs && now - baselineAt <= freshnessMs,
    'Apply evidence is no longer fresh')
  return { result: 'READY', project, migration }
}

export function pauseApplyArguments(operator) {
  assert.ok(typeof operator === 'string' &&
    /^[a-zA-Z]:[\\/]/.test(operator) && !/[\r\n]/.test(operator),
  'Isolated operator path must be absolute')
  return ['db', 'push', '--linked', '--workdir', operator,
    '--output-format', 'json', '--yes']
}
