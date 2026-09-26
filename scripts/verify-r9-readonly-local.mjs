// Local-only source/reference guard. This file has no remote execution path.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertCleanSourceFolder, verifyPinnedLocalEvidence } from './r9-readonly-preflight-checks.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const folder = join(root, 'docs/release-private/staging-r9-readonly-preflight-20260924')
const files = {
  r9: ['docs/release-private/staging-app-candidate-20260924-r9/manifest.json', 'efe015abbf52de6ee07bdf46a0d45826211c4feaa3009a2ba58839e92f200a46'],
  r8: ['docs/release-private/staging-privacy-release-20260923-r8/manifest.json', 'c8863d66e618cdbbf02da3d66dd17fbef751cea5bdafbb27a91afb06c5941781'],
  stop: ['docs/release-private/staging-backup-20260923-r8/release-window/hosted-browser-post0839-local-20260924/STOP.json', '335ea14df0261efc4d3c35b747b6b545d0401b1842b7491a198b4bc3bea8b823'],
  recovery: ['docs/release-private/staging-backup-20260923-r8/release-window/auth-recovery-staff-stop-local-20260924/recovery-result.json', '8ff08d4db7dc47074bd7badb4d8ecf4974b0a284c172a38fd6703bea1acb92a1'],
}
assertCleanSourceFolder(readdirSync(folder))
const lock = JSON.parse(readFileSync(join(folder, 'evidence-lock.json'), 'utf8'))
assert.equal(lock.project, 'iclrvvsiwypxlwrwgqia')
assert.equal(lock.scope, 'local-only evidence pin for approved read-only pre-deployment checks')
for (const [name, [path, sha256]] of Object.entries(files)) {
  assert.equal(lock.files[name]?.path, path)
  assert.equal(lock.files[name]?.sha256, sha256)
}
assert.deepEqual(Object.keys(lock.files).sort(), Object.keys(files).sort())
const bytes = Object.fromEntries(Object.entries(files).map(([name, [path]]) => [name, readFileSync(join(root, path))]))
const expected = Object.fromEntries(Object.entries(files).map(([name, [, sha256]]) => [name, sha256]))
const result = verifyPinnedLocalEvidence(bytes, expected)
const candidate = spawnSync(process.execPath, ['scripts/prepare-r9-app-candidate.mjs', '--verify-frozen'],
  { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
assert.equal(candidate.status, 0, 'R9 candidate local verification failed')
console.log(JSON.stringify({ result: 'LOCAL_PASS', ...result, remoteChecked: false,
  keyCurrentValidityVerified: false, deployed: false }))
