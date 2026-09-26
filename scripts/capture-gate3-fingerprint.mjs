// Captures canonical, read-only evidence from the isolated local Gate 3 DB.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import pg from 'pg'

const repository = fileURLToPath(new URL('../', import.meta.url))
const packageRoot = resolve(repository, 'docs/release-private/gate3-isolated-20260925')
const evidenceDirectory = join(packageRoot, 'evidence')
const mode = process.argv[2]
assert.ok(['--probe', '--first', '--second', '--compare'].includes(mode),
  'Use --probe, --first, --second, or --compare')

const digest = (value) => createHash('sha256').update(value).digest('hex')

if (mode === '--compare') {
  const first = JSON.parse(readFileSync(join(evidenceDirectory, 'fingerprint-first.json'), 'utf8'))
  const second = JSON.parse(readFileSync(join(evidenceDirectory, 'fingerprint-second.json'), 'utf8'))
  assert.deepEqual(second.versions, first.versions, 'Migration history differs between clean replays')
  assert.deepEqual(second.rows, first.rows, 'Schema fingerprint differs between clean replays')
  assert.deepEqual(second.audit, first.audit, 'Ownership/overlap audit differs between clean replays')
  const comparison = {
    result: 'PASS',
    migrationCount: first.versions.length,
    fingerprintRows: first.rows.length,
    marker: first.marker,
    firstSha256: digest(readFileSync(join(evidenceDirectory, 'fingerprint-first.json'))),
    secondSha256: digest(readFileSync(join(evidenceDirectory, 'fingerprint-second.json'))),
  }
  writeFileSync(join(evidenceDirectory, 'comparison.json'), JSON.stringify(comparison, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify(comparison))
} else {
  const password = process.env.RALLY_GATE3_DB_PASSWORD
  assert.ok(password, 'Set RALLY_GATE3_DB_PASSWORD for the local disposable database')
  const port = mode === '--probe'
    ? Number.parseInt(process.env.RALLY_GATE3_PROBE_PORT ?? '54322', 10)
    : 55322
  assert.ok(Number.isInteger(port) && port > 0 && port <= 65535, 'Invalid local port')
  const client = new pg.Client({
    host: '127.0.0.1', port, user: 'postgres', password, database: 'postgres',
    application_name: 'rally_gate3_readonly_fingerprint',
  })
  await client.connect()
  try {
    await client.query('begin read only')
    const identity = (await client.query("select current_database() as database, current_setting('server_version') as version")).rows[0]
    assert.equal(identity.database, 'postgres')
    assert.match(identity.version, /^17\./)
    const sql = readFileSync(join(packageRoot, 'supabase/schema_fingerprint.sql'), 'utf8')
    const queryResults = await client.query(sql)
    const rows = Array.isArray(queryResults) ? queryResults.at(-1).rows : queryResults.rows
    const markerRows = rows.filter((row) => row.category === '!fingerprint' && row.identity === 'md5')
    assert.equal(markerRows.length, 1, 'Expected one canonical fingerprint marker')
    const marker = markerRows[0].details
    assert.match(marker, /^[0-9a-f]{32}$/)

    if (mode === '--probe') {
      console.log(JSON.stringify({ result: 'PASS', mode, port, database: identity.database,
        postgres: identity.version, fingerprintRows: rows.length, marker }))
    } else {
      const versions = (await client.query('select version from supabase_migrations.schema_migrations order by version'))
        .rows.map((row) => row.version)
      const expected = readdirSync(join(packageRoot, 'supabase/migrations'))
        .filter((name) => name.endsWith('.sql')).sort().map((name) => name.split('_')[0])
      assert.deepEqual(versions, expected, 'Expected exactly the 14 ordered migrations')
      const audit = (await client.query(`
        select
          (select count(*)::int from public.clubs) as clubs,
          (select count(*)::int from public.venues) as venues,
          (select count(*)::int from public.courts) as courts,
          (select count(*)::int from public.members) as members,
          (select count(*)::int from public.bookings) as bookings,
          (select count(*)::int from public.court_allocations) as allocations,
          (select count(*)::int from public.transactions) as transactions,
          (select count(*)::int from public.courts c left join public.venues v
            on v.id = c.venue_id and v.club_id = c.club_id where v.id is null) as court_venue_mismatches,
          (select count(*)::int from public.court_allocations a
            join public.court_allocations b on a.id < b.id and a.court_id = b.court_id
              and a.interval && b.interval
            where a.status in ('held','reserved','playing')
              and b.status in ('held','reserved','playing')) as active_overlap_pairs,
          (select count(*)::int from pg_constraint
            where conname = 'court_allocations_no_overlap'
              and conrelid = 'public.court_allocations'::regclass) as exclusion_constraints,
          (select count(*)::int from public.transactions
            where verification_status is distinct from 'unverified') as unexpected_verified_transactions
      `)).rows[0]
      assert.equal(audit.court_venue_mismatches, 0)
      assert.equal(audit.active_overlap_pairs, 0)
      assert.equal(audit.exclusion_constraints, 1)
      assert.equal(audit.unexpected_verified_transactions, 0)
      const record = { mode, database: identity.database, postgres: identity.version,
        versions, marker, rows, audit }
      mkdirSync(evidenceDirectory, { recursive: true })
      const output = join(evidenceDirectory, mode === '--first' ? 'fingerprint-first.json' : 'fingerprint-second.json')
      assert.ok(!existsSync(output), 'Refusing to overwrite existing replay evidence')
      writeFileSync(output, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' })
      console.log(JSON.stringify({ result: 'PASS', mode, migrationCount: versions.length,
        fingerprintRows: rows.length, marker, audit, outputSha256: digest(readFileSync(output)) }))
    }
  } finally {
    await client.query('rollback')
    await client.end()
  }
}
