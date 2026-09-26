import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationsDirectory = join(process.cwd(), 'supabase', 'migrations')
const migrationFiles = readdirSync(migrationsDirectory).sort()

function readMigration(suffix: string) {
  const matches = migrationFiles.filter((file) => file.endsWith(suffix))
  expect(matches, `expected exactly one *${suffix} migration`).toHaveLength(1)
  return readFileSync(join(migrationsDirectory, matches[0]), 'utf8').toLowerCase()
}

describe('tenant-ready migration phase contract', () => {
  it('pins a canonical search path for cross-environment schema fingerprints', () => {
    const sql = readFileSync(join(process.cwd(), 'supabase', 'verification', 'schema_fingerprint.sql'), 'utf8').toLowerCase()
    expect(sql).toMatch(/set search_path = public, extensions;/)
    expect(sql).not.toMatch(/set search_path = [^;\n]*auth/)
  })

  it('keeps the expand phase additive and compatible with the legacy app', () => {
    const sql = readMigration('_tenant_ready.sql')

    expect(sql).toContain('create table if not exists public.clubs')
    expect(sql).toContain('create table if not exists public.court_allocations')
    expect(sql).toContain('create or replace function private.current_club_id()')
    expect(sql).toContain('create or replace function public.create_unpaid_desk_booking')
    expect(sql).toContain('create view public.public_schedule')

    expect(sql).not.toMatch(/update public\.members\s+set club_id/)
    expect(sql).not.toMatch(/alter column (club_id|venue_id) set not null/)
    expect(sql).not.toContain('court_allocations_no_overlap')
    expect(sql).not.toContain('revoke all on all tables in schema public')
    expect(sql).not.toMatch(/drop policy .* on public\./)
  })

  it('keeps ownership repair and audit evidence in the backfill phase', () => {
    const sql = readMigration('_tenant_backfill.sql')

    expect(sql).toMatch(/raise notice 'tenant backfill before counts:/)
    expect(sql).toMatch(/raise notice 'tenant backfill after counts:/)
    expect(sql).toMatch(/update public\.members\s+set club_id/)
    expect(sql).toContain('insert into public.club_staff_roles')
    expect(sql).toContain('insert into public.staff_venue_grants')
    expect(sql).toContain('insert into public.court_allocations')
    expect(sql).toContain('tenant ownership backfill left orphaned rows')
    expect(sql).toContain('existing court sessions overlap')

    expect(sql).not.toMatch(/alter column (club_id|venue_id) set not null/)
    expect(sql).not.toContain('court_allocations_no_overlap')
    expect(sql).not.toContain('revoke all on all tables in schema public')
    expect(sql).not.toMatch(/drop policy .* on public\./)
  })

  it('keeps constraints and least-privilege cutover in the enforcement phase', () => {
    const sql = readMigration('_tenant_enforcement.sql')

    expect(sql).toMatch(/alter column club_id set not null/)
    expect(sql).toContain('members_club_user_key')
    expect(sql).toContain('bookings_court_venue_fk')
    expect(sql).toContain('court_allocations_no_overlap')
    expect(sql).toContain('revoke all on all tables in schema public')
    expect(sql).toContain('create policy members_self_select')

    expect(sql).not.toMatch(/update public\.members\s+set club_id/)
    expect(sql).not.toContain("verification_status = 'unverified'")
    expect(sql).not.toContain('insert into public.club_staff_roles')
  })
})
