#!/usr/bin/env node
/**
 * Builds the EMPTY Brinely production database (Supabase project tuttbvwnlndcstmmxybb) from
 * supabase/migrations, one migration per transaction, recording each in Supabase's migration
 * history exactly as the CLI does. Then checks the result against hosted staging's evidence.
 *
 *   node scripts/run-production-bootstrap.mjs --check                 read-only: target facts + manifest
 *   node scripts/run-production-bootstrap.mjs --apply --manifest <sha256>
 *   node scripts/run-production-bootstrap.mjs --verify                read-only postchecks only
 *
 * The connection string (Supabase "Session pooler" URI with the database password) is read from
 * BRINELY_PROD_DB_FILE or C:/Users/ed/.rally-point/production-db.local, outside the repo. It is
 * never printed or written to evidence.
 *
 * Refuses: any other project, a database that already has tables, migration history, buckets or
 * users, a migration set that differs from the manifest the owner approved, and seed.sql (never run).
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const root = fileURLToPath(new URL('../', import.meta.url))
const project = 'tuttbvwnlndcstmmxybb'
const expectedCount = 43
// Hosted staging after release coaches-court-types-20261126 (same 43 migrations).
const stagingMarker = '3af88ea9110df5cf26f5348b084b5560'
const mainCheckout = 'C:/Users/ed/rally-point-web'
const stagingEvidence = join(mainCheckout, 'docs/release-private/coaches-court-types-staging-apply-20261126-r1')
const secretFile = process.env.BRINELY_PROD_DB_FILE ?? join(homedir(), '.rally-point', 'production-db.local')

const sha = (text) => createHash('sha256').update(text).digest('hex')
const args = process.argv.slice(2)
const mode = ['--check', '--apply', '--verify'].find((flag) => args.includes(flag))
assert.ok(mode, 'Pass --check, --apply --manifest <sha256>, or --verify')

function migrations() {
  const dir = join(root, 'supabase/migrations')
  const names = readdirSync(dir).filter((name) => name.endsWith('.sql')).sort()
  assert.equal(names.length, expectedCount, `Expected ${expectedCount} migrations, found ${names.length}`)
  return names.map((name) => {
    const match = /^(\d+)_([a-z0-9_]+)\.sql$/.exec(name)
    assert.ok(match, `Unexpected migration name: ${name}`)
    const sql = readFileSync(join(dir, name), 'utf8').replace(/^\uFEFF/, '')
    assert.ok(!/^\s*(begin|commit|rollback|start transaction)\s*;/im.test(sql), `${name} has its own transaction control`)
    return { name, version: match[1], label: match[2], sha256: sha(sql), sql }
  })
}

function connectionConfig() {
  assert.ok(existsSync(secretFile), `Put the production Session pooler URI in ${secretFile}`)
  const raw = readFileSync(secretFile, 'utf8').trim().replace(/^DATABASE_URL=/, '')
  let url
  try { url = new URL(raw) } catch { throw new Error('The production connection file does not hold a postgres:// URI') }
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol), 'Not a postgres URI')
  const pooler = url.hostname.endsWith('.pooler.supabase.com') && url.username.endsWith(`.${project}`)
  const direct = url.hostname === `db.${project}.supabase.co`
  assert.ok(pooler || direct, `The connection file does not point at project ${project}`)
  url.searchParams.delete('sslmode')
  return { connectionString: url.toString(), ssl: { rejectUnauthorized: false }, application_name: 'brinely-production-bootstrap' }
}

async function one(client, sql) {
  const result = await client.query(sql)
  return Array.isArray(result) ? result.filter((r) => r.command === 'SELECT').at(-1) : result
}

async function targetFacts(client) {
  const row = (await one(client, `
    select current_database() as database,
      (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')) as public_relations,
      (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public') as public_functions,
      (select count(*)::int from pg_namespace where nspname in ('private', 'board')) as app_schemas,
      to_regclass('supabase_migrations.schema_migrations') is not null as has_history,
      (select count(*)::int from storage.buckets) as buckets,
      (select count(*)::int from auth.users) as users,
      current_setting('server_version') as server_version`)).rows[0]
  row.history = row.has_history
    ? (await one(client, 'select count(*)::int as n from supabase_migrations.schema_migrations')).rows[0].n
    : 0
  row.empty = row.public_relations === 0 && row.public_functions === 0 && row.app_schemas === 0
    && row.history === 0 && row.buckets === 0 && row.users === 0
  return row
}

const evidenceDir = (() => {
  const day = new Date().toISOString().slice(0, 10).replaceAll('-', '')
  let n = 1
  while (existsSync(join(mainCheckout, `docs/release-private/production-bootstrap-${day}-r${n}`))) n += 1
  return join(mainCheckout, `docs/release-private/production-bootstrap-${day}-r${n}`)
})()
const save = (name, value) => {
  mkdirSync(evidenceDir, { recursive: true })
  writeFileSync(join(evidenceDir, name), `${JSON.stringify(value, null, 2)}\n`)
}

async function postchecks(client) {
  const fingerprint = (await one(client, readFileSync(join(root, 'supabase/verification/schema_fingerprint.sql'), 'utf8'))).rows
  const marker = fingerprint.find((r) => r.category === '!fingerprint')?.details
  const report = { marker, markerMatchesStaging: marker === stagingMarker, fingerprintDifferences: [], postflights: [] }
  if (!report.markerMatchesStaging && existsSync(join(stagingEvidence, 'after-fingerprint.json'))) {
    const key = (r) => `${r.category}|${r.identity}`
    const staging = new Map(JSON.parse(readFileSync(join(stagingEvidence, 'after-fingerprint.json'), 'utf8')).map((r) => [key(r), r.details]))
    const here = new Map(fingerprint.map((r) => [key(r), r.details]))
    for (const [k, v] of here) if (k !== '!fingerprint|md5' && staging.get(k) !== v) report.fingerprintDifferences.push({ key: k, production: v, staging: staging.get(k) ?? null })
    for (const [k, v] of staging) if (!here.has(k)) report.fingerprintDifferences.push({ key: k, production: null, staging: v })
  }
  const files = readdirSync(join(root, 'supabase/verification')).filter((f) => f.endsWith('_postflight.sql')).sort()
  for (const file of files) {
    const rows = (await one(client, readFileSync(join(root, 'supabase/verification', file), 'utf8'))).rows
    const stagingFile = join(stagingEvidence, `post-${file.replace(/\.sql$/, '.json')}`)
    const stagingFailed = existsSync(stagingFile)
      ? new Set(JSON.parse(readFileSync(stagingFile, 'utf8')).filter((r) => r.required && !r.ok).map((r) => r.check_name))
      : new Set()
    const failed = rows.filter((r) => r.required && !r.ok).map((r) => r.check_name)
    report.postflights.push({ file, checks: rows.length, failed, newFailures: failed.filter((n) => !stagingFailed.has(n)), rows })
  }
  report.pass = report.markerMatchesStaging && report.postflights.every((p) => p.newFailures.length === 0)
  return report
}

const list = migrations()
const manifest = list.map(({ name, version, sha256 }) => ({ name, version, sha256 }))
const manifestSha = sha(JSON.stringify(manifest))
console.log(`project ${project}: ${list.length} migrations, manifest ${manifestSha}`)

const client = new pg.Client(connectionConfig())
await client.connect()
try {
  const facts = await targetFacts(client)
  console.log('target:', JSON.stringify({ ...facts }))

  if (mode === '--check') {
    console.log(facts.empty ? 'EMPTY: ready for --apply' : 'NOT EMPTY: --apply will refuse')
  }

  if (mode === '--apply') {
    const approved = args[args.indexOf('--manifest') + 1]
    assert.equal(approved, manifestSha, 'The approved manifest does not match these migrations')
    assert.ok(facts.empty, 'Refusing: the production database is not empty')
    save('ATTEMPT.json', { project, manifestSha, manifest, startedAt: new Date().toISOString(), target: facts })
    await client.query('create schema if not exists supabase_migrations')
    await client.query('create table if not exists supabase_migrations.schema_migrations (version text not null primary key, statements text[], name text)')
    for (const m of list) {
      const tag = `migration_${m.sha256.slice(0, 16)}`
      assert.ok(!m.sql.includes(`$${tag}$`), 'Dollar-quote tag collision')
      try {
        await client.query('begin')
        await client.query("set local lock_timeout = '15s'; set local statement_timeout = '10min'; set local search_path = public, extensions;")
        await client.query(m.sql)
        await client.query(`insert into supabase_migrations.schema_migrations (version, statements, name) values ($1, array[$${tag}$${m.sql}$${tag}$], $2)`, [m.version, m.label])
        await client.query('commit')
        console.log(`applied ${m.name}`)
      } catch (error) {
        await client.query('rollback').catch(() => {})
        save('RESULT.json', { result: 'FAIL', project, manifestSha, failedAt: m.name, error: String(error?.message ?? error) })
        throw new Error(`Stopped at ${m.name}: ${error?.message ?? error}`)
      }
    }
  }

  if (mode === '--apply' || mode === '--verify') {
    const report = await postchecks(client)
    save(mode === '--apply' ? 'RESULT.json' : 'VERIFY.json', { result: report.pass ? 'PASS' : 'CHECK', project, manifestSha, ...report })
    console.log(`fingerprint ${report.marker} ${report.markerMatchesStaging ? '= staging' : `!= staging (${report.fingerprintDifferences.length} differences)`}`)
    for (const p of report.postflights) console.log(`${p.file}: ${p.checks} checks, failed [${p.failed}]${p.newFailures.length ? ` NEW [${p.newFailures}]` : ''}`)
    console.log(report.pass ? 'PASS' : 'CHECK: see evidence', evidenceDir)
    if (!report.pass) process.exitCode = 1
  }
} finally {
  await client.end()
}
