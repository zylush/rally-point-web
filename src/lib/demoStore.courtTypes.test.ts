import { beforeEach, describe, expect, it } from 'vitest'
import type { CourtType } from '../types'
import { ymdLocal } from '../types'
import { demoStore, type DemoDB } from './demoStore'
import { setActiveClubId } from './clubContext'
import { normalizeStored } from './demo/persistence'
import { DEMO_VENUE_ID } from './tenant'

describe('demo indoor and outdoor courts (mirrors admin_set_court_type)', () => {
  beforeEach(() => {
    localStorage.clear()
    setActiveClubId(null)
    demoStore.reset()
  })

  it('seeds a mix of indoor, outdoor and not set courts', () => {
    const types = Object.fromEntries(demoStore.get().courts.map((court) => [court.name, court.court_type ?? null]))
    expect(types).toEqual({
      'Court A': 'indoor',
      'Court B': 'indoor',
      'Court C': 'outdoor',
      'Court D': 'outdoor',
      'Davao Court 1': 'indoor',
      'Davao Court 2': null,
    })
  })

  it('adds a court with a type, or not set when none is given', () => {
    expect(demoStore.upsertCourt({ venue_id: DEMO_VENUE_ID, name: 'Court E', hourly_rate: 500, in_service: true, court_type: 'outdoor' }).court_type)
      .toBe('outdoor')
    expect(demoStore.upsertCourt({ venue_id: DEMO_VENUE_ID, name: 'Court F', hourly_rate: 500, in_service: true }).court_type)
      .toBeNull()
  })

  it('changes a type, keeps it when the form sends none, and clears it with null', () => {
    const courtA = demoStore.courts(DEMO_VENUE_ID).find((court) => court.name === 'Court A')!
    const edit = { id: courtA.id, venue_id: DEMO_VENUE_ID, name: 'Court A', hourly_rate: 500, in_service: true }

    expect(demoStore.upsertCourt({ ...edit, court_type: 'outdoor' }).court_type).toBe('outdoor')
    expect(demoStore.upsertCourt(edit).court_type).toBe('outdoor')
    expect(demoStore.upsertCourt({ ...edit, court_type: null }).court_type).toBeNull()
    expect(demoStore.courts(DEMO_VENUE_ID).find((court) => court.id === courtA.id)?.court_type).toBeNull()
  })

  it('refuses any type other than indoor or outdoor, and saves nothing', () => {
    const courtA = demoStore.courts(DEMO_VENUE_ID).find((court) => court.name === 'Court A')!
    expect(() => demoStore.upsertCourt({
      id: courtA.id, venue_id: DEMO_VENUE_ID, name: 'Court A renamed', hourly_rate: 500, in_service: true, court_type: 'covered' as CourtType,
    })).toThrow('Choose indoor or outdoor')
    expect(demoStore.courts(DEMO_VENUE_ID).find((court) => court.id === courtA.id)).toMatchObject({ name: 'Court A', court_type: 'indoor' })
  })

  it('shows the type on public club pages and counts in-service courts by type', () => {
    const gensan = demoStore.publicClubDetail('rally-point-gensan')!
    expect(gensan.venues.flatMap((venue) => venue.courts.map((court) => [court.name, court.court_type])))
      .toEqual([['Court A', 'indoor'], ['Court B', 'indoor'], ['Court C', 'outdoor'], ['Court D', 'outdoor']])

    // An out-of-service court is not counted, as it is not in the court count either.
    const courtD = demoStore.courts().find((court) => court.name === 'Court D')!
    demoStore.upsertCourt({ id: courtD.id, venue_id: courtD.venue_id!, name: 'Court D', hourly_rate: 650, member_rate: 550, in_service: false })

    const clubs = Object.fromEntries(demoStore.publicClubs().map((club) => [club.slug, club]))
    expect(clubs['rally-point-gensan']).toMatchObject({ court_count: 3, indoor_courts: 2, outdoor_courts: 1 })
    expect(clubs['rally-point-davao']).toMatchObject({ court_count: 2, indoor_courts: 1, outdoor_courts: 0 })
  })

  it('keeps the type in availability', () => {
    const ymd = ymdLocal(new Date(Date.now() + 3 * 86400000))
    const rows = demoStore.availability(ymd, DEMO_VENUE_ID)
    expect(rows.map((row) => row.court.court_type)).toEqual(['indoor', 'indoor'])
  })
})

describe('demo state saved before courts had a type', () => {
  beforeEach(() => {
    localStorage.clear()
    setActiveClubId(null)
    demoStore.reset()
  })

  it('reads courts with no type as not set, and clears an unknown one', () => {
    const current = demoStore.get()
    const stored = {
      ...current,
      courts: current.courts.map(({ court_type: _type, ...court }, index) =>
        index === 0 ? { ...court, court_type: 'covered' } : court),
    } as unknown as DemoDB

    const { db, repaired } = normalizeStored(stored, () => false)

    expect(repaired).toBe(true)
    expect(db.courts[0].court_type).toBeNull()
    expect(db.courts.slice(1).every((court) => court.court_type === undefined)).toBe(true)
  })

  it('loads old saved state without crashing, showing no labels or counts', () => {
    const current = demoStore.get()
    demoStore.set({ ...current, courts: current.courts.map(({ court_type: _type, ...court }) => court) })

    expect(demoStore.publicClubDetail('rally-point-gensan')!.venues[0].courts.every((court) => court.court_type === null)).toBe(true)
    expect(demoStore.publicClubs().every((club) => club.indoor_courts === 0 && club.outdoor_courts === 0)).toBe(true)
  })
})
