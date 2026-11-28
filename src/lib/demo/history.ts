/**
 * Six months of made-up past activity for the demo, so the owner and superadmin
 * dashboards have trends to show.
 *
 * The history is worked out, never stored: the same day always gets the same rows
 * (a seeded random generator, keyed by club and day), and every row falls strictly
 * before the start of today in Philippine time. So today's figures, the stored demo
 * data and every all-time total the other screens show stay exactly as they were.
 * Only the period-scoped analytics reads below add it in.
 */
import type { Booking, Court, MembershipType, OwnerCallRequest, OwnerCallStatus, OwnerCallTime, PlatformCommission, Transaction } from '../../types'
import { addDays, phDay, weekdayIndex } from '../analytics'
import { DEMO_CLUB_ID, DEMO_DAVAO_CLUB_ID } from '../tenant'
import { activeClubId } from './access'
import { COMMISSION_TYPES, round2 } from './commissions'
import type { DemoCommission, DemoDB, DemoOwnerCallRequest } from './model'
import { load } from './persistence'
import { requirePlatform } from './platform'

/** Days of history before today: a 90-day period and the 90 days before it. */
export const HISTORY_DAYS = 180

export interface DemoHistory {
  transactions: Transaction[]
  bookings: Booking[]
  commissions: DemoCommission[]
  ownerCallRequests: DemoOwnerCallRequest[]
}

interface ClubPlan {
  /** Two-letter tag for row ids. */
  tag: string
  /** Days of history: a club has none from before it joined the platform (seed.ts account created_at). */
  days: number
  /** Courts that existed when the history was recorded (the seeded ones). */
  courtIds: string[]
  /** Commission rate in force for the history (the seeded rate). */
  commissionRate: number
  /** Bookings per court on an ordinary weekday at the end of the history. */
  bookingsPerCourt: number
  walkInsPerDay: number
  walkInFee: number
  membershipsPerWeek: number
}

const PLANS: Record<string, ClubPlan> = {
  [DEMO_CLUB_ID]: {
    tag: 'gs',
    days: HISTORY_DAYS,
    courtIds: ['court_1', 'court_2', 'court_3', 'court_4'],
    commissionRate: 5,
    bookingsPerCourt: 2.6,
    walkInsPerDay: 2.2,
    walkInFee: 350,
    membershipsPerWeek: 4,
  },
  [DEMO_DAVAO_CLUB_ID]: {
    tag: 'dv',
    days: 139,
    courtIds: ['court_davao_1', 'court_davao_2'],
    commissionRate: 6,
    bookingsPerCourt: 2.2,
    walkInsPerDay: 1.2,
    walkInFee: 300,
    membershipsPerWeek: 1.5,
  },
}

const MEMBERSHIP_FEES: Record<MembershipType, number> = { basic: 1500, standard: 2000, premium: 2500 }
const MEMBERSHIP_LABELS: Record<MembershipType, string> = { basic: 'Basic', standard: 'Standard', premium: 'Premium' }

/** Relative pull of each start hour (06:00 to 22:00): a morning bump, a quiet midday, busy evenings. */
const HOUR_WEIGHTS: Record<number, number> = {
  6: 4, 7: 5, 8: 4, 9: 2, 10: 2, 11: 1, 12: 1, 13: 1, 14: 1, 15: 2,
  16: 4, 17: 7, 18: 9, 19: 9, 20: 7, 21: 4, 22: 2,
}

const OWNER_CITIES = ['Cebu City', 'Iloilo City', 'Cagayan de Oro', 'Bacolod', 'Zamboanga City', 'Koronadal', 'Davao City', 'Tagum']
const OWNER_TIMES: OwnerCallTime[] = ['morning', 'afternoon', 'evening']

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------

/** FNV-1a: a stable number for a text key. */
function hashKey(key: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** mulberry32: a small seeded generator returning numbers in [0, 1). */
export function seededRandom(key: string): () => number {
  let state = hashKey(key)
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length) % items.length]
}

function weightedHour(rand: () => number, open: number, lastStart: number): number | null {
  const hours = Object.keys(HOUR_WEIGHTS).map(Number).filter((hour) => hour >= open && hour <= lastStart)
  const total = hours.reduce((sum, hour) => sum + HOUR_WEIGHTS[hour], 0)
  if (!total) return null
  let roll = rand() * total
  for (const hour of hours) {
    roll -= HOUR_WEIGHTS[hour]
    if (roll < 0) return hour
  }
  return hours[hours.length - 1]
}

/** The instant of a wall-clock time on a Philippine calendar day (UTC+8, no daylight saving). */
function phInstant(day: string, hour: number, minute = 0): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, hour - 8, minute)).toISOString()
}

function shift(iso: string, minutes: number): string {
  return new Date(Date.parse(iso) + minutes * 60000).toISOString()
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

function clubHistory(db: DemoDB, clubId: string, plan: ClubPlan, today: string, out: DemoHistory) {
  const courts = plan.courtIds
    .map((id) => db.courts.find((court) => court.id === id && court.club_id === clubId))
    .filter((court): court is Court => !!court)
  const members = db.members.filter((member) => member.club_id === clubId)
  if (!courts.length || !members.length) return
  const venues = db.venues.filter((venue) => venue.club_id === clubId)
  const venueFor = (court: Court) => venues.find((venue) => venue.id === court.venue_id)

  const addCharge = (tx: Transaction) => {
    out.transactions.push(tx)
    if (!COMMISSION_TYPES.includes(tx.type)) return
    const commission = round2((tx.amount * plan.commissionRate) / 100)
    out.commissions.push({
      id: `hist_cm_${tx.id}`,
      club_id: clubId,
      venue_id: tx.venue_id ?? null,
      transaction_id: tx.id,
      gross_amount: tx.amount,
      commission_rate: plan.commissionRate,
      commission_amount: commission,
      club_net_amount: round2(tx.amount - commission),
      verification_status: 'unverified',
      created_at: tx.created_at,
    })
  }

  for (let ago = Math.min(plan.days, HISTORY_DAYS); ago >= 1; ago--) {
    const day = addDays(today, -ago)
    const rand = seededRandom(`${clubId}|${day}`)
    const weekday = weekdayIndex(day)
    // Busier weekends and Friday evenings; slowly growing towards today.
    const dayFactor = weekday >= 5 ? 1.5 : weekday === 4 ? 1.2 : 1
    const growth = 0.7 + 0.4 * (1 - ago / HISTORY_DAYS)
    const tag = `${plan.tag}_${day.replace(/-/g, '')}`

    // Court bookings, one court-hour at a time so nothing overlaps.
    const taken = new Map(courts.map((court) => [court.id, Array<boolean>(24).fill(false)]))
    const wanted = Math.round(courts.length * plan.bookingsPerCourt * dayFactor * growth * (0.8 + 0.4 * rand()))
    let made = 0
    for (let attempt = 0; attempt < wanted * 4 && made < wanted; attempt++) {
      const court = pick(rand, courts)
      const venue = venueFor(court)
      const open = Math.max(venue?.open_hour ?? 6, 6)
      const close = Math.min(venue?.close_hour ?? 23, 23)
      const roll = rand()
      const hours = roll < 0.5 ? 1 : roll < 0.85 ? 2 : 3
      const start = weightedHour(rand, open, close - hours)
      if (start == null) continue
      const slots = taken.get(court.id)!
      if (slots.slice(start, start + hours).some(Boolean)) continue
      for (let h = start; h < start + hours; h++) slots[h] = true
      made++

      const member = pick(rand, members)
      const memberRate = member.membership_type && court.member_rate != null && rand() < 0.6
      const amount = hours * (memberRate ? court.member_rate! : court.hourly_rate)
      const online = rand() < 0.4
      const statusRoll = rand()
      const status: Booking['status'] = statusRoll < 0.06 ? 'cancelled' : statusRoll < 0.1 ? 'no_show' : statusRoll < 0.13 ? 'confirmed' : 'completed'
      const startAt = phInstant(day, start)
      const createdAt = shift(startAt, -Math.round((online ? 2 + rand() * 70 : 0.5 + rand() * 20) * 60))
      const id = `hist_bk_${tag}_${made}`
      const reference = online ? `GC${String(Math.floor(rand() * 1e10)).padStart(10, '0')}` : null
      out.bookings.push({
        id,
        club_id: clubId,
        venue_id: court.venue_id,
        court_id: court.id,
        member_id: member.id,
        start_at: startAt,
        end_at: phInstant(day, start + hours),
        hours,
        amount,
        status,
        payment_method: online ? 'gcash' : null,
        payment_ref: null,
        payment_reference: reference,
        payment_submitted_at: online ? shift(createdAt, 5) : null,
        hold_expires_at: online ? shift(createdAt, 15) : null,
        confirm_by: null,
        session_id: null,
        created_at: createdAt,
      })

      // The club records a charge for hours that were kept (a paid no-show keeps its money).
      if (status === 'cancelled' || (status === 'no_show' && !online)) continue
      addCharge({
        id: `hist_tx_${tag}_${made}`,
        club_id: clubId,
        venue_id: court.venue_id ?? null,
        member_id: member.id,
        amount,
        type: online ? 'booking' : 'court_rental',
        description: `${court.name} — ${hours} ${hours === 1 ? 'hour' : 'hours'}`,
        created_at: online ? shift(createdAt, 10) : startAt,
        created_by: null,
        verification_status: 'unverified',
      })
      if (status === 'completed' && rand() < 0.08 && start + hours < 24) {
        addCharge({
          id: `hist_tx_${tag}_${made}_ext`,
          club_id: clubId,
          venue_id: court.venue_id ?? null,
          member_id: member.id,
          amount: court.hourly_rate,
          type: 'extension',
          description: `Extend ${court.name} +1 hour`,
          created_at: phInstant(day, start + hours - 1, 50),
          created_by: null,
          verification_status: 'unverified',
        })
      }
    }

    // Walk-in day passes at the desk.
    const walkIns = Math.floor(plan.walkInsPerDay * dayFactor * growth * (0.4 + rand() * 1.2))
    for (let n = 1; n <= walkIns; n++) {
      const court = pick(rand, courts)
      addCharge({
        id: `hist_tx_${tag}_walk${n}`,
        club_id: clubId,
        venue_id: court.venue_id ?? null,
        member_id: null,
        amount: plan.walkInFee,
        type: 'walk_in',
        description: 'Walk-in day pass',
        created_at: phInstant(day, 9 + Math.floor(rand() * 12), Math.floor(rand() * 60)),
        created_by: null,
        verification_status: 'unverified',
      })
    }

    // Membership fees (new members and renewals).
    if (rand() < (plan.membershipsPerWeek / 7) * growth * 1.2) {
      const member = pick(rand, members)
      const type: MembershipType = member.membership_type ?? pick(rand, ['basic', 'standard', 'premium'] as const)
      addCharge({
        id: `hist_tx_${tag}_mem`,
        club_id: clubId,
        venue_id: null,
        member_id: member.id,
        amount: MEMBERSHIP_FEES[type],
        type: 'membership',
        description: `${MEMBERSHIP_LABELS[type]} membership`,
        created_at: phInstant(day, 10 + Math.floor(rand() * 9), Math.floor(rand() * 60)),
        created_by: null,
        verification_status: 'unverified',
      })
    }
  }
}

function ownerRequestHistory(today: string): DemoOwnerCallRequest[] {
  const rand = seededRandom('owner-requests')
  const rows: DemoOwnerCallRequest[] = []
  for (let n = 1; n <= 14; n++) {
    // Spread over the history; the id is keyed to the day so a day keeps its request.
    const ago = 2 + Math.floor(rand() * (HISTORY_DAYS - 3))
    const day = addDays(today, -ago)
    const city = pick(rand, OWNER_CITIES)
    const status: OwnerCallStatus = ago <= 10 ? 'new' : rand() < 0.65 ? 'called' : 'closed'
    const createdAt = phInstant(day, 8 + Math.floor(rand() * 12), Math.floor(rand() * 60))
    rows.push({
      id: `hist_owner_${day.replace(/-/g, '')}_${n}`,
      full_name: `Sample Owner ${n}`,
      club_name: `${city} Pickleball Courts`,
      city,
      court_count: 2 + Math.floor(rand() * 5),
      phone: null,
      email: `owner${n}@example.invalid`,
      preferred_date: addDays(day, 2),
      preferred_time: pick(rand, OWNER_TIMES),
      message: null,
      status,
      created_at: createdAt,
      handled_at: status === 'new' ? null : shift(createdAt, 24 * 60),
      handled_by: status === 'new' ? null : 'user_superadmin',
    })
  }
  return rows
}

let cache: { key: string; history: DemoHistory } | null = null

/**
 * The demo history for every seeded club, for the HISTORY_DAYS before today (Philippine
 * time). Pure for a given database and day: no clock reads besides `now`.
 */
export function demoHistory(db: DemoDB, now: Date = new Date()): DemoHistory {
  const today = phDay(now)
  const clubs = Object.keys(PLANS).filter((clubId) => db.clubs.some((club) => club.id === clubId))
  const signature = clubs
    .map((clubId) => {
      const courts = db.courts.filter((court) => PLANS[clubId].courtIds.includes(court.id))
      const members = db.members.filter((member) => member.club_id === clubId)
      return `${clubId}:${courts.map((court) => `${court.id}/${court.venue_id}/${court.hourly_rate}/${court.member_rate ?? ''}`).join(',')}:${members.map((member) => `${member.id}/${member.membership_type ?? ''}`).join(',')}`
    })
    .join('|')
  const key = `${today}|${signature}`
  if (cache?.key === key) return cache.history
  const history: DemoHistory = { transactions: [], bookings: [], commissions: [], ownerCallRequests: ownerRequestHistory(today) }
  for (const clubId of clubs) clubHistory(db, clubId, PLANS[clubId], today, history)
  cache = { key, history }
  return history
}

// ---------------------------------------------------------------------------
// Period-scoped reads (stored rows plus history)
// ---------------------------------------------------------------------------

function within(iso: string, fromIso: string, toIso: string) {
  const t = Date.parse(iso)
  return t >= Date.parse(fromIso) && t < Date.parse(toIso)
}

/** Booking reads from the analytics screens are capped, as the live read is. */
const ROW_CAP = 5000

export const analyticsOperations = {
  /** The active club's charges recorded in [from, to), oldest first. */
  transactionsBetween(fromIso: string, toIso: string): Transaction[] {
    const db = load()
    const clubId = activeClubId(db)
    return [...db.transactions, ...demoHistory(db).transactions]
      .filter((tx) => tx.club_id === clubId && within(tx.created_at, fromIso, toIso))
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
  },
  /** The active club's bookings starting in [from, to), oldest first, each with its court. */
  bookingsBetween(fromIso: string, toIso: string): Booking[] {
    const db = load()
    const clubId = activeClubId(db)
    const courts = new Map(db.courts.map((court) => [court.id, court]))
    return [...db.bookings, ...demoHistory(db).bookings]
      .filter((booking) => booking.club_id === clubId && within(booking.start_at, fromIso, toIso))
      .sort((a, b) => b.start_at.localeCompare(a.start_at))
      .slice(0, ROW_CAP)
      .reverse()
      .map((booking) => ({ ...booking, court: courts.get(booking.court_id) }))
  },
  /** The active club's commission lines recorded in [from, to), as a club admin may read them. */
  clubCommissionBetween(fromIso: string, toIso: string): { commission_amount: number; gross_amount: number; created_at: string }[] {
    const db = load()
    const clubId = activeClubId(db)
    return [...db.commissions, ...demoHistory(db).commissions]
      .filter((line) => line.club_id === clubId && within(line.created_at, fromIso, toIso))
      .map((line) => ({ commission_amount: line.commission_amount, gross_amount: line.gross_amount, created_at: line.created_at }))
  },
  /**
   * Platform-wide commission lines in [from, to) and owner requests, for the superadmin
   * dashboard. Requests keep only city, status and time; no member rows are read.
   */
  platformAnalyticsRows(fromIso: string, toIso: string): {
    ledger: Pick<PlatformCommission, 'club_id' | 'club_name' | 'gross_amount' | 'commission_amount' | 'created_at'>[]
    requests: Pick<OwnerCallRequest, 'city' | 'status' | 'created_at'>[]
  } {
    const db = load()
    requirePlatform(db)
    const history = demoHistory(db)
    const clubName = new Map(db.clubs.map((club) => [club.id, club.name]))
    return {
      ledger: [...db.commissions, ...history.commissions]
        .filter((line) => within(line.created_at, fromIso, toIso))
        .map((line) => ({
          club_id: line.club_id,
          club_name: clubName.get(line.club_id) ?? 'Unknown club',
          gross_amount: line.gross_amount,
          commission_amount: line.commission_amount,
          created_at: line.created_at,
        })),
      requests: [...(db.ownerCallRequests ?? []), ...history.ownerCallRequests]
        .filter((row) => within(row.created_at, fromIso, toIso))
        .map((row) => ({ city: row.city, status: row.status, created_at: row.created_at })),
    }
  },
}
