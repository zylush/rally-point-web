#!/usr/bin/env node
/**
 * Applies ONE migration that already went through a staging release to the Brinely production
 * database (Supabase project tuttbvwnlndcstmmxybb), with the same gates in a smaller form:
 *
 *   node scripts/run-production-release.mjs --release flat-booking-fee-20261128 --check
 *       read-only: project, migration ledger, schema fingerprint; prints the manifest SHA-256
 *   node scripts/run-production-release.mjs --release flat-booking-fee-20261128 --apply --manifest <sha256>
 *       saves a local backup of the rows the migration changes and the before-fingerprint, applies
 *       the migration and its ledger row in ONE transaction, then runs the postchecks
 *   node scripts/run-production-release.mjs --release flat-booking-fee-20261128 --verify
 *       read-only postchecks only
 *
 * The SQL applied is the exact file the staging release applied (copied into its evidence folder),
 * and it must still equal the repo's migration. Production must be at the schema staging had
 * before that release (same fingerprint), and must end at the schema staging had after it.
 * Every postflight must pass wherever it passed on staging. The two-club isolation check is not
 * run on production: it creates fixture users and clubs (rolled back) and ran on staging.
 *
 * The connection string (Supabase "Session pooler" URI with the database password) is read from
 * BRINELY_PROD_DB_FILE or C:/Users/ed/.rally-point/production-db.local, outside the repo. It is
 * never printed or written to evidence. Evidence goes to docs/release-private/ (local only).
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
const secretFile = process.env.BRINELY_PROD_DB_FILE ?? join(homedir(), '.rally-point', 'production-db.local')

/** Production releases: each follows a staging release whose evidence it reuses. */
const releases = Object.freeze({
  'flat-booking-fee-20261128': Object.freeze({
    migration: '20261127110000_flat_booking_fee.sql',
    stagingApply: 'docs/release-private/flat-booking-fee-staging-apply-20261128-r1',
    // Staging before and after this release (production was built to the "before" state).
    beforeMarker: '3af88ea9110df5cf26f5348b084b5560',
    afterMarker: '1e3d3f5a6718158cba92b6eb203188e4',
    beforeCount: 43,
    // Rows the migration rewrites (club_accounts.commission_rate set to 0), saved before it runs.
    backup: Object.freeze({ club_accounts: 'select * from public.club_accounts order by club_id' }),
  }),
})

const sha = (text) => createHash('sha256').update(text).digest('hex')
const args = process.argv.slice(2)
const mode = ['--check', '--apply', '--verify'].find((flag) => args.includes(flag))
assert.ok(mode, 'Pass --release <id> and one of --check, --apply --manifest <sha256>, --verify')
const releaseId = args[args.indexOf('--release') + 1]
assert.ok(args.includes('--release') && Object.hasOwn(releases, releaseId ?? ''), `Unknown release. Known: ${Object.keys(releases).join(', ')}`)
const release = releases[releaseId]

function releaseSql() {
  const evidence = join(root, release.stagingApply)
  assert.ok(existsSync(join(evidence, 'RESULT.json')), `Staging evidence missing: ${release.stagingApply}`)
  const staged = JSON.parse(readFileSync(join(evidence, 'RESULT.json'), 'utf8'))
  assert.equal(staged.result, 'PASS', 'The staging apply did not pass')
  const appliedBytes = readFileSync(join(evidence, `release-${release.migration}`))
  const repoBytes = readFileSync(join(root, 'supabase/migrations', release.migration))
  assert.equal(sha(appliedBytes), sha(repoBytes), 'The repo migration differs from the SQL staging applied')
  const sql = appliedBytes.toString('utf8').replace(/^\uFEFF/, '')
  assert.ok(!/^\s*(begin|commit|rollback|start transaction)\s*;/im.test(sql), 'The migration has its own transaction control')
  const match = /^(\d+)_([a-z0-9_]+)\.sql$/.exec(release.migration)
  return { sql, version: match[1], label: match[2], sha256: sha(appliedBytes) }
}

function expectedVersions(version) {
  const names = readdirSync(join(root, 'supabase/migrations')).filter((name) => name.endsWith('.sql')).sort()
  const before = names.map((name) => name.split('_')[0]).filter((v) => v < version)
  assert.equal(before.length, release.beforeCount, `Expected ${release.beforeCount} earlier migrations in the repo`)
  return before
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
  return { connectionString: url.toString(), ssl: { rejectUnauthorized: false }, application_name: `brinely-production-release-${releaseId}` }
}

async function rows(client, sql) {
  const result = await client.query(sql)
  return (Array.isArray(result) ? result.filter((r) => r.command === 'SELECT').at(-1) : result).rows
}

async function fingerprint(client) {
  const all = await rows(client, readFileSync(join(root, 'supabase/verification/schema_fingerprint.sql'), 'utf8'))
  return { all, marker: all.find((r) => r.category === '!fingerprint')?.details }
}

async function ledger(client) {
  return (await rows(client, 'select version from supabase_migrations.schema_migrations order by version')).map((r) => r.version)
}

const evidenceDir = (() => {
  const day = new Date().toISOString().slice(0, 10).replaceAll('-', '')
  let n = 1
  const base = `docs/release-private/production-${releaseId}-${mode.slice(2)}-${day}`
  while (existsSync(join(root, `${base}-r${n}`))) n += 1
  return join(root, `${base}-r${n}`)
})()
const save = (name, value) => {
  mkdirSync(evidenceDir, { recursive: true })
  writeFileSync(join(evidenceDir, name), `${JSON.stringify(value, null, 2)}\n`)
}

async function postchecks(client) {
  const { all, marker } = await fingerprint(client)
  const stagingDir = join(root, release.stagingApply)
  const report = { marker, markerMatchesStaging: marker === release.afterMarker, fingerprintDifferences: [], postflights: [] }
  if (!report.markerMatchesStaging) {
    const key = (r) => `${r.category}|${r.identity}`
    const staging = new Map(JSON.parse(readFileSync(join(stagingDir, 'after-fingerprint.json'), 'utf8')).map((r) => [key(r), r.details]))
    const here = new Map(all.map((r) => [key(r), r.details]))
    for (const [k, v] of here) if (k !== '!fingerprint|md5' && staging.get(k) !== v) report.fingerprintDifferences.push({ key: k, production: v, staging: staging.get(k) ?? null })
    for (const [k, v] of staging) if (!here.has(k)) report.fingerprintDifferences.push({ key: k, production: null, staging: v })
  }
  const files = readdirSync(join(root, 'supabase/verification')).filter((f) => f.endsWith('_postflight.sql')).sort()
  for (const file of files) {
    const result = await rows(client, readFileSync(join(root, 'supabase/verification', file), 'utf8'))
    const stagingFile = join(stagingDir, `post-${file.replace(/\.sql$/, '.json')}`)
    const stagingFailed = existsSync(stagingFile)
      ? new Set(JSON.parse(readFileSync(stagingFile, 'utf8')).filter((r) => r.required && !r.ok).map((r) => r.check_name))
      : null
    const failed = result.filter((r) => r.required && !r.ok).map((r) => r.check_name)
    // Earlier postflights count their own migration totals; staging failed those rows the same way.
    const newFailures = stagingFailed ? failed.filter((n) => !stagingFailed.has(n)) : failed.filter((n) => !n.startsWith('ledger_'))
    report.postflights.push({ file, checks: result.length, failed, newFailures, stagingEvidence: Boolean(stagingFailed), rows: result })
  }
  const own = report.postflights.find((p) => p.file === release.migration.replace(/^\d+_/, '').replace(/\.sql$/, '_postflight.sql'))
  report.ownPostflightClean = Boolean(own) && own.failed.length === 0
  report.pass = report.markerMatchesStaging && report.ownPostflightClean && report.postflights.every((p) => p.newFailures.length === 0)
  return report
}

const migration = releaseSql()
const versions = expectedVersions(migration.version)
const manifest = { release: releaseId, project, migration: release.migration, sha256: migration.sha256,
  beforeMarker: release.beforeMarker, afterMarker: release.afterMarker, beforeVersions: versions }
const manifestSha = sha(JSON.stringify(manifest))
console.log(`production release ${releaseId}: ${release.migration} (${migration.sha256.slice(0, 16)}…), manifest ${manifestSha}`)

const client = new pg.Client(connectionConfig())
await client.connect()
try {
  const ledgerNow = await ledger(client)
  const before = await fingerprint(client)
  const facts = {
    database: (await rows(client, 'select current_database() as d'))[0].d,
    ledgerCount: ledgerNow.length,
    ledgerMatchesExpected: JSON.stringify(ledgerNow) === JSON.stringify(versions),
    alreadyApplied: ledgerNow.includes(migration.version),
    marker: before.marker,
    markerMatchesBefore: before.marker === release.beforeMarker,
    markerMatchesAfter: before.marker === release.afterMarker,
  }
  console.log('target:', JSON.stringify(facts))

  if (mode === '--check') {
    const ready = facts.ledgerMatchesExpected && facts.markerMatchesBefore && !facts.alreadyApplied
    console.log(ready ? 'READY: --apply --manifest ' + manifestSha : 'NOT READY: --apply will refuse')
    if (!ready) process.exitCode = 1
  }

  if (mode === '--apply') {
    assert.equal(args[args.indexOf('--manifest') + 1], manifestSha, 'The approved manifest does not match this release')
    assert.ok(!facts.alreadyApplied, 'Refusing: the migration is already in the production ledger')
    assert.ok(facts.ledgerMatchesExpected, 'Refusing: the production migration ledger is not the expected one')
    assert.ok(facts.markerMatchesBefore, 'Refusing: the production schema is not the state this release was tested on')
    const backup = {}
    for (const [name, sql] of Object.entries(release.backup)) backup[name] = await rows(client, sql)
    save('ATTEMPT.json', { project, manifestSha, manifest, startedAt: new Date().toISOString(), target: facts })
    save('before-fingerprint.json', before.all)
    save('backup-rows.json', backup)
    const tag = `migration_${migration.sha256.slice(0, 16)}`
    assert.ok(!migration.sql.includes(`$${tag}$`), 'Dollar-quote tag collision')
    try {
      await client.query('begin')
      await client.query("set local lock_timeout = '15s'; set local statement_timeout = '10min'; set local search_path = public, extensions;")
      await client.query(migration.sql)
      await client.query(`insert into supabase_migrations.schema_migrations (version, statements, name) values ($1, array[$${tag}$${migration.sql}$${tag}$], $2)`,
        [migration.version, migration.label])
      await client.query('commit')
      console.log(`applied ${release.migration}`)
    } catch (error) {
      await client.query('rollback').catch(() => {})
      save('RESULT.json', { result: 'FAIL', project, manifestSha, error: String(error?.message ?? error), rolledBack: true })
      throw new Error(`Rolled back: ${error?.message ?? error}`)
    }
  }

  if (mode === '--apply' || mode === '--verify') {
    const report = await postchecks(client)
    const after = await fingerprint(client)
    save('after-fingerprint.json', after.all)
    save(mode === '--apply' ? 'RESULT.json' : 'VERIFY.json', { result: report.pass ? 'PASS' : 'CHECK', project, manifestSha, ...report })
    console.log(`fingerprint ${report.marker} ${report.markerMatchesStaging ? '= staging after the release' : `!= staging (${report.fingerprintDifferences.length} differences)`}`)
    for (const p of report.postflights) console.log(`${p.file}: ${p.checks} checks, failed [${p.failed}]${p.newFailures.length ? ` NEW [${p.newFailures}]` : ''}`)
    console.log(report.pass ? 'PASS' : 'CHECK: see evidence', evidenceDir)
    if (!report.pass) process.exitCode = 1
  }
} finally {
  await client.end()
}
