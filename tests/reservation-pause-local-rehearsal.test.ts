// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  assertLocalPauseRehearsalApproval, unwrapCapturedReadOnly,
  verifyLocalPauseTarget, verifyRolledBackPause, validateLocalContainerPassword,
  normalizeLocalInventory,
  localPauseMode,
  normalizeLocalActivity,
} from '../scripts/reservation-pause-local-rehearsal-checks.mjs'

describe('disposable restored-database pause rehearsal guards', () => {
  it('keeps filesystem-only, read-only, and rollback-only modes distinct', () => {
    expect(localPauseMode('--verify-local', undefined)).toBe('files')
    expect(localPauseMode('--verify-readonly-local', undefined)).toBe('read-only')
    expect(() => localPauseMode('--execute-approved', undefined)).toThrow()
    expect(localPauseMode('--execute-approved', 'rollback-only-local-approved')).toBe('rollback-only')
    expect(() => localPauseMode('--linked', 'rollback-only-local-approved')).toThrow()
  })
  it('requires an exact separate approval guard', () => {
    expect(() => assertLocalPauseRehearsalApproval(undefined)).toThrow()
    expect(() => assertLocalPauseRehearsalApproval('staging-approved')).toThrow()
    expect(assertLocalPauseRehearsalApproval('rollback-only-local-approved')).toBe(true)
  })

  it('unwraps only one captured read-only transaction', () => {
    expect(unwrapCapturedReadOnly('begin read only;\nselect 1;\ncommit;'))
      .toBe('select 1;')
    expect(() => unwrapCapturedReadOnly('select 1;')).toThrow()
    expect(() => unwrapCapturedReadOnly('begin; select 1; commit;')).toThrow()
    expect(() => unwrapCapturedReadOnly('begin read only; select 1; commit; select 2;')).toThrow()
  })

  it('accepts only the restored local database, postgres role, and no other client', () => {
    const target = { database: 'rally_pause_backup_restore_20260926',
      server_version: '17.6', role: 'postgres', other_clients: 0 }
    expect(verifyLocalPauseTarget(target)).toEqual({ result: 'PASS', ...target })
    for (const change of [
      { database: 'postgres' }, { server_version: '15.0' },
      { role: 'authenticated' }, { other_clients: 1 },
    ]) expect(() => verifyLocalPauseTarget({ ...target, ...change })).toThrow()
  })

  it('requires exact state after rollback, except at most one ledger stat insertion', () => {
    const before = { fingerprint: [{ marker: 'a' }], inventory: [{ name: 'bookings' }],
      catalog: [{ object: 'court' }], grants: [{ role: 'authenticated' }],
      sequences: [{ last_value: 3 }], activity: [{ other_active_clients: 0, writes: [
        { schema: 'public', table: 'bookings', inserted: 0, updated: 0, deleted: 0 },
        { schema: 'supabase_migrations', table: 'schema_migrations', inserted: 13, updated: 0, deleted: 0 },
      ] }] }
    const after = structuredClone(before)
    after.activity[0].writes[1].inserted = 14
    expect(verifyRolledBackPause(before, after)).toEqual({
      result: 'PASS', ledgerCounterInserts: 1, persistentDataChanged: false,
    })
    after.inventory[0].name = 'changed'
    expect(() => verifyRolledBackPause(before, after)).toThrow()
  })

  it('accepts a local-container password without leaking it in errors', () => {
    expect(validateLocalContainerPassword('local-example-secret')).toBe('local-example-secret')
    for (const value of ['', 'secret\nextra', undefined]) {
      expect(() => validateLocalContainerPassword(value)).toThrow()
    }
    try { validateLocalContainerPassword('secret\nextra') } catch (error) {
      expect(String(error)).not.toContain('secret')
    }
  })

  it('normalizes only safe bigint inventory counts from node-postgres', () => {
    expect(normalizeLocalInventory([{ schema_name: 'public', table_name: 'bookings',
      row_count: '4', content_md5: 'digest' }])).toEqual([{ schema_name: 'public',
      table_name: 'bookings', row_count: 4, content_md5: 'digest' }])
    for (const value of ['9007199254740993', '-1', 'not-a-count']) {
      expect(() => normalizeLocalInventory([{ row_count: value }])).toThrow()
    }
  })

  it('normalizes the active-client bigint without altering write counters', () => {
    const writes = [{ schema: 'public', table: 'bookings', inserted: '4' }]
    expect(normalizeLocalActivity([{ other_active_clients: '0', writes }])).toEqual([
      { other_active_clients: 0, writes },
    ])
    for (const value of ['-1', '9007199254740993', 'not-a-count']) {
      expect(() => normalizeLocalActivity([{ other_active_clients: value, writes }])).toThrow()
    }
  })
})
