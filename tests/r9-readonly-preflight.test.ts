// @vitest-environment node
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { assertCleanSourceFolder, assertFreshReadOnlyApproval,
  verifyPinnedLocalEvidence } from '../scripts/r9-readonly-preflight-checks.mjs'

const project = 'iclrvvsiwypxlwrwgqia'
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
const r9 = JSON.stringify({ packageId: 'staging-app-candidate-20260924-r9', target: { projectRef: project },
  status: 'local-review-only', files: Array(20).fill({ path: 'app/a', sha256: 'a'.repeat(64) }),
  sourceFiles: Array(105).fill({ path: 'src/a', sha256: 'b'.repeat(64) }),
  databasePayload: false, deploymentAuthorized: false, enforcementAuthorized: false,
  browserKeySource: { keyCurrentValidityVerified: false } })
const r8 = JSON.stringify({ packageId: 'staging-privacy-release-20260923-r8', target: { projectRef: project } })
const stop = JSON.stringify({ result: 'STOP', at: '2026-09-24T09:29:02.210Z', phase: 'synthetic-browser' })
const recovery = JSON.stringify({ result: 'PASS', at: '2026-09-24T09:42:04.301Z', project })
const bytes = { r9: Buffer.from(r9), r8: Buffer.from(r8), stop: Buffer.from(stop), recovery: Buffer.from(recovery) }
const expected = Object.fromEntries(Object.entries(bytes).map(([name, value]) => [name, sha256(value)]))

describe('r9 read-only preflight source boundary', () => {
  it('accepts the exact local candidate, STOP, and passed recovery references', () => {
    expect(verifyPinnedLocalEvidence(bytes, expected)).toEqual({ project, appFiles: 20, sourceFiles: 105 })
  })

  it.each(['r9', 'r8', 'stop', 'recovery'])('rejects altered %s bytes before any remote step', (name) => {
    expect(() => verifyPinnedLocalEvidence({ ...bytes, [name]: Buffer.concat([bytes[name as keyof typeof bytes], Buffer.from(' ')]) }, expected)).toThrow()
  })

  it('rejects a broader or invalid candidate even when its hash is updated', () => {
    const altered = Buffer.from(r9.replace('"deploymentAuthorized":false', '"deploymentAuthorized":true'))
    expect(() => verifyPinnedLocalEvidence({ ...bytes, r9: altered }, { ...expected, r9: sha256(altered) })).toThrow()
  })

  it('rejects an unresolved or wrong-target recovery even when its hash is updated', () => {
    const altered = Buffer.from(recovery.replace('"result":"PASS"', '"result":"STOP"'))
    expect(() => verifyPinnedLocalEvidence({ ...bytes, recovery: altered }, { ...expected, recovery: sha256(altered) })).toThrow()
  })

  it('allows only reviewed source/reference files in the new folder', () => {
    expect(() => assertCleanSourceFolder(['README.md', 'evidence-lock.json'])).not.toThrow()
    for (const extra of ['remote-approval.json', 'member-password.private.log', 'STOP.json', 'auth-current.json']) {
      expect(() => assertCleanSourceFolder(['README.md', 'evidence-lock.json', extra])).toThrow()
    }
  })

  it('requires a new narrow approval tied to the latest pre-deployment STOP', () => {
    const approval = {
      project,
      scope: 'r9-predeployment-readonly-retry',
      stagingPausedAndTesterSessionsClosed: true,
      previousStopSha256: 'e81e21fb8ab2eab0976484a1bcdac7dc49f0fc2f7fc9043efbc5952a6b478837',
      r9ManifestSha256: 'efe015abbf52de6ee07bdf46a0d45826211c4feaa3009a2ba58839e92f200a46',
    }
    expect(() => assertFreshReadOnlyApproval(approval)).not.toThrow()
    expect(() => assertFreshReadOnlyApproval(null)).toThrow()
    expect(() => assertFreshReadOnlyApproval({ ...approval, previousStopSha256: 'old-stop' })).toThrow()
    expect(() => assertFreshReadOnlyApproval({ ...approval, scope: 'read-only plus deployment' })).toThrow()
    expect(() => assertFreshReadOnlyApproval({ ...approval, stagingPausedAndTesterSessionsClosed: false })).toThrow()
    expect(() => assertFreshReadOnlyApproval({ ...approval, allowSignIns: true })).toThrow()
  })
})
