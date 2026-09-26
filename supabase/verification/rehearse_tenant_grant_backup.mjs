// Restore only into this fresh disposable local database; no remote URL accepted.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import pg from 'pg'

const root = new URL('../../', import.meta.url)
const evidence = 'docs/release-private/staging-backup-20260921/'
const read = (path) => readFileSync(new URL(path, root), 'utf8').replace(/^\uFEFF/, '')
const json = (path) => JSON.parse(read(evidence + path))
const config = { host: '127.0.0.1', port: 54322, user: 'supabase_admin', password: 'postgres' }
const scratch = 'rally_grant_restore_20260922_v3'
const verifyExisting = process.argv.includes('--verify-existing')
const enforcedOnly = process.argv.includes('--enforced-only')
const admin = new pg.Client({ ...config, database: 'postgres' })
await admin.connect()
try {
  // Reuse only an empty database left by a rolled-back bootstrap attempt.
  const exists = await admin.query('select 1 from pg_database where datname = $1', [scratch])
  if (!exists.rowCount) await admin.query(`create database ${scratch} owner postgres template template0`)
} finally { await admin.end() }
const client = new pg.Client({ ...config, database: scratch })
const report = enforcedOnly ? json('grant_repair_rehearsal.json') : { database: scratch, tests: [] }
const names = readdirSync(new URL('supabase/migrations/', root)).sort()
const repair = read('supabase/migrations/' + names.find((n) => n.endsWith('_tenant_table_grant_repair.sql')))
const fingerprint = read(evidence + 'fingerprint_compact.sql')
await client.connect()
try {
  assert.equal((await client.query('select current_database() as name')).rows[0].name, scratch)
  if (!enforcedOnly) {
  if (!verifyExisting) {
    assert.equal((await client.query("select count(*)::integer as count from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%' and c.relkind in ('r','p')")).rows[0].count, 0, 'Refusing to overwrite a nonempty rehearsal database')
  await client.query('begin')
  await client.query('create schema private authorization postgres; create schema extensions authorization postgres; grant usage on schema extensions to public; create extension pgcrypto with schema extensions; create publication supabase_realtime')
  await client.query(read(evidence + 'managed_before_app.sql'))
  await client.query(read(evidence + 'history_schema.sql'))
  for (const version of json('grant_repair_before_acl.json').rows[0].snapshot.versions) {
    await client.query('insert into supabase_migrations.schema_migrations(version) values ($1)', [version])
  }
  await client.query('set local role postgres')
  const schema = read(evidence + 'grant_repair_before_schema.sql')
  // Restore creation-time defaults before objects: pg_dump emits these at the end.
  const defaults = schema.match(/^ALTER DEFAULT PRIVILEGES[^;]+;/gm) ?? []
  await client.query(defaults.join('\n'))
  await client.query(schema)
  await client.query('create extension if not exists btree_gist with schema public')
  await client.query(read(evidence + 'grant_repair_before_data.sql'))
  await client.query(read(evidence + 'managed_after_app.sql'))
  await client.query('reset role')
  await client.query(json('grant_repair_acl_recovery.json').rows[0].restore_sql)
  await client.query('set search_path = public, extensions')
  await client.query('commit')
  }
  await client.query('set search_path = public, extensions')
  const restored = (await client.query(fingerprint)).rows[0].fingerprints
  const expected = json('grant_repair_before_fingerprint.json').rows[0].fingerprints
  const difference = restored.filter((r) => !expected.some((e) => e.category === r.category && e.identity === r.identity && e.details_md5 === r.details_md5))
  assert.equal(difference.length, 0, JSON.stringify(difference))
  assert.equal(restored.length, expected.length)
  const inventory = (await client.query(read('supabase/verification/backup_content_inventory.sql'))).rows
  const owned = (rows) => rows.filter((r) => ['public', 'private'].includes(r.schema_name))
    .map((r) => ({ ...r, row_count: Number(r.row_count) }))
  assert.deepEqual(owned(inventory), owned(json('grant_repair_before_content.json').rows))
  const restoredAcl = (await client.query(read('supabase/verification/tenant_grant_snapshot.sql'))).rows[0].snapshot
  assert.deepEqual(restoredAcl, json('grant_repair_before_acl.json').rows[0].snapshot)
  report.backup = { publicFingerprintEntries: restored.length, ownedTableContentMatches: owned(inventory).length, aclMatches: true }
  await client.query(repair)
  report.expectedFingerprint = (await client.query(fingerprint)).rows[0].fingerprints
  report.expectedAcl = (await client.query(read('supabase/verification/tenant_grant_snapshot.sql'))).rows[0].snapshot
  writeFileSync(new URL(evidence + 'grant_repair_rehearsal.json', root), JSON.stringify(report, null, 2) + '\n')
  }
  async function test(file, phase) {
    const results = await client.query(read('supabase/tests/database/' + file))
    const lines = results.flatMap((r) => r.rows.flatMap((row) => Object.values(row))).filter((v) => typeof v === 'string')
    const failures = lines.filter((line) => /^not ok|^# Looks like/i.test(line))
    assert.deepEqual(failures, [], file)
    const passed = lines.filter((line) => /^ok \d+/.test(line)).length
    const plan = lines.find((line) => /^1\.\.\d+$/.test(line))
    assert.equal(passed, Number(plan?.slice(3)), file + ' plan count')
    report.tests.push({ file, phase, passed })
    writeFileSync(new URL(evidence + 'grant_repair_rehearsal.json', root), JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify(report.tests.at(-1)))
  }
  if (!enforcedOnly) {
  await test('tenant_table_grants.test.sql', 'repaired-backfill')
  await test('null_role_guards.test.sql', 'repaired-backfill')
  // Prove the existing later cutover also composes with the repair, locally only.
  await client.query('create extension if not exists btree_gist')
  await client.query(read('supabase/migrations/20260921111105_tenant_enforcement.sql'))
  await client.query(repair)
  }
  await client.query(read('supabase/seed.sql'))
  report.tests = report.tests.filter((t) => t.phase !== 'enforced-local-only')
  for (const file of readdirSync(new URL('supabase/tests/database/', root)).filter((n) => n.endsWith('.sql')).sort()) {
    await test(file, 'enforced-local-only')
  }
  writeFileSync(new URL(evidence + 'grant_repair_rehearsal.json', root), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report.backup))
} finally { await client.end() }
