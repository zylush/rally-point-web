import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationDir = resolve(process.cwd(), 'supabase/migrations')
const reservationTables = ['bookings', 'court_sessions', 'open_plays', 'open_play_signups', 'court_allocations', 'courts']
const reservationFunctions = [
  'create_unpaid_desk_booking(uuid, uuid, uuid, uuid, date, integer, integer)',
  'create_desk_rental(uuid, uuid, uuid, uuid, text, integer)',
  'add_member_to_session(uuid, uuid)',
  'extend_desk_session(uuid, integer)',
  'end_desk_session(uuid)',
  'create_open_play_session(uuid, uuid, uuid, text, timestamptz, timestamptz, integer, numeric, public.skill_level, text)',
  'join_open_play_session(uuid, uuid)',
  'leave_open_play_session(uuid, uuid)',
  'cancel_booking_reservation(uuid)',
]

function pauseMigration() {
  const names = readdirSync(migrationDir).filter((name) => /^\d{14}_reservation_write_pause\.sql$/.test(name))
  expect(names).toHaveLength(1)
  return readFileSync(resolve(migrationDir, names[0]), 'utf8').toLowerCase()
}

describe('temporary reservation-write pause migration', () => {
  it('denies direct reservation DML without removing read grants', () => {
    const sql = pauseMigration()
    for (const table of reservationTables) {
      expect(sql).toContain(`revoke insert, update, delete, truncate, references, trigger, maintain on table public.${table} from public, anon, authenticated, service_role;`)
    }
    expect(sql).not.toMatch(/revoke\s+select\s+on\s+table\s+public\./)
    expect(sql).not.toMatch(/grant\s+(?:insert|update|delete)\s+on\s+table\s+public\./)
  })

  it('denies every known reservation-changing RPC, including release and extension', () => {
    const sql = pauseMigration()
    for (const signature of reservationFunctions) {
      expect(sql).toContain(`revoke execute on function public.${signature} from public, anon, authenticated, service_role;`)
    }
    expect(sql).not.toMatch(/grant\s+execute\s+on\s+function\s+public\./)
  })

  it('fails closed on missing objects and checks effective privileges after revocation', () => {
    const sql = pauseMigration()
    expect(sql).toContain('to_regprocedure')
    expect(sql).toContain('has_table_privilege')
    expect(sql).toContain("'truncate, references, trigger, maintain'")
    expect(sql).toContain('has_any_column_privilege')
    expect(sql).toContain('has_function_privilege')
    expect(sql).toContain("array['public', 'anon', 'authenticated', 'service_role']")
    expect(sql).not.toContain('court_allocations_no_overlap')
  })
})
