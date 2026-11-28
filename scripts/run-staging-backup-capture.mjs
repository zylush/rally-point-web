// Fresh logical backup of staging before a release (see `releases` in club-platform-staging.mjs).
// Usage: node scripts/run-staging-backup-capture.mjs --release <id> --verify-local|--capture
// Read-only on staging: SELECTs inside read-only transactions, supabase db dump, and downloads
// of the stored files through their public links (every known bucket is public).
// It never restores, migrates, deploys or prints rows. One-shot: a used folder is never reused.
import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { evaluateChecks } from './club-platform-checks.mjs'
import { activitySql, childEnv, dockerExe, downloadStoredFile, fingerprintMarker, identitySql, knownBucketsOnly,
  parseJsonOutput, parseReleaseArgs, project, readOnlyJson, readPassword, root, runChild, sequenceSql, sha,
  snapshotNames, stagingPsql, stagingTarget, storageBucketsSql, storageObjectFile, storageObjectsSql,
  supabaseCli } from './club-platform-staging.mjs'

let release = null
let directory = null
const verificationFiles = () => ['schema_fingerprint.sql', 'tenant_grant_snapshot.sql', 'backup_content_inventory.sql',
  'restore_catalog_snapshot.sql', release.stateCheck.file, 'staging_privacy_readonly_preflight.sql',
  'backup_application_acls.sql']
const verification = name => readFileSync(join(root, 'supabase/verification', name), 'utf8').replace(/^﻿/, '')
const snapshotSql = () => ({
  fingerprint: verification('schema_fingerprint.sql'),
  grants: verification('tenant_grant_snapshot.sql'),
  inventory: verification('backup_content_inventory.sql'),
  catalog: verification('restore_catalog_snapshot.sql'),
  sequences: sequenceSql,
  // The release's state check: what staging must look like before the release.
  preflight: verification(release.stateCheck.file),
  privacy: verification('staging_privacy_readonly_preflight.sql'),
})
const dumpJobs = [['roles.sql', ['--role-only']], ['schema.sql', []], ['data.sql', ['--data-only', '--use-copy']],
  ['managed_schema.sql', ['--schema', 'auth,storage']], ['managed_data.sql', ['--schema', 'auth,storage', '--data-only', '--use-copy']],
  ['history_schema.sql', ['--schema', 'supabase_migrations']],
  ['history_data.sql', ['--schema', 'supabase_migrations', '--data-only', '--use-copy']]]
const signupTrigger = /^CREATE OR REPLACE TRIGGER "on_auth_user_created" AFTER INSERT ON "auth"\."users" FOR EACH ROW EXECUTE FUNCTION "public"\."handle_new_user"\(\);$/gm

let password = ''
let started = false
const phases = []
const startedAt = new Date().toISOString()
function save(name, value) {
  assert.match(name, /^[a-zA-Z0-9_.-]+$/)
  const bytes = Buffer.isBuffer(value) || typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n'
  writeFileSync(join(directory, name), bytes, { flag: 'wx' })
}

/** Copies one stored file through its public link, checked against its record, into the capture. */
async function copyStorageFile(index, object) {
  const { bytes, etag } = await downloadStoredFile(object, `Stored file ${index + 1}`)
  const file = storageObjectFile(index)
  save(file, bytes)
  return { bucket: object.bucket_id, name: object.name, file, bytes: bytes.length, sha256: sha(bytes),
    mimetype: object.mimetype ?? null, etag }
}
function record(value) {
  phases.push({ ...value, at: new Date().toISOString() })
  console.log(JSON.stringify(value))
}
function failed(name, result, message) {
  save(`failure-${name}.private.txt`, String(result.stderr || result.error || 'No diagnostic').slice(0, 16384))
  throw new Error(`${message}; diagnostic kept privately`)
}

function query(target, name, sql) {
  const result = stagingPsql(target, password, readOnlyJson(sql))
  if (result.status !== 0) failed(name, result, `Read-only query failed: ${name}`)
  return parseJsonOutput(result.stdout, name)
}

function snapshot(target, prefix) {
  const rows = {}
  for (const [name, sql] of Object.entries(snapshotSql())) {
    rows[name] = query(target, `${prefix}_${name}`, sql)
    save(`${prefix}_${name}.json`, rows[name])
  }
  return rows
}

function activity(target, label) {
  const [row] = query(target, `activity_${label}`, activitySql)
  save(`activity_${label}.json`, row)
  assert.equal(Number(row.other_active_clients), 0, `Another client was active during capture (${label}): STOP`)
  return row
}

function dump(name, flags) {
  const file = join(directory, name)
  assert.ok(!existsSync(file), `Refusing to overwrite ${name}`)
  const result = runChild(supabaseCli, ['db', 'dump', '--linked', '--file', file, ...flags],
    { env: childEnv({ SUPABASE_DB_PASSWORD: password }), secret: password, timeout: 900000 })
  if (result.status !== 0) failed(`dump-${name}`, result, `supabase db dump failed for ${name}`)
  const bytes = readFileSync(file)
  assert.ok(bytes.length > 100, `Empty dump: ${name}`)
  assert.ok(!bytes.toString('utf8').includes(password), `Password found in ${name}: STOP`)
  record({ phase: 'dumped', file: name, bytes: bytes.length })
}

async function main() {
  const { release: chosen, mode } = parseReleaseArgs(process.argv.slice(2), ['--verify-local', '--capture'])
  release = chosen
  directory = join(root, release.dirs.capture)
  const target = stagingTarget()
  assert.ok(existsSync(dockerExe), 'Pinned Docker Desktop client not found')
  const version = runChild(supabaseCli, ['--version'])
  assert.equal(version.status, 0, 'Pinned Supabase CLI not runnable')
  assert.equal(version.stdout.trim(), '2.110.0', 'Unexpected Supabase CLI version')
  for (const name of verificationFiles()) verification(name)
  assert.ok(!existsSync(directory), 'This capture folder was already used; captures are one-shot')
  if (mode === '--verify-local') {
    console.log(JSON.stringify({ result: 'LOCAL_READY_CAPTURE_PENDING', release: release.id, project, pooler: target.host,
      expectedVersions: release.baseVersions.length, stagingContacted: false }))
    return
  }

  password = readPassword()
  mkdirSync(directory, { recursive: true })
  started = true
  save('ATTEMPT.json', { kind: 'staging-logical-backup-capture', release: release.id, project, pooler: target.host, startedAt,
    captureScriptSha256: sha(readFileSync(fileURLToPath(import.meta.url))), cliVersion: '2.110.0', stagingWrites: false })

  const [identity] = query(target, 'identity', identitySql)
  assert.equal(identity.database, 'postgres', 'Unexpected staging database')
  assert.equal(identity.version, '17.6', 'Unexpected staging PostgreSQL version')
  assert.deepEqual(identity.versions, [...release.baseVersions], 'Staging migration history changed: STOP')
  save('target.json', { project, pooler: target.host, database: identity.database, serverVersion: identity.version,
    versions: identity.versions, observedAt: new Date().toISOString() })

  // Storage: only known buckets may exist (each one whose migration staging has, with its
  // settings), and their files are copied first. The dump holds
  // their records; the files live outside the database. Copying before the "before" snapshot
  // means a download that touched a record can never pass as a change made during the capture.
  const buckets = query(target, 'storage_buckets', storageBucketsSql)
  assert.ok(knownBucketsOnly(buckets, release.baseVersions), 'Staging has an unknown, changed or missing Storage bucket: STOP')
  save('storage_buckets.json', buckets)
  const stored = query(target, 'storage_objects', storageObjectsSql)
  const copies = []
  for (const [index, object] of stored.entries()) copies.push(await copyStorageFile(index, object))
  save('storage_objects.json', copies)
  record({ phase: 'storage_copied', buckets: buckets.length, files: copies.length,
    bytes: copies.reduce((total, copy) => total + copy.bytes, 0) })

  const before = snapshot(target, 'before')
  evaluateChecks(before.preflight, release.stateCheck.kind)
  assert.ok(before.privacy.length === 16 && before.privacy.every(row => Number(row.issue_count) === 0),
    'Staging data integrity preflight failed: STOP')
  // The files copied above are still exactly the stored ones.
  assert.ok(isDeepStrictEqual(query(target, 'storage_objects_again', storageObjectsSql), stored),
    'Stored files changed while they were copied: STOP')
  const records = before.inventory.find(entry => entry.schema_name === 'storage' && entry.table_name === 'objects')
  assert.equal(Number(records?.row_count), copies.length, 'Stored file records and copies differ: STOP')
  const baseline = activity(target, 'before')
  record({ phase: 'preflight', tables: before.inventory.length, fingerprint: fingerprintMarker(before.fingerprint),
    versions: identity.versions.length, otherActiveClients: 0 })

  const [acl] = query(target, 'application_acl_recovery', verification('backup_application_acls.sql'))
  save('application_acl_recovery.json', [acl])
  save('application_acl_recovery.generated.sql', acl.restore_sql + '\n')
  const managedHistory = query(target, 'managed_migration_rows', `select 'auth.schema_migrations' as name,
    coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]') as rows from auth.schema_migrations t
    union all select 'storage.migrations', coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]')
    from storage.migrations t`)
  save('managed_migration_rows.json', managedHistory)

  for (const [name, flags] of dumpJobs) {
    dump(name, flags)
    const sample = activity(target, `after_${name.replace('.sql', '')}`)
    assert.ok(isDeepStrictEqual(sample.writes, baseline.writes), `Staging write counters changed during ${name}: STOP`)
  }

  // The CLI leaves out managed migration rows; supplement the freshly queried rows.
  const data = readFileSync(join(directory, 'managed_data.sql'), 'utf8') + readFileSync(join(directory, 'data.sql'), 'utf8')
  for (const { name } of managedHistory) {
    const [schema, table] = name.split('.')
    assert.ok(!data.includes(`COPY "${schema}"."${table}"`) && !data.includes(`COPY ${name}`), `Managed history already in dump: ${name}`)
  }
  save('managed_migration_data.sql', managedHistory.map(({ name, rows }) =>
    `insert into ${name} select * from jsonb_populate_recordset(null::${name}, $fresh_history$${JSON.stringify(rows)}$fresh_history$::jsonb);`).join('\n') + '\n')
  const managed = readFileSync(join(directory, 'managed_schema.sql'), 'utf8')
  const triggers = [...managed.matchAll(signupTrigger)]
  assert.equal(triggers.length, 1, 'Signup trigger capture mismatch')
  save('managed_before_app.sql', managed.replace(signupTrigger, '-- Signup trigger restored after application function.'))
  save('managed_after_app.sql', triggers[0][0] + '\n')

  const after = snapshot(target, 'after')
  for (const name of snapshotNames) {
    assert.ok(isDeepStrictEqual(after[name], before[name]), `Staging changed during capture: ${name}; STOP`)
  }
  const finalActivity = activity(target, 'final')
  assert.ok(isDeepStrictEqual(finalActivity.writes, baseline.writes), 'Final staging write counters changed: STOP')

  for (const name of verificationFiles()) copyFileSync(join(root, 'supabase/verification', name), join(directory, name))
  const endedAt = new Date().toISOString()
  const files = readdirSync(directory).filter(name => !name.endsWith('.private.txt') && name !== 'ATTEMPT.json').sort()
    .map(file => ({ file, bytes: readFileSync(join(directory, file)).length, sha256: sha(readFileSync(join(directory, file))) }))
  save('capture_manifest.json', { result: 'CAPTURE_PASS_RESTORE_PENDING', release: release.id, stateCheck: release.stateCheck,
    project, startedAt, endedAt,
    serverVersion: identity.version, cliVersion: '2.110.0', files, publicFingerprint: fingerprintMarker(before.fingerprint),
    tables: before.inventory.length, versions: identity.versions, activeClientsObserved: 0, writeCounterChanges: 0,
    storageObjects: copies.length, storageBuckets: buckets.map(bucket => bucket.id),
    captureScriptSha256: sha(readFileSync(fileURLToPath(import.meta.url))),
    limitations: ['Managed service configuration and encryption root keys are not copied.',
      'Stored files are copied through their public links; restoring them means uploading them again through Storage.',
      'Private local capture is not off-machine backup retention.',
      'Activity polling cannot prove the absence of every transient session; contents and write counters were unchanged.'],
    stagingWritesAuthorized: false, phases })
  console.log(JSON.stringify({ result: 'CAPTURE_PASS_RESTORE_PENDING', directory, files: files.length,
    tables: before.inventory.length, fingerprint: fingerprintMarker(before.fingerprint) }))
}

main().catch(error => {
  const reason = String(error?.message || error).replaceAll(password || '\0', '[redacted]').slice(0, 4096)
  if (started && !existsSync(join(directory, 'STOP.json'))) {
    save('STOP.json', { result: 'STOP', startedAt, stoppedAt: new Date().toISOString(), reason, phases, stagingWrites: false })
  }
  console.error(JSON.stringify({ result: started ? 'STOP' : 'LOCAL_PRECHECK_FAILED', reason }))
  process.exitCode = 1
})
