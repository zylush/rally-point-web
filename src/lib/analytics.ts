/**
 * Dashboard and analytics figures for a club owner and for the platform superadmin.
 *
 * Everything here is pure: it takes rows the screens may already read and returns
 * one summary object. The same shapes come back from the server summary functions
 * (`admin_club_analytics`, `platform_analytics`), so a page renders either source.
 *
 * Days are calendar days in Philippine time (APP_TIME_ZONE), whatever the device's
 * own timezone. A period of N days ends today and includes it; the previous period
 * is the N days before that.
 */
import type {
  Booking,
  BookingStatus,
  ClubStatus,
  Court,
  Member,
  OwnerCallRequest,
  OwnerCallStatus,
  PlatformClub,
  PlatformCommission,
  Transaction,
  TxType,
  Venue,
} from '../types'
import { appHour, ymdLocal } from '../types'

export const ANALYTICS_PERIODS = [7, 30, 90] as const
export type AnalyticsPeriod = (typeof ANALYTICS_PERIODS)[number]
export const DEFAULT_ANALYTICS_PERIOD: AnalyticsPeriod = 30

/** Reads `?period=` from a URL; anything else falls back to 30 days. */
export function parsePeriod(raw: string | null | undefined): AnalyticsPeriod {
  const n = Number(raw)
  return (ANALYTICS_PERIODS as readonly number[]).includes(n) ? (n as AnalyticsPeriod) : DEFAULT_ANALYTICS_PERIOD
}

// ---------------------------------------------------------------------------
// Days and windows
// ---------------------------------------------------------------------------

/** The Philippine calendar day (YYYY-MM-DD) of an instant. */
export function phDay(iso: string | Date): string {
  return ymdLocal(typeof iso === 'string' ? new Date(iso) : iso)
}

/** Adds whole days to a YYYY-MM-DD day key. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return t.toISOString().slice(0, 10)
}

/** Monday = 0 … Sunday = 6 for a YYYY-MM-DD day key. */
export function weekdayIndex(day: string): number {
  const [y, m, d] = day.split('-').map(Number)
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
}

export interface DayRange {
  /** First day, inclusive. */
  from: string
  /** Last day, inclusive. */
  to: string
  days: number
}

export interface AnalyticsWindow {
  current: DayRange
  previous: DayRange
}

/** The N days ending today (Philippine time), and the N days before them. */
export function analyticsWindow(days: number, now: Date = new Date()): AnalyticsWindow {
  const today = phDay(now)
  const from = addDays(today, -(days - 1))
  return {
    current: { from, to: today, days },
    previous: { from: addDays(from, -days), to: addDays(from, -1), days },
  }
}

/** Every day key in a range, oldest first. */
export function daysIn(range: DayRange): string[] {
  return Array.from({ length: range.days }, (_, i) => addDays(range.from, i))
}

export function inRange(day: string, range: DayRange): boolean {
  return day >= range.from && day <= range.to
}

/**
 * The instants that bound a day range in Philippine time, for range-filtered
 * reads: `from` is midnight PH on the first day, `to` midnight after the last.
 */
export function rangeInstants(range: DayRange): { from: string; to: string } {
  const start = (day: string) => {
    const [y, m, d] = day.split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, d, -8)).toISOString()
  }
  return { from: start(range.from), to: start(addDays(range.to, 1)) }
}

/** "Nov 1 – Nov 30, 2026" for the range line under the period switch. */
export function rangeLabel(range: DayRange): string {
  const fmt = (day: string, withYear: boolean) => {
    const [y, m, d] = day.split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      ...(withYear ? { year: 'numeric' } : {}),
      timeZone: 'UTC',
    })
  }
  return `${fmt(range.from, false)} – ${fmt(range.to, true)}`
}

// ---------------------------------------------------------------------------
// Trends
// ---------------------------------------------------------------------------

export type TrendKind = 'up' | 'down' | 'same' | 'new' | 'none'

export interface Trend {
  kind: TrendKind
  /** Whole-percent change, always positive; 0 for same/new/none. */
  pct: number
}

/**
 * Change against the previous period. Nothing before and nothing now is "none";
 * nothing before but something now is "new"; under half a percent is "same".
 */
export function trend(current: number, previous: number): Trend {
  if (previous === 0) return current === 0 ? { kind: 'none', pct: 0 } : { kind: 'new', pct: 0 }
  const change = (current - previous) / Math.abs(previous)
  if (Math.abs(change) < 0.005) return { kind: 'same', pct: 0 }
  return { kind: change > 0 ? 'up' : 'down', pct: Math.round(Math.abs(change) * 100) }
}

/** A round axis maximum at or above `max`: 1, 2, 2.5, 5 or 10 times a power of ten. */
export function niceMax(max: number): number {
  if (!(max > 0)) return 1
  const power = 10 ** Math.floor(Math.log10(max))
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (step * power >= max) return step * power
  }
  return 10 * power
}

export function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

// ---------------------------------------------------------------------------
// Club owner analytics
// ---------------------------------------------------------------------------

/** One day of a club's figures, for sparklines and the per-day chart. */
export interface ClubDay {
  day: string
  charges: number
  bookings: number
  hours: number
  new_members: number
  cancellations: number
  commission: number
}

export interface ClubTotals {
  charges: number
  bookings: number
  hours: number
  /** Court hours the club was open for booking (in-service courts × venue hours × days). */
  open_hours: number
  new_members: number
  new_players: number
  /** Cancelled and no-show bookings. */
  cancellations: number
  /** Average amount of a booking that kept its hours. */
  avg_booking: number
  commission: number
}

export interface ClubAnalytics {
  period: DayRange
  previous_period: DayRange
  current: ClubTotals
  previous: ClubTotals
  by_day: ClubDay[]
  charges_by_type: { type: TxType; amount: number }[]
  charges_by_venue: { venue_id: string | null; name: string; amount: number }[]
  bookings_by_status: { status: BookingStatus; count: number }[]
  /** Booked hours per court in the current period, with the hours it was open. */
  courts: { court_id: string; name: string; venue_name: string; hours: number; open_hours: number }[]
  /** Booked hours by weekday (Mon = 0) and hour of day (0–23), current period. */
  busy_hours: number[][]
  /** Bookings paid through the club's GCash QR, against bookings made at the desk. */
  payment_split: { online: number; desk: number }
  /** Not tied to the period: how things stand today. */
  members: { active_members: number; ending_soon: number; players: number }
  /**
   * Coach booking requests for the club's coaches. Only the server summary can count
   * them (the coach tables are closed to direct reads), so browser totals give null.
   */
  coaching: { requests: number; previous_requests: number; accepted: number } | null
  /** Where the figures came from; 'browser' totals are added up from rows on this device. */
  source: 'server' | 'browser'
}

export interface ClubAnalyticsInput {
  window: AnalyticsWindow
  transactions: Pick<Transaction, 'amount' | 'type' | 'venue_id' | 'created_at'>[]
  bookings: Pick<Booking, 'court_id' | 'start_at' | 'hours' | 'amount' | 'status' | 'payment_reference' | 'created_at'>[]
  members: Pick<Member, 'membership_type' | 'status' | 'join_date' | 'expiry_date' | 'created_at'>[]
  courts: Pick<Court, 'id' | 'name' | 'status' | 'venue_id'>[]
  venues: Pick<Venue, 'id' | 'name' | 'open_hour' | 'close_hour' | 'is_active'>[]
  commissions: Pick<PlatformCommission, 'commission_amount' | 'created_at'>[]
  now?: Date
}

/** Statuses whose hours stay taken on the court. */
const HELD: BookingStatus[] = ['confirmed', 'completed', 'no_show']
const TX_TYPES: TxType[] = ['booking', 'court_rental', 'extension', 'membership', 'walk_in', 'other']
const BOOKING_STATUSES: BookingStatus[] = ['confirmed', 'completed', 'pending_payment', 'cancelled', 'no_show']

function emptyDay(day: string): ClubDay {
  return { day, charges: 0, bookings: 0, hours: 0, new_members: 0, cancellations: 0, commission: 0 }
}

function emptyTotals(): ClubTotals {
  return { charges: 0, bookings: 0, hours: 0, open_hours: 0, new_members: 0, new_players: 0, cancellations: 0, avg_booking: 0, commission: 0 }
}

/** The day a member joined: their join date, or the day the row was made. */
function joinDay(member: ClubAnalyticsInput['members'][number]): string {
  return member.join_date ? member.join_date.slice(0, 10) : phDay(member.created_at)
}

/** Adds up a club's figures for the current and previous period from its rows. */
export function buildClubAnalytics(input: ClubAnalyticsInput): ClubAnalytics {
  const { window } = input
  const now = input.now ?? new Date()
  const today = phDay(now)
  const days = daysIn(window.current)
  const byDay = new Map(days.map((day) => [day, emptyDay(day)]))
  const cur = emptyTotals()
  const prev = emptyTotals()
  const periodOf = (day: string) => (inRange(day, window.current) ? cur : inRange(day, window.previous) ? prev : null)

  const byType = new Map<TxType, number>()
  const venueNames = new Map(input.venues.map((venue) => [venue.id, venue.name]))
  const byVenue = new Map<string | null, number>()
  for (const tx of input.transactions) {
    const day = phDay(tx.created_at)
    const totals = periodOf(day)
    if (!totals) continue
    const amount = Number(tx.amount) || 0
    totals.charges += amount
    if (totals !== cur) continue
    byDay.get(day)!.charges += amount
    byType.set(tx.type, (byType.get(tx.type) ?? 0) + amount)
    const venueKey = tx.venue_id ?? null
    byVenue.set(venueKey, (byVenue.get(venueKey) ?? 0) + amount)
  }

  const courtHours = new Map<string, number>()
  const busy = Array.from({ length: 7 }, () => Array<number>(24).fill(0))
  const byStatus = new Map<BookingStatus, number>()
  const heldAmount = { cur: 0, prev: 0 }
  const split = { online: 0, desk: 0 }
  for (const booking of input.bookings) {
    const day = phDay(booking.start_at)
    const totals = periodOf(day)
    if (!totals) continue
    const isCur = totals === cur
    if (isCur) byStatus.set(booking.status, (byStatus.get(booking.status) ?? 0) + 1)
    if (booking.status === 'cancelled' || booking.status === 'no_show') {
      totals.cancellations += 1
      if (isCur) byDay.get(day)!.cancellations += 1
    }
    if (!HELD.includes(booking.status)) continue
    const hours = Number(booking.hours) || 0
    totals.bookings += 1
    totals.hours += hours
    if (isCur) heldAmount.cur += Number(booking.amount) || 0
    else heldAmount.prev += Number(booking.amount) || 0
    if (!isCur) continue
    const point = byDay.get(day)!
    point.bookings += 1
    point.hours += hours
    courtHours.set(booking.court_id, (courtHours.get(booking.court_id) ?? 0) + hours)
    if (booking.payment_reference) split.online += 1
    else split.desk += 1
    const weekday = weekdayIndex(day)
    const startHour = appHour(booking.start_at)
    for (let h = 0; h < hours && startHour + h < 24; h++) busy[weekday][startHour + h] += 1
  }
  cur.avg_booking = cur.bookings ? Math.round((heldAmount.cur / cur.bookings) * 100) / 100 : 0
  prev.avg_booking = prev.bookings ? Math.round((heldAmount.prev / prev.bookings) * 100) / 100 : 0

  const venueHoursPerDay = new Map(
    input.venues.filter((venue) => venue.is_active).map((venue) => [venue.id, Math.max(0, venue.close_hour - venue.open_hour)]),
  )
  const inService = input.courts.filter((court) => court.status !== 'maintenance')
  const openPerDay = sum(inService.map((court) => venueHoursPerDay.get(court.venue_id ?? '') ?? 0))
  cur.open_hours = openPerDay * window.current.days
  prev.open_hours = openPerDay * window.previous.days

  let players = 0
  let activeMembers = 0
  let endingSoon = 0
  const soon = addDays(today, 7)
  for (const member of input.members) {
    const day = joinDay(member)
    const totals = periodOf(day)
    if (totals) {
      if (member.membership_type) totals.new_members += 1
      else totals.new_players += 1
      if (totals === cur) byDay.get(day)!.new_members += 1
    }
    if (!member.membership_type) {
      players += 1
      continue
    }
    const expiry = member.expiry_date?.slice(0, 10) ?? null
    if (member.status === 'active' && (!expiry || expiry >= today)) {
      activeMembers += 1
      if (expiry && expiry <= soon) endingSoon += 1
    }
  }

  for (const line of input.commissions) {
    const day = phDay(line.created_at)
    const totals = periodOf(day)
    if (!totals) continue
    const amount = Number(line.commission_amount) || 0
    totals.commission += amount
    if (totals === cur) byDay.get(day)!.commission += amount
  }

  return {
    period: window.current,
    previous_period: window.previous,
    current: cur,
    previous: prev,
    by_day: days.map((day) => byDay.get(day)!),
    charges_by_type: TX_TYPES.filter((type) => byType.has(type)).map((type) => ({ type, amount: byType.get(type)! })),
    charges_by_venue: [...byVenue.entries()]
      .map(([venue_id, amount]) => ({ venue_id, name: venue_id ? venueNames.get(venue_id) ?? 'Other location' : 'No location', amount }))
      .sort((a, b) => b.amount - a.amount),
    bookings_by_status: BOOKING_STATUSES.filter((status) => byStatus.has(status)).map((status) => ({ status, count: byStatus.get(status)! })),
    courts: input.courts
      .map((court) => ({
        court_id: court.id,
        name: court.name,
        venue_name: venueNames.get(court.venue_id ?? '') ?? '',
        hours: courtHours.get(court.id) ?? 0,
        open_hours: court.status === 'maintenance' ? 0 : (venueHoursPerDay.get(court.venue_id ?? '') ?? 0) * window.current.days,
      }))
      .sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name)),
    busy_hours: busy,
    payment_split: split,
    members: { active_members: activeMembers, ending_soon: endingSoon, players },
    coaching: null,
    source: 'browser',
  }
}

/** Share of open court hours that were booked, 0–100, rounded. */
export function occupancyPct(hours: number, openHours: number): number {
  return openHours > 0 ? Math.round((hours / openHours) * 100) : 0
}

// ---------------------------------------------------------------------------
// Platform (superadmin) analytics — aggregates only, never member details
// ---------------------------------------------------------------------------

export interface PlatformDay {
  day: string
  gross: number
  commission: number
  lines: number
  new_clubs: number
  requests: number
}

export interface PlatformTotals {
  gross: number
  commission: number
  lines: number
  new_clubs: number
  requests: number
}

export interface PlatformAnalytics {
  period: DayRange
  previous_period: DayRange
  current: PlatformTotals
  previous: PlatformTotals
  by_day: PlatformDay[]
  /** Clubs ranked by charges recorded in the current period. */
  top_clubs: { club_id: string; name: string; gross: number; commission: number; lines: number }[]
  clubs_by_status: { status: ClubStatus; count: number }[]
  /** Owner requests received in the current period, by where they stand now. */
  requests_by_status: { status: OwnerCallStatus; count: number }[]
  requests_by_city: { city: string; count: number }[]
  /** True when the ledger read was cut off, so older lines in the period may be missing. */
  ledger_capped: boolean
  source: 'server' | 'browser'
}

export interface PlatformAnalyticsInput {
  window: AnalyticsWindow
  clubs: Pick<PlatformClub, 'club_id' | 'name' | 'status' | 'created_at'>[]
  ledger: Pick<PlatformCommission, 'club_id' | 'club_name' | 'gross_amount' | 'commission_amount' | 'created_at'>[]
  requests: Pick<OwnerCallRequest, 'city' | 'status' | 'created_at'>[] | null
  ledgerLimit?: number
}

const CLUB_STATUSES: ClubStatus[] = ['active', 'provisioning', 'suspended']
const REQUEST_STATUSES: OwnerCallStatus[] = ['new', 'called', 'closed']

function emptyPlatformTotals(): PlatformTotals {
  return { gross: 0, commission: 0, lines: 0, new_clubs: 0, requests: 0 }
}

export function buildPlatformAnalytics(input: PlatformAnalyticsInput): PlatformAnalytics {
  const { window } = input
  const days = daysIn(window.current)
  const byDay = new Map<string, PlatformDay>(
    days.map((day) => [day, { day, gross: 0, commission: 0, lines: 0, new_clubs: 0, requests: 0 }]),
  )
  const cur = emptyPlatformTotals()
  const prev = emptyPlatformTotals()
  const periodOf = (day: string) => (inRange(day, window.current) ? cur : inRange(day, window.previous) ? prev : null)

  const clubTotals = new Map<string, { club_id: string; name: string; gross: number; commission: number; lines: number }>()
  for (const line of input.ledger) {
    const day = phDay(line.created_at)
    const totals = periodOf(day)
    if (!totals) continue
    const gross = Number(line.gross_amount) || 0
    const commission = Number(line.commission_amount) || 0
    totals.gross += gross
    totals.commission += commission
    totals.lines += 1
    if (totals !== cur) continue
    const point = byDay.get(day)!
    point.gross += gross
    point.commission += commission
    point.lines += 1
    const club = clubTotals.get(line.club_id) ?? { club_id: line.club_id, name: line.club_name, gross: 0, commission: 0, lines: 0 }
    club.gross += gross
    club.commission += commission
    club.lines += 1
    clubTotals.set(line.club_id, club)
  }

  const statusCounts = new Map<ClubStatus, number>()
  for (const club of input.clubs) {
    statusCounts.set(club.status, (statusCounts.get(club.status) ?? 0) + 1)
    const day = phDay(club.created_at)
    const totals = periodOf(day)
    if (!totals) continue
    totals.new_clubs += 1
    if (totals === cur) byDay.get(day)!.new_clubs += 1
  }

  const requestStatus = new Map<OwnerCallStatus, number>()
  const requestCity = new Map<string, number>()
  for (const request of input.requests ?? []) {
    const day = phDay(request.created_at)
    const totals = periodOf(day)
    if (!totals) continue
    totals.requests += 1
    if (totals !== cur) continue
    byDay.get(day)!.requests += 1
    requestStatus.set(request.status, (requestStatus.get(request.status) ?? 0) + 1)
    const city = request.city?.trim() || 'Not given'
    requestCity.set(city, (requestCity.get(city) ?? 0) + 1)
  }

  const limit = input.ledgerLimit
  return {
    period: window.current,
    previous_period: window.previous,
    current: cur,
    previous: prev,
    by_day: days.map((day) => byDay.get(day)!),
    top_clubs: [...clubTotals.values()].sort((a, b) => b.gross - a.gross || a.name.localeCompare(b.name)),
    clubs_by_status: CLUB_STATUSES.filter((status) => statusCounts.has(status)).map((status) => ({ status, count: statusCounts.get(status)! })),
    requests_by_status: REQUEST_STATUSES.filter((status) => requestStatus.has(status)).map((status) => ({ status, count: requestStatus.get(status)! })),
    requests_by_city: [...requestCity.entries()]
      .map(([city, count]) => ({ city, count }))
      .sort((a, b) => b.count - a.count || a.city.localeCompare(b.city)),
    ledger_capped: limit != null && input.ledger.length >= limit,
    source: 'browser',
  }
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export const txTypeLabel: Record<TxType, string> = {
  booking: 'Court bookings',
  court_rental: 'Desk court time',
  extension: 'Extensions',
  membership: 'Memberships',
  walk_in: 'Walk-ins',
  other: 'Other',
}

export const bookingStatusLabel: Record<BookingStatus, string> = {
  confirmed: 'Confirmed',
  completed: 'Played',
  pending_payment: 'Waiting for payment',
  cancelled: 'Cancelled',
  no_show: 'No-show',
}

export const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
