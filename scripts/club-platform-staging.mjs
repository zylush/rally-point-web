// Shared, guarded plumbing for staging releases: the release definitions, the
// staging target, the owner's password file, psql through the local Supabase
// container, read-only JSON queries, and the backup and approval checks.
// The password is passed only to child processes as an environment variable;
// it is never written, logged, or included in errors.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { defaultAclSupplement } from './restore-catalog-checks.mjs'
import { planRestoreData } from './restore-data-checks.mjs'

export const root = fileURLToPath(new URL('../', import.meta.url))
export const project = 'iclrvvsiwypxlwrwgqia'
export const passwordFile = 'C:/Users/ed/.rally-point/staging-db-password.local'
export const dockerExe = 'C:/Users/ed/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe'
export const supabaseCli = 'C:/Users/ed/node_modules/@supabase/cli-windows-x64/bin/supabase.exe'
export const container = 'supabase_db_rally-point-web'
export const localImage = 'public.ecr.aws/supabase/postgres:17.6.1.147'

// The owner approved this package on 2026-10-17 ("Approve, run after backup"):
// it may be applied only after a fresh capture has been restored and verified.
export const approvedManifestSha256 = '70a9287ddc74937e12fa83e99d856e0be6595070a1af906e388fb5723dcb7918'

export const expectedStagingVersions = Object.freeze(['001', '002', '003', '004', '20260803125450',
  '20260805094557', '20260921090000', '20260921110828', '20260922011918', '20260922163027',
  '20260922163830', '20260922164128', '20260923053440', '20260925174111'])

// Releases the capture, restore and apply scripts can run, each with its own
// one-shot evidence folders. The club platform release (applied 2026-10-17)
// is complete; it ran the versions of those scripts in commit b79f264.

// Applied 2026-10-17 and kept for the record. Its manifest pins files that later
// releases changed and staging has moved past its baseline, so its gates now refuse it.
export const advisorFixesRelease = Object.freeze({
  id: 'advisor-fixes-20261017',
  title: 'Supabase advisor fixes',
  baseVersions: Object.freeze([...expectedStagingVersions, '20260921111105', '20260927105500', '20260928170000',
    '20261017090000', '20261017090100', '20261017090200', '20261017090300'].sort()),
  migrations: Object.freeze(['20261017160000_supabase_advisor_fixes.sql']),
  // The SQL that runs and the code that runs it. Approval pins all of these bytes.
  files: Object.freeze(['supabase/migrations/20261017160000_supabase_advisor_fixes.sql',
    'supabase/verification/supabase_advisor_postflight.sql', 'supabase/verification/club_platform_postflight.sql',
    'supabase/verification/two_club_isolation.sql', 'supabase/verification/schema_fingerprint.sql',
    'supabase/verification/backup_content_inventory.sql', 'supabase/verification/reservation_write_pause_readonly.sql',
    'supabase/verification/staging_privacy_readonly_preflight.sql', 'scripts/run-staging-release-apply.mjs',
    'scripts/club-platform-staging.mjs', 'scripts/club-platform-checks.mjs', 'scripts/restore-catalog-checks.mjs',
    'scripts/restore-data-checks.mjs']),
  stateCheck: Object.freeze({ file: 'club_platform_postflight.sql', kind: 'postflight' }),
  postChecks: Object.freeze([
    Object.freeze({ file: 'supabase_advisor_postflight.sql', kind: 'advisor', ignore: Object.freeze([]) }),
    // The club postflight insists on exactly 21 migrations; this release adds the 22nd.
    Object.freeze({ file: 'club_platform_postflight.sql', kind: 'postflight', ignore: Object.freeze(['ledger_has_every_migration']) }),
  ]),
  isolation: Object.freeze({ file: 'two_club_isolation.sql', plan: 55 }),
  dirs: Object.freeze({
    capture: 'docs/release-private/staging-backup-20261017-r2',
    restore: 'docs/release-private/staging-backup-restore-20261017-r2',
    dryRun: 'docs/release-private/advisor-fixes-staging-dryrun-20261017-r1',
    apply: 'docs/release-private/advisor-fixes-staging-apply-20261017-r1',
  }),
  databases: Object.freeze({ restore: 'rally_staging_backup_20261017_r2_restore', dryRun: 'rally_staging_backup_20261017_r2_dryrun' }),
})

export const advisorFollowupRelease = Object.freeze({
  id: 'advisor-followup-20261017',
  title: 'Supabase advisor follow-up',
  baseVersions: Object.freeze([...advisorFixesRelease.baseVersions, '20261017160000']),
  migrations: Object.freeze(['20261017170000_supabase_advisor_followup.sql']),
  // The SQL that runs and the code that runs it. Approval pins all of these bytes.
  files: Object.freeze(['supabase/migrations/20261017170000_supabase_advisor_followup.sql',
    'supabase/verification/supabase_advisor_followup_postflight.sql', 'supabase/verification/supabase_advisor_postflight.sql',
    'supabase/verification/club_platform_postflight.sql', 'supabase/verification/two_club_isolation.sql',
    'supabase/verification/schema_fingerprint.sql', 'supabase/verification/backup_content_inventory.sql',
    'supabase/verification/reservation_write_pause_readonly.sql', 'supabase/verification/staging_privacy_readonly_preflight.sql',
    'scripts/run-staging-release-apply.mjs', 'scripts/club-platform-staging.mjs', 'scripts/club-platform-checks.mjs',
    'scripts/restore-catalog-checks.mjs', 'scripts/restore-data-checks.mjs']),
  stateCheck: Object.freeze({ file: 'supabase_advisor_postflight.sql', kind: 'advisor' }),
  postChecks: Object.freeze([
    Object.freeze({ file: 'supabase_advisor_followup_postflight.sql', kind: 'advisorFollowup', ignore: Object.freeze([]) }),
    // Written for 22 migrations with the schedule board still a definer view; this release changes both.
    Object.freeze({ file: 'supabase_advisor_postflight.sql', kind: 'advisor',
      ignore: Object.freeze(['ledger_has_advisor_fix', 'only_schedule_board_is_definer_view']) }),
    Object.freeze({ file: 'club_platform_postflight.sql', kind: 'postflight', ignore: Object.freeze(['ledger_has_every_migration']) }),
  ]),
  isolation: Object.freeze({ file: 'two_club_isolation.sql', plan: 55 }),
  dirs: Object.freeze({
    capture: 'docs/release-private/staging-backup-20261017-r3',
    restore: 'docs/release-private/staging-backup-restore-20261017-r3',
    // r1 stopped: hosted staging lets service_role read the views; the migration now keeps that.
    dryRun: 'docs/release-private/advisor-followup-staging-dryrun-20261017-r2',
    apply: 'docs/release-private/advisor-followup-staging-apply-20261017-r1',
  }),
  databases: Object.freeze({ restore: 'rally_staging_backup_20261017_r3_restore', dryRun: 'rally_staging_backup_20261017_r3_dryrun2' }),
})
// Court management, the public club list and players without a membership, venue
// locations, 24-hour booking and Philippine time. admin_upsert_court is a narrow
// admin-only court write path; the reservation-write pause itself stays in force.
export const courtMarketplaceRelease = Object.freeze({
  id: 'court-marketplace-20261022',
  title: 'Court management and player marketplace',
  baseVersions: Object.freeze([...advisorFollowupRelease.baseVersions, '20261017170000']),
  migrations: Object.freeze(['20261022090000_admin_court_management.sql', '20261022100000_player_marketplace.sql',
    '20261022110000_open_all_day_ph_time.sql']),
  // The SQL that runs and the code that runs it. Approval pins all of these bytes.
  files: Object.freeze(['supabase/migrations/20261022090000_admin_court_management.sql',
    'supabase/migrations/20261022100000_player_marketplace.sql', 'supabase/migrations/20261022110000_open_all_day_ph_time.sql',
    'supabase/verification/court_marketplace_postflight.sql', 'supabase/verification/supabase_advisor_followup_postflight.sql',
    'supabase/verification/supabase_advisor_postflight.sql', 'supabase/verification/club_platform_postflight.sql',
    'supabase/verification/two_club_isolation.sql', 'supabase/verification/schema_fingerprint.sql',
    'supabase/verification/backup_content_inventory.sql', 'supabase/verification/reservation_write_pause_readonly.sql',
    'supabase/verification/staging_privacy_readonly_preflight.sql', 'scripts/run-staging-release-apply.mjs',
    'scripts/club-platform-staging.mjs', 'scripts/club-platform-checks.mjs', 'scripts/restore-catalog-checks.mjs',
    'scripts/restore-data-checks.mjs']),
  stateCheck: Object.freeze({ file: 'supabase_advisor_followup_postflight.sql', kind: 'advisorFollowup' }),
  postChecks: Object.freeze([
    Object.freeze({ file: 'court_marketplace_postflight.sql', kind: 'courtMarketplace', ignore: Object.freeze([]) }),
    // Earlier postflights count 22 or 23 migrations; this release brings staging to 26.
    Object.freeze({ file: 'supabase_advisor_followup_postflight.sql', kind: 'advisorFollowup',
      ignore: Object.freeze(['ledger_has_followup']) }),
    Object.freeze({ file: 'supabase_advisor_postflight.sql', kind: 'advisor',
      ignore: Object.freeze(['ledger_has_advisor_fix', 'only_schedule_board_is_definer_view']) }),
    Object.freeze({ file: 'club_platform_postflight.sql', kind: 'postflight', ignore: Object.freeze(['ledger_has_every_migration']) }),
  ]),
  isolation: Object.freeze({ file: 'two_club_isolation.sql', plan: 55 }),
  dirs: Object.freeze({
    capture: 'docs/release-private/staging-backup-20261022-r1',
    restore: 'docs/release-private/staging-backup-restore-20261022-r1',
    dryRun: 'docs/release-private/court-marketplace-staging-dryrun-20261022-r1',
    apply: 'docs/release-private/court-marketplace-staging-apply-20261022-r1',
  }),
  databases: Object.freeze({ restore: 'rally_staging_backup_20261022_r1_restore', dryRun: 'rally_staging_backup_20261022_r1_dryrun' }),
})

export const releases = Object.freeze({ [advisorFixesRelease.id]: advisorFixesRelease,
  [advisorFollowupRelease.id]: advisorFollowupRelease, [courtMarketplaceRelease.id]: courtMarketplaceRelease })

export function getRelease(id) {
  assert.ok(Object.hasOwn(releases, id ?? ''), `Unknown release: ${id}. Known: ${Object.keys(releases).join(', ')}`)
  return releases[id]
}

/** Every release script takes exactly: --release <id> <mode>. */
export function parseReleaseArgs(argv, modes) {
  assert.ok(argv.length === 3 && argv[0] === '--release' && modes.includes(argv[2]),
    `Use --release <id> with one of ${modes.join(', ')}`)
  return { release: getRelease(argv[1]), mode: argv[2] }
}

// Check files every release uses, besides its own state, post and isolation checks.
export const releaseCheckFiles = Object.freeze(['schema_fingerprint.sql', 'backup_content_inventory.sql',
  'reservation_write_pause_readonly.sql', 'staging_privacy_readonly_preflight.sql'])

/**
 * The reviewed bytes of a release: its definition and every listed file with its
 * SHA-256. Owner approval (staging-release-approvals.mjs) pins the returned sha256.
 * Callers use the returned contents, never a second read, so what was hashed is what runs.
 */
export function releaseManifest(release, baseDir = root) {
  const migrationVersions = release.migrations.map(name => {
    const match = /^(\d{14})_[a-z0-9_]+\.sql$/.exec(name)
    assert.ok(match, `Unexpected migration name: ${name}`)
    return match[1]
  })
  assert.ok(migrationVersions.every(version => version > release.baseVersions.at(-1)), 'A release migration predates the staging baseline')
  assert.deepEqual([...release.baseVersions], [...new Set(release.baseVersions)].sort(), 'Base versions must be sorted and unique')
  const checks = [...releaseCheckFiles, release.stateCheck.file, ...release.postChecks.map(check => check.file), release.isolation.file]
  const needed = [...release.migrations.map(name => `supabase/migrations/${name}`), ...checks.map(name => `supabase/verification/${name}`)]
  for (const path of needed) assert.ok(release.files.includes(path), `Release file not listed: ${path}`)
  assert.equal(new Set(release.files.map(path => path.split('/').at(-1))).size, release.files.length, 'Release file names must be unique')

  const contents = new Map(release.files.map(path => [path, readFileSync(join(baseDir, path))]))
  const isolation = contents.get(`supabase/verification/${release.isolation.file}`).toString('utf8')
  assert.ok(isolation.includes(`select extensions.plan(${release.isolation.plan});`), 'Isolation test plan changed; review required')
  assert.ok(/\nrollback;\s*$/.test(isolation), 'Isolation test must end with rollback')
  const manifest = { kind: 'staging-release-manifest-v1', definition: release,
    files: [...contents].map(([path, bytes]) => ({ path, sha256: sha(bytes) })) }
  return { manifest, sha256: sha(Buffer.from(JSON.stringify(manifest))), contents }
}

export const captureFiles = Object.freeze(['roles.sql', 'schema.sql', 'data.sql', 'managed_schema.sql',
  'managed_data.sql', 'history_schema.sql', 'history_data.sql', 'managed_before_app.sql',
  'managed_after_app.sql', 'managed_migration_data.sql', 'managed_migration_rows.json',
  'application_acl_recovery.generated.sql'])
export const snapshotNames = Object.freeze(['fingerprint', 'grants', 'inventory', 'catalog', 'sequences', 'preflight', 'privacy'])

export const sequenceSql = `select n.nspname as schema_name, c.relname as sequence_name,
 query_to_xml(format('select last_value, is_called from %I.%I', n.nspname, c.relname), false, true, '')::text as state
 from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where c.relkind = 'S' and n.nspname in ('public', 'private', 'auth', 'storage', 'supabase_migrations')
 order by n.nspname, c.relname;`
export const activitySql = `select (select count(*) from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid()
   and backend_type = 'client backend' and state in ('active', 'idle in transaction')
   and usename not in ('supabase_admin', 'supabase_replication_admin', 'supabase_read_only_user')) as other_active_clients,
 (select jsonb_agg(jsonb_build_object('schema', schemaname, 'table', relname, 'inserted', n_tup_ins,
   'updated', n_tup_upd, 'deleted', n_tup_del) order by schemaname, relname)
  from pg_stat_user_tables where schemaname in ('public', 'private', 'auth', 'storage', 'supabase_migrations')) as writes;`
export const identitySql = `select current_database() as database, current_setting('server_version') as version,
 (select array_agg(version order by version) from supabase_migrations.schema_migrations) as versions;`

export const sha = bytes => createHash('sha256').update(bytes).digest('hex')

/** The staging session pooler, read from the CLI link files. Anything else is refused. */
export function stagingTarget(baseDir = root) {
  const ref = readFileSync(join(baseDir, 'supabase/.temp/project-ref'), 'utf8').trim()
  assert.equal(ref, project, 'The linked project is not staging')
  const url = new URL(readFileSync(join(baseDir, 'supabase/.temp/pooler-url'), 'utf8').trim())
  assert.equal(url.protocol, 'postgresql:', 'Unexpected pooler URL scheme')
  assert.equal(url.password, '', 'The saved pooler URL must not contain a password')
  assert.equal(decodeURIComponent(url.username), `postgres.${project}`, 'The pooler user is not staging')
  assert.match(url.hostname, /^aws-0-[a-z0-9-]+\.pooler\.supabase\.com$/, 'Unexpected pooler host')
  assert.equal(url.port || '5432', '5432', 'Use the session pooler on port 5432')
  assert.equal(url.pathname, '/postgres', 'Unexpected pooler database')
  return Object.freeze({ host: url.hostname, port: '5432', user: `postgres.${project}`, database: 'postgres' })
}

/** Reads the owner's password file. The value never leaves this process except as a child's PGPASSWORD. */
export function readPassword(path = passwordFile) {
  assert.ok(existsSync(path), `Password file not found: ${path}`)
  const value = readFileSync(path, 'utf8').replace(/^\uFEFF/, '').trim()
  assert.ok(value.length >= 8 && !/[\r\n]/.test(value) && !value.includes('\u0000'), 'The password file must hold one password on one line')
  return value
}

export function redact(text, secret) {
  const value = String(text ?? '')
  if (!secret) return value
  return value.replaceAll(secret, '[redacted]').replaceAll(encodeURIComponent(secret), '[redacted]')
}

// Only what Docker and the Supabase CLI need on Windows, plus named credentials.
const systemVariables = ['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP',
  'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH', 'PROGRAMDATA', 'PROGRAMFILES']
export function childEnv(extra = {}, source = process.env) {
  for (const key of Object.keys(source)) {
    assert.ok(!/^(DOCKER_HOST|DOCKER_CONTEXT|DOCKER_TLS_VERIFY|PGHOST|PGPORT|PGUSER|PGDATABASE|PGSERVICE|DATABASE_URL)$/i.test(key),
      `Environment override ${key} is not allowed`)
  }
  const env = {}
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string' && systemVariables.includes(key.toUpperCase())) env[key] = value
  }
  return { ...env, ...extra }
}

export function runChild(program, args, { input = '', env = childEnv(), secret = '', timeout = 600000 } = {}) {
  const result = spawnSync(program, args, { cwd: root, input, encoding: 'utf8', env, shell: false,
    windowsHide: true, timeout, maxBuffer: 128 * 1024 * 1024 })
  return { status: result.status, stdout: redact(result.stdout, secret), stderr: redact(result.stderr, secret),
    error: result.error ? redact(result.error.message, secret) : null }
}

/** psql inside the local container, pointed at the staging session pooler over TLS. */
export function stagingPsqlArgs(target, { singleTransaction = false } = {}) {
  return ['exec', '-i', '-e', 'PGPASSWORD', '-e', 'PGSSLMODE', '-e', 'PGAPPNAME', container,
    'psql', '-X', '-q', '-A', '-t', '-w', '-v', 'ON_ERROR_STOP=1', ...(singleTransaction ? ['--single-transaction'] : []),
    '-h', target.host, '-p', target.port, '-U', target.user, '-d', target.database]
}

export function stagingPsql(target, password, sql, options = {}) {
  assert.ok(!stagingPsqlArgs(target, options).some(arg => arg.includes(password)), 'Password leaked into arguments')
  return runChild(dockerExe, stagingPsqlArgs(target, options), { input: sql, secret: password,
    env: childEnv({ PGPASSWORD: password, PGSSLMODE: 'require', PGAPPNAME: 'rally_club_platform_release' }) })
}

/** psql inside the local container against an approved local database. */
export function localPsql(database, sql, { role = 'postgres', singleTransaction = false, allowed = [] } = {}) {
  assert.ok(database === 'postgres' || allowed.includes(database), 'Unapproved local database')
  assert.ok(['postgres', 'supabase_admin'].includes(role), 'Unapproved local role')
  return runChild(dockerExe, ['exec', '-i', container, 'psql', '-X', '-q', '-A', '-t', '-w', '-v', 'ON_ERROR_STOP=1',
    ...(singleTransaction ? ['--single-transaction'] : []), '-U', role, '-d', database], { input: sql })
}

/** Turns a read-only query file into one statement that returns its rows as a JSON array. */
export function readOnlyJson(sql) {
  const body = sql.replace(/^\uFEFF/, '').replace(/^begin read only;\s*/i, '').replace(/\s*commit;\s*$/i, '')
  const start = body.search(/^(?:with |select )/im)
  assert.ok(start >= 0, 'Missing read-only SELECT query')
  const setup = body.slice(0, start)
  const query = body.slice(start).trim().replace(/;\s*$/, '')
  assert.ok(!/;\s*\S/.test(query.replace(/'[^']*'/g, "''").replace(/\$([a-z_]*)\$[\s\S]*?\$\1\$/gi, '')),
    'A read-only query file must end with a single SELECT')
  return `BEGIN READ ONLY;\n${setup}\nselect coalesce(jsonb_agg(to_jsonb(r)), '[]') from (\n${query}\n) r;\nCOMMIT;\n`
}

export function parseJsonOutput(text, label) {
  const lines = String(text).split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  assert.ok(lines.length > 0, `${label}: no output`)
  return JSON.parse(lines.at(-1))
}

/** One migration and its ledger row, for psql --single-transaction with ON_ERROR_STOP. */
export function migrationTransactionSql(name, sql) {
  const match = /^(\d{14})_([a-z0-9_]+)\.sql$/.exec(name)
  assert.ok(match, `Unexpected migration name: ${name}`)
  assert.ok(!/^\s*(begin|commit|rollback|start transaction)\s*;/im.test(sql), `${name} has its own transaction control`)
  const tag = `migration_${sha(sql).slice(0, 16)}`
  assert.ok(!sql.includes(`$${tag}$`), 'Dollar-quote tag collision')
  return [
    "set local lock_timeout = '15s';",
    "set local statement_timeout = '10min';",
    'set local search_path = public, extensions;',
    sql,
    `insert into supabase_migrations.schema_migrations (version, statements, name) values ('${match[1]}', array[$${tag}$${sql}$${tag}$], '${match[2]}');`,
  ].join('\n')
}

/** Keyed comparison helper for snapshot rows. Returns the identities that differ. */
export function keyedDifferences(expected, actual, key) {
  const index = rows => {
    const map = new Map()
    for (const row of rows) {
      const id = key(row)
      assert.ok(!map.has(id), `Duplicate snapshot identity: ${id}`)
      map.set(id, JSON.stringify(row))
    }
    return map
  }
  const before = index(expected)
  const after = index(actual)
  return [...new Set([...before.keys(), ...after.keys()])].filter(id => before.get(id) !== after.get(id)).sort()
}

export const snapshotKeys = Object.freeze({
  fingerprint: row => `${row.category}\0${row.identity}`,
  inventory: row => `${row.schema_name}.${row.table_name}`,
  sequences: row => `${row.schema_name}.${row.sequence_name}`,
  preflight: row => row.check_name,
  privacy: row => row.check_name,
})

export function fingerprintMarker(rows) {
  const markers = rows.filter(row => row.category === '!fingerprint')
  assert.equal(markers.length, 1, 'Fingerprint marker missing')
  return markers[0].details
}

/** Checks a capture manifest; never reads or returns captured row values. */
export function validateCaptureManifest(manifest, versions = expectedStagingVersions) {
  assert.ok(manifest && typeof manifest === 'object', 'Missing capture manifest')
  assert.equal(manifest.result, 'CAPTURE_PASS_RESTORE_PENDING', 'Capture is not complete')
  assert.equal(manifest.project, project, 'Wrong capture project')
  assert.deepEqual(manifest.versions, [...versions], 'Capture migration history differs from the staging baseline')
  assert.match(String(manifest.publicFingerprint), /^[a-f0-9]{32}$/, 'Capture fingerprint missing')
  assert.equal(manifest.storageObjects, 0, 'Storage objects need a separate backup')
  assert.equal(manifest.activeClientsObserved, 0, 'An active client was observed during capture')
  assert.equal(manifest.writeCounterChanges, 0, 'Writes were observed during capture')
  assert.equal(manifest.stagingWritesAuthorized, false, 'A capture cannot authorize staging writes')
  assert.ok(Date.parse(manifest.startedAt) < Date.parse(manifest.endedAt), 'Invalid capture timestamps')
  assert.ok(Array.isArray(manifest.files) && manifest.files.length > 0, 'Capture file list missing')
  const names = new Set()
  for (const entry of manifest.files) {
    assert.ok(entry && /^[a-zA-Z0-9_.-]+$/.test(entry.file ?? '') && !names.has(entry.file), 'Unsafe or duplicate capture filename')
    assert.ok(Number.isSafeInteger(entry.bytes) && entry.bytes > 0 && /^[a-f0-9]{64}$/.test(entry.sha256 ?? ''),
      `Invalid capture file metadata: ${entry.file}`)
    names.add(entry.file)
  }
  for (const name of [...captureFiles, ...snapshotNames.flatMap(s => [`before_${s}.json`, `after_${s}.json`])]) {
    assert.ok(names.has(name), `Missing capture file: ${name}`)
  }
  return { files: names.size, tables: manifest.tables, versions: manifest.versions.length }
}

export function verifyCaptureFiles(manifest, readBytes, versions = expectedStagingVersions) {
  validateCaptureManifest(manifest, versions)
  for (const entry of manifest.files) {
    const bytes = readBytes(entry.file)
    assert.ok(Buffer.isBuffer(bytes) && bytes.length === entry.bytes && sha(bytes) === entry.sha256,
      `Capture file changed: ${entry.file}`)
  }
  return manifest.files.length
}

/** The full restore transaction, following the reviewed 2026-09-25 restore that passed. */
export function restoreTransactionSql(read, dataFiles, catalogObjects) {
  const schema = read('schema.sql')
  const defaults = schema.match(/^ALTER DEFAULT PRIVILEGES[^;]+;/gm) ?? []
  assert.ok(defaults.length > 0, 'Missing default privileges in the schema dump')
  return ['BEGIN;', 'CREATE SCHEMA private AUTHORIZATION postgres;', 'CREATE SCHEMA extensions AUTHORIZATION postgres;',
    'CREATE SCHEMA vault AUTHORIZATION postgres;', 'GRANT USAGE ON SCHEMA extensions TO PUBLIC;',
    'CREATE EXTENSION pgcrypto WITH SCHEMA extensions;', 'CREATE PUBLICATION supabase_realtime;',
    read('managed_before_app.sql'), read('history_schema.sql'), defaults.join('\n'), schema,
    'CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;', read('managed_after_app.sql'),
    ...dataFiles.map(read), read('application_acl_recovery.generated.sql'), defaultAclSupplement(catalogObjects), 'COMMIT;'].join('\n')
}

/** Loads and fully verifies a capture folder: hashes, unchanged snapshots and table coverage. */
export function loadCapture(directory, versions = expectedStagingVersions) {
  const read = name => readFileSync(join(directory, name), 'utf8').replace(/^﻿/, '')
  const json = name => JSON.parse(read(name))
  const manifestBytes = readFileSync(join(directory, 'capture_manifest.json'))
  const manifest = JSON.parse(manifestBytes.toString('utf8'))
  verifyCaptureFiles(manifest, name => readFileSync(join(directory, name)), versions)
  for (const name of snapshotNames) {
    assert.ok(isDeepStrictEqual(json(`before_${name}.json`), json(`after_${name}.json`)), `Staging changed during capture: ${name}`)
  }
  assert.equal(fingerprintMarker(json('before_fingerprint.json')), manifest.publicFingerprint, 'Capture fingerprint mismatch')
  const inventory = json('before_inventory.json')
  const dataFiles = planRestoreData({ data: read('data.sql'), managed: read('managed_data.sql'),
    history: read('history_data.sql'), managedHistory: json('managed_migration_rows.json'), inventory })
  const catalog = json('before_catalog.json')[0].objects
  return { manifest, manifestSha256: sha(manifestBytes), read, json, inventory, dataFiles, catalog,
    restoreSql: () => restoreTransactionSql(read, dataFiles, catalog) }
}

/** Creates one new local database and restores the capture into it in a single transaction. */
export function restoreCaptureInto(capture, database) {
  assert.match(database, /^rally_[a-z0-9_]+$/, 'Unsafe local database name')
  const options = { allowed: [database] }
  const check = (result, label) => {
    assert.equal(result.status, 0, `${label} failed: ${String(result.stderr || result.error).slice(0, 2000)}`)
    return result.stdout.trim()
  }
  const image = runChild(dockerExe, ['inspect', '--format', '{{.Config.Image}}', container])
  assert.equal(check(image, 'docker inspect'), localImage, 'Wrong local Supabase PostgreSQL image')
  assert.equal(check(localPsql('postgres', "select current_database() || '|' || current_setting('server_version')"), 'identity'),
    'postgres|17.6', 'Wrong local PostgreSQL server')
  assert.equal(check(localPsql('postgres', `select count(*) from pg_database where datname = '${database}'`), 'absence'),
    '0', `Local database ${database} already exists; restores never reuse a database`)
  check(localPsql('postgres', `create database ${database} owner postgres template template0;`), 'create database')
  check(localPsql(database, capture.restoreSql(), { ...options, role: 'supabase_admin' }), 'restore transaction')
}

/** Read-only rows from a local database, as the given role. */
export function localRows(database, sql, role = 'supabase_admin') {
  const result = localPsql(database, readOnlyJson(sql), { role, allowed: [database] })
  assert.equal(result.status, 0, `Local read-only query failed: ${String(result.stderr || result.error).slice(0, 2000)}`)
  return parseJsonOutput(result.stdout, 'local query')
}

/**
 * The apply gate: the package must be the approved one, and the backup must be
 * a fresh capture of exactly the state staging is in now, restored and verified.
 */
export function verifyApplyGate({ manifestSha256, capture, captureManifestSha256, restore, dryRun, liveMarker, liveVersions,
  now = Date.now(), maxAgeHours = 12, expectedVersions = expectedStagingVersions, approvedSha = approvedManifestSha256 }) {
  assert.match(String(approvedSha), /^[a-f0-9]{64}$/, 'This release has not been approved by the owner')
  assert.equal(manifestSha256, approvedSha, 'This is not the approved release package')
  validateCaptureManifest(capture, expectedVersions)
  assert.ok(now - Date.parse(capture.endedAt) <= maxAgeHours * 3600 * 1000, `The verified backup is older than ${maxAgeHours} hours`)
  assert.equal(restore?.result, 'PASS', 'The backup has not been restored and verified')
  assert.equal(restore.captureManifestSha256, captureManifestSha256, 'The verified restore is for a different capture')
  assert.equal(dryRun?.result, 'PASS', 'The dry run on the restored copy has not passed')
  assert.equal(dryRun.captureManifestSha256, captureManifestSha256, 'The dry run used a different capture')
  assert.equal(dryRun.manifestSha256, approvedSha, 'The dry run used a different package')
  assert.deepEqual(liveVersions, [...expectedVersions], 'Staging migration history changed since the capture')
  assert.equal(liveMarker, capture.publicFingerprint, 'Staging schema changed since the capture')
  return { captureAgeMinutes: Math.round((now - Date.parse(capture.endedAt)) / 60000) }
}
