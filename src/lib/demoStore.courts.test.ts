import { beforeEach, describe, expect, it } from 'vitest'
import { demoStore } from './demoStore'
import { setActiveClubId } from './clubContext'
import { DEMO_DAVAO_CLUB_ID, DEMO_DAVAO_VENUE_ID, DEMO_VENUE_ID } from './tenant'

const futureYmd = () => {
  const date = new Date()
  date.setDate(date.getDate() + 3)
  return date.toISOString().slice(0, 10)
}

describe('demo court management (mirrors admin_upsert_court)', () => {
  beforeEach(() => {
    localStorage.clear()
    setActiveClubId(null)
    demoStore.reset()
  })

  it('adds a trimmed, in-service court to a venue and lists it for booking', () => {
    const court = demoStore.upsertCourt({ venue_id: DEMO_VENUE_ID, name: '  Court E ', hourly_rate: 550.5, in_service: true })

    expect(court).toMatchObject({ name: 'Court E', status: 'available', hourly_rate: 550.5, venue_id: DEMO_VENUE_ID })
    const listed = demoStore.availability(futureYmd(), DEMO_VENUE_ID).find((row) => row.court.id === court.id)
    expect(listed?.slots.some((slot) => slot.available)).toBe(true)
  })

  it('accepts two-decimal rates that are inexact in floating point', () => {
    expect(demoStore.upsertCourt({ venue_id: DEMO_VENUE_ID, name: 'Court F', hourly_rate: 500.1, in_service: true }).hourly_rate)
      .toBe(500.1)
  })

  it('refuses blank names, bad rates, and duplicate names in the same venue', () => {
    const base = { venue_id: DEMO_VENUE_ID, hourly_rate: 500, in_service: true }
    expect(() => demoStore.upsertCourt({ ...base, name: '   ' })).toThrow('Court name must be 1 to 40 characters')
    expect(() => demoStore.upsertCourt({ ...base, name: 'Court G', hourly_rate: -1 })).toThrow('Hourly rate must be between 0 and 100,000 pesos')
    expect(() => demoStore.upsertCourt({ ...base, name: 'Court G', hourly_rate: 500.125 })).toThrow('Hourly rate must be between 0 and 100,000 pesos')
    expect(() => demoStore.upsertCourt({ ...base, name: 'court a' })).toThrow('This venue already has a court with that name')
  })

  it('takes a court out of service so it cannot be booked, then puts it back', () => {
    const courtB = demoStore.courts(DEMO_VENUE_ID).find((court) => court.name === 'Court B')
    if (!courtB) throw new Error('Expected seeded Court B')

    const out = demoStore.upsertCourt({ id: courtB.id, venue_id: DEMO_VENUE_ID, name: 'Court B', hourly_rate: 600, in_service: false })
    expect(out).toMatchObject({ status: 'maintenance', hourly_rate: 600 })
    const row = demoStore.availability(futureYmd(), DEMO_VENUE_ID).find((item) => item.court.id === courtB.id)
    expect(row?.slots.every((slot) => !slot.available)).toBe(true)

    expect(demoStore.upsertCourt({ id: courtB.id, venue_id: DEMO_VENUE_ID, name: 'Court B', hourly_rate: 600, in_service: true }).status)
      .toBe('available')
  })

  it('keeps a court in use in service, and never clears "occupied" when editing it', () => {
    const courtA = demoStore.courts(DEMO_VENUE_ID).find((court) => court.name === 'Court A')
    if (!courtA) throw new Error('Expected seeded Court A')
    expect(courtA.status).toBe('occupied')

    expect(() => demoStore.upsertCourt({ id: courtA.id, venue_id: DEMO_VENUE_ID, name: 'Court A', hourly_rate: 500, in_service: false }))
      .toThrow('This court is in use. Take it out of service after the session ends.')
    expect(demoStore.upsertCourt({ id: courtA.id, venue_id: DEMO_VENUE_ID, name: 'Court A1', hourly_rate: 500, in_service: true }).status)
      .toBe('occupied')
  })

  it('keeps each club to its own venues and courts, and courts to their venue', () => {
    expect(() => demoStore.upsertCourt({ venue_id: DEMO_DAVAO_VENUE_ID, name: 'Sneaky', hourly_rate: 500, in_service: true }))
      .toThrow('venue not found')
    const gensanCourt = demoStore.courts(DEMO_VENUE_ID)[0]

    setActiveClubId(DEMO_DAVAO_CLUB_ID)
    expect(() => demoStore.upsertCourt({ id: gensanCourt.id, venue_id: DEMO_VENUE_ID, name: 'Hijack', hourly_rate: 1, in_service: true }))
      .toThrow('court not found')
    const davaoCourt = demoStore.upsertCourt({ venue_id: DEMO_DAVAO_VENUE_ID, name: 'Davao Court 3', hourly_rate: 450, in_service: true })
    expect(davaoCourt.club_id).toBe(DEMO_DAVAO_CLUB_ID)
    expect(() => demoStore.upsertCourt({ id: davaoCourt.id, venue_id: DEMO_VENUE_ID, name: 'Davao Court 3', hourly_rate: 450, in_service: true }))
      .toThrow('A court cannot move to another venue')
  })
})
