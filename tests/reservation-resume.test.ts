// @vitest-environment node
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const candidate = 'docs/release-private/reservation-rpc-resume-20260926-r1/candidate/supabase/migrations'
const sha = (text: string | Buffer) => createHash('sha256').update(text).digest('hex')
const checks = () => import('../scripts/reservation-resume-checks.mjs')
const hex = 'a'.repeat(64)
const sqlSuites = readdirSync('supabase/tests/database').filter(n => n.endsWith('.test.sql')).sort()
const authorizationCases = ['member-own', 'same-club-private', 'staff-assigned-venue', 'staff-unassigned-venue',
  'admin-own-club', 'cross-club', 'forged-ids', 'revoked-staff-grant', 'anonymous-denial',
  'safe-tv', 'limited-roster', 'legacy-direct-write-denial']
const concurrencyCases = ['same-court-one-winner', 'adjacent-both-succeed', 'different-courts-both-succeed',
  'booking-rental-open-play-shared-rule', 'cancellation-releases', 'completion-releases',
  'retry-no-duplicates', 'pause-restored-after-probe']
const allTrue = (names: string[]) => Object.fromEntries(names.map(n => [n, true]))

function fixture() {
  const expected = { packageSha256: hex, schemaSha256: 'b'.repeat(64), baselineSha256: 'c'.repeat(64),
    snapshotMd5: 'd'.repeat(32), target: 'local:rally_resume_verify_20260926', database: 'rally_resume_verify_20260926',
    backendPid: 123, transactionId: '456', sqlSuites }
  const proof = { kind: 'reservation-rpc-resume-proof-v1', approval: 'scoped-reservation-rpc-resume-approved',
    packageSha256: expected.packageSha256, schemaSha256: expected.schemaSha256,
    baselineSha256: expected.baselineSha256, snapshotMd5: expected.snapshotMd5,
    target: expected.target, database: expected.database, stagingPaused: true,
    enforced: true, paused: true, unrelatedStateUnchanged: true,
    orders: ['pause-enforcement-resume', 'enforcement-pause-resume'].map(order => ({
      order, result: 'PASS', environment: 'disposable-local', syntheticOnly: true,
      packageSha256: expected.packageSha256, schemaSha256: expected.schemaSha256,
      rawEvidenceSha256: 'e'.repeat(64), baselineRestored: true,
      authorization: allTrue(authorizationCases), concurrency: allTrue(concurrencyCases),
      independentConnections: 2, sqlSuites: sqlSuites.map(name => ({ name, planned: 10, passed: 10, failed: 0, skipped: 0 })),
    })) }
  const bytes = JSON.stringify(proof)
  return { proof, bytes, expected: { ...expected, proofSha256: sha(bytes) } }
}

describe('guarded reservation RPC resume preparation', () => {
  it('provides a draft outside the normal migration chain', () => {
    const names = existsSync(candidate) ? readdirSync(candidate) : []
    expect(names.filter(n => /^\d{14}_reservation_rpc_resume\.sql$/.test(n))).toHaveLength(1)
    expect(readdirSync('supabase/migrations').filter(n => n.includes('reservation_rpc_resume'))).toEqual([])
  })

  it('prepares actual staging and clean replay orders, with resume last', async () => {
    const { makeResumeOrders } = await checks()
    const names = readdirSync('supabase/migrations').filter(n => n.endsWith('.sql'))
    const draft = '20990101000000_reservation_rpc_resume.sql'
    const orders = makeResumeOrders(names, draft)
    expect(orders.map(o => o.order)).toEqual(['pause-enforcement-resume', 'enforcement-pause-resume'])
    for (const order of orders) {
      expect(order.migrations).toHaveLength(16)
      expect(order.migrations.at(-1)).toBe(draft)
      expect(new Set(order.migrations).size).toBe(16)
    }
    expect(orders[0].migrations.slice(-3)).toEqual([
      '20260925174111_reservation_write_pause.sql',
      '20260921111105_tenant_enforcement.sql', draft,
    ])
  })

  it('preserves the applied pause and consumed staging package', () => {
    expect(sha(readFileSync('supabase/migrations/20260925174111_reservation_write_pause.sql')))
      .toBe('f5a03d8c294efc7902c195f84eeee0af97b81377b5be2a5ccba9243d5e6a44ef')
    expect(sha(readFileSync('docs/release-private/staging-pause-apply-20260926-r2/frozen/manifest.json')))
      .toBe('9908a527d40d5979559a844ab5e4a687aa3ee76f6003f48b3064394d35ef574f')
  })

  it('binds complete evidence to the approved bytes, target, baseline, package, schema and current transaction', async () => {
    const { validateResumeProof } = await checks()
    const { bytes, expected } = fixture()
    expect(validateResumeProof(bytes, expected)).toEqual({ database: expected.database,
      backend_pid: 123, transaction_id: '456', proof_sha256: expected.proofSha256,
      package_sha256: expected.packageSha256, snapshot_md5: expected.snapshotMd5,
      enforcement_verified: true, authorization_verified: true, concurrency_verified: true,
      orders_verified: 2 })
  })

  it.each(['approval', 'packageSha256', 'schemaSha256', 'baselineSha256', 'snapshotMd5', 'target', 'database'])
  ('rejects a changed proof field %s even when its bytes are repinned', async key => {
    const { validateResumeProof } = await checks()
    const { proof, expected } = fixture()
    const altered = { ...proof, [key]: 'incorrect' }
    const bytes = JSON.stringify(altered)
    expect(() => validateResumeProof(bytes, { ...expected, proofSha256: sha(bytes) })).toThrow()
  })

  it.each(['stagingPaused', 'enforced', 'paused', 'unrelatedStateUnchanged'])
  ('rejects missing prerequisite %s', async key => {
    const { validateResumeProof } = await checks()
    const { proof, expected } = fixture()
    const bytes = JSON.stringify({ ...proof, [key]: false })
    expect(() => validateResumeProof(bytes, { ...expected, proofSha256: sha(bytes) })).toThrow()
  })

  it.each([...authorizationCases.map(key => ['authorization', key]), ...concurrencyCases.map(key => ['concurrency', key])])
  ('rejects each missing/failed required scenario %s:%s', async (group, key) => {
    const { validateResumeProof } = await checks()
    const { proof, expected } = fixture()
    proof.orders[0][group as 'authorization' | 'concurrency'][key] = false
    const bytes = JSON.stringify(proof)
    expect(() => validateResumeProof(bytes, { ...expected, proofSha256: sha(bytes) })).toThrow()
  })

  it.each(['missing-order', 'duplicate-order', 'one-connection', 'not-restored', 'real-target',
    'not-synthetic', 'wrong-package', 'wrong-schema', 'missing-raw', 'missing-suite', 'failed-suite', 'skipped-suite'])
  ('rejects incomplete rehearsal evidence: %s', async defect => {
    const { validateResumeProof } = await checks()
    const { proof, expected } = fixture()
    const row = proof.orders[0]
    if (defect === 'missing-order') proof.orders.pop()
    if (defect === 'duplicate-order') proof.orders[1] = row
    if (defect === 'one-connection') row.independentConnections = 1
    if (defect === 'not-restored') row.baselineRestored = false
    if (defect === 'real-target') row.environment = 'staging'
    if (defect === 'not-synthetic') row.syntheticOnly = false
    if (defect === 'wrong-package') row.packageSha256 = 'f'.repeat(64)
    if (defect === 'wrong-schema') row.schemaSha256 = 'f'.repeat(64)
    if (defect === 'missing-raw') row.rawEvidenceSha256 = ''
    if (defect === 'missing-suite') row.sqlSuites.pop()
    if (defect === 'failed-suite') row.sqlSuites[0].failed = 1
    if (defect === 'skipped-suite') row.sqlSuites[0].skipped = 1
    const bytes = JSON.stringify(proof)
    expect(() => validateResumeProof(bytes, { ...expected, proofSha256: sha(bytes) })).toThrow()
  })

  it('rejects unapproved bytes, malformed input, invalid session identity and inventory drift', async () => {
    const { validateResumeProof, makeResumeOrders } = await checks()
    const { bytes, expected } = fixture()
    expect(() => validateResumeProof(bytes + ' ', expected)).toThrow()
    for (const raw of ['{', '{}', '[]', 'null', 'true']) {
      expect(() => validateResumeProof(raw, { ...expected, proofSha256: sha(raw) })).toThrow()
    }
    expect(() => validateResumeProof(bytes, { ...expected, backendPid: 0 })).toThrow()
    expect(() => validateResumeProof(bytes, { ...expected, transactionId: '1; grant all' })).toThrow()
    const names = readdirSync('supabase/migrations').filter(n => n.endsWith('.sql'))
    for (const bad of [names.slice(1), [...names, names[0]], [...names, 'unexpected.sql']]) {
      expect(() => makeResumeOrders(bad, '20990101000000_reservation_rpc_resume.sql')).toThrow()
    }
    expect(() => makeResumeOrders(names, '../20990101000000_reservation_rpc_resume.sql')).toThrow()
    expect(() => makeResumeOrders(names, '20200101000000_reservation_rpc_resume.sql')).toThrow()
  })

  it('keeps the SQL atomic, one-shot, owner-only, evidence-bound, and limited to nine authenticated RPC grants', async () => {
    const { reservationRpcs } = await checks()
    const name = readdirSync(candidate).find(n => n.endsWith('.sql'))!
    const sql = readFileSync(`${candidate}/${name}`, 'utf8')
    expect(sql).toContain("current_setting('rally.reservation_resume_evidence', true)")
    expect(sql).toContain('pg_current_xact_id()')
    expect(sql).toContain('pg_backend_pid()')
    expect(sql).toContain("session_user <> 'postgres'")
    expect(sql).toContain('court_allocations_no_overlap')
    expect(sql).toContain('convalidated')
    expect(sql).toContain('indisvalid')
    expect(sql).toContain("'=(uuid,uuid)'::regoperator::oid")
    expect(sql).toContain("'&&(anyrange,anyrange)'::regoperator::oid")
    expect(sql).toContain("'(status=ANY(ARRAY[''held''::text,''reserved''::text,''playing''::text]))'")
    expect(sql).toContain('has_any_column_privilege')
    expect(sql).toContain("set_config('rally.reservation_resume_evidence', '', true)")
    expect(sql.match(/grant execute on function public\./g)).toHaveLength(9)
    for (const rpc of reservationRpcs) expect(sql).toContain(`grant execute on function public.${rpc} to authenticated;`)
    expect(sql).not.toMatch(/grant\s+(?:all|insert|update|delete|truncate|references|trigger|maintain|select)\b/i)
    expect(sql).not.toMatch(/to\s+(?:public|anon|service_role)\s*;/i)
    const state = readFileSync('supabase/verification/reservation_resume_state.sql', 'utf8').trim()
    expect(sql).toContain(state.replace(' as snapshot_md5\n', ' into v_snapshot\n'))
  })

  it('allows only the nine exact RPC ACL additions and the resume ledger row in postflight', async () => {
    const { verifyResumeDelta, resumeCatalogIdentities, reservationTables, reservationRpcs } = await checks()
    const version = '20260926063659'
    const versions = readdirSync('supabase/migrations').filter(n => n.endsWith('.sql')).sort().map(n => n.split('_')[0])
    const roles = ['public', 'anon', 'authenticated', 'service_role']
    const audit = [
      ...roles.flatMap(role_name => reservationTables.map((target: string) => ({ kind: 'table write', role_name, target, violation: false }))),
      ...roles.flatMap(role_name => reservationRpcs.map((target: string) => ({ kind: 'RPC execute', role_name, target, violation: false }))),
      ...reservationTables.map((target: string) => ({ kind: 'authenticated read', role_name: 'authenticated', target, violation: false })),
    ]
    const before = { catalog: [{ objects: resumeCatalogIdentities.map((identity: string) => ({ kind: 'function', identity,
      details: { owner: 'postgres', definition: 'synthetic', acl: [['postgres', 'postgres', 'EXECUTE', false]] } })) }],
    inventory: [{ schema_name: 'public', table_name: 'bookings', row_count: 1, content_md5: 'same' },
      { schema_name: 'supabase_migrations', table_name: 'schema_migrations', row_count: 15, content_md5: 'old' }],
    history: versions.map(version => ({ version, name: 'fixture', statements: ['select 1'] })),
    grants: [{ snapshot: { versions, tableGrantFixture: false } }], sequences: [{ name: 's', value: '1' }],
    activity: [{ other_active_clients: 0, writes: [{ schema: 'public', table: 'bookings', inserted: 1, updated: 0, deleted: 0 },
      { schema: 'supabase_migrations', table: 'schema_migrations', inserted: 15, updated: 0, deleted: 0 }] }] }
    const after = structuredClone(before)
    for (const row of after.catalog[0].objects) row.details.acl.push(['postgres', 'authenticated', 'EXECUTE', false])
    after.inventory[1].row_count = 16
    after.inventory[1].content_md5 = 'new'
    after.history.push({ version, name: 'reservation_rpc_resume', statements: ['do $resume$ ...'] })
    after.grants[0].snapshot.versions.push(version)
    after.activity[0].writes[1].inserted++
    expect(verifyResumeDelta(before, { ...after, audit }, version)).toMatchObject({ result: 'PASS', rpcGrantsAdded: 9, auditRows: 66 })
    const mutations = [
      (x: typeof after) => { x.catalog[0].objects[0].details.acl.push(['postgres', 'anon', 'EXECUTE', false]) },
      (x: typeof after) => { x.catalog[0].objects[0].details.definition = 'changed' },
      (x: typeof after) => { x.catalog[0].objects.pop() },
      (x: typeof after) => { x.inventory[0].content_md5 = 'changed' },
      (x: typeof after) => { x.history[0].statements = ['changed'] },
      (x: typeof after) => { x.grants[0].snapshot.tableGrantFixture = true },
      (x: typeof after) => { x.sequences[0].value = '2' },
      (x: typeof after) => { x.activity[0].writes[0].inserted++ },
      (x: typeof after) => { x.activity[0].other_active_clients = 1 },
    ]
    for (const change of mutations) {
      const changed = structuredClone(after)
      change(changed)
      expect(() => verifyResumeDelta(before, { ...changed, audit }, version)).toThrow()
    }
    expect(() => verifyResumeDelta(before, { ...after, audit: audit.slice(1) }, version)).toThrow()
    expect(() => verifyResumeDelta({}, {}, version)).toThrow()
  })
})
