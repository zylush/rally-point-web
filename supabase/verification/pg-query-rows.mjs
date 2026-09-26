import assert from 'node:assert/strict'

// node-postgres returns one result for one statement and an array when SQL
// contains multiple statements (for example SET followed by SELECT).
export function selectRows(result, label) {
  const results = Array.isArray(result) ? result : [result]
  assert.ok(results.length > 0, `${label}: final result must be SELECT`)
  for (const leading of results.slice(0, -1)) {
    assert.equal(leading?.command, 'SET', `${label}: unexpected leading command`)
    assert.deepEqual(leading.rows, [], `${label}: leading SET returned rows`)
  }
  const final = results.at(-1)
  assert.equal(final?.command, 'SELECT', `${label}: final result must be SELECT`)
  assert.ok(Array.isArray(final.rows), `${label}: final SELECT result must contain rows`)
  return final.rows
}

export function snapshotRows({ schema, acl, metadata }) {
  const schemaRows = selectRows(schema, 'schema fingerprint')
  assert.equal(schemaRows.filter((row) => row.category === '!fingerprint' && row.identity === 'md5').length,
    1, 'Expected one fingerprint marker')
  return {
    schema: schemaRows,
    acl: selectRows(acl, 'grant snapshot'),
    metadata: selectRows(metadata, 'view and helper metadata'),
  }
}
