// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
// @ts-expect-error JavaScript operator module is exercised directly.
import { databases, manifestSha256, localConfig, verifyContainer, verifyDockerEndpoint, verifyAbsent, parseTap, createFresh, executeOnce } from '../scripts/reservation-resume-executor-guards.mjs'
// @ts-expect-error JavaScript operator module is exercised directly.
import { tapLines, authorizationEvidence } from '../scripts/reservation-resume-local-probes.mjs'

const fixtureCredential = () => ['in-memory', 'fixture'].join('-')
const passwordVariable = () => ['POSTGRES', 'PASSWORD'].join('_')
describe('disposable resume executor safety', () => {
  it('has exactly the three approved targets and frozen manifest', () => {
    expect(databases).toEqual(['rally_resume_gate23_20260926_stage', 'rally_resume_gate23_20260926_clean1', 'rally_resume_gate23_20260926_clean2'])
    expect(manifestSha256).toBe('3197f0e9a0e79db4879d80080dbf84a0b0381fd87be6cd6da20143827b6c7363')
  })
  it.each(['postgres', 'template1', 'rally_pause_backup_restore_20260926', 'remote', 'postgres;drop database postgres'])('rejects application connections to %s', name => {
    expect(() => localConfig(name, fixtureCredential())).toThrow()
  })
  it('pins all connection options independently of PG environment', () => {
    vi.stubEnv('PGHOST', 'remote.example.invalid')
    vi.stubEnv('PGPORT', '6543')
    vi.stubEnv('PGDATABASE', 'postgres')
    vi.stubEnv('PGOPTIONS', '-c search_path=unsafe')
    try {
      expect(localConfig(databases[0], fixtureCredential())).toMatchObject({ host: '127.0.0.1', port: 54322, database: databases[0], user: 'postgres', password: fixtureCredential(), ssl: false, options: '-c search_path=public,extensions,pg_catalog -c statement_timeout=30000 -c lock_timeout=10000', application_name: 'rally_resume_gate23_local' })
    } finally { vi.unstubAllEnvs() }
  })
  it.each(['', null, undefined, 'bad\nsecret'])('rejects missing/malformed in-memory credentials', value => {
    expect(() => localConfig(databases[0], value)).toThrow()
  })
  const container = () => ({ Name: '/supabase_db_rally-point-web', Config: { Image: 'public.ecr.aws/supabase/postgres:17.6.1.147', Env: [`${passwordVariable()}=${fixtureCredential()}`] }, State: { Running: true }, NetworkSettings: { Ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '54322' }] }, Networks: { local: { IPAddress: '172.20.0.2' } } } })
  it('validates the fixed Docker container and extracts a secret only in memory', () => {
    expect(verifyContainer([container()])).toEqual({ password: fixtureCredential(), addresses: ['172.20.0.2'] })
  })
  it.each(['npipe:////./pipe/docker_engine', 'npipe:////./pipe/dockerDesktopLinuxEngine'])('accepts a local Docker named pipe %s', endpoint => {
    expect(verifyDockerEndpoint([{ Endpoints: { docker: { Host: endpoint } } }])).toBe(endpoint)
  })
  it.each(['ssh://somewhere', 'tcp://127.0.0.1:2375', 'tcp://remote:2376', 'unix:///var/run/docker.sock'])('rejects non-approved Docker contexts %s', endpoint => {
    expect(() => verifyDockerEndpoint([{ Endpoints: { docker: { Host: endpoint } } }])).toThrow()
  })
  it.each(['image', 'stopped', 'port', 'name', 'password', 'duplicate', 'address'])('rejects container drift: %s', field => {
    const row = container()
    if (field === 'image') row.Config.Image = 'other'
    if (field === 'stopped') row.State.Running = false
    if (field === 'port') row.NetworkSettings.Ports['5432/tcp'][0].HostPort = '54323'
    if (field === 'name') row.Name = '/other'
    if (field === 'password') row.Config.Env = []
    if (field === 'duplicate') row.Config.Env.push('POSTGRES_PASSWORD=second')
    if (field === 'address') row.NetworkSettings.Networks.local.IPAddress = ''
    expect(() => verifyContainer([row])).toThrow()
  })
  it.each([null, {}, [{ datname: databases[1] }], [{ datname: 'unexplained' }]])('fails closed for occupied or malformed absence results', rows => {
    expect(() => verifyAbsent(rows)).toThrow()
  })
  it('checks all names before creating exactly one database at a time', async () => {
    const calls: unknown[] = []
    const query = vi.fn(async (sql: string, params: unknown) => { calls.push([sql, params]); return { rows: [] } })
    await createFresh(query, async () => {})
    expect(calls[0]).toEqual(['select datname from pg_database where datname = any($1::text[]) order by datname', [databases]])
    expect(calls.slice(1)).toEqual(databases.map((name: string) => [`CREATE DATABASE "${name}" OWNER postgres TEMPLATE template0`, undefined]))
  })
  it('does not create anything if even one target exists', async () => {
    const query = vi.fn(async () => ({ rows: [{ datname: databases[2] }] }))
    await expect(createFresh(query, vi.fn())).rejects.toThrow()
    expect(query).toHaveBeenCalledTimes(1)
  })
  it('never creates the next target or drops/repairs a failed one', async () => {
    const query = vi.fn(async () => ({ rows: [] }))
    const run = vi.fn(async () => { throw new Error('rehearsal failed') })
    await expect(createFresh(query, run)).rejects.toThrow('rehearsal failed')
    expect(query).toHaveBeenCalledTimes(2)
    expect(run).toHaveBeenCalledTimes(1)
  })
  it('requires local safety evidence before consuming an attempt or connecting', async () => {
    const claim = vi.fn(), work = vi.fn()
    await expect(executeOnce(false, claim, work)).rejects.toThrow()
    expect(claim).not.toHaveBeenCalled(); expect(work).not.toHaveBeenCalled()
  })
  it('consumes one attempt before work and cannot retry a consumed attempt', async () => {
    let consumed = false
    const claim = vi.fn(() => { if (consumed) throw new Error('consumed'); consumed = true })
    const work = vi.fn(async () => { throw new Error('failed') })
    await expect(executeOnce(true, claim, work)).rejects.toThrow('failed')
    await expect(executeOnce(true, claim, work)).rejects.toThrow('consumed')
    expect(work).toHaveBeenCalledTimes(1)
  })
  it('accepts only a complete numbered TAP plan', () => {
    expect(parseTap(['1..2', 'ok 1 - a', 'ok 2 - b'], 'fixture')).toEqual({ name: 'fixture', planned: 2, passed: 2, failed: 0, skipped: 0 })
  })
  it('ignores only known UUID output from rollback-only JWT test setup', () => {
    expect(parseTap(['1..1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'ok 1 - a'], 'fixture').passed).toBe(1)
  })
  it.each([
    [], ['1..0'], ['1..2', 'ok 1 - a'], ['1..1', 'not ok 1 - failed'],
    ['1..1', 'ok 1 # SKIP'], ['1..1', 'ok 1 # TODO'], ['1..1', 'ok 1', 'Bail out!'],
    ['1..2', 'ok 1', 'ok 1'], ['1..1', 'ok 2'], ['1..1', '1..1', 'ok 1'],
    ['1..1', 'ok 1', '# Looks like failed'], ['1..1', 'ok 1', 'unrecognized output'],
  ])('rejects incomplete, skipped, duplicate or malformed TAP %j', lines => {
    expect(() => parseTap(lines, 'fixture')).toThrow()
  })
  it('extracts TAP from a multi-statement query without treating SET as an assertion', () => {
    expect(tapLines([{ rows: [] }, { rows: [{ plan: '1..1' }] }, { rows: [{ ok: 'ok 1 - a' }] }])).toEqual(['1..1', 'ok 1 - a'])
  })
  it('never labels authorization PASS from suite counts alone', () => {
    expect(() => authorizationEvidence([{ lines: ['1..68', ...Array.from({ length: 68 }, (_, i) => `ok ${i + 1}`)] }], { tableAttempts: 54 })).toThrow('Missing observed authorization assertion')
  })
})
