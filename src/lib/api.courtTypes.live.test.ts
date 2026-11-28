import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { setActiveClubId } from './clubContext'
import type { Court } from '../types'

const live = vi.hoisted(() => {
  const clubId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const venueId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac'
  const courtId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad'
  const rpcResults = new Map<string, { data: unknown; error: unknown } | (() => Promise<never>)>()
  const rpc = vi.fn(async (name: string, _args?: Record<string, unknown>) => {
    const result = rpcResults.get(name)
    if (typeof result === 'function') return result()
    return result ?? { data: null, error: null }
  })
  // Any table read answers with no rows (the public schedule is all the availability reads).
  const from = vi.fn(() => {
    const query: Record<string, unknown> = {}
    for (const name of ['select', 'eq', 'lt', 'gt', 'setHeader', 'order']) query[name] = () => query
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve)
    return query
  })
  return { clubId, venueId, courtId, rpcResults, rpc, from }
})

vi.mock('./supabase', () => ({
  isDemoMode: false,
  supabase: {
    rpc: live.rpc,
    from: live.from,
    storage: { from: () => ({ getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.example/court-photos/${path}` } }) }) },
  },
}))

const saved: Court = {
  id: live.courtId, club_id: live.clubId, venue_id: live.venueId, name: 'Court A', status: 'available', hourly_rate: 500, member_rate: null, court_type: null,
}
const input = { id: live.courtId, venue_id: live.venueId, name: 'Court A', hourly_rate: 500, member_rate: null, in_service: true }
const rpcNames = () => live.rpc.mock.calls.map(([name]) => name)

beforeEach(() => {
  vi.clearAllMocks()
  live.rpcResults.clear()
  setActiveClubId(live.clubId)
})

describe('court type on save (live)', () => {
  it('saves the court only, when the form sends no type', async () => {
    live.rpcResults.set('admin_upsert_court', { data: saved, error: null })
    expect(await api.upsertCourt(input)).toEqual(saved)
    expect(rpcNames()).toEqual(['admin_upsert_court'])
    // admin_upsert_court keeps its six parameters; the type is never one of them.
    expect(Object.keys(live.rpc.mock.calls[0][1] ?? {})).toEqual([
      'p_court_id', 'p_venue_id', 'p_name', 'p_hourly_rate', 'p_member_rate', 'p_in_service',
    ])
  })

  it('does not set the type again when it has not changed', async () => {
    live.rpcResults.set('admin_upsert_court', { data: { ...saved, court_type: 'indoor' }, error: null })
    await api.upsertCourt({ ...input, court_type: 'indoor' })
    live.rpcResults.set('admin_upsert_court', { data: saved, error: null })
    await api.upsertCourt({ ...input, court_type: null })
    expect(rpcNames()).toEqual(['admin_upsert_court', 'admin_upsert_court'])
  })

  it('sets a changed type after saving the court, and returns the updated court', async () => {
    live.rpcResults.set('admin_upsert_court', { data: saved, error: null })
    live.rpcResults.set('admin_set_court_type', { data: { ...saved, court_type: 'outdoor' }, error: null })

    const court = await api.upsertCourt({ ...input, id: undefined, court_type: 'outdoor' })

    expect(rpcNames()).toEqual(['admin_upsert_court', 'admin_set_court_type'])
    expect(live.rpc).toHaveBeenLastCalledWith('admin_set_court_type', { p_court_id: live.courtId, p_court_type: 'outdoor' })
    expect(court.court_type).toBe('outdoor')
  })

  it('clears the type with null', async () => {
    live.rpcResults.set('admin_upsert_court', { data: { ...saved, court_type: 'indoor' }, error: null })
    live.rpcResults.set('admin_set_court_type', { data: saved, error: null })

    expect((await api.upsertCourt({ ...input, court_type: null })).court_type).toBeNull()
    expect(live.rpc).toHaveBeenLastCalledWith('admin_set_court_type', { p_court_id: live.courtId, p_court_type: null })
  })

  it('treats a court row without the column as not set', async () => {
    const { court_type: _dropped, ...withoutType } = saved
    live.rpcResults.set('admin_upsert_court', { data: withoutType, error: null })
    await api.upsertCourt({ ...input, court_type: null })
    expect(rpcNames()).toEqual(['admin_upsert_court'])
  })

  it('reports a refused type change', async () => {
    live.rpcResults.set('admin_upsert_court', { data: saved, error: null })
    live.rpcResults.set('admin_set_court_type', { data: null, error: Object.assign(new Error('Choose indoor or outdoor'), { code: '22023' }) })
    await expect(api.upsertCourt({ ...input, court_type: 'indoor' })).rejects.toThrow('Choose indoor or outdoor')
  })

  it('does not set a type when saving the court fails', async () => {
    live.rpcResults.set('admin_upsert_court', { data: null, error: new Error('This venue already has a court with that name') })
    await expect(api.upsertCourt({ ...input, court_type: 'indoor' })).rejects.toThrow('This venue already has a court with that name')
    expect(rpcNames()).toEqual(['admin_upsert_court'])
  })
})

describe('indoor and outdoor counts on Find a court (live)', () => {
  const listing = (slug: string) => ({
    slug, name: slug, city: null, address: null, cities: [], venue_count: '1', court_count: '3', min_rate: '500', min_member_rate: null,
  })

  it('adds each club its indoor and outdoor counts as numbers; a club missing from them counts zero', async () => {
    live.rpcResults.set('list_public_clubs', { data: [listing('rally-point-gensan'), listing('pickle-court')], error: null })
    live.rpcResults.set('list_public_club_court_types', {
      data: [{ slug: 'rally-point-gensan', indoor_courts: '2', outdoor_courts: 1 }],
      error: null,
    })

    const [gensan, pickle] = await api.listPublicClubs()

    expect(gensan).toMatchObject({ slug: 'rally-point-gensan', court_count: 3, indoor_courts: 2, outdoor_courts: 1 })
    expect(pickle).toMatchObject({ slug: 'pickle-court', indoor_courts: 0, outdoor_courts: 0 })
    expect(rpcNames()).toEqual(expect.arrayContaining(['list_public_clubs', 'list_public_club_covers', 'list_public_club_court_types']))
  })

  it('still lists clubs, with zero counts, when the counts answer with an error', async () => {
    live.rpcResults.set('list_public_clubs', { data: [listing('rally-point-gensan')], error: null })
    live.rpcResults.set('list_public_club_court_types', { data: null, error: Object.assign(new Error('function not found'), { code: 'PGRST202' }) })

    const [club] = await api.listPublicClubs()
    expect(club).toMatchObject({ slug: 'rally-point-gensan', court_count: 3, indoor_courts: 0, outdoor_courts: 0 })
  })

  it('still lists clubs, with zero counts, when the counts request fails outright', async () => {
    live.rpcResults.set('list_public_clubs', { data: [listing('rally-point-gensan')], error: null })
    live.rpcResults.set('list_public_club_court_types', () => Promise.reject(new Error('network down')))

    const [club] = await api.listPublicClubs()
    expect(club).toMatchObject({ indoor_courts: 0, outdoor_courts: 0 })
  })

  it('still fails when the club list itself cannot load', async () => {
    live.rpcResults.set('list_public_clubs', { data: null, error: new Error('club list down') })
    await expect(api.listPublicClubs()).rejects.toThrow('club list down')
  })
})

describe('court type on public club pages (live)', () => {
  const detail = {
    slug: 'rally-point-gensan', name: 'Rally Point Gensan', city: null, address: null,
    venues: [{
      id: live.venueId, name: 'Main', open_hour: 0, close_hour: 24, address: null, city: null, latitude: null, longitude: null,
      courts: [
        { id: live.courtId, name: 'Court A', hourly_rate: '500', member_rate: null, in_service: true, court_type: 'indoor' },
        { id: 'court-b', name: 'Court B', hourly_rate: '500', member_rate: null, in_service: true, court_type: null },
        // A database without the court type sends no field at all.
        { id: 'court-c', name: 'Court C', hourly_rate: '500', member_rate: null, in_service: false },
      ],
    }],
  }

  it('keeps each court type on the club page, and reads a missing one as not set', async () => {
    live.rpcResults.set('get_public_club_detail', { data: detail, error: null })
    const courts = (await api.publicClubDetail('rally-point-gensan'))!.venues[0].courts
    expect(courts.map((court) => court.court_type)).toEqual(['indoor', null, null])
  })

  it('keeps the court type in visitor availability', async () => {
    live.rpcResults.set('get_public_club', { data: [{ id: live.clubId, slug: 'rally-point-gensan', name: 'Rally Point Gensan' }], error: null })
    live.rpcResults.set('get_public_club_detail', { data: detail, error: null })

    const rows = await api.publicClubAvailability('rally-point-gensan', '2099-09-20')
    expect(rows.map((row) => [row.court.name, row.court.court_type])).toEqual([
      ['Court A', 'indoor'], ['Court B', null], ['Court C', null],
    ])
  })
})
