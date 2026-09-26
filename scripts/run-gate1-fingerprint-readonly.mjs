// Canonical Gate 1 staging fingerprint. Every SQL request is pinned and read-only.
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertApprovedQuery } from '../docs/release-private/staging-backup-20260923-r8/release-window/auth-recovery-staff-stop-local-20260924/read-only-sql.mjs'
import { assertExactSnapshot, assertStableActivity, verifyCanonicalFingerprint,
  verifyStagingTarget } from './r9-readonly-compare.mjs'

assert.ok(process.argv.length === 3 &&
  ['--verify-local', '--approved-readonly'].includes(process.argv[2]),
  'Use --verify-local or --approved-readonly')
const root = fileURLToPath(new URL('../', import.meta.url))
const project = 'iclrvvsiwypxlwrwgqia'
const windowRoot = join(root, 'docs/release-private/staging-backup-20260923-r8/release-window')
const reference = join(windowRoot, 'auth-recovery-staff-stop-local-20260924')
const operator = join(windowRoot, 'operator')
const cli = 'C:/Users/ed/node_modules/@supabase/cli-windows-x64/bin/supabase.exe'
const fingerprintSource = join(root, 'supabase/verification/schema_fingerprint.sql')
const fingerprintWrapped = join(windowRoot, 'baseline_fingerprint.sql')
const fingerprintReference = join(root,
  'docs/release-private/staging-gate1-fingerprint-20260925085234-32d2014a/fingerprint.json')
const fingerprintReferenceHash = '9e4d28231aa924aa991c5a5ea8d64e6e3920af0756733eeaa742260f7fa62338'
const fingerprintMarker = '7f18a8fafb767f4fdd1a5a37401a6471'
const fingerprintRows = 617
const runId = `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${randomBytes(4).toString('hex')}`
const output = join(root, 'docs/release-private', `staging-gate1-fingerprint-${runId}`)
const sha = (value) => createHash('sha256').update(value).digest('hex')
const hash = (path) => sha(readFileSync(path))
const read = (path) => readFileSync(path, 'utf8').replace(/^\uFEFF/, '')
const json = (path) => JSON.parse(read(path))
const canonical = (value) => value.replace(/\r\n/g, '\n').trim()

function save(name, value) {
  writeFileSync(join(output, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n',
    { flag: 'wx' })
}
function command(program, args, label, timeout = 60000) {
  const result = spawnSync(program, args, { cwd: root, encoding: 'utf8', timeout,
    maxBuffer: 30 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
  save(`${label}.stdout.private`, result.stdout || '')
  save(`${label}.stderr.private`, result.stderr || String(result.error || ''))
  assert.equal(result.status, 0, `${label} failed; private diagnostics retained`)
  return result.stdout.trim()
}
function query(label, path, fingerprint = false) {
  const sql = read(path)
  if (fingerprint) {
    assert.equal(canonical(sql), `BEGIN READ ONLY;\n${canonical(read(fingerprintSource))}\nCOMMIT;`,
      'Fingerprint wrapper no longer matches current source')
  } else assertApprovedQuery(sql)
  const response = JSON.parse(command(cli,
    ['db', 'query', '--linked', '--workdir', operator, '--file', path, '--output-format', 'json'], label))
  assert.ok(Array.isArray(response.rows), `${label} result rows missing`)
  save(`${label}.json`, response.rows)
  return response.rows
}

let phase = 'local-pins'
let started = false
try {
  assert.equal(read(join(root, 'supabase/.temp/project-ref')).trim(), project)
  assert.equal(read(join(operator, 'supabase/.temp/project-ref')).trim(), project)
  assert.ok(existsSync(cli), 'Pinned Supabase CLI binary missing')
  const local = spawnSync(process.execPath, ['scripts/verify-r9-readonly-local.mjs'],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  assert.equal(local.status, 0, 'Frozen r9/reference pins failed')
  assert.equal(json(join(reference, 'grants.json'))[0].snapshot.versions.length, 13,
    'Saved 13-version staging baseline missing')
  assert.equal(canonical(read(fingerprintWrapped)),
    `BEGIN READ ONLY;\n${canonical(read(fingerprintSource))}\nCOMMIT;`,
    'Fingerprint wrapper no longer matches current source')
  assert.equal(hash(fingerprintReference), fingerprintReferenceHash,
    'Saved canonical fingerprint evidence changed')
  const savedFingerprint = json(fingerprintReference)
  verifyCanonicalFingerprint(savedFingerprint, savedFingerprint, fingerprintMarker, fingerprintRows)
  for (const name of ['activity', 'inventory', 'catalog', 'grants', 'sequences']) {
    assertApprovedQuery(read(join(windowRoot, `post_test_${name}.sql`)))
  }
  assertApprovedQuery(read(join(reference, 'auth-state.sql')))
  if (process.argv[2] === '--verify-local') {
    console.log(JSON.stringify({ result: 'PASS', localOnly: true, project,
      appliedVersions: 13, fingerprintSourceSha256: hash(fingerprintSource) }))
    process.exit(0)
  }
  assert.ok(!existsSync(output), 'Private evidence folder collision')
  mkdirSync(output)
  started = true
  save('scope.json', { project, readOnly: true, noSignins: true,
    fingerprintSourceSha256: hash(fingerprintSource),
    fingerprintWrapperSha256: hash(fingerprintWrapped),
    referenceResultSha256: hash(join(reference, 'recovery-result.json')) })

  phase = 'target'
  verifyStagingTarget(JSON.parse(command(cli, ['projects', 'list', '--output-format', 'json'], 'projects')))

  phase = 'baseline'
  const sql = (name) => join(windowRoot, `post_test_${name}.sql`)
  const baselineActivity = json(join(reference, 'activity-end.json'))[0]
  const activityStart = query('activity-start', sql('activity'))[0]
  assertStableActivity(baselineActivity, activityStart, activityStart)
  for (const [name, path, baseline] of [
    ['inventory', sql('inventory'), 'inventory.json'],
    ['catalog', sql('catalog'), 'catalog.json'],
    ['grants', sql('grants'), 'grants.json'],
    ['sequences', sql('sequences'), 'sequences.json'],
    ['auth', join(reference, 'auth-state.sql'), 'auth-current.json'],
  ]) assertExactSnapshot(name, json(join(reference, baseline)), query(name, path))

  phase = 'canonical-fingerprint'
  const rows = query('fingerprint', fingerprintWrapped, true)
  const fingerprint = verifyCanonicalFingerprint(savedFingerprint, rows,
    fingerprintMarker, fingerprintRows)

  phase = 'postflight'
  for (const [name, path, baseline] of [
    ['inventory-end', sql('inventory'), 'inventory.json'],
    ['catalog-end', sql('catalog'), 'catalog.json'],
    ['grants-end', sql('grants'), 'grants.json'],
    ['sequences-end', sql('sequences'), 'sequences.json'],
    ['auth-end', join(reference, 'auth-state.sql'), 'auth-current.json'],
  ]) assertExactSnapshot(name, json(join(reference, baseline)), query(name, path))
  verifyCanonicalFingerprint(savedFingerprint,
    query('fingerprint-end', fingerprintWrapped, true), fingerprintMarker, fingerprintRows)
  assertStableActivity(baselineActivity, activityStart, query('activity-end', sql('activity'))[0])
  save('RESULT.json', { result: 'PASS', at: new Date().toISOString(), project,
    appliedVersions: json(join(reference, 'grants.json'))[0].snapshot.versions,
    fingerprintRows: fingerprint.rows, marker: fingerprint.marker,
    inventoryTables: json(join(reference, 'inventory.json')).length,
    baselineAndPostflightExact: true, noOtherClientsObserved: true,
    noSignins: true, noStagingWrites: true })
  console.log(JSON.stringify({ result: 'PASS', evidence: output,
    fingerprintRows: fingerprint.rows, marker: fingerprint.marker, appliedVersions: 13 }))
} catch (error) {
  if (started && !existsSync(join(output, 'STOP.json'))) {
    save('STOP.json', { result: 'STOP', at: new Date().toISOString(), phase,
      reason: error instanceof Error ? error.message : 'Unknown read-only verification failure' })
  }
  console.error(JSON.stringify({ result: 'STOP', phase,
    reason: error instanceof Error ? error.message : 'Unknown read-only verification failure',
    evidence: started ? output : null }))
  process.exitCode = 1
}
