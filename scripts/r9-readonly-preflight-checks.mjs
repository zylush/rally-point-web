import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

const project = 'iclrvvsiwypxlwrwgqia'
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')

export function assertCleanSourceFolder(files) {
  assert.deepEqual([...files].sort(), ['README.md', 'evidence-lock.json'],
    'New preflight folder must contain only reviewed source/reference files')
}

export function assertFreshReadOnlyApproval(approval) {
  assert.ok(approval && typeof approval === 'object' && !Array.isArray(approval),
    'Fresh read-only approval missing')
  assert.deepEqual(Object.keys(approval).sort(), [
    'project', 'scope', 'stagingPausedAndTesterSessionsClosed',
    'previousStopSha256', 'r9ManifestSha256',
  ].sort(), 'Read-only approval fields changed')
  assert.ok(approval.project === 'iclrvvsiwypxlwrwgqia', 'Read-only approval target mismatch')
  assert.ok(approval.scope === 'r9-predeployment-readonly-retry', 'Read-only approval scope mismatch')
  assert.ok(approval.stagingPausedAndTesterSessionsClosed === true,
    'Staging pause confirmation missing')
  assert.ok(approval.previousStopSha256 ===
    'e81e21fb8ab2eab0976484a1bcdac7dc49f0fc2f7fc9043efbc5952a6b478837',
  'Latest STOP not acknowledged')
  assert.ok(approval.r9ManifestSha256 ===
    'efe015abbf52de6ee07bdf46a0d45826211c4feaa3009a2ba58839e92f200a46',
  'R9 candidate not pinned')
}

export function verifyPinnedLocalEvidence(bytes, expected) {
  for (const name of ['r9', 'r8', 'stop', 'recovery']) {
    assert.ok(Buffer.isBuffer(bytes[name]), 'Evidence bytes missing')
    assert.match(expected[name], /^[a-f0-9]{64}$/, 'Invalid evidence hash')
    assert.ok(hash(bytes[name]) === expected[name], `Pinned ${name} evidence changed`)
  }
  const r9 = JSON.parse(bytes.r9.toString('utf8'))
  const r8 = JSON.parse(bytes.r8.toString('utf8'))
  const stop = JSON.parse(bytes.stop.toString('utf8'))
  const recovery = JSON.parse(bytes.recovery.toString('utf8'))
  assert.equal(r9.packageId, 'staging-app-candidate-20260924-r9')
  assert.equal(r9.target.projectRef, project)
  assert.equal(r9.status, 'local-review-only')
  assert.equal(r9.databasePayload, false)
  assert.equal(r9.deploymentAuthorized, false)
  assert.equal(r9.enforcementAuthorized, false)
  assert.equal(r9.browserKeySource.keyCurrentValidityVerified, false)
  assert.equal(r9.files.length, 20)
  assert.equal(r9.sourceFiles.length, 105)
  assert.ok(!bytes.r9.toString('utf8').includes('sb_publishable_'), 'Key value in candidate manifest')
  assert.equal(r8.packageId, 'staging-privacy-release-20260923-r8')
  assert.equal(r8.target.projectRef, project)
  assert.equal(stop.result, 'STOP')
  assert.equal(stop.phase, 'synthetic-browser')
  assert.equal(stop.at, '2026-09-24T09:29:02.210Z')
  assert.equal(recovery.result, 'PASS')
  assert.equal(recovery.project, project)
  assert.equal(recovery.at, '2026-09-24T09:42:04.301Z')
  return { project, appFiles: r9.files.length, sourceFiles: r9.sourceFiles.length }
}
