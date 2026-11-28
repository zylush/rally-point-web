import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { analyticsWindow, phDay, rangeInstants } from './analytics'
import { api } from './api'
import { setActiveClubId } from './clubContext'
import { demoHistory, HISTORY_DAYS } from './demo/history'
import { demoStore } from './demoStore'
import { DEMO_CLUB_ID, DEMO_DAVAO_CLUB_ID } from './tenant'

vi.mock('./supabase', () => ({ isDemoMode: true, supabase: null }))

// Noon in the Philippines, so the device's own date matches the Philippine date in most timezones.
const NOW = new Date('2026-11-24T04:00:00.000Z')

function phStartOfToday(now = NOW) {
  return rangeInstants(analyticsWindow(1, now).current).from
}

describe('demo analytics', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    localStorage.clear()
    setActiveClubId(null)
    demoStore.reset()
  })
  afterEach(() => {
    setActiveClubId(null)
    vi.useRealTimers()
  })

  it('gives the owner thirty days of charges, bookings and hours, with today unchanged', async () => {
    demoStore.login('admin@brinely.info', 'admin123')
    const analytics = await api.clubAnalytics(30)
    expect(analytics.source).toBe('browser')
    expect(analytics.by_day).toHaveLength(30)
    expect(analytics.current.charges).toBeGreaterThan(0)
    expect(analytics.current.bookings).toBeGreaterThan(0)
    expect(analytics.current.hours).toBeGreaterThan(0)
    expect(analytics.previous.charges).toBeGreaterThan(0)
    expect(analytics.current.commission).toBeGreaterThan(0)
    expect(analytics.current.new_members).toBeGreaterThan(0)
    expect(analytics.payment_split.online).toBeGreaterThan(0)
    expect(analytics.payment_split.desk).toBeGreaterThan(0)
    expect(analytics.busy_hours.flat().some((count) => count > 0)).toBe(true)

    // Today is exactly what the stored demo data says: the history stops before today.
    const today = phDay(NOW)
    const todayRows = (await api.transactions()).filter((tx) => phDay(tx.created_at) === today)
    const todayTotal = todayRows.reduce((sum, tx) => sum + tx.amount, 0)
    expect(analytics.by_day[29]).toMatchObject({ day: today, charges: todayTotal, bookings: 0 })
    expect(todayTotal).toBe(20040)
  })

  it('keeps every history row before the Philippine start of today and is the same on every read', () => {
    const db = demoStore.get()
    const start = Date.parse(phStartOfToday())
    const history = demoHistory(db, NOW)
    expect(history.bookings.length).toBeGreaterThan(0)
    for (const row of [...history.transactions, ...history.commissions, ...history.ownerCallRequests]) {
      expect(Date.parse(row.created_at)).toBeLessThan(start)
    }
    for (const booking of history.bookings) {
      expect(Date.parse(booking.end_at)).toBeLessThanOrEqual(start)
      expect(booking.hours).toBeGreaterThanOrEqual(1)
      expect(booking.hours).toBeLessThanOrEqual(3)
    }
    const oldest = Date.parse(rangeInstants(analyticsWindow(HISTORY_DAYS + 1, NOW).current).from)
    expect(Math.min(...history.bookings.map((booking) => Date.parse(booking.start_at)))).toBeGreaterThanOrEqual(oldest)

    // Deterministic: a fresh copy of the database gives identical rows.
    const again = demoHistory(JSON.parse(JSON.stringify(db)), NOW)
    expect(again.transactions).toEqual(history.transactions)
    expect(again.bookings).toEqual(history.bookings)

    // Commission lines follow the court-time charges at each club's rate.
    const courtTime = history.transactions.filter((tx) => ['booking', 'court_rental', 'extension'].includes(tx.type))
    expect(history.commissions).toHaveLength(courtTime.length)
    const gensanLine = history.commissions.find((line) => line.club_id === DEMO_CLUB_ID)!
    expect(gensanLine.commission_amount).toBeCloseTo(gensanLine.gross_amount * 0.05, 2)
    const davaoLine = history.commissions.find((line) => line.club_id === DEMO_DAVAO_CLUB_ID)!
    expect(davaoLine.commission_amount).toBeCloseTo(davaoLine.gross_amount * 0.06, 2)

    // No two kept bookings share a court hour.
    const held = history.bookings.filter((booking) => booking.status !== 'cancelled')
    const seen = new Set<string>()
    for (const booking of held) {
      for (let h = 0; h < booking.hours; h++) {
        const key = `${booking.court_id}|${Date.parse(booking.start_at) + h * 3600000}`
        expect(seen.has(key)).toBe(false)
        seen.add(key)
      }
    }
  })

  it('leaves the stored lists alone and keeps all-time totals at least the period totals', async () => {
    const before = demoStore.get()
    expect(before.bookings).toEqual([])
    demoStore.login('superadmin@brinely.info', 'superadmin123')
    const davao = demoStore.platformClubs().find((club) => club.club_id === DEMO_DAVAO_CLUB_ID)!
    const recent = await api.platformAnalytics(90)
    const davaoRecent = recent.top_clubs.find((club) => club.club_id === DEMO_DAVAO_CLUB_ID)!
    expect(davao.gross_amount).toBeGreaterThanOrEqual(davaoRecent.gross)
    expect(davao.entry_count).toBeGreaterThanOrEqual(davaoRecent.lines)
    expect(demoStore.platformLedger(DEMO_DAVAO_CLUB_ID).slice(0, 2).map((line) => line.commission_amount)).toEqual([27, 54])
    expect(demoStore.platformOwnerCallRequests()).toEqual([])
    expect(await api.listBookings()).toEqual([])
  })

  it('reads bookings in a range for the active club only, oldest first, with the court', async () => {
    const window = analyticsWindow(7, NOW)
    const from = rangeInstants(window.current).from
    const to = rangeInstants(window.current).to
    setActiveClubId(DEMO_DAVAO_CLUB_ID)
    const davao = await api.bookingsBetween(from, to)
    expect(davao.length).toBeGreaterThan(0)
    expect(davao.every((booking) => booking.club_id === DEMO_DAVAO_CLUB_ID && booking.court?.club_id === DEMO_DAVAO_CLUB_ID)).toBe(true)
    expect(davao.every((booking) => booking.start_at >= from && booking.start_at < to)).toBe(true)
    expect(davao.map((booking) => booking.start_at)).toEqual(davao.map((booking) => booking.start_at).sort())
    const commission = await api.myClubCommission(from, to)
    expect(commission.length).toBeGreaterThan(0)
    expect(commission.every((line) => line.created_at >= from && line.created_at < to)).toBe(true)
  })

  it('gives the superadmin top clubs and requests without any member detail', async () => {
    demoStore.login('superadmin@brinely.info', 'superadmin123')
    const analytics = await api.platformAnalytics(30)
    expect(analytics.source).toBe('browser')
    expect(analytics.by_day).toHaveLength(30)
    expect(analytics.top_clubs.map((club) => club.club_id)).toEqual([DEMO_CLUB_ID, DEMO_DAVAO_CLUB_ID])
    expect(analytics.current.gross).toBeGreaterThan(0)
    expect(analytics.current.commission).toBeGreaterThan(0)
    expect(analytics.ledger_capped).toBe(false)
    expect(analytics.clubs_by_status).toEqual([{ status: 'active', count: 2 }])

    const ninety = await api.platformAnalytics(90)
    expect(ninety.current.requests + ninety.previous.requests).toBeGreaterThan(0)
    expect(ninety.requests_by_city.length).toBeGreaterThan(0)
    expect(ninety.previous.new_clubs).toBe(1)

    const text = JSON.stringify([analytics, ninety])
    const members = demoStore.get().members
    for (const member of members) {
      expect(text).not.toContain(member.full_name)
      if (member.email) expect(text).not.toContain(member.email)
    }
    expect(text).not.toMatch(/@email\.com|member@brinely|example\.invalid/)
  })

  it('refuses platform figures to anyone but the superadmin', async () => {
    demoStore.login('admin@brinely.info', 'admin123')
    await expect(api.platformAnalytics(30)).rejects.toThrow('Platform access required')
  })
})
