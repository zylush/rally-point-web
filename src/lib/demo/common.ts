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
