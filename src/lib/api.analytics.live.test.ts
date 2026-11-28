import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addDays, phDay } from './analytics'
import { api } from './api'
import { setActiveClubId } from './clubContext'

const live = vi.hoisted(() => {
  const clubId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const venueId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab'
  type Call = { table: string; op: string; args: unknown[] }
  type Result = { data: unknown; error: unknown }
  const calls: Call[] = []
  const tables = new Map<string, unknown[] | Error>()
  const rpcs = new Map<string, Result>()

  const from = vi.fn((table: string) => {
    let range: [number, number] | null = null
    const query: Record<string, unknown> = {}
    for (const name of ['select', 'eq', 'gte', 'lt', 'order', 'range']) {
      query[name] = (...args: unknown[]) => {
        calls.push({ table, op: name, args })
        if (name === 'range') range = [args[0] as number, args[1] as number]
        return query
      }
    }
    query.then = (resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) => {
      const rows = tables.get(table) ?? []
      if (rows instanceof Error) return Promise.resolve({ data: null, error: rows }).then(resolve, reject)
      const data = range ? rows.slice(range[0], range[1] + 1) : rows
      return Promise.resolve({ data, error: null }).then(resolve, reject)
    }
    return query
  })

  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    calls.push({ table: 'rpc', op: name, args: [args] })
    return rpcs.get(name) ?? { data: null, error: null }
  })

  return {
    clubId, venueId, calls, tables, rpcs, from, rpc,
    reset() {
      calls.length = 0
      tables.clear()
      rpcs.clear()
    },
  }
})

vi.mock('./supabase', () => ({ isDemoMode: false, supabase: { from: live.from, rpc: live.rpc } }))

/** An instant at a Philippine wall-clock hour, some days before today. */
function phAt(daysAgo: number, hour: number) {
  const [y, m, d] = addDays(phDay(new Date()), -daysAgo).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, hour - 8)).toISOString()
}

const court = { id: 'court-live', club_id: live.clubId, venue_id: live.venueId, name: 'Live Court', status: 'available', hourly_rate: 600 }

function seedTables() {
  live.tables.set('transactions', [
    { id: 'tx-1', club_id: live.clubId, venue_id: live.venueId, member_id: null, amount: '600.00', type: 'court_rental', description: 'Live Court', verification_status: 'unverified', created_at: phAt(1, 18) },
    { id: 'tx-2', club_id: live.clubId, venue_id: null, member_id: 'member-live', amount: '2000.00', type: 'membership', description: 'Standard', verification_status: 'unverified', created_at: phAt(35, 10) },
  ])
  live.tables.set('bookings', [
    { id: 'bk-1', club_id: live.clubId, venue_id: live.venueId, court_id: court.id, member_id: 'member-live', start_at: phAt(1, 18), end_at: phAt(1, 20), hours: '2', amount: '1200.00', status: 'completed', payment_reference: 'GC123', created_at: phAt(2, 9), court },
  ])
  live.tables.set('member_roster', [
    { id: 'member-live', club_id: live.clubId, member_code: 'BR-1', full_name: 'Live Member', membership_type: 'standard', status: 'active', join_date: addDays(phDay(new Date()), -3), expiry_date: '2099-01-01', created_at: phAt(3, 9) },
  ])
  live.tables.set('courts', [court])
  live.tables.set('venues', [{ id: live.venueId, club_id: live.clubId, slug: 'main', name: 'Main', timezone: 'Asia/Manila', open_hour: 6, close_hour: 22, is_active: true }])
  live.tables.set('platform_commissions', [{ commission_amount: '30.00', gross_amount: '600.00', created_at: phAt(1, 18) }])
}

const serverClub = {
  period: { from: '2026-10-26', to: '2026-11-24', days: '30' },
  previous_period: { from: '2026-09-26', to: '2026-10-25', days: 30 },
  current: { charges: '1500.50', bookings: '3', hours: '4', open_hours: '480', new_members: '1', new_players: 0, cancellations: '1', avg_booking: '500.17', commission: '25.00' },
  previous: { charges: '900', bookings: 2, hours: 2, open_hours: 480, new_members: 0, new_players: 0, cancellations: 0, avg_booking: 450, commission: '15' },
  by_day: [{ day: '2026-11-24', charges: '1500.50', bookings: '3', hours: '4', new_members: '1', cancellations: '1', commission: '25' }],
  charges_by_type: [{ type: 'booking', amount: '1500.50' }],
  charges_by_venue: [{ venue_id: live.venueId, name: 'Main', amount: '1500.50' }],
  bookings_by_status: [{ status: 'completed', count: '3' }],
  courts: [{ court_id: court.id, name: 'Live Court', venue_name: 'Main', hours: '4', open_hours: '480' }],
  busy_hours: [[0, '2']],
  payment_split: { online: '2', desk: '1' },
  members: { active_members: '40', ending_soon: '3', players: '5' },
  coaching: { requests: '4', previous_requests: '2', accepted: '3' },
}

beforeEach(() => {
  vi.clearAllMocks()
  live.reset()
  setActiveClubId(live.clubId)
})

describe('club analytics (live)', () => {
  it('uses the server summary for the active club and turns numerics into numbers', async () => {
    live.rpcs.set('admin_club_analytics', { data: serverClub, error: null })
    const analytics = await api.clubAnalytics(30)
    expect(live.rpc).toHaveBeenCalledWith('admin_club_analytics', { p_club_id: live.clubId, p_days: 30 })
    expect(live.from).not.toHaveBeenCalled()
    expect(analytics.source).toBe('server')
    expect(analytics.period.days).toBe(30)
    expect(analytics.current).toMatchObject({ charges: 1500.5, bookings: 3, hours: 4, open_hours: 480, avg_booking: 500.17, commission: 25 })
    expect(analytics.by_day[0]).toEqual({ day: '2026-11-24', charges: 1500.5, bookings: 3, hours: 4, new_members: 1, cancellations: 1, commission: 25 })
    expect(analytics.busy_hours).toHaveLength(7)
    expect(analytics.busy_hours.every((row) => row.length === 24)).toBe(true)
    expect(analytics.busy_hours[0][1]).toBe(2)
    expect(analytics.payment_split).toEqual({ online: 2, desk: 1 })
    expect(analytics.members).toEqual({ active_members: 40, ending_soon: 3, players: 5 })
    expect(analytics.coaching).toEqual({ requests: 4, previous_requests: 2, accepted: 3 })
  })

  it.each([
    ['a missing function', { code: 'PGRST202', message: 'Could not find the function public.admin_club_analytics' }],
    ['a function not granted', { code: '42501', message: 'permission denied for function admin_club_analytics' }],
  ])('adds the figures up in the browser after %s', async (_label, error) => {
    live.rpcs.set('admin_club_analytics', { data: null, error })
    seedTables()
    const analytics = await api.clubAnalytics(30)
    expect(analytics.source).toBe('browser')
    expect(analytics.by_day).toHaveLength(30)
    // Only the charge, booking and commission in the last 30 days count now; the membership is in the previous period.
    expect(analytics.current).toMatchObject({ charges: 600, bookings: 1, hours: 2, commission: 30, new_members: 1 })
    expect(analytics.previous.charges).toBe(2000)
    expect(analytics.payment_split).toEqual({ online: 1, desk: 0 })
    expect(analytics.coaching).toBeNull()

    // Every table read is scoped to the active club and both periods.
    const tables = ['transactions', 'bookings', 'member_roster', 'courts', 'venues', 'platform_commissions']
    for (const table of tables) {
      expect(live.calls).toContainEqual({ table, op: 'eq', args: ['club_id', live.clubId] })
    }
    const ranged = live.calls.filter((call) => call.op === 'gte')
    // Each range read asks once more and stops at the empty page.
    expect([...new Set(ranged.map((call) => call.table))].sort()).toEqual(['bookings', 'platform_commissions', 'transactions'])
    const [fromColumn, fromIso] = live.calls.find((call) => call.table === 'bookings' && call.op === 'gte')!.args as [string, string]
    const [toColumn, toIso] = live.calls.find((call) => call.table === 'bookings' && call.op === 'lt')!.args as [string, string]
    expect([fromColumn, toColumn]).toEqual(['start_at', 'start_at'])
    expect((Date.parse(toIso) - Date.parse(fromIso)) / 86400000).toBe(60)
  })

  it('still answers when the commission lines cannot be read', async () => {
    live.rpcs.set('admin_club_analytics', { data: null, error: { code: 'PGRST202', message: 'missing' } })
    seedTables()
    live.tables.set('platform_commissions', new Error('permission denied for table platform_commissions'))
    const analytics = await api.clubAnalytics(7)
    expect(analytics.current.commission).toBe(0)
    expect(analytics.current.charges).toBe(600)
  })

  it('passes any other error on without reading tables', async () => {
    live.rpcs.set('admin_club_analytics', { data: null, error: { code: 'P0001', message: 'Club admin access required' } })
    await expect(api.clubAnalytics(30)).rejects.toMatchObject({ message: 'Club admin access required' })
    expect(live.from).not.toHaveBeenCalled()
  })

  it('needs an active club', async () => {
    setActiveClubId(null)
    await expect(api.clubAnalytics(30)).rejects.toThrow('No club is selected')
    expect(live.rpc).not.toHaveBeenCalled()
  })
})

describe('range reads (live)', () => {
  it('reads bookings page by page past the 1000-row answer limit, oldest first', async () => {
    const rows = Array.from({ length: 1500 }, (_, i) => ({
      id: `bk-${i}`, club_id: live.clubId, court_id: court.id, member_id: 'm', start_at: new Date(Date.UTC(2026, 10, 1) - i * 60000).toISOString(),
      end_at: '', hours: '1', amount: '500.00', status: 'completed', created_at: '', court,
    }))
    live.tables.set('bookings', rows)
    const result = await api.bookingsBetween('2026-10-01T00:00:00.000Z', '2026-11-02T00:00:00.000Z')
    expect(result).toHaveLength(1500)
    expect(result[0].id).toBe('bk-1499')
    expect(result[1499]).toMatchObject({ id: 'bk-0', hours: 1, amount: 500 })
    const ranges = live.calls.filter((call) => call.table === 'bookings' && call.op === 'range').map((call) => call.args)
    expect(ranges).toEqual([[0, 999], [1000, 1999], [1500, 2499]])
    expect(live.calls).toContainEqual({ table: 'bookings', op: 'select', args: ['*, court:courts!bookings_court_id_fkey(*)'] })
    expect(live.calls).toContainEqual({ table: 'bookings', op: 'eq', args: ['club_id', live.clubId] })
  })

  it('stops at 5000 rows', async () => {
    live.tables.set('transactions', Array.from({ length: 6200 }, (_, i) => ({ id: `tx-${i}`, amount: '1', type: 'walk_in', created_at: '2026-11-01T00:00:00.000Z' })))
    const result = await api.transactionsBetween('2026-10-01T00:00:00.000Z', '2026-11-02T00:00:00.000Z')
    expect(result).toHaveLength(5000)
    expect(result.every((tx) => tx.amount === 1)).toBe(true)
  })

  it("reads only the active club's commission lines, as numbers", async () => {
    live.tables.set('platform_commissions', [{ commission_amount: '12.50', gross_amount: '250.00', created_at: '2026-11-01T00:00:00.000Z' }])
    expect(await api.myClubCommission('2026-10-01T00:00:00.000Z', '2026-11-02T00:00:00.000Z')).toEqual([
      { commission_amount: 12.5, gross_amount: 250, created_at: '2026-11-01T00:00:00.000Z' },
    ])
    expect(live.calls).toContainEqual({ table: 'platform_commissions', op: 'select', args: ['commission_amount, gross_amount, created_at'] })
    expect(live.calls).toContainEqual({ table: 'platform_commissions', op: 'eq', args: ['club_id', live.clubId] })
  })
})

describe('platform analytics (live)', () => {
  it('uses the server summary and turns numerics into numbers', async () => {
    live.rpcs.set('platform_analytics', {
      data: {
        period: { from: '2026-10-26', to: '2026-11-24', days: 30 },
        previous_period: { from: '2026-09-26', to: '2026-10-25', days: 30 },
        current: { gross: '1000.00', commission: '50.00', lines: '2', new_clubs: '1', requests: '3' },
        previous: { gross: '0', commission: '0', lines: 0, new_clubs: 0, requests: 0 },
        by_day: [{ day: '2026-11-24', gross: '1000', commission: '50', lines: '2', new_clubs: 0, requests: '1' }],
        top_clubs: [{ club_id: live.clubId, name: 'Rally Point Gensan', gross: '1000.00', commission: '50.00', lines: '2' }],
        clubs_by_status: [{ status: 'active', count: '2' }],
        requests_by_status: [{ status: 'new', count: '3' }],
        requests_by_city: [{ city: 'Cebu City', count: '3' }],
        ledger_capped: false,
      },
      error: null,
    })
    const analytics = await api.platformAnalytics(30)
    expect(live.rpc).toHaveBeenCalledWith('platform_analytics', { p_days: 30 })
    expect(analytics).toMatchObject({
      source: 'server',
      current: { gross: 1000, commission: 50, lines: 2, new_clubs: 1, requests: 3 },
      top_clubs: [{ club_id: live.clubId, name: 'Rally Point Gensan', gross: 1000, commission: 50, lines: 2 }],
      clubs_by_status: [{ status: 'active', count: 2 }],
      requests_by_city: [{ city: 'Cebu City', count: 3 }],
      ledger_capped: false,
    })
    expect(live.from).not.toHaveBeenCalled()
  })

  it('falls back to the platform functions only, never member tables', async () => {
    const recent = phAt(1, 12)
    live.rpcs.set('platform_analytics', { data: null, error: { code: '42883', message: 'function platform_analytics does not exist' } })
    live.rpcs.set('platform_list_clubs', { data: [{ club_id: live.clubId, slug: 'gensan', name: 'Rally Point Gensan', status: 'active', commission_rate: '5', venue_count: '1', court_count: '4', member_count: '40', admin_count: '1', gross_amount: '600', commission_amount: '30', club_net_amount: '570', entry_count: '1', created_at: '2025-01-01T00:00:00.000Z' }], error: null })
    live.rpcs.set('platform_commission_ledger', { data: [{ id: 'c1', club_id: live.clubId, club_name: 'Rally Point Gensan', venue_id: null, transaction_id: 't1', description: 'Court', gross_amount: '600.00', commission_rate: '5', commission_amount: '30.00', club_net_amount: '570.00', verification_status: 'unverified', created_at: recent }], error: null })
    live.rpcs.set('platform_owner_call_requests', { data: [{ id: 'r1', full_name: 'Owner', club_name: 'New Courts', city: 'Iloilo City', court_count: '3', phone: null, email: 'owner@example.invalid', preferred_date: '2026-12-01', preferred_time: 'morning', message: null, status: 'new', created_at: recent, handled_at: null, handled_by_email: null }], error: null })
    const analytics = await api.platformAnalytics(30)
    expect(analytics.source).toBe('browser')
    expect(analytics.current).toMatchObject({ gross: 600, commission: 30, lines: 1, requests: 1 })
    expect(analytics.top_clubs).toEqual([{ club_id: live.clubId, name: 'Rally Point Gensan', gross: 600, commission: 30, lines: 1 }])
    expect(analytics.requests_by_city).toEqual([{ city: 'Iloilo City', count: 1 }])
    expect(live.rpc).toHaveBeenCalledWith('platform_commission_ledger', { p_club_id: null, p_limit: 1000 })
    expect(live.from).not.toHaveBeenCalled()
    expect(live.calls.every((call) => call.table === 'rpc' && call.op.startsWith('platform_'))).toBe(true)
  })

  it('still answers when owner requests cannot be read', async () => {
    live.rpcs.set('platform_analytics', { data: null, error: { code: 'PGRST202', message: 'missing' } })
    live.rpcs.set('platform_list_clubs', { data: [], error: null })
    live.rpcs.set('platform_commission_ledger', { data: [], error: null })
    live.rpcs.set('platform_owner_call_requests', { data: null, error: { code: 'PGRST202', message: 'missing' } })
    const analytics = await api.platformAnalytics(7)
    expect(analytics.current.requests).toBe(0)
    expect(analytics.requests_by_city).toEqual([])
  })

  it('passes any other error on', async () => {
    live.rpcs.set('platform_analytics', { data: null, error: { code: 'P0001', message: 'Platform access required' } })
    await expect(api.platformAnalytics(30)).rejects.toMatchObject({ message: 'Platform access required' })
    expect(live.rpc).toHaveBeenCalledTimes(1)
  })
})
