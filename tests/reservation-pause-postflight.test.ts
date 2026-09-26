// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { verifyReservationPausePostflight } from '../scripts/reservation-pause-postflight-checks.mjs'

const pause = '20260925174111'
const applied = ['001', '002', '003', '004', '20260803125450', '20260805094557',
  '20260921090000', '20260921110828', '20260922011918', '20260922163027',
  '20260922163830', '20260922164128', '20260923053440']
const tables = ['bookings', 'court_sessions', 'open_plays', 'open_play_signups',
  'court_allocations', 'courts']
const functions = [
  'create_unpaid_desk_booking(uuid, uuid, uuid, uuid, date, integer, integer)',
  'create_desk_rental(uuid, uuid, uuid, uuid, text, integer)',
  'add_member_to_session(uuid, uuid)', 'extend_desk_session(uuid, integer)',
  'end_desk_session(uuid)',
  'create_open_play_session(uuid, uuid, uuid, text, timestamptz, timestamptz, integer, numeric, public.skill_level, text)',
  'join_open_play_session(uuid, uuid)', 'leave_open_play_session(uuid, uuid)',
  'cancel_booking_reservation(uuid)',
]
const roles = ['public', 'anon', 'authenticated', 'service_role']

function fixture() {
  const beforeInventory = [
    { schema_name: 'public', table_name: 'bookings', row_count: 2, content_md5: 'a' },
    { schema_name: 'auth', table_name: 'users', row_count: 1, content_md5: 'b' },
    { schema_name: 'supabase_migrations', table_name: 'schema_migrations', row_count: 13, content_md5: 'c' },
  ]
  const afterInventory = structuredClone(beforeInventory)
  afterInventory[2] = { ...afterInventory[2], row_count: 14, content_md5: 'new migration digest' }
  const beforeGrants = [{ snapshot: {
    versions: [...applied],
    rls: [{ table: 'bookings', enabled: true }],
    column_acl: [],
    acl: [
      { relname: 'bookings', grantee: 'authenticated', grantor: 'postgres', privilege_type: 'SELECT', is_grantable: false },
      { relname: 'bookings', grantee: 'authenticated', grantor: 'postgres', privilege_type: 'INSERT', is_grantable: false },
      { relname: 'members', grantee: 'authenticated', grantor: 'postgres', privilege_type: 'SELECT', is_grantable: false },
    ],
    effective: [
      { relname: 'bookings', role_name: 'authenticated', privilege: 'SELECT', allowed: true },
      { relname: 'bookings', role_name: 'authenticated', privilege: 'INSERT', allowed: true },
      { relname: 'members', role_name: 'authenticated', privilege: 'SELECT', allowed: true },
      ...tables.filter(table => table !== 'bookings').map(relname => ({
        relname, role_name: 'authenticated', privilege: 'SELECT', allowed: true,
      })),
    ],
  } }]
  const afterGrants = structuredClone(beforeGrants)
  afterGrants[0].snapshot.versions.push(pause)
  afterGrants[0].snapshot.acl = afterGrants[0].snapshot.acl.filter(
    row => !(row.relname === 'bookings' && row.privilege_type === 'INSERT'))
  afterGrants[0].snapshot.effective[1].allowed = false
  const audit = [
    ...roles.flatMap(role_name => tables.map(target => ({ kind: 'table write', role_name, target, violation: false }))),
    ...roles.flatMap(role_name => functions.map(target => ({ kind: 'RPC execute', role_name, target, violation: false }))),
    ...tables.map(target => ({ kind: 'authenticated read', role_name: 'authenticated', target, violation: false })),
  ]
  const beforeCatalog = [{ objects: [
    { kind: 'relation', identity: 'public.bookings', details: {
      owner: 'postgres', rls: true, acl: [
        ['postgres', 'authenticated', 'SELECT', false],
        ['postgres', 'authenticated', 'INSERT', false],
      ],
    } },
    { kind: 'function', identity: 'public.create_unpaid_desk_booking(p_club_id uuid, p_venue_id uuid, p_court_id uuid, p_member_id uuid, p_date date, p_start_hour integer, p_hours integer)', details: {
      owner: 'postgres', definition: 'function body', acl: [
        ['postgres', 'authenticated', 'EXECUTE', false],
        ['postgres', 'postgres', 'EXECUTE', false],
      ],
    } },
    { kind: 'relation', identity: 'public.members', details: {
      owner: 'postgres', rls: true, acl: [['postgres', 'authenticated', 'SELECT', false]],
    } },
  ] }]
  const afterCatalog = structuredClone(beforeCatalog)
  afterCatalog[0].objects[0].details.acl = afterCatalog[0].objects[0].details.acl.filter(row => row[2] !== 'INSERT')
  afterCatalog[0].objects[1].details.acl = afterCatalog[0].objects[1].details.acl.filter(row => row[1] !== 'authenticated')
  return {
    beforeInventory, afterInventory, beforeGrants, afterGrants, audit,
    beforeCatalog, afterCatalog,
    beforeSequences: [{ schema: 'auth', name: 'refresh_tokens_id_seq', last_value: 2 }],
    afterSequences: [{ schema: 'auth', name: 'refresh_tokens_id_seq', last_value: 2 }],
    beforeActivity: [{ other_active_clients: 0, writes: [
      { schema: 'public', table: 'bookings', inserted: 2, updated: 0, deleted: 0 },
      { schema: 'supabase_migrations', table: 'schema_migrations', inserted: 13, updated: 0, deleted: 0 },
    ] }],
    afterActivity: [{ other_active_clients: 0, writes: [
      { schema: 'public', table: 'bookings', inserted: 2, updated: 0, deleted: 0 },
      { schema: 'supabase_migrations', table: 'schema_migrations', inserted: 13, updated: 0, deleted: 0 },
    ] }],
  }
}

describe('reservation-pause staging postflight, pure local checker', () => {
  it('accepts only the expected history and permission delta', () => {
    const proof = fixture()
    expect(verifyReservationPausePostflight(proof)).toEqual({
      result: 'PASS', auditRows: 66, inventoryTables: 3, catalogObjects: 3, appliedVersions: 14,
      unchangedSequences: 1, operationalActivityUnchanged: true, migrationLedgerInserts: 0,
    })
  })

  it('rejects an operational or Auth row change', () => {
    const proof = fixture()
    proof.afterInventory[1].content_md5 = 'unexpected'
    expect(() => verifyReservationPausePostflight(proof)).toThrow()
  })

  it('rejects an unrelated sequence or table privilege change', () => {
    const proof = fixture()
    proof.afterSequences[0].last_value = 3
    expect(() => verifyReservationPausePostflight(proof)).toThrow()
    proof.afterSequences = structuredClone(proof.beforeSequences)
    proof.afterGrants[0].snapshot.effective[2].allowed = false
    expect(() => verifyReservationPausePostflight(proof)).toThrow()
  })

  it('rejects a reopened write, RPC, missing read, duplicate, or incomplete audit', () => {
    for (const index of [0, 24, 60]) {
      const proof = fixture()
      proof.audit[index].violation = true
      expect(() => verifyReservationPausePostflight(proof)).toThrow()
    }
    const duplicate = fixture()
    duplicate.audit[0] = duplicate.audit[1]
    expect(() => verifyReservationPausePostflight(duplicate)).toThrow()
    const missing = fixture()
    missing.audit.pop()
    expect(() => verifyReservationPausePostflight(missing)).toThrow()
  })

  it('rejects migration drift, missing history, changed ACL, or activity', () => {
    const drift = fixture()
    drift.afterGrants[0].snapshot.versions.push('20260921111105')
    expect(() => verifyReservationPausePostflight(drift)).toThrow()
    const missing = fixture()
    missing.afterInventory[2].row_count = 13
    expect(() => verifyReservationPausePostflight(missing)).toThrow()
    const acl = fixture()
    acl.afterGrants[0].snapshot.acl[1].privilege_type = 'UPDATE'
    expect(() => verifyReservationPausePostflight(acl)).toThrow()
    const activity = fixture()
    activity.afterActivity[0].writes[0].updated = 1
    expect(() => verifyReservationPausePostflight(activity)).toThrow()
  })

  it('allows only one migration-ledger insertion counter, never operational writes', () => {
    const proof = fixture()
    proof.afterActivity[0].writes[1].inserted = 14
    expect(verifyReservationPausePostflight(proof).migrationLedgerInserts).toBe(1)
    proof.afterActivity[0].writes[1].inserted = 15
    expect(() => verifyReservationPausePostflight(proof)).toThrow()
    proof.afterActivity[0].writes[1].inserted = 14
    proof.afterActivity[0].writes[1].updated = 1
    expect(() => verifyReservationPausePostflight(proof)).toThrow()
  })

  it('rejects unrelated catalog changes and reopened function execution', () => {
    const unrelated = fixture()
    unrelated.afterCatalog[0].objects[2].details.owner = 'other'
    expect(() => verifyReservationPausePostflight(unrelated)).toThrow()
    const functionGrant = fixture()
    functionGrant.afterCatalog[0].objects[1].details.acl.push(
      ['postgres', 'authenticated', 'EXECUTE', false])
    expect(() => verifyReservationPausePostflight(functionGrant)).toThrow()
  })
})
