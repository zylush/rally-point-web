// New candidate only. The consumed r1 guard remains byte-for-byte unchanged.
import assert from 'node:assert/strict'
import { isIP } from 'node:net'
import { verifyContainer } from './reservation-resume-executor-guards.mjs'

export * from './reservation-resume-executor-guards.mjs'

export function verifyLoopbackContainer(rows) {
  const local = verifyContainer(rows)
  const bindings = rows[0].NetworkSettings.Ports['5432/tcp']
  assert.ok(Array.isArray(bindings) && bindings.length === 1 &&
    bindings[0].HostIp === '127.0.0.1' && bindings[0].HostPort === '54322',
  'Database port is not bound exclusively to 127.0.0.1:54322')
  return local
}

export function verifySocketIdentity(row) {
  assert.ok(row && typeof row === 'object', 'Missing Docker-socket identity')
  assert.equal(row.db, 'postgres', 'Wrong Docker-socket database')
  assert.equal(row.role, 'postgres', 'Wrong Docker-socket role')
  assert.equal(row.version, '17.6', 'Wrong Docker-socket PostgreSQL version')
  assert.equal(row.address, null, 'Docker-socket query used TCP')
  assert.equal(row.port, null, 'Docker-socket query used TCP')
  assert.match(row.cluster_id, /^\d+$/, 'Missing PostgreSQL cluster identifier')
  assert.equal(row.data_directory, '/var/lib/postgresql/data', 'Wrong PostgreSQL data directory')
  assert.match(row.postmaster_started, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d/, 'Missing PostgreSQL start time')
  return row
}

export function verifyPostgresIdentity(row, database, addresses, socket) {
  verifySocketIdentity(socket)
  assert.ok(row && typeof row === 'object', 'Missing PostgreSQL TCP identity')
  assert.equal(row.db, database)
  assert.equal(row.role, 'postgres')
  assert.equal(row.version, '17.6')
  assert.equal(row.port, 5432, 'Wrong PostgreSQL server port')
  assert.equal(row.cluster_id, socket.cluster_id, 'PostgreSQL cluster differs from Docker-socket reference')
  assert.equal(row.data_directory, socket.data_directory, 'PostgreSQL data directory differs')
  assert.equal(row.postmaster_started, socket.postmaster_started, 'PostgreSQL server start differs')
  assert.ok(Array.isArray(addresses) && addresses.length > 0 &&
    addresses.every(address => isIP(address) === 4), 'Missing Docker IPv4 address')
  assert.equal(typeof row.address, 'string', 'Missing PostgreSQL server address')
  const [address, mask, extra] = row.address.split('/')
  assert.ok(isIP(address) === 4 && extra === undefined &&
    (mask === undefined || mask === '32') && addresses.includes(address),
  'Connection is not the approved local container')
  assert.equal(row.other_clients, 0, 'Other client in disposable database')
}
