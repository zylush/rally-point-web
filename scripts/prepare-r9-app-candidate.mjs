// Local app-only packaging. No hosted, database, Auth, browser, Git write, or deploy calls.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PROJECT, verifyBrowserBundle } from './privacy-release-checks.mjs'
import { extractPinnedPublishableKey, sha256, verifyFileInventory } from './r9-app-candidate-checks.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const frozen = join(root, 'docs/release-private/staging-privacy-release-20260923-r8')
const candidate = join(root, 'docs/release-private/staging-app-candidate-20260924-r9')
const slash = (path) => path.replaceAll('\\', '/')
const read = (path) => readFileSync(path, 'utf8')
const json = (path) => JSON.parse(read(path))
const hash = (path) => sha256(readFileSync(path))
const command = (program, args) => {
  const result = spawnSync(program, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  assert.equal(result.status, 0, `Local ${program} metadata check failed`)
  return result.stdout.trim()
}

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    assert.ok(!entry.isSymbolicLink(), 'Symlink forbidden in candidate')
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return files(path)
    assert.ok(entry.isFile(), 'Non-file candidate entry')
    return [path]
  }).sort()
}
function inventory(base, paths) {
  return paths.map((path) => ({ path: slash(relative(base, path)), sha256: hash(path) }))
}
function sourcePaths() {
  return [
    ...files(join(root, 'src')),
    ...files(join(root, 'public')),
    ...files(join(root, 'supabase/migrations')),
    ...files(join(root, 'supabase/tests/database')),
    ...['package.json', 'package-lock.json', 'index.html', 'vite.config.ts', 'vitest.config.ts',
      'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json', '.env.staging',
      'scripts/prepare-r9-app-candidate.mjs', 'scripts/r9-app-candidate-checks.mjs',
      'scripts/privacy-release-checks.mjs', 'tests/r9-app-candidate.test.ts',
      'tests/r8-browser-key-provenance-local.md'].map((path) => join(root, path)),
  ].sort()
}
function verifyFrozenAndGetKey() {
  const manifest = json(join(frozen, 'manifest.json'))
  assert.equal(manifest.packageId, 'staging-privacy-release-20260923-r8')
  assert.equal(manifest.target.projectRef, PROJECT)
  verifyFileInventory(manifest.files, inventory(frozen, files(frozen).filter((path) => path !== join(frozen, 'manifest.json'))))
  const javascript = manifest.files.filter((row) => /^app\/assets\/[^/]+\.js$/.test(row.path))
  assert.equal(javascript.length, 1, 'Expected one frozen r8 app bundle')
  const prior = manifest.browserKeySource
  assert.equal(prior.kind, 'prior-local-browser-artifact')
  assert.equal(prior.path, 'staging-artifact.local/assets/index-CUS71MsR.js')
  assert.equal(hash(join(root, prior.path)), prior.sha256, 'Prior browser bundle hash drift')
  const key = extractPinnedPublishableKey({
    priorBundle: read(join(root, prior.path)), frozenBundle: read(join(frozen, javascript[0].path)),
    priorHash: prior.sha256, frozenHash: javascript[0].sha256, project: PROJECT,
  })
  return { key, priorPath: prior.path, priorHash: prior.sha256,
    frozenPath: javascript[0].path, frozenHash: javascript[0].sha256 }
}
function verifyApp(key) {
  const app = files(join(candidate, 'app'))
  assert.ok(app.length > 0, 'Empty app candidate')
  assert.ok(!app.some((path) => /\.map$|\.env|credentials|backup|\.sql$/i.test(path)), 'Private or source-map file in app candidate')
  const browserText = app.filter((path) => /\.(js|html)$/.test(path)).map(read).join('\n')
  verifyBrowserBundle(browserText)
  const found = [...new Set(browserText.match(/sb_publishable_[A-Za-z0-9_-]+/g) ?? [])]
  assert.equal(found.length, 1, 'Expected one public key in app candidate')
  assert.ok(found[0] === key, 'App candidate browser key differs from frozen r8')
  assert.ok(app.some((path) => path === join(candidate, 'app/index.html')), 'Missing app entry point')
  assert.ok(app.some((path) => path === join(candidate, 'app/404.html')), 'Missing Pages fallback')
  return inventory(candidate, app)
}
function verify(checkCurrentSource = true) {
  const { key, priorHash, frozenHash } = verifyFrozenAndGetKey()
  const manifest = json(join(candidate, 'manifest.json'))
  assert.equal(manifest.packageId, 'staging-app-candidate-20260924-r9')
  assert.equal(manifest.target.projectRef, PROJECT)
  assert.equal(manifest.status, 'local-review-only')
  assert.equal(manifest.browserKeySource.priorHash, priorHash)
  assert.equal(manifest.browserKeySource.frozenHash, frozenHash)
  assert.equal(manifest.databasePayload, false)
  assert.equal(manifest.deploymentAuthorized, false)
  assert.equal(manifest.enforcementAuthorized, false)
  verifyFileInventory(manifest.files, inventory(candidate,
    files(candidate).filter((path) => path !== join(candidate, 'manifest.json'))))
  // A frozen artifact remains valid after later source-only migrations are added.
  // Build-time verification still requires the original exact source inventory.
  verifyFileInventory(manifest.sourceFiles,
    checkCurrentSource ? inventory(root, sourcePaths()) : manifest.sourceFiles)
  verifyFileInventory(manifest.files, verifyApp(key))
  console.log(JSON.stringify({ result: 'PASS', candidate: slash(relative(root, candidate)),
    appFiles: manifest.files.length, sourceFiles: manifest.sourceFiles.length,
    frozenR8Intact: true, currentSourceCompared: checkCurrentSource,
    keyCurrentValidityVerified: false,
    databasePayload: false, applied: false, deployed: false }))
}

assert.ok(['--build', '--verify', '--verify-frozen'].includes(process.argv[2]) && process.argv.length === 3,
  'Use --build, --verify, or --verify-frozen')
if (process.argv[2] === '--verify' || process.argv[2] === '--verify-frozen') {
  verify(process.argv[2] === '--verify')
} else {
  assert.ok(!existsSync(candidate), 'Candidate folder already exists; no overwrite permitted')
  const { key, priorPath, priorHash, frozenPath, frozenHash } = verifyFrozenAndGetKey()
  assert.ok(!read(join(root, '.env.staging')).includes('sb_publishable_'), 'Publishable key must not be persisted in staging env file')
  const sourceFiles = inventory(root, sourcePaths())
  mkdirSync(candidate)
  const build = spawnSync(process.execPath,
    ['node_modules/vite/bin/vite.js', 'build', '--mode', 'staging', '--outDir', join(candidate, 'app')],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: {
      ...process.env, VITE_SUPABASE_URL: `https://${PROJECT}.supabase.co`,
      VITE_SUPABASE_ANON_KEY: key, VITE_BASE: '/rally-point-web/',
    } })
  assert.equal(build.status, 0, 'Local staging app build failed; candidate incomplete')
  const appFiles = verifyApp(key)
  const manifest = {
    packageId: 'staging-app-candidate-20260924-r9', createdAt: new Date().toISOString(),
    status: 'local-review-only',
    target: { name: 'Rally-Point-Database', projectRef: PROJECT,
      website: 'https://zylush.github.io/rally-point-web/' },
    sourceCommit: command('git', ['rev-parse', 'HEAD']),
    branch: command('git', ['branch', '--show-current']),
    nodeVersion: process.version, packageLockVersion: json(join(root, 'package-lock.json')).lockfileVersion,
    browserKeySource: { kind: 'verified-r8-local-and-frozen-browser-bundles',
      priorPath, priorHash, frozenPath, frozenHash,
      historicalAssociationOnly: true, keyCurrentValidityVerified: false },
    sourceFiles, files: appFiles,
    databasePayload: false, deploymentAuthorized: false, enforcementAuthorized: false,
  }
  writeFileSync(join(candidate, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  verify()
}
