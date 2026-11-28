import { beforeEach, describe, expect, it } from 'vitest'
import { demoStore, type DemoDB } from '../demoStore'
import { normalizeStored } from './persistence'

describe('demo persistence normalization', () => {
  beforeEach(() => {
    localStorage.clear()
    demoStore.reset()
  })

  it('repairs legacy fields without mutating the parsed input', () => {
    const stored = {
      ...demoStore.get(),
      bookings: undefined,
      openPlays: undefined,
      openPlaySignups: undefined,
      reminders: undefined,
      inquiries: undefined,
      members: demoStore.get().members.map((member) => ({ ...member })),
      sessionUserId: 'user_member',
      passwords: { member: 'legacy-secret' },
    } as unknown as DemoDB & { passwords?: unknown }
    stored.members[0].qr_token = null

    const normalized = normalizeStored(stored, () => false)

    expect(normalized.repaired).toBe(true)
    expect(normalized.db.bookings).toEqual([])
    expect(normalized.db.openPlays).toEqual([])
    expect(normalized.db.openPlaySignups).toEqual([])
    expect(normalized.db.reminders).toEqual([])
    expect(normalized.db.inquiries).toEqual([])
    expect(normalized.db.members[0].qr_token).toBe('QR_RP1001')
    expect(normalized.db.sessionUserId).toBeNull()
    expect(stored.members[0].qr_token).toBeNull()
    expect(stored.passwords).toEqual({ member: 'legacy-secret' })
    expect(JSON.stringify(normalized.db)).not.toContain('legacy-secret')
  })

  it('round-trips demo state and clears all versioned keys on reset', () => {
    const db = demoStore.get()
    db.walkins.push({
      id: 'roundtrip',
      full_name: 'Stored Guest',
      phone: null,
      purpose: 'Day pass',
      amount: 350,
      created_at: new Date().toISOString(),
      created_by: 'user_staff',
    })
    demoStore.set(db)
    expect(demoStore.get().walkins.at(-1)?.id).toBe('roundtrip')
    expect(JSON.parse(localStorage.getItem('brinely_demo_v4')!)).not.toHaveProperty('passwords')

    localStorage.setItem('rally_point_demo_v1', 'legacy')
    localStorage.setItem('rally_point_demo_v2', 'legacy')
    localStorage.setItem('rally_point_demo_v3', 'legacy')
    localStorage.setItem('rally_point_demo_v4', 'legacy')
    demoStore.reset()
    expect(demoStore.get().walkins).toEqual([])
    expect(localStorage.getItem('rally_point_demo_v1')).toBeNull()
    expect(localStorage.getItem('rally_point_demo_v2')).toBeNull()
    expect(localStorage.getItem('rally_point_demo_v3')).toBeNull()
    expect(localStorage.getItem('rally_point_demo_v4')).toBeNull()
  })

  it('drops branch-era data and turns legacy roles into trusted club and platform roles', () => {
    const stored = {
      ...demoStore.get(),
      clubs: [{ id: 'club_rally_point', slug: 'rally-point-gensan', name: 'Rally Point Gensan', default_timezone: 'Asia/Manila', is_active: true }],
      clubAccounts: undefined,
      clubRoles: undefined,
      platformRoles: undefined,
      auditLog: undefined,
      branches: [{ id: 'branch_gensan', name: 'Rally Point Gensan' }],
      commissions: [{ id: 'old', branch_id: 'branch_gensan', status: 'settled' }],
    } as unknown as DemoDB & { branches?: unknown }

    const normalized = normalizeStored(stored, () => true)

    expect(normalized.repaired).toBe(true)
    expect(normalized.db).not.toHaveProperty('branches')
    expect(normalized.db.commissions).toEqual([])
    expect(normalized.db.auditLog).toEqual([])
    expect(normalized.db.clubAccounts).toEqual([
      expect.objectContaining({ club_id: 'club_rally_point', status: 'active', commission_rate: 5 }),
    ])
    expect(normalized.db.clubRoles).toEqual(expect.arrayContaining([
      { club_id: 'club_rally_point', user_id: 'user_admin', role: 'admin', is_active: true },
      { club_id: 'club_rally_point', user_id: 'user_staff', role: 'staff', is_active: true },
    ]))
    expect(normalized.db.platformRoles).toEqual([{ user_id: 'user_superadmin', role: 'superadmin' }])
  })

  it('leaves freshly seeded data alone once its defaults are filled in', () => {
    const first = normalizeStored(demoStore.get(), () => true)
    const second = normalizeStored(first.db, () => true)
    expect(second.repaired).toBe(false)
  })

  it('preserves inquiries created before club ownership was added', () => {
    const stored = demoStore.get()
    stored.inquiries.push({
      id: 'legacy-inquiry',
      user_id: 'user_staff',
      category: 'other',
      subject: 'Old question',
      message: 'Please help.',
      status: 'open',
      created_at: new Date().toISOString(),
    } as DemoDB['inquiries'][number])
    delete (stored.inquiries[0] as Partial<DemoDB['inquiries'][number]>).club_id

    const normalized = normalizeStored(stored, () => true)
    expect(normalized.repaired).toBe(true)
    expect(normalized.db.inquiries[0].club_id).toBe('club_rally_point')
    expect(stored.inquiries[0].club_id).toBeUndefined()
  })
})
