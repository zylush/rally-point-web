// Pure validation of the frozen staging capture. This module never contacts a
// database and never includes captured row values in errors or return values.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

const versions = ['001', '002', '003', '004', '20260803125450',
  '20260805094557', '20260921090000', '20260921110828',
  '20260922011918', '20260922163027', '20260922163830',
  '20260922164128', '20260923053440']
const required = ['roles.sql', 'schema.sql', 'data.sql', 'managed_schema.sql',
  'managed_data.sql', 'history_schema.sql', 'history_data.sql',
  'managed_before_app.sql', 'managed_after_app.sql',
  'managed_migration_data.sql', 'managed_migration_rows.json',
  'application_acl_recovery.generated.sql', 'before_fingerprint.json',
  'before_inventory.json', 'before_catalog.json', 'before_grants.json',
  'before_preflight.json', 'before_sequences.json', 'after_fingerprint.json',
  'after_inventory.json', 'after_catalog.json', 'after_grants.json',
  'after_preflight.json', 'after_sequences.json']

export function validateCaptureManifest(manifest) {
  assert.ok(manifest && typeof manifest === 'object', 'Missing capture manifest')
  assert.equal(manifest.result, 'CAPTURE_PASS_RESTORE_PENDING', 'Capture is not complete')
  assert.equal(manifest.project, 'iclrvvsiwypxlwrwgqia', 'Wrong capture project')
  assert.equal(manifest.sourceVersion, '17.6.1.147', 'Unexpected source PostgreSQL version')
  assert.deepEqual(manifest.versions, versions, 'Migration history mismatch')
  assert.equal(manifest.tables, 54, 'Table count mismatch')
  assert.equal(manifest.publicFingerprint, '7f18a8fafb767f4fdd1a5a37401a6471', 'Fingerprint mismatch')
  assert.equal(manifest.storageObjects, 0, 'Storage objects require separate backup')
  assert.equal(manifest.activeClientsObserved, 0, 'Active client observed during capture')
  assert.equal(manifest.writeCounterChanges, 0, 'Writes observed during capture')
  assert.equal(manifest.restoreApproved, false, 'Capture cannot authorize restore')
  assert.equal(manifest.stagingWritesAuthorized, false, 'Staging writes cannot be authorized by capture')
  assert.equal(manifest.captureScriptSha256,
    'bb0066b6dea5e1d621f50c6be1cec05c7ec7ccdf04e6620b8d10989feedfdf02',
    'Capture script provenance mismatch')
  assert.equal(manifest.pausePackageManifestSha256,
    '7f8c7f5193c2484b8d6a9b751e120524f67ce27b09c4558ef3b062e695ecd902',
    'Pause package provenance mismatch')
  assert.equal(manifest.baselineReferenceSha256,
    '9e4d28231aa924aa991c5a5ea8d64e6e3920af0756733eeaa742260f7fa62338',
    'Baseline provenance mismatch')
  assert.ok(Date.parse(manifest.startedAt) < Date.parse(manifest.endedAt), 'Invalid capture timestamps')
  assert.ok(Array.isArray(manifest.files) && manifest.files.length === 67, 'Capture file count mismatch')
  const names = new Set()
  for (const entry of manifest.files) {
    assert.ok(entry && typeof entry.file === 'string' &&
      /^[a-zA-Z0-9_.-]+$/.test(entry.file) && entry.file !== '.' && entry.file !== '..',
    'Unsafe capture filename')
    assert.ok(!names.has(entry.file), 'Duplicate capture filename')
    names.add(entry.file)
    assert.ok(Number.isSafeInteger(entry.bytes) && entry.bytes > 0 &&
      typeof entry.sha256 === 'string' && /^[a-f0-9]{64}$/.test(entry.sha256),
    `Invalid capture file metadata: ${entry.file}`)
  }
  for (const name of required) assert.ok(names.has(name), `Missing capture file: ${name}`)
  return { files: names.size, tables: manifest.tables, versions: manifest.versions.length }
}

export function verifyCaptureFiles(manifest, readBytes) {
  validateCaptureManifest(manifest)
  for (const entry of manifest.files) {
    const bytes = readBytes(entry.file)
    assert.ok(Buffer.isBuffer(bytes) && bytes.length === entry.bytes &&
      createHash('sha256').update(bytes).digest('hex') === entry.sha256,
    `Capture file mismatch: ${entry.file}`)
  }
  return manifest.files.length
}

export function assertRestoreApproval(value) {
  assert.equal(value, 'disposable-local-restore-approved',
    'Disposable local restore requires separate approval')
}
