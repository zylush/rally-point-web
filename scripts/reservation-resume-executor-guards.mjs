// Pure loopback executor guards; importing this module opens no connection.
import assert from 'node:assert/strict'

export const databases = Object.freeze(['rally_resume_gate23_20260926_stage',
  'rally_resume_gate23_20260926_clean1', 'rally_resume_gate23_20260926_clean2'])
export const manifestSha256 = '3197f0e9a0e79db4879d80080dbf84a0b0381fd87be6cd6da20143827b6c7363'

export function localConfig(database, password) {
  assert.ok(databases.includes(database), 'Unapproved application database')
  assert.ok(typeof password === 'string' && password.length > 0 &&
    !['\r','\n','\0'].some(character => password.includes(character)), 'Missing/malformed local credential')
  return { host: '127.0.0.1', port: 54322, database, user: 'postgres', password,
    ssl: false, application_name: 'rally_resume_gate23_local',
    options: '-c search_path=public,extensions,pg_catalog -c statement_timeout=30000 -c lock_timeout=10000',
    connectionTimeoutMillis: 10000, query_timeout: 45000 }
}

export function verifyContainer(rows) {
  assert.ok(Array.isArray(rows) && rows.length === 1, 'Ambiguous Docker identity')
  const row = rows[0]
  assert.equal(row.Name, '/supabase_db_rally-point-web', 'Wrong container')
  assert.equal(row.Config?.Image, 'public.ecr.aws/supabase/postgres:17.6.1.147', 'Wrong image')
  assert.equal(row.State?.Running, true, 'Container not running')
  assert.ok(row.NetworkSettings?.Ports?.['5432/tcp']?.some(p =>
    ['127.0.0.1', '0.0.0.0'].includes(p.HostIp) && p.HostPort === '54322'), 'Wrong loopback port binding')
  const secrets = row.Config.Env.filter(v => v.startsWith('POSTGRES_PASSWORD='))
  assert.equal(secrets.length, 1, 'Ambiguous local credential')
  const password = secrets[0].slice('POSTGRES_PASSWORD='.length)
  localConfig(databases[0], password)
  const addresses = Object.values(row.NetworkSettings.Networks).map(n => n.IPAddress)
  assert.ok(addresses.length > 0 && addresses.every(a => typeof a === 'string' && /^\d+\.\d+\.\d+\.\d+$/.test(a)), 'Missing container address')
  return { password, addresses }
}

export function verifyDockerEndpoint(rows) {
  assert.ok(Array.isArray(rows) && rows.length === 1, 'Ambiguous Docker context')
  const host = rows[0]?.Endpoints?.docker?.Host
  assert.ok(['npipe:////./pipe/docker_engine',
    'npipe:////./pipe/dockerDesktopLinuxEngine'].includes(host),
  'Docker endpoint is not a local Windows named pipe')
  return host
}

export function verifyAbsent(rows) {
  assert.ok(Array.isArray(rows) && rows.length === 0, 'Disposable target exists or absence check malformed')
}

// The maintenance connection has no arbitrary SQL callback exposed to replay code.
// No DROP, reset, reuse, or fallback database path exists.
export async function createFresh(query, run) {
  verifyAbsent((await query('select datname from pg_database where datname = any($1::text[]) order by datname', [databases])).rows)
  for (const database of databases) {
    await query(`CREATE DATABASE "${database}" OWNER postgres TEMPLATE template0`)
    await run(database)
  }
}

export async function executeOnce(safetyPassed, claim, work) {
  assert.equal(safetyPassed, true, 'Local safety checks must pass before any connection')
  await claim()
  return await work()
}

export function parseTap(lines, name) {
  assert.ok(Array.isArray(lines) && lines.length > 0 && lines.every(x => typeof x === 'string'), 'Missing TAP')
  const expanded = lines.flatMap(s => s.split(/\r?\n/)).filter(Boolean)
  assert.ok(!expanded.some(s => /^(?:not ok|Bail out!|# Looks like)|#\s*(?:SKIP|TODO)\b/i.test(s)), 'Failed/skipped TAP')
  const plans = expanded.filter(s => /^1\.\.[1-9]\d*$/.test(s))
  assert.equal(plans.length, 1, 'Missing/duplicate TAP plan')
  const passed = expanded.filter(s => /^ok [1-9]\d*(?:\s|$)/.test(s))
  const planned = Number(plans[0].slice(3))
  assert.equal(passed.length, planned, 'Incomplete TAP count')
  assert.deepEqual(passed.map(s => Number(s.match(/^ok (\d+)/)[1])), Array.from({ length: planned }, (_, i) => i + 1), 'Invalid TAP numbering')
  assert.ok(expanded.every(s => /^1\.\.\d+$|^ok \d+(?:\s|$)|^#|^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(s)), 'Malformed TAP output')
  return { name, planned, passed: passed.length, failed: 0, skipped: 0 }
}
