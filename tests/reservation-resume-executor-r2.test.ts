// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
// @ts-expect-error The JavaScript-only r2 guard module is exercised directly.
import { verifyLoopbackContainer, verifySocketIdentity, verifyPostgresIdentity } from '../scripts/reservation-resume-executor-guards-r2.mjs'

const fixtureCredential = () => ['in-memory', 'fixture'].join('-')
const passwordVariable = () => ['POSTGRES', 'PASSWORD'].join('_')
const container = (bindings = [{ HostIp: '127.0.0.1', HostPort: '54322' }]) => ({
  Name: '/supabase_db_rally-point-web',
  Config: { Image: 'public.ecr.aws/supabase/postgres:17.6.1.147', Env: [`${passwordVariable()}=${fixtureCredential()}`] },
  State: { Running: true },
  NetworkSettings: {
    Ports: { '5432/tcp': bindings },
    Networks: { local: { IPAddress: '172.18.0.2' } },
  },
})
const socket = () => ({
  db: 'postgres', role: 'postgres', version: '17.6', address: null, port: null,
  cluster_id: '7688011043246211111', data_directory: '/var/lib/postgresql/data',
  postmaster_started: '2026-09-26 05:21:13.401338+00',
})
const host = () => ({
  db: 'postgres', role: 'postgres', version: '17.6', address: '172.18.0.2/32', port: 5432,
  cluster_id: '7688011043246211111', data_directory: '/var/lib/postgresql/data',
  postmaster_started: '2026-09-26 05:21:13.401338+00', other_clients: 0,
})

describe('r2 local PostgreSQL identity guards', () => {
  it('accepts only a single loopback host binding for the pinned port', () => {
    expect(verifyLoopbackContainer([container()])).toEqual({ password: fixtureCredential(), addresses: ['172.18.0.2'] })
  })
  it.each([
    [{ HostIp: '0.0.0.0', HostPort: '54322' }],
    [{ HostIp: '::', HostPort: '54322' }],
    [{ HostIp: '0.0.0.0', HostPort: '54322' }, { HostIp: '::', HostPort: '54322' }],
    [{ HostIp: '127.0.0.1', HostPort: '54322' }, { HostIp: '::', HostPort: '54322' }],
    [{ HostIp: '127.0.0.1', HostPort: '54323' }],
  ].map(bindings => [bindings]))('rejects non-loopback or ambiguous Docker port bindings: %j', bindings => {
    expect(() => verifyLoopbackContainer([container(bindings)])).toThrow()
  })
  it('accepts a trusted Docker-socket identity before comparing host TCP', () => {
    expect(verifySocketIdentity(socket())).toEqual(socket())
  })
  it.each(['remote', 'role', 'version', 'address', 'port', 'cluster_id', 'data_directory', 'postmaster_started'])('rejects malformed Docker-socket identity: %s', field => {
    const row: Record<string, unknown> = socket()
    if (field === 'remote') row.db = 'other'
    if (field === 'role') row.role = 'anon'
    if (field === 'version') row.version = '16.0'
    if (field === 'address') row.address = '172.18.0.2/32'
    if (field === 'port') row.port = 5432
    if (field === 'cluster_id') row.cluster_id = 'not-an-id'
    if (field === 'data_directory') row.data_directory = ''
    if (field === 'postmaster_started') row.postmaster_started = ''
    expect(() => verifySocketIdentity(row)).toThrow()
  })
  it.each(['172.18.0.2/32', '172.18.0.2'])('accepts exact Docker IPv4 with or without the host mask: %s', address => {
    expect(verifyPostgresIdentity({ ...host(), address }, 'postgres', ['172.18.0.2'], socket())).toBeUndefined()
  })
  it.each(['172.18.0.3/32', '172.18.0.2/24', '172.18.0.2/032', '172.18.0.2/32/1', '127.0.0.1', null])('rejects a wrong or malformed PostgreSQL server address: %s', address => {
    expect(() => verifyPostgresIdentity({ ...host(), address }, 'postgres', ['172.18.0.2'], socket())).toThrow()
  })
  it.each(['cluster_id', 'postmaster_started', 'data_directory', 'db', 'role', 'version', 'port', 'other_clients'])('rejects host/server drift or other client: %s', field => {
    const row = host()
    if (field === 'cluster_id') row.cluster_id = '7688011043246211112'
    if (field === 'postmaster_started') row.postmaster_started = 'other'
    if (field === 'data_directory') row.data_directory = '/elsewhere'
    if (field === 'db') row.db = 'unapproved'
    if (field === 'role') row.role = 'anon'
    if (field === 'version') row.version = '16.0'
    if (field === 'port') row.port = 5433
    if (field === 'other_clients') row.other_clients = 1
    expect(() => verifyPostgresIdentity(row, 'postgres', ['172.18.0.2'], socket())).toThrow()
  })
  it('the new runner does not reuse the consumed evidence folder and obtains a Docker-socket cluster reference', () => {
    const source = readFileSync('scripts/run-reservation-resume-gate23-r2-local.mjs', 'utf8')
    expect(source).toContain('reservation-resume-gate23-20260926-r2')
    expect(source).toContain('verifySocketIdentity')
    expect(source).toContain('verifyPostgresIdentity')
    expect(source).toContain('pg_control_system()')
  })
})
