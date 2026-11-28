import { describe, expect, it } from 'vitest'
import {
  addDays,
  analyticsWindow,
  buildClubAnalytics,
  buildPlatformAnalytics,
  daysIn,
  niceMax,
  occupancyPct,
  parsePeriod,
  phDay,
  rangeInstants,
  rangeLabel,
  trend,
  weekdayIndex,
} from './analytics'

// 2026-11-24 10:00 in the Philippines (02:00 UTC).
const NOW = new Date('2026-11-24T02:00:00.000Z')

describe('days and windows', () => {
  it('buckets by the Philippine day, whatever the device timezone', () => {
    // 23:30 UTC on Nov 23 is 07:30 on Nov 24 in Manila.
    expect(phDay('2026-11-23T23:30:00.000Z')).toBe('2026-11-24')
    // 15:59 UTC is 23:59 Manila, still the same day; 16:00 UTC is the next day.
    expect(phDay('2026-11-24T15:59:00.000Z')).toBe('2026-11-24')
    expect(phDay('2026-11-24T16:00:00.000Z')).toBe('2026-11-25')
  })

  it('gives the same day keys under another device timezone', () => {
    // Node re-reads TZ when it changes; the app code must not depend on it.
    const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env
    const original = env.TZ
    try {
      for (const tz of ['UTC', 'Europe/Amsterdam', 'America/Los_Angeles']) {
        env.TZ = tz
        expect(phDay('2026-11-24T15:59:00.000Z')).toBe('2026-11-24')
        expect(analyticsWindow(7, NOW).current).toEqual({ from: '2026-11-18', to: '2026-11-24', days: 7 })
      }
    } finally {
      env.TZ = original
    }
  })

  it('makes a period ending today and the same-length period before it', () => {
    const window = analyticsWindow(30, NOW)
    expect(window.current).toEqual({ from: '2026-10-26', to: '2026-11-24', days: 30 })
    expect(window.previous).toEqual({ from: '2026-09-26', to: '2026-10-25', days: 30 })
    expect(daysIn(window.current)).toHaveLength(30)
    expect(daysIn(window.current).at(-1)).toBe('2026-11-24')
  })

  it('crosses month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('numbers weekdays from Monday', () => {
    expect(weekdayIndex('2026-11-23')).toBe(0) // Monday
    expect(weekdayIndex('2026-11-29')).toBe(6) // Sunday
  })

  it('turns a day range into Philippine midnights for range reads', () => {
    expect(rangeInstants({ from: '2026-11-24', to: '2026-11-24', days: 1 })).toEqual({
      from: '2026-11-23T16:00:00.000Z',
      to: '2026-11-24T16:00:00.000Z',
    })
  })

  it('labels a range', () => {
    expect(rangeLabel({ from: '2026-11-01', to: '2026-11-30', days: 30 })).toBe('Nov 1 – Nov 30, 2026')
  })

  it('reads only the offered periods from the URL', () => {
    expect(parsePeriod('7')).toBe(7)
    expect(parsePeriod('90')).toBe(90)
    expect(parsePeriod('31')).toBe(30)
    expect(parsePeriod(null)).toBe(30)
  })
})

describe('trend', () => {
  it('follows the previous-period rules', () => {
    expect(trend(0, 0)).toEqual({ kind: 'none', pct: 0 })
    expect(trend(5, 0)).toEqual({ kind: 'new', pct: 0 })
    expect(trend(1000, 1003)).toEqual({ kind: 'same', pct: 0 })
    expect(trend(150, 100)).toEqual({ kind: 'up', pct: 50 })
    expect(trend(75, 100)).toEqual({ kind: 'down', pct: 25 })
  })
})

describe('niceMax and occupancy', () => {
  it('rounds an axis up to a readable number', () => {
    expect(niceMax(0)).toBe(1)
    expect(niceMax(7)).toBe(10)
    expect(niceMax(18)).toBe(20)
    expect(niceMax(2100)).toBe(2500)
    expect(niceMax(4800)).toBe(5000)
  })

  it('gives a whole percent and never divides by zero', () => {
    expect(occupancyPct(30, 120)).toBe(25)
    expect(occupancyPct(5, 0)).toBe(0)
  })
})

describe('buildClubAnalytics', () => {
  const window = analyticsWindow(7, NOW)
  const venues = [{ id: 'v1', name: 'Main', open_hour: 6, close_hour: 22, is_active: true }]
  const courts = [
    { id: 'c1', name: 'Court 1', status: 'available' as const, venue_id: 'v1' },
    { id: 'c2', name: 'Court 2', status: 'maintenance' as const, venue_id: 'v1' },
  ]

  const result = buildClubAnalytics({
    window,
    now: NOW,
    venues,
    courts,
    transactions: [
      { amount: 500, type: 'booking', venue_id: 'v1', created_at: '2026-11-24T01:00:00.000Z' },
      { amount: 300, type: 'membership', venue_id: null, created_at: '2026-11-20T01:00:00.000Z' },
      // Previous period.
      { amount: 400, type: 'booking', venue_id: 'v1', created_at: '2026-11-15T01:00:00.000Z' },
      // Too old for either.
      { amount: 999, type: 'booking', venue_id: 'v1', created_at: '2026-10-01T01:00:00.000Z' },
    ],
    bookings: [
      // 18:00–20:00 Manila on Monday Nov 23.
      { court_id: 'c1', start_at: '2026-11-23T10:00:00.000Z', hours: 2, amount: 600, status: 'confirmed', payment_reference: 'GC123', created_at: '2026-11-22T00:00:00.000Z' },
      { court_id: 'c1', start_at: '2026-11-24T00:00:00.000Z', hours: 1, amount: 300, status: 'completed', payment_reference: null, created_at: '2026-11-23T00:00:00.000Z' },
      { court_id: 'c1', start_at: '2026-11-22T00:00:00.000Z', hours: 1, amount: 300, status: 'cancelled', payment_reference: null, created_at: '2026-11-21T00:00:00.000Z' },
      { court_id: 'c1', start_at: '2026-11-22T02:00:00.000Z', hours: 1, amount: 300, status: 'pending_payment', payment_reference: 'GC9', created_at: '2026-11-21T00:00:00.000Z' },
      { court_id: 'c1', start_at: '2026-11-14T00:00:00.000Z', hours: 3, amount: 900, status: 'confirmed', payment_reference: null, created_at: '2026-11-13T00:00:00.000Z' },
    ],
    members: [
      { membership_type: 'basic', status: 'active', join_date: '2026-11-20', expiry_date: '2026-11-28', created_at: '2026-11-20T00:00:00.000Z' },
      { membership_type: null, status: 'active', join_date: '2026-11-21', expiry_date: null, created_at: '2026-11-21T00:00:00.000Z' },
      { membership_type: 'premium', status: 'active', join_date: '2026-01-01', expiry_date: '2027-01-01', created_at: '2026-01-01T00:00:00.000Z' },
      { membership_type: 'basic', status: 'expired', join_date: '2025-01-01', expiry_date: '2025-02-01', created_at: '2025-01-01T00:00:00.000Z' },
    ],
    commissions: [
      { commission_amount: 25, created_at: '2026-11-24T01:00:00.000Z' },
      { commission_amount: 20, created_at: '2026-11-15T01:00:00.000Z' },
    ],
  })

  it('splits charges between the two periods', () => {
    expect(result.current.charges).toBe(800)
    expect(result.previous.charges).toBe(400)
    expect(result.charges_by_type).toEqual([
      { type: 'booking', amount: 500 },
      { type: 'membership', amount: 300 },
    ])
    expect(result.charges_by_venue.map((v) => v.name)).toEqual(['Main', 'No location'])
  })

  it('counts held hours, cancellations and the payment split', () => {
    expect(result.current.bookings).toBe(2)
    expect(result.current.hours).toBe(3)
    expect(result.current.cancellations).toBe(1)
    expect(result.current.avg_booking).toBe(450)
    expect(result.previous.hours).toBe(3)
    expect(result.payment_split).toEqual({ online: 1, desk: 1 })
    expect(result.bookings_by_status).toEqual([
      { status: 'confirmed', count: 1 },
      { status: 'completed', count: 1 },
      { status: 'pending_payment', count: 1 },
      { status: 'cancelled', count: 1 },
    ])
  })

  it('opens only in-service courts for the venue hours', () => {
    expect(result.current.open_hours).toBe(16 * 7)
    expect(result.courts.find((c) => c.court_id === 'c2')?.open_hours).toBe(0)
    expect(result.courts[0]).toMatchObject({ court_id: 'c1', hours: 3 })
  })

  it('fills the busy-hours grid in Philippine hours', () => {
    expect(result.busy_hours[0][18]).toBe(1)
    expect(result.busy_hours[0][19]).toBe(1)
    expect(result.busy_hours[1][8]).toBe(1) // Tuesday 08:00 Manila
  })

  it('counts members and today’s standing', () => {
    expect(result.current.new_members).toBe(1)
    expect(result.current.new_players).toBe(1)
    expect(result.members).toEqual({ active_members: 2, ending_soon: 1, players: 1 })
  })

  it('adds up the platform commission', () => {
    expect(result.current.commission).toBe(25)
    expect(result.previous.commission).toBe(20)
  })

  it('keeps one point per day, oldest first', () => {
    expect(result.by_day).toHaveLength(7)
    expect(result.by_day.at(-1)).toMatchObject({ day: '2026-11-24', charges: 500, commission: 25, hours: 1 })
    expect(result.source).toBe('browser')
  })
})

describe('buildPlatformAnalytics', () => {
  const window = analyticsWindow(7, NOW)
  const result = buildPlatformAnalytics({
    window,
    ledgerLimit: 3,
    clubs: [
      { club_id: 'a', name: 'Alpha', status: 'active', created_at: '2026-01-01T00:00:00.000Z' },
      { club_id: 'b', name: 'Bravo', status: 'provisioning', created_at: '2026-11-22T00:00:00.000Z' },
    ],
    ledger: [
      { club_id: 'a', club_name: 'Alpha', gross_amount: 1000, commission_amount: 50, created_at: '2026-11-24T00:00:00.000Z' },
      { club_id: 'b', club_name: 'Bravo', gross_amount: 2000, commission_amount: 100, created_at: '2026-11-23T00:00:00.000Z' },
      { club_id: 'a', club_name: 'Alpha', gross_amount: 500, commission_amount: 25, created_at: '2026-11-12T00:00:00.000Z' },
    ],
    requests: [
      { city: 'General Santos', status: 'new', created_at: '2026-11-23T00:00:00.000Z' },
      { city: 'General Santos', status: 'called', created_at: '2026-11-21T00:00:00.000Z' },
      { city: ' ', status: 'closed', created_at: '2026-11-20T00:00:00.000Z' },
      { city: 'Davao', status: 'new', created_at: '2026-11-12T00:00:00.000Z' },
    ],
  })

  it('totals the ledger for both periods and ranks clubs', () => {
    expect(result.current).toMatchObject({ gross: 3000, commission: 150, lines: 2, new_clubs: 1, requests: 3 })
    expect(result.previous).toMatchObject({ gross: 500, commission: 25, lines: 1, requests: 1 })
    expect(result.top_clubs.map((c) => c.name)).toEqual(['Bravo', 'Alpha'])
  })

  it('counts clubs, requests and cities', () => {
    expect(result.clubs_by_status).toEqual([
      { status: 'active', count: 1 },
      { status: 'provisioning', count: 1 },
    ])
    expect(result.requests_by_status).toEqual([
      { status: 'new', count: 1 },
      { status: 'called', count: 1 },
      { status: 'closed', count: 1 },
    ])
    expect(result.requests_by_city).toEqual([
      { city: 'General Santos', count: 2 },
      { city: 'Not given', count: 1 },
    ])
  })

  it('says when the ledger read was cut off', () => {
    expect(result.ledger_capped).toBe(true)
    expect(buildPlatformAnalytics({ window, clubs: [], ledger: [], requests: null }).ledger_capped).toBe(false)
  })
})
