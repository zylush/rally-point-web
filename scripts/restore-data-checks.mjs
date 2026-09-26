// Pure local restore-input validation; no filesystem or database access.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

function copyBlocks(sql) {
  const blocks = new Map()
  const lines = sql.replaceAll('\r\n', '\n').split('\n')
  for (let line = 0; line < lines.length; line++) {
    if (!lines[line].startsWith('COPY ')) continue
    // Deliberately accepts only the simple identifiers in this captured schema.
    // An unfamiliar pg_dump format must be reviewed, not guessed.
    const header = lines[line].match(/^COPY "?([a-z_][a-z0-9_]*)"?\."?([a-z_][a-z0-9_]*)"? (\([^;]+\)) FROM stdin;$/)
    assert.ok(header, 'Unsupported COPY header')
    const table = `${header[1]}.${header[2]}`
    assert.ok(!blocks.has(table), `Duplicate COPY: ${table}`)
    const rows = []
    while (++line < lines.length && lines[line] !== '\\.') rows.push(lines[line])
    assert.ok(line < lines.length, `Unterminated COPY: ${table}`)
    // Empty dumps have no data line; an empty line represents a real one-column row.
    const digest = createHash('sha256').update(JSON.stringify([header[3], rows.toSorted()])).digest('hex')
    blocks.set(table, { count: rows.length, digest })
  }
  assert.ok(blocks.size > 0, 'Expected COPY data blocks')
  return blocks
}

export function planRestoreData({ data, managed, history, managedHistory, inventory }) {
  const selected = copyBlocks(data)
  for (const [table, block] of copyBlocks(managed)) {
    assert.ok(selected.has(table), `Managed table missing from main dump: ${table}`)
    assert.equal(selected.get(table).digest, block.digest, `Managed dump differs: ${table}`)
  }
  function add(table, block) {
    assert.ok(!selected.has(table), `Duplicate restore table: ${table}`)
    selected.set(table, block)
  }
  for (const [table, block] of copyBlocks(history)) add(table, block)
  for (const { name, rows } of managedHistory) {
    assert.ok(['auth.schema_migrations', 'storage.migrations'].includes(name), 'Unexpected managed history table')
    assert.ok(Array.isArray(rows), 'Managed history rows missing')
    add(name, { count: rows.length })
  }
  const expected = inventory.map(row => `${row.schema_name}.${row.table_name}`).sort()
  assert.equal(new Set(expected).size, expected.length, 'Duplicate inventory table')
  assert.deepEqual([...selected.keys()].sort(), expected, 'Table coverage mismatch')
  for (const row of inventory) {
    const table = `${row.schema_name}.${row.table_name}`
    assert.equal(selected.get(table).count, Number(row.row_count), `Row count mismatch: ${table}`)
  }
  return ['data.sql', 'history_data.sql', 'managed_migration_data.sql']
}
