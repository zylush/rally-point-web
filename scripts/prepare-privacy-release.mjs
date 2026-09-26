// Local file packaging only. No database driver, Supabase command, deploy or push.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ENFORCEMENT, PROJECT, REPAIR, verifyBrowserBundle, verifyMigrationSet } from './privacy-release-checks.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const packet = join(root, 'docs/release-private/staging-privacy-release-20260923-r8')
const read = (path) => readFileSync(path, 'utf8').replace(/^\uFEFF/, '')
const json = (path) => JSON.parse(read(path))
const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
const slash = (path) => path.replaceAll('\\', '/')
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    assert.ok(!entry.isSymbolicLink(), 'Symlinks are not allowed in a frozen package')
    const path = join(directory, entry.name)
    return entry.isDirectory() ? files(path) : [path]
  }).sort()
}
function copy(source, target) {
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(source, target)
}
function command(program, args) {
  const result = spawnSync(program, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  assert.equal(result.status, 0, `Local ${program} check failed`)
  return result.stdout.trim()
}
function historicalBackup() {
  const directory = join(root, 'docs/release-private/staging-backup-20260923-prerepair')
  // Parse the existing frozen hash literals as data, never execute the restore script.
  const literals = read(join(directory, 'restore_local.mjs')).match(/const checksums = \{([\s\S]*?)\n\}/)?.[1]
  assert.ok(literals, 'Historical backup hash list missing')
  const entries = [...literals.matchAll(/'([^']+)': '([A-F0-9]{64})'/g)]
  assert.equal(entries.length, 16, 'Historical backup inventory changed')
  const inventory = entries.map(([, file, expected]) => {
    assert.ok(!file.includes('/') && !file.includes('\\'), 'Unexpected backup path')
    const sha256 = hash(join(directory, file))
    assert.equal(sha256, expected.toLowerCase(), `Historical backup integrity: ${file}`)
    return { file, sha256 }
  })
  const prior = json(join(root, 'docs/release-private/staging-repair-fixture-result-20260923.json'))
  assert.equal(hash(join(directory, 'restore_rehearsal_result.json')), prior.backup.restore_result_sha256.toLowerCase())
  const restored = json(join(directory, 'restore_rehearsal_result.json'))
  assert.equal(restored.result, 'PASS')
  assert.equal(restored.source_project_ref, PROJECT)
  return { historicalIntegrity: 'PASS', historicalRestore: restored, inventory,
    suitableForCurrentRollback: false, freshBackupRequired: true,
    reason: 'Predates the three forward repairs and synthetic Auth/activity fixtures. No new capture or restore is performed by this tool.' }
}
function artifactChecks() {
  const app = files(join(packet, 'app'))
  assert.ok(!app.some((path) => /\.map$|\.env|credentials|backup|\.sql$/i.test(path)), 'Private or source-map file in deploy root')
  const browserText = app.filter((path) => /\.(js|html)$/.test(path)).map(read).join('\n')
  verifyBrowserBundle(browserText)
  const maintenance = read(join(packet, 'maintenance/index.html'))
  assert.ok(!/<script|<form|https?:\/\//i.test(maintenance), 'Maintenance page must not load APIs, scripts or forms')
  assert.ok(maintenance.includes('noindex') && maintenance.includes('Temporarily unavailable'))
  verifyMigrationSet(readdirSync(join(packet, 'database/supabase/migrations')),
    json(join(root, 'docs/release-private/staging-forward-repairs-20260923/manifest.json')).migrations.map((row) => row.file))
  assert.ok(!existsSync(join(packet, 'database/supabase/.temp')), 'Do not link this review package')
  const config = read(join(packet, 'database/supabase/config.toml'))
  assert.match(config, /\[db.seed\]\s+enabled = false\s+sql_paths = \[\]/)
}
function verify() {
  const manifest = json(join(packet, 'manifest.json'))
  assert.equal(manifest.target.projectRef, PROJECT)
  assert.deepEqual(manifest.pendingMigrations, [REPAIR])
  assert.deepEqual(manifest.excludedMigrations, [ENFORCEMENT])
  const actual = files(packet).map((path) => slash(relative(packet, path))).filter((path) => path !== 'manifest.json')
  assert.deepEqual(actual.sort(), manifest.files.map((row) => row.path).sort(), 'Package file inventory changed')
  for (const row of manifest.files) assert.equal(hash(join(packet, row.path)), row.sha256, `Package changed: ${row.path}`)
  for (const row of manifest.sourceFiles) assert.equal(hash(join(root, row.path)), row.sha256, `Source changed: ${row.path}`)
  artifactChecks()
  historicalBackup()
  console.log(JSON.stringify({ result: 'PASS', package: slash(relative(root, packet)),
    packageFiles: actual.length, sourceFiles: manifest.sourceFiles.length,
    pendingMigrations: manifest.pendingMigrations, enforcementExcluded: true,
    historicalBackupHashes: 16, freshBackupRequired: true, applied: false, deployed: false }))
}

assert.ok(process.argv.length <= 3, 'Expected one packaging mode')
if (process.argv[2] === '--verify') {
  verify()
} else {
  assert.ok([undefined, '--use-existing-browser-key'].includes(process.argv[2]), 'Unsupported packaging mode')
  assert.ok(!existsSync(packet), 'Package already exists; verify it or choose a newly reviewed release ID in source')
  const buildEnv = { ...process.env }
  let browserKeySource = { kind: 'configured-staging-environment', associationVerifiedThisRun: false }
  if (process.argv[2] === '--use-existing-browser-key') {
    // Public browser key only, reused in this child process. Never write .env or
    // inspect Auth/Admin credentials. URL co-location is not key association proof.
    const priorBundle = join(root, 'staging-artifact.local/assets/index-CUS71MsR.js')
    const text = read(priorBundle)
    const hosts = [...new Set(text.match(/https:\/\/[a-z0-9]+\.supabase\.co/g) ?? [])]
    assert.deepEqual(hosts, [`https://${PROJECT}.supabase.co`])
    const keys = [...new Set(text.match(/sb_publishable_[A-Za-z0-9_-]+/g) ?? [])]
    assert.equal(keys.length, 1, 'Expected exactly one public browser key in the prior local artifact')
    buildEnv.VITE_SUPABASE_URL = `https://${PROJECT}.supabase.co`
    buildEnv.VITE_SUPABASE_ANON_KEY = keys[0]
    browserKeySource = { kind: 'prior-local-browser-artifact', path: slash(relative(root, priorBundle)),
      sha256: hash(priorBundle), associationVerifiedThisRun: false }
  }
  const backup = historicalBackup()
  const baseline = json(join(root, 'docs/release-private/staging-forward-repairs-20260923/manifest.json'))
  const orders = json(join(root, 'docs/release-private/deferred-enforcement-orders.json'))
  const migrations = [...baseline.migrations, { file: REPAIR, sha256: orders.migrationHashes[REPAIR] }]
  for (const row of migrations) assert.equal(hash(join(root, 'supabase/migrations', row.file)), row.sha256, `Migration source changed: ${row.file}`)
  for (const [file, sha256] of Object.entries(orders.migrationHashes)) assert.equal(hash(join(root, 'supabase/migrations', file)), sha256)
  assert.equal(orders.identicalFinalState, true)
  const sourcePaths = [...files(join(root, 'src')), ...files(join(root, 'public')),
    ...['package.json','package-lock.json','index.html','vite.config.ts','tsconfig.json','tsconfig.app.json','tsconfig.node.json',
      'scripts/privacy-release-checks.mjs','scripts/prepare-privacy-release.mjs',
      'supabase/verification/schema_fingerprint.sql','supabase/verification/tenant_grant_snapshot.sql',
      'supabase/verification/backup_content_inventory.sql','supabase/verification/staging_privacy_readonly_preflight.sql',
      'docs/PRIVACY-RELEASE-RUNBOOK.md','docs/privacy-maintenance.html',
      'docs/release-private/deferred-enforcement-orders.json',
      'docs/release-private/staging-forward-repairs-20260923/supabase/config.toml',
      'tests/member-privacy-tdd.md','tests/bookings-desk-race-tdd.md','tests/financial-labels-tdd.md'].map((file) => join(root, file))]
  const sourceFiles = sourcePaths.map((path) => ({ path: slash(relative(root, path)), sha256: hash(path) }))
  mkdirSync(packet, { recursive: true })
  for (const row of migrations) copy(join(root, 'supabase/migrations', row.file), join(packet, 'database/supabase/migrations', row.file))
  copy(join(root, 'docs/release-private/staging-forward-repairs-20260923/supabase/config.toml'), join(packet, 'database/supabase/config.toml'))
  copy(join(root, 'docs/PRIVACY-RELEASE-RUNBOOK.md'), join(packet, 'RUNBOOK.md'))
  copy(join(root, 'docs/privacy-maintenance.html'), join(packet, 'maintenance/index.html'))
   for (const file of ['schema_fingerprint.sql','tenant_grant_snapshot.sql','backup_content_inventory.sql']) {
     copy(join(root, 'supabase/verification', file), join(packet, 'checks', file))
   }
   copy(join(root, 'supabase/verification/staging_privacy_readonly_preflight.sql'),
     join(packet, 'checks/staging_privacy_readonly_preflight.sql'))
  copy(join(root, 'docs/release-private/deferred-enforcement-orders.json'), join(packet, 'evidence/migration-orders.json'))
  copy(join(root, 'tests/member-privacy-tdd.md'), join(packet, 'evidence/local-privacy-verification.md'))
  copy(join(root, 'tests/bookings-desk-race-tdd.md'), join(packet, 'evidence/bookings-desk-race-tdd.md'))
  copy(join(root, 'tests/financial-labels-tdd.md'), join(packet, 'evidence/financial-labels-tdd.md'))
  writeFileSync(join(packet, 'evidence/backup-check.json'), JSON.stringify(backup, null, 2) + '\n')
  // Dedicated output avoids overwriting dist or the previously published artifact.
  const build = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--mode', 'staging', '--outDir', join(packet, 'app')],
    { cwd: root, stdio: 'inherit', env: buildEnv })
  assert.equal(build.status, 0, 'Staging artifact build failed; package is incomplete')
  artifactChecks()
  const manifest = {
     packageId: 'staging-privacy-release-20260923-r8', createdAt: new Date().toISOString(), status: 'local-review-only',
    target: { name: 'Rally-Point-Database', projectRef: PROJECT, website: 'https://zylush.github.io/rally-point-web/' },
    sourceCommit: command('git', ['rev-parse','HEAD']), branch: command('git', ['branch','--show-current']),
    worktreeStatus: command('git', ['status','--short']), nodeVersion: process.version,
    packageLockVersion: json(join(root, 'package-lock.json')).lockfileVersion, browserKeySource,
    expectedAppliedVersions: baseline.migrations.map((row) => row.file.split('_')[0]),
    pendingMigrations: [REPAIR], excludedMigrations: [ENFORCEMENT],
    freshBackupRequired: true, historicalBackupSuitableForRollback: false,
    oldClientDrainRequired: true, sourceFiles,
    files: files(packet).map((path) => ({ path: slash(relative(packet, path)), sha256: hash(path) })),
    applyAuthorized: false, deploymentAuthorized: false, enforcementAuthorized: false,
  }
  writeFileSync(join(packet, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  verify()
}
