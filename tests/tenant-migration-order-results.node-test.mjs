import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { snapshotRows, selectRows } from '../supabase/verification/pg-query-rows.mjs'

const select = (rows) => ({ command: 'SELECT', rows })
const set = () => ({ command: 'SET', rows: [] })
const marker = { category: '!fingerprint', identity: 'md5', details: '0123456789abcdef0123456789abcdef' }

test('keeps the final SELECT rows from a SET plus fingerprint query', () => {
  const rows = [marker, { category: 'table', identity: 'members', details: {} }]
  assert.deepEqual(selectRows([set(), select(rows)], 'fingerprint'), rows)
})

test('keeps rows from a single SELECT result', () => {
  assert.deepEqual(selectRows(select([{ snapshot: { effective: [] } }]), 'grants'),
    [{ snapshot: { effective: [] } }])
})

test('builds a complete snapshot with a real fingerprint marker', () => {
  const state = snapshotRows({
    schema: [set(), select([marker])],
    acl: select([{ snapshot: { effective: [] } }]),
    metadata: select([{ kind: 'view', name: 'public.member_roster' }]),
  })
  assert.equal(state.schema.find((row) => row.category === '!fingerprint')?.details, marker.details)
  assert.equal(state.acl.length, 1)
  assert.equal(state.metadata.length, 1)
})

test('rejects a missing final SELECT instead of comparing undefined schemas', () => {
  assert.throws(() => selectRows([set()], 'fingerprint'), /fingerprint.*SELECT/)
  assert.throws(() => selectRows([], 'fingerprint'), /fingerprint.*SELECT/)
  assert.throws(() => selectRows({ command: 'SELECT' }, 'fingerprint'), /fingerprint.*rows/)
})

test('rejects extra leading SELECTs that would otherwise be silently ignored', () => {
  assert.throws(() => selectRows([select([{ hidden: true }]), select([marker])], 'fingerprint'),
    /fingerprint.*leading/)
})

test('rejects a snapshot whose fingerprint marker is missing or duplicated', () => {
  const base = { acl: select([{ snapshot: {} }]), metadata: select([]) }
  assert.throws(() => snapshotRows({ ...base, schema: [set(), select([])] }), /fingerprint marker/)
  assert.throws(() => snapshotRows({ ...base, schema: [set(), select([marker, marker])] }), /fingerprint marker/)
})
