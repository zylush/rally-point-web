// Local file packager only. It never invokes Supabase, opens a DB, or applies SQL.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const prior = join(root, 'docs/release-private/staging-privacy-release-20260923-r8')
const packet = join(root, 'docs/release-private/staging-reservation-pause-20260926-r1')
const pause = '20260925174111_reservation_write_pause.sql'
const enforcement = '20260921111105_tenant_enforcement.sql'
const projectRef = 'iclrvvsiwypxlwrwgqia'
const applied = [
  '001_rally_point.sql', '002_bookings.sql', '003_open_play_qr.sql',
  '004_member_signup.sql', '20260803125450_authorization_boundary.sql',
  '20260805094557_auth_rate_limits.sql', '20260921090000_tenant_ready.sql',
  '20260921110828_tenant_backfill.sql',
  '20260922011918_tenant_table_grant_repair.sql',
  '20260922163027_booking_rpc_alias_repair.sql',
  '20260922163830_booking_cancellation_command.sql',
  '20260922164128_rls_member_lookup_repair.sql',
  '20260923053440_member_privacy_repair.sql',
]
const expected = [...applied, pause]
const frozenManifestHash = 'c8863d66e618cdbbf02da3d66dd17fbef751cea5bdafbb27a91afb06c5941781'
const rehearsalHash = '1e79f2a9de48584e72b7a2780250898ef776720c13c8ff042cd32bccb3ef7671'
const pauseHash = 'f5a03d8c294efc7902c195f84eeee0af97b81377b5be2a5ccba9243d5e6a44ef'
const auditHash = '4c90aa24f59028f3944ed6297e644f69081417d77774a2b0733f8494252b4e5b'
const rehearsal = join(root, 'docs/release-private/reservation-write-pause-20260925-gate2-local-1.json')
const audit = join(root, 'supabase/verification/reservation_write_pause_readonly.sql')
const slash = (path) => path.replaceAll('\\', '/')
const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
const json = (path) => JSON.parse(readFileSync(path, 'utf8'))

export function validatePauseInventory(names) {
  assert.ok(Array.isArray(names), 'Migration inventory must be an array')
  assert.deepEqual([...names].sort(), [...expected].sort(),
    'Pause package must contain exactly the 13 applied migrations and the pending pause')
  return { appliedVersions: applied.map((name) => name.split('_')[0]), pendingMigration: pause }
}

export function makePausePlan(names) {
  const inventory = validatePauseInventory(names)
  return { packageId: 'staging-reservation-pause-20260926-r1', databaseContacted: false,
    targetProjectRef: projectRef, appliedVersions: inventory.appliedVersions,
    pendingMigration: inventory.pendingMigration, excludedMigration: enforcement,
    stagingApplyAuthorized: false, freshStagingBaselineAndBackupRequired: true,
    dryRunRequired: true }
}

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    assert.ok(!entry.isSymbolicLink(), 'Package symlinks are not allowed')
    const path = join(directory, entry.name)
    return entry.isDirectory() ? files(path) : [path]
  }).sort()
}

function sourceRows() {
  const oldManifest = join(prior, 'manifest.json')
  assert.equal(hash(oldManifest), frozenManifestHash, 'Frozen r8 manifest changed')
  const frozen = json(oldManifest)
  assert.equal(frozen.target.projectRef, projectRef)
  assert.deepEqual(frozen.pendingMigrations, ['20260923053440_member_privacy_repair.sql'])
  assert.deepEqual(frozen.excludedMigrations, [enforcement])
  assert.deepEqual(frozen.expectedAppliedVersions,
    applied.slice(0, -1).map((name) => name.split('_')[0]))
  const migrationRows = frozen.files.filter((row) => row.path.startsWith('database/supabase/migrations/'))
  assert.deepEqual(migrationRows.map((row) => row.path.split('/').at(-1)).sort(), [...applied].sort())
  for (const row of migrationRows) {
    assert.equal(hash(join(prior, row.path)), row.sha256, `Frozen r8 copy changed: ${row.path}`)
    assert.equal(hash(join(root, 'supabase/migrations', row.path.split('/').at(-1))), row.sha256,
      `Migration source changed: ${row.path}`)
  }
  const configRow = frozen.files.find((row) => row.path === 'database/supabase/config.toml')
  assert.ok(configRow, 'Frozen r8 database config missing')
  assert.equal(hash(join(prior, configRow.path)), configRow.sha256)
  assert.match(readFileSync(join(prior, configRow.path), 'utf8'),
    /\[db.seed\]\s+enabled = false\s+sql_paths = \[\]/)
  assert.equal(hash(join(root, 'supabase/migrations', pause)), pauseHash, 'Pause migration changed')
  assert.equal(hash(audit), auditHash, 'Pause audit changed')
  assert.equal(hash(rehearsal), rehearsalHash, 'Approved local rehearsal evidence changed')
  const result = json(rehearsal)
  assert.equal(result.status, 'PASS')
  assert.equal(result.target, '127.0.0.1:54322/postgres')
  assert.equal(result.localBaselineUnchanged, true)
  assert.deepEqual(result.orders.map((row) => [row.order, row.status]), [
    ['pause-then-enforcement', 'PASS'], ['enforcement-then-pause', 'PASS'],
  ])
  return [...migrationRows.map((row) => ({
    source: join(root, 'supabase/migrations', row.path.split('/').at(-1)),
    path: row.path, sha256: row.sha256,
  })),
  { source: join(root, 'supabase/migrations', pause),
    path: 'database/supabase/migrations/' + pause, sha256: pauseHash },
  { source: join(prior, configRow.path), path: configRow.path, sha256: configRow.sha256 },
  { source: audit, path: 'checks/reservation_write_pause_readonly.sql', sha256: auditHash },
  { source: rehearsal, path: 'evidence/local-rollback-only-rehearsal.json', sha256: rehearsalHash }]
}

function plan() {
  const rows = sourceRows()
  const names = rows.filter((row) => row.path.startsWith('database/supabase/migrations/'))
    .map((row) => row.path.split('/').at(-1))
  return { ...makePausePlan(names), files: rows.map(({ path, sha256 }) => ({ path, sha256 })) }
}

function verify() {
  const manifest = json(join(packet, 'manifest.json'))
  assert.deepEqual(manifest, plan(), 'Pause package manifest changed')
  const paths = files(packet).map((path) => slash(relative(packet, path)))
  assert.deepEqual(paths.sort(), [...manifest.files.map((row) => row.path), 'manifest.json'].sort(),
    'Pause package has missing or extra files')
  for (const row of manifest.files) assert.equal(hash(join(packet, row.path)), row.sha256,
    `Pause package file changed: ${row.path}`)
  assert.ok(!existsSync(join(packet, 'database/supabase/.temp')), 'Pause package must not be linked')
  validatePauseInventory(readdirSync(join(packet, 'database/supabase/migrations')))
  return { result: 'PASS', package: slash(relative(root, packet)), packageFiles: paths.length,
    pendingMigration: pause, enforcementExcluded: true, databaseContacted: false,
    stagingApplyAuthorized: false }
}

function prepare() {
  const manifest = plan()
  assert.ok(!existsSync(packet), 'Refusing to overwrite an existing pause package')
  for (const row of sourceRows()) {
    const target = join(packet, row.path)
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(row.source, target)
  }
  writeFileSync(join(packet, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' })
  return verify()
}

if (process.argv[1] && fileURLToPath(import.meta.url) === join(root, slash(relative(root, process.argv[1])))) {
  assert.ok(process.argv.length === 3, 'Use --plan, --prepare, or --verify')
  const mode = process.argv[2]
  assert.ok(['--plan', '--prepare', '--verify'].includes(mode), 'Unsupported mode')
  console.log(JSON.stringify(mode === '--plan' ? plan() : mode === '--prepare' ? prepare() : verify()))
}
