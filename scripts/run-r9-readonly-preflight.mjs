// Read-only staging/Pages verification; requires fresh scoped approval. Never deploy or sign in.
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertApprovedQuery } from '../docs/release-private/staging-backup-20260923-r8/release-window/auth-recovery-staff-stop-local-20260924/read-only-sql.mjs'
import { assertExactSnapshot, assertStableActivity, verifyPagesMetadata,
  verifyStagingTarget, verifyPublicProjectionResponse } from './r9-readonly-compare.mjs'
import { assertFreshReadOnlyApproval } from './r9-readonly-preflight-checks.mjs'

assert.ok(process.argv.length === 3 && process.argv[2] === '--approved-readonly',
  'A separately approved read-only run is required')

const root = fileURLToPath(new URL('../', import.meta.url))
const project = 'iclrvvsiwypxlwrwgqia'
const commit = '558f2fee0be9ae876960e4913928535cd38242ad'
const windowRoot = join(root, 'docs/release-private/staging-backup-20260923-r8/release-window')
const reference = join(windowRoot, 'auth-recovery-staff-stop-local-20260924')
const backup = join(root, 'docs/release-private/staging-backup-20260923-r8')
const r9 = join(root, 'docs/release-private/staging-app-candidate-20260924-r9')
const r8 = join(root, 'docs/release-private/staging-privacy-release-20260923-r8')
const operator = join(windowRoot, 'operator')
const cli = 'C:/Users/ed/node_modules/@supabase/cli-windows-x64/bin/supabase.exe'
const runId = `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${randomBytes(4).toString('hex')}`
const output = join(root, 'docs/release-private', `staging-r9-readonly-check-${runId}`)
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const hash = (path) => sha(readFileSync(path))
const read = (path) => readFileSync(path, 'utf8').replace(/^\uFEFF/, '')
const json = (path) => JSON.parse(read(path))

function save(name, value) {
  writeFileSync(join(output, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
}
function command(program, args, label, timeout = 60000) {
  const result = spawnSync(program, args, { cwd: root, encoding: 'utf8', timeout,
    maxBuffer: 30 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
  save(`${label}.stdout.private`, result.stdout || '')
  save(`${label}.stderr.private`, result.stderr || String(result.error || ''))
  assert.equal(result.status, 0, `${label} failed; private diagnostics retained`)
  return result.stdout.trim()
}
function query(label, path) {
  const sql = read(path)
  assertApprovedQuery(sql)
  const response = JSON.parse(command(cli,
    ['db', 'query', '--linked', '--workdir', operator, '--file', path, '--output-format', 'json'], label))
  assert.ok(Array.isArray(response.rows), `${label} result rows missing`)
  save(`${label}.json`, response.rows)
  return response.rows
}
function pin(path, expected, label) {
  assert.ok(hash(path) === expected, `${label} changed`)
}

let phase = 'local-pins'
let started = false
try {
  const local = spawnSync(process.execPath, ['scripts/verify-r9-readonly-local.mjs'],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  assert.equal(local.status, 0, 'R9 local reference check failed')
  pin(join(reference, 'recovery-result.json'), '8ff08d4db7dc47074bd7badb4d8ecf4974b0a284c172a38fd6703bea1acb92a1', 'Recovery result')
  pin(join(root, 'docs/release-private/staging-r9-readonly-check-20260924105849-c397ce4e/STOP.json'),
    'e81e21fb8ab2eab0976484a1bcdac7dc49f0fc2f7fc9043efbc5952a6b478837',
    'Latest pre-deployment STOP')
  pin(join(windowRoot, 'database_result.json'), '1c8e6e217e10ad7e76fe94d53d5070a62da89288cfae04ae5be781766a04cb41', 'Database result')
  pin(join(backup, 'catalog_retry_verification_manifest.json'), '8a046c4bfeca535950c22beb823e03443a3c72209d21bb18adc7e336d46aa170', 'Backup companion')
  for (const [name, expected] of Object.entries({
    'inventory.json': 'ecf9255248340355499bee5afb403836cf744d66b32d0febe29da830df4ed66f',
    'catalog.json': '79df339c1007a729c9694503a41956b7d1d3e30b005d526afb8f4ae8e14ffc1c',
    'grants.json': '1ee809aebc7f68015ec5c1d46e2c95682d2f3ca267853f3636f023afb31c7e4e',
    'sequences.json': '6bc61ec3dceef39ce5af768d1149d0287be3a8554105aa8e3c117a4cb0f1b361',
    'auth-current.json': '7ca85aa9823e000df5b5c7b407039c1897a424551c17344c11d5b8d9c69642dd',
    'activity-end.json': '8c7d8d8b300e27f018d67da9a98ab6fd3f659caad489a9ac41ef994f7fef8b66',
  })) pin(join(reference, name), expected, `Reference ${name}`)
  const database = json(join(windowRoot, 'database_result.json'))
  assert.equal(database.result, 'PASS')
  assert.equal(database.project, project)
  assert.equal(database.versions, 13)
  assert.equal(database.enforcement, false)
  assert.equal(database.all54TablesMatchPostMigrationAfterRollback, true)
  const backupReference = json(join(backup, 'catalog_retry_verification_manifest.json'))
  assert.equal(backupReference.result, 'VERIFIED_LOGICAL_RESTORE')
  assert.equal(backupReference.sourceProject, project)
  assert.equal(read(join(root, 'supabase/.temp/project-ref')).trim(), project)
  assert.equal(read(join(operator, 'supabase/.temp/project-ref')).trim(), project)
  const approvalPath = join(root, 'docs/release-private/staging-r9-readonly-approval.local.json')
  assert.ok(existsSync(approvalPath), 'Fresh read-only retry approval is required')
  assertFreshReadOnlyApproval(json(approvalPath))
  assert.ok(!existsSync(output), 'Fresh private evidence folder already exists')
  mkdirSync(output)
  started = true
  save('scope.json', { project, scope: 'read-only pre-deployment check',
    noSignins: true, noOperationalWrites: true, noDeployment: true,
    r9ManifestSha256: hash(join(r9, 'manifest.json')),
    r8ManifestSha256: hash(join(r8, 'manifest.json')),
    recoverySha256: hash(join(reference, 'recovery-result.json')),
    backupReferenceSha256: hash(join(backup, 'catalog_retry_verification_manifest.json')) })

  phase = 'target-and-pages'
  const projects = JSON.parse(command(cli, ['projects', 'list', '--output-format', 'json'], 'projects'))
  verifyStagingTarget(projects)
  const pages = JSON.parse(command('gh', ['api', 'repos/zylush/rally-point-web/pages'], 'pages-target'))
  const branch = JSON.parse(command('gh', ['api', 'repos/zylush/rally-point-web/git/ref/heads/gh-pages'], 'pages-branch'))
  const build = JSON.parse(command('gh', ['api', 'repos/zylush/rally-point-web/pages/builds/latest'], 'pages-build-before'))
  verifyPagesMetadata(pages, branch, build)

  phase = 'staging-baseline'
  const sql = (name) => join(windowRoot, `post_test_${name}.sql`)
  const activitySql = sql('activity')
  const baselineActivity = json(join(reference, 'activity-end.json'))[0]
  const activityStart = query('activity-start', activitySql)[0]
  assertStableActivity(baselineActivity, activityStart, activityStart)
  const current = {
    inventory: query('inventory', sql('inventory')),
    catalog: query('catalog', sql('catalog')),
    grants: query('grants', sql('grants')),
    sequences: query('sequences', sql('sequences')),
    auth: query('auth-current', join(reference, 'auth-state.sql')),
  }
  for (const [name, rows] of Object.entries(current)) {
    const file = name === 'auth' ? 'auth-current.json' : `${name}.json`
    assertExactSnapshot(name, json(join(reference, file)), rows)
  }
  assert.equal(current.inventory.length, 54, 'Inventory table count drift')

  phase = 'hosted-r8-bytes'
  const files = json(join(r8, 'manifest.json')).files.filter((row) => row.path.startsWith('app/'))
  assert.equal(files.length, 20, 'Frozen r8 app inventory drift')
  const verified = []
  for (const file of files) {
    assert.match(file.path, /^app\/[A-Za-z0-9_./-]+$/, 'Unsafe app path')
    assert.ok(!file.path.includes('..'), 'Unsafe app path')
    const pathname = file.path.slice(4)
    assert.ok(hash(join(r8, file.path)) === file.sha256, `Frozen r8 file drift: ${pathname}`)
    const response = await fetch(`https://zylush.github.io/rally-point-web/${pathname}?release=${commit}`,
      { cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(20000) })
    assert.equal(response.status, 200, `Hosted r8 HTTP failure: ${pathname}`)
    const bytes = Buffer.from(await response.arrayBuffer())
    assert.ok(sha(bytes) === file.sha256, `Hosted r8 file drift: ${pathname}`)
    verified.push({ path: pathname, bytes: bytes.length, sha256: file.sha256 })
  }
  save('hosted-r8-files.json', verified)

  phase = 'r9-key-acceptance'
  const r9Files = json(join(r9, 'manifest.json')).files.filter((row) => /^app\/assets\/[^/]+\.js$/.test(row.path))
  assert.equal(r9Files.length, 1, 'R9 JavaScript inventory drift')
  const js = read(join(r9, r9Files[0].path))
  const keys = [...new Set(js.match(/sb_publishable_[A-Za-z0-9_-]+/g) ?? [])]
  assert.equal(keys.length, 1, 'Expected one r9 publishable key')
  const response = await fetch(`https://${project}.supabase.co/rest/v1/public_schedule?select=*&limit=0`,
    { headers: { apikey: keys[0], Accept: 'application/json' }, cache: 'no-store',
      credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(20000) })
  const body = response.status === 200 ? await response.json() : []
  verifyPublicProjectionResponse(response.status, body, response.headers.get('content-type'))
  save('public-key-check.json', { status: response.status,
    contentType: response.headers.get('content-type'), rowCount: body.length,
    keyWasNotSaved: true, authSessionCreatedByThisCheck: false })

  phase = 'read-only-postflight'
  const endInventory = query('inventory-end', sql('inventory'))
  assertExactSnapshot('Postflight inventory', json(join(reference, 'inventory.json')), endInventory)
  for (const name of ['catalog', 'grants', 'sequences']) {
    assertExactSnapshot(`Postflight ${name}`, json(join(reference, `${name}.json`)),
      query(`${name}-end`, sql(name)))
  }
  assertExactSnapshot('Postflight Auth', json(join(reference, 'auth-current.json')),
    query('auth-end', join(reference, 'auth-state.sql')))
  const activityEnd = query('activity-end', activitySql)[0]
  assertStableActivity(baselineActivity, activityStart, activityEnd)
  const finalBuild = JSON.parse(command('gh', ['api', 'repos/zylush/rally-point-web/pages/builds/latest'], 'pages-build-after'))
  verifyPagesMetadata(pages, branch, finalBuild)
  save('RESULT.json', { result: 'PASS', at: new Date().toISOString(), project,
    expectedPagesCommit: commit, hostedFiles: verified.length, inventoryTables: current.inventory.length,
    authAndSequencesExact: true, catalogAndGrantsExact: true, noOtherClientsObserved: true,
    writeCountersUnchanged: true, backupReferenceHistoricalOnly: true,
    publicKeyAcceptedForAnonymousSafeRead: true, noSignins: true, noDeployment: true,
    enforcementApplied: false, stagingActivityResumed: false })
  console.log(JSON.stringify({ result: 'PASS', evidence: output, hostedFiles: verified.length,
    inventoryTables: current.inventory.length, currentKeyAccepted: true,
    deployed: false, stagingResumed: false }))
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
