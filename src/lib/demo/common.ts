import type { Booking } from '../../types'
import type { DemoDB } from './model'

export function uid(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`
}

export function todayISO() {
  return new Date().toISOString()
}

export function daysFromNow(n: number) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  return new Date(aStart) < new Date(bEnd) && new Date(bStart) < new Date(aEnd)
}

interface CourtSlot {
  courtId: string
  start_at: string
  end_at: string
  ignoreBookingId?: string
}

/**
 * An unpaid online checkout whose time to pay has run out no longer holds its hours.
 * Once the player has sent a payment the clock stops: the club confirms or rejects it.
 */
export function holdHasLapsed(booking: Pick<Booking, 'status' | 'hold_expires_at' | 'payment_submitted_at'>, now = Date.now()) {
  return booking.status === 'pending_payment'
    && booking.hold_expires_at != null
    && !booking.payment_submitted_at
    && new Date(booking.hold_expires_at).getTime() <= now
}

/** Marks unpaid checkouts whose time ran out as cancelled, so every list agrees with the time grid. */
export function retireLapsedHolds(db: DemoDB, now = Date.now()) {
  let changed = false
  for (const booking of db.bookings) {
    if (!holdHasLapsed(booking, now)) continue
    booking.status = 'cancelled'
    changed = true
  }
  return changed
}

export function isSlotFree(db: DemoDB, slot: CourtSlot) {
  for (const session of db.sessions) {
    if (session.court_id !== slot.courtId) continue
    if (session.status !== 'playing' && session.status !== 'scheduled' && session.status !== 'pending_payment') continue
    if (overlaps(slot.start_at, slot.end_at, session.start_at, session.end_at)) return false
  }
  for (const booking of db.bookings) {
    if (booking.court_id !== slot.courtId) continue
    if (slot.ignoreBookingId && booking.id === slot.ignoreBookingId) continue
    if (booking.status !== 'confirmed' && booking.status !== 'pending_payment') continue
    if (holdHasLapsed(booking)) continue
    if (overlaps(slot.start_at, slot.end_at, booking.start_at, booking.end_at)) return false
  }
  return true
}

export function hydrateBooking(db: DemoDB, booking: Booking): Booking {
  return {
    ...booking,
    court: db.courts.find((court) => court.id === booking.court_id),
    member: db.members.find((member) => member.id === booking.member_id),
  }
}
