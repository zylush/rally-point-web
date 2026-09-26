// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { planRestoreData } from '../scripts/restore-data-checks.mjs'

const copy = (table: string, rows = 'synthetic-id\tsynthetic-value') => `COPY ${table} (id, value) FROM stdin;\n${rows ? rows + '\n' : ''}\\.\n`
const base = () => ({
  data: copy('"auth"."users"') + copy('"public"."members"') + copy('"storage"."objects"', ''),
  managed: copy('"auth"."users"') + copy('"storage"."objects"', ''),
  history: copy('"supabase_migrations"."schema_migrations"'),
  managedHistory: [
    { name: 'auth.schema_migrations', rows: [{ version: '1' }] },
    { name: 'storage.migrations', rows: [{ id: 1 }] },
  ],
  inventory: [
    ['auth', 'users', 1], ['public', 'members', 1], ['storage', 'objects', 0],
    ['supabase_migrations', 'schema_migrations', 1], ['auth', 'schema_migrations', 1], ['storage', 'migrations', 1],
  ].map(([schema_name, table_name, row_count]) => ({ schema_name, table_name, row_count })),
})

describe('restore input preflight', () => {
  it('loads managed data only once when the default dump already covers it', () => {
    expect(planRestoreData(base())).toEqual(['data.sql', 'history_data.sql', 'managed_migration_data.sql'])
  })
  it('fails closed when overlapping managed contents disagree, without exposing rows', () => {
    const input = base()
    input.managed = copy('"auth"."users"', 'PRIVATE-DATA') + copy('"storage"."objects"', '')
    expect(() => planRestoreData(input)).toThrow(/Managed dump differs/)
    try { planRestoreData(input) } catch (error) { expect(String(error)).not.toContain('PRIVATE-DATA') }
  })
  it('rejects duplicate tables inside a selected dump', () => {
    const input = base(); input.data += copy('"auth"."users"')
    expect(() => planRestoreData(input)).toThrow(/Duplicate COPY/)
  })
  it('rejects overlapping migration-history inputs', () => {
    const input = base(); input.data += copy('"supabase_migrations"."schema_migrations"')
    expect(() => planRestoreData(input)).toThrow(/Duplicate restore table/)
  })
  it('rejects incomplete table coverage and wrong row counts', () => {
    const missing = base(); missing.data = copy('"auth"."users"') + copy('"storage"."objects"', '')
    expect(() => planRestoreData(missing)).toThrow(/Table coverage/)
    const wrongCount = base(); wrongCount.inventory[0].row_count = 2
    expect(() => planRestoreData(wrongCount)).toThrow(/Row count/)
  })
  it('rejects a managed table absent from the main dump', () => {
    const input = base(); input.managed += copy('"auth"."sessions"')
    expect(() => planRestoreData(input)).toThrow(/Managed table missing/)
  })
  it('rejects truncated COPY blocks and unexpected data formats', () => {
    const truncated = base(); truncated.data = 'COPY "auth"."users" (id) FROM stdin;\nsecret'
    expect(() => planRestoreData(truncated)).toThrow(/Unterminated COPY/)
    const inserts = base(); inserts.data = 'INSERT INTO auth.users VALUES (1);'
    expect(() => planRestoreData(inserts)).toThrow(/Expected COPY/)
  })
  it('rejects duplicate or missing managed history supplements', () => {
    const duplicate = base(); duplicate.managedHistory.push(duplicate.managedHistory[0])
    expect(() => planRestoreData(duplicate)).toThrow(/Duplicate restore table/)
    const missing = base(); missing.managedHistory.pop()
    expect(() => planRestoreData(missing)).toThrow(/Table coverage/)
  })
  it('compares COPY columns as well as row values', () => {
    const input = base(); input.managed = input.managed.replace('(id, value)', '(value, id)')
    expect(() => planRestoreData(input)).toThrow(/Managed dump differs/)
  })
  it('accepts line-ending differences and row order differences', () => {
    const input = base()
    input.data = input.data.replace('synthetic-id\tsynthetic-value', 'a\t1\nb\t2')
    input.managed = input.managed.replace('synthetic-id\tsynthetic-value', 'b\t2\na\t1').replaceAll('\n', '\r\n')
    input.inventory[0].row_count = 2
    expect(planRestoreData(input)).toEqual(['data.sql', 'history_data.sql', 'managed_migration_data.sql'])
  })
})
