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
    expect(JSON.parse(localStorage.getItem('rally_point_demo_v3')!)).not.toHaveProperty('passwords')

    localStorage.setItem('rally_point_demo_v1', 'legacy')
    localStorage.setItem('rally_point_demo_v2', 'legacy')
    demoStore.reset()
    expect(demoStore.get().walkins).toEqual([])
    expect(localStorage.getItem('rally_point_demo_v1')).toBeNull()
    expect(localStorage.getItem('rally_point_demo_v2')).toBeNull()
  })
})
