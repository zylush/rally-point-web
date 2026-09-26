// Filesystem-only provenance checks. No Supabase, database, or hosted requests.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { verifyCaptureFiles } from './staging-pause-restore-checks.mjs'
import { validatePauseInventory } from './reservation-pause-package.mjs'

export const project = 'iclrvvsiwypxlwrwgqia'
export const cli = 'C:/Users/ed/node_modules/@supabase/cli-windows-x64/bin/supabase.exe'
export const cliHash = '14814afa6fe59081eb9f24709fc077226bf89bc25cf77ee3bcb19565f3ef8899'
export const defaultRoot = fileURLToPath(new URL('../', import.meta.url))
export const capturePath = 'docs/release-private/staging-pause-backup-20260926-r1'
export const migrationPath = 'docs/release-private/staging-reservation-pause-20260926-r1'
export const linkedCachePath = 'docs/release-private/staging-reservation-pause-dryrun-20260925184439-da84a4c6/operator/supabase/.temp/linked-project.json'
export const snapshotNames = ['fingerprint', 'inventory', 'catalog', 'grants', 'sequences', 'activity', 'preflight']
export const shaBytes = bytes => createHash('sha256').update(bytes).digest('hex')
const fixed = [
  [capturePath + '/capture_manifest.json', 'a5cb6805b281f356bbc31ca857dd2e55fdf473eb33ebe0c0282701a1a2651d0d'],
  [migrationPath + '/manifest.json', '7f8c7f5193c2484b8d6a9b751e120524f67ce27b09c4558ef3b062e695ecd902'],
  ['docs/release-private/staging-pause-restore-20260926-r1/result.json', 'e9c1717958f20899ff4dcd4d2d773b56061a57c94fdc974ce2bba4f7f9172fa4'],
  ['docs/release-private/reservation-pause-restored-rollback-only-20260925201135-61810a60/RESULT.json', 'f5154fde4af558ed667828d8ff12379f3159e9a13cef071b876f049c7b33a6e7'],
  ['docs/release-private/reservation-pause-restored-read-only-20260925200309-51223bac/STOP.json', 'f630cbd08064c3bb859776704f5f5d8498dfed038e05ee67a81b686bf1be755c'],
  ['scripts/run-reservation-pause-restored-local-rehearsal.mjs', 'f0150ff924c08c746590b70d8fba95f864f4cab51a2331b31f678407559c380c'],
  [linkedCachePath, '3b53513fc2360a9b7f0c0086aca0a6bc36b900f1aa19a30149c4d20a46b225f4'],
]
const sources = [
  'run-reservation-pause-staging-apply.mjs', 'reservation-pause-staging-runtime.mjs',
  'reservation-pause-runner-files.mjs', 'reservation-pause-staging-flow.mjs',
  'reservation-pause-staging-apply-checks.mjs', 'reservation-pause-dry-run-checks.mjs',
  'reservation-pause-local-rehearsal-checks.mjs', 'reservation-pause-postflight-checks.mjs',
  'staging-pause-restore-checks.mjs', 'reservation-pause-package.mjs', 'r9-readonly-compare.mjs',
].map(name => 'scripts/' + name).sort()

export function checkedPath(root, path, allowMissing = false) {
  assert.ok(typeof path === 'string' && path.length > 0 && !path.includes('\\') &&
    path.split('/').every(part => /^[a-zA-Z0-9_.-]+$/.test(part) && part !== '.' && part !== '..'),
  'Unsafe relative artifact path')
  let current = resolve(root)
  assert.ok(!lstatSync(current).isSymbolicLink(), 'Root links are forbidden')
  for (const part of path.split('/')) {
    current = join(current, part)
    if (allowMissing && !existsSync(current)) continue
    assert.ok(!lstatSync(current).isSymbolicLink(), 'Artifact links are forbidden')
  }
  return current
}
const read = (root, path) => readFileSync(checkedPath(root, path))
const json = (root, path) => JSON.parse(read(root, path).toString('utf8'))
const same = (a, b, label) => assert.ok(isDeepStrictEqual(a, b), label)

export function artifactFiles(root, prefix = '') {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    assert.ok(!entry.isSymbolicLink(), 'Artifact links are forbidden')
    const name = prefix + entry.name
    if (entry.isDirectory()) return artifactFiles(join(root, entry.name), name + '/')
    assert.ok(entry.isFile(), 'Artifact is not a regular file')
    return [name]
  }).sort()
}

export function runnerPaths(options = {}) {
  const root = resolve(options.root || defaultRoot)
  const packet = resolve(options.packet || join(root, 'docs/release-private/staging-pause-apply-20260926-r1'))
  const rel = relative(root, packet).replaceAll('\\', '/')
  assert.ok(rel.startsWith('docs/release-private/'), 'Runner package must be private and repository-local')
  checkedPath(root, rel, true)
  const ignored = spawnSync('git', ['check-ignore', '-q', '--', rel + '/manifest.json'],
    { cwd: root, windowsHide: true, stdio: 'pipe' })
  assert.equal(ignored.status, 0, 'Private artifacts must be Git-ignored')
  return { root, packet }
}

export function frozenPauseInputs(root) {
  for (const [path, expected] of fixed) assert.ok(shaBytes(read(root, path)) === expected, 'Frozen reference drift')
  const backup = json(root, fixed[0][0])
  const captureFiles = verifyCaptureFiles(backup, file => read(root, capturePath + '/' + file))
  const migrations = json(root, fixed[1][0])
  same(artifactFiles(checkedPath(root, migrationPath)),
    ['manifest.json', ...migrations.files.map(row => row.path)].sort(), 'Migration package inventory drift')
  for (const row of migrations.files) assert.ok(shaBytes(read(root, migrationPath + '/' + row.path)) === row.sha256,
    'Frozen migration package bytes changed')
  const migrationFiles = migrations.files.filter(row => row.path.startsWith('database/supabase/migrations/'))
  validatePauseInventory(migrationFiles.map(row => row.path.split('/').at(-1)))
  assert.match(read(root, migrationPath + '/database/supabase/config.toml').toString(),
    /\[db.seed\]\s+enabled = false\s+sql_paths = \[\]/, 'Seeds must be disabled')
  const restore = json(root, fixed[2][0])
  assert.ok(restore.result === 'PASS' && restore.project === project &&
    restore.database === 'rally_pause_backup_restore_20260926' &&
    restore.captureManifestSha256.toLowerCase() === fixed[0][1] &&
    restore.stagingContacted === false && restore.stagingChanged === false, 'Restore evidence mismatch')
  assert.equal(json(root, fixed[3][0]).result, 'PASS', 'Local rehearsal did not pass')
  assert.ok(!lstatSync(cli).isSymbolicLink() && shaBytes(readFileSync(cli)) === cliHash, 'CLI binary drift')
  return { backup, backupSha256: fixed[0][1], restore, packageManifestSha256: fixed[1][1],
    migrations, captureFiles, migrationFiles: migrationFiles.length,
    saved: Object.fromEntries(snapshotNames.map(name => [name, json(root, `${capturePath}/before_${name}.json`)])) }
}

function manifestFor(root) {
  return { kind: 'staging-pause-apply-v1', project, databaseContacted: false, stagingApplyAuthorized: false,
    cli: { path: cli, version: '2.110.0', sha256: cliHash },
    sources: sources.map(path => ({ path, sha256: shaBytes(read(root, path)) })),
    references: fixed.map(([path, sha256]) => ({ path, sha256 })) }
}

export function preparePauseRunner(options = {}) {
  const { root, packet } = runnerPaths(options)
  assert.ok(!existsSync(packet), 'Never overwrite a runner package')
  frozenPauseInputs(root)
  const manifest = manifestFor(root)
  mkdirSync(packet) // Parent must already exist; no broad directory creation.
  writeFileSync(join(packet, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' })
  return verifyPauseRunner({ root, packet })
}

export function verifyPauseRunner(options = {}) {
  const { root, packet } = runnerPaths(options)
  const bytes = readFileSync(checkedPath(packet, 'manifest.json'))
  const manifestSha256 = shaBytes(bytes)
  if (options.manifestSha256 !== undefined) assert.ok(options.manifestSha256 === manifestSha256,
    'Runner manifest does not match approved digest')
  same(JSON.parse(bytes.toString('utf8')), manifestFor(root), 'Runner source or reference pins changed')
  const proof = frozenPauseInputs(root)
  return { result: 'LOCAL_READY_APPROVAL_REQUIRED', project, manifestSha256,
    captureFiles: proof.captureFiles, migrationFiles: proof.migrationFiles, databaseContacted: false,
    stagingApplyAuthorized: false, attemptConsumed: existsSync(join(packet, 'ATTEMPT.json')) }
}
