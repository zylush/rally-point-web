// One-shot, pause-only staging dry run. Does not apply migrations.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyReservationPauseDryRun } from './reservation-pause-dry-run-checks.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const project = 'iclrvvsiwypxlwrwgqia'
const packageRoot = join(root, 'docs/release-private/staging-reservation-pause-20260926-r1')
const priorStop = join(root, 'docs/release-private/staging-reservation-pause-dryrun-20260925-182447/STOP.json')
const cli = 'C:/Users/ed/node_modules/@supabase/cli-windows-x64/bin/supabase.exe'
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
const save = (name, value) => writeFileSync(join(evidence, name),
  typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
const run = (program, args, cwd, timeout = 90000) => spawnSync(program, args,
  { cwd, encoding: 'utf8', timeout, maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'] })

assert.equal(process.argv.length, 4,
  'Use --approved-dry-run <passing Gate 1 evidence directory>')
assert.equal(process.argv[2], '--approved-dry-run')
const gate1 = resolve(root, process.argv[3])
assert.match(gate1.replaceAll('\\', '/'),
  /\/docs\/release-private\/staging-gate1-fingerprint-\d{14}-[a-f0-9]{8}$/)
assert.equal(sha(priorStop),
  'bbc97e2b7fd6141763e76a1e9d28055cd7a14ab4b543fff6cc453e0e29a19dd9',
  'Prior STOP changed')
const baseline = JSON.parse(readFileSync(join(gate1, 'RESULT.json'), 'utf8'))
assert.equal(baseline.result, 'PASS')
assert.equal(baseline.project, project)
assert.equal(baseline.fingerprintRows, 617)
assert.equal(baseline.marker, '7f18a8fafb767f4fdd1a5a37401a6471')
assert.equal(baseline.appliedVersions.length, 13)
assert.equal(baseline.baselineAndPostflightExact, true)
assert.equal(baseline.noOtherClientsObserved, true)
assert.equal(baseline.noStagingWrites, true)
assert.ok(Date.now() - Date.parse(baseline.at) < 15 * 60 * 1000,
  'Passing staging baseline is no longer fresh')
assert.equal(sha(join(packageRoot, 'manifest.json')),
  '7f8c7f5193c2484b8d6a9b751e120524f67ce27b09c4558ef3b062e695ecd902')
assert.equal(readFileSync(join(root, 'supabase/.temp/project-ref'), 'utf8').trim(), project)
assert.ok(existsSync(cli), 'Pinned CLI missing')
const packageCheck = run(process.execPath, ['scripts/reservation-pause-package.mjs', '--verify'], root)
assert.equal(packageCheck.status, 0, 'Pause package failed verification')
assert.equal(JSON.parse(packageCheck.stdout).result, 'PASS')

const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
const evidence = join(root, 'docs/release-private',
  `staging-reservation-pause-dryrun-${stamp}-${randomBytes(4).toString('hex')}`)
assert.ok(!existsSync(evidence), 'Evidence folder collision')
mkdirSync(evidence)
let phase = 'isolate-package'
try {
  save('scope.json', { project, migrationApplyAuthorized: false, dryRunOnly: true,
    sourcePackageManifestSha256: sha(join(packageRoot, 'manifest.json')),
    priorStopSha256: sha(priorStop), gate1Evidence: gate1,
    gate1ResultSha256: sha(join(gate1, 'RESULT.json')) })
  const operator = join(evidence, 'operator')
  cpSync(join(packageRoot, 'database/supabase'), join(operator, 'supabase'),
    { recursive: true, errorOnExist: true, force: false })
  mkdirSync(join(operator, 'supabase/.temp'))
  writeFileSync(join(operator, 'supabase/.temp/project-ref'), project + '\n', { flag: 'wx' })
  const names = JSON.parse(packageCheck.stdout)
  assert.equal(names.pendingMigration, '20260925174111_reservation_write_pause.sql')
  assert.equal(names.enforcementExcluded, true)

  phase = 'cli-dry-run'
  const args = ['db', 'push', '--linked', '--dry-run', '--workdir', operator,
    '--output-format', 'json']
  save('command.json', { program: cli, args, linkedProject: project })
  const result = run(cli, args, root)
  save('cli.stdout.private', result.stdout || '')
  save('cli.stderr.private', result.stderr || String(result.error || ''))
  const parsed = verifyReservationPauseDryRun(result.stdout, result.stderr, result.status)
  phase = 'postflight'
  const post = run(process.execPath,
    ['scripts/run-gate1-fingerprint-readonly.mjs', '--approved-readonly'], root, 180000)
  save('postflight.stdout.private', post.stdout || '')
  save('postflight.stderr.private', post.stderr || String(post.error || ''))
  assert.equal(post.status, 0, 'Read-only staging postflight failed')
  const postResult = JSON.parse(post.stdout.trim())
  assert.equal(postResult.result, 'PASS')
  assert.equal(postResult.appliedVersions, 13)
  assert.equal(postResult.fingerprintRows, 617)
  assert.equal(postResult.marker, baseline.marker)
  save('RESULT.json', { result: 'PASS', at: new Date().toISOString(), project,
    ...parsed, baselineEvidence: gate1, postflightEvidence: postResult.evidence,
    noMigrationApplied: true, stagingActivityResumed: false })
  console.log(JSON.stringify({ result: 'PASS', evidence, pending: parsed.pending,
    postflight: postResult.evidence, noMigrationApplied: true }))
} catch (error) {
  save('STOP.json', { result: 'STOP', at: new Date().toISOString(), project, phase,
    reason: error instanceof Error ? error.message : 'Unknown dry-run failure',
    migrationApplyAuthorized: false, stagingActivityResumed: false })
  console.error(JSON.stringify({ result: 'STOP', phase, evidence,
    reason: error instanceof Error ? error.message : 'Unknown dry-run failure' }))
  process.exitCode = 1
}
