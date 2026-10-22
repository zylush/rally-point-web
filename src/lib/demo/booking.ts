import type { Booking, BookingStatus, CourtDayAvailability, CourtSession, PaymentMethod } from '../../types'
import { CLUB_CLOSE_HOUR, CLUB_OPEN_HOUR, courtRateFor, hourLabel, localRangeISO } from '../../types'
import { makePaymentRef } from '../payments'
import { activeClubId } from './access'
import { hydrateBooking, isSlotFree, todayISO, uid } from './common'
import { recordTransaction } from './commissions'
import { load, save } from './persistence'

export const bookingOperations = {
  availability(dateYmd: string, venueId?: string): CourtDayAvailability[] {
    const db = load()
    const clubId = activeClubId(db)
    const now = new Date()
    return db.courts.filter((court) => court.club_id === clubId && (!venueId || court.venue_id === venueId)).map((court) => {
      const slots = []
      for (let h = CLUB_OPEN_HOUR; h < CLUB_CLOSE_HOUR; h++) {
        const { start_at, end_at } = localRangeISO(dateYmd, h, 1)
        const start = new Date(start_at)
        let available = court.status !== 'maintenance' && isSlotFree(db, { courtId: court.id, start_at, end_at })
        if (start.getTime() < now.getTime() - 5 * 60000) available = false
        slots.push({ startHour: h, label: hourLabel(h), available })
      }
      return { court, slots }
    })
  },
  createBooking(opts: {
    court_id: string
    venue_id?: string
    member_id: string
    dateYmd: string
    startHour: number
    hours: number
    user_id: string
  }): Booking {
    const db = load()
    const clubId = activeClubId(db)
    const court = db.courts.find((c) => c.id === opts.court_id && c.club_id === clubId)
    if (!court) throw new Error('Court not found')
    if (opts.venue_id && court.venue_id !== opts.venue_id) throw new Error('Court is outside the selected venue')
    if (court.status === 'maintenance') throw new Error('Court under maintenance')
    if (opts.hours < 1 || opts.hours > 3) throw new Error('Book 1–3 hours')
    if (opts.startHour + opts.hours > CLUB_CLOSE_HOUR) throw new Error('Outside club hours')
    const member = db.members.find((m) => m.id === opts.member_id)
    if (member && member.club_id !== court.club_id) throw new Error('Member belongs to another club')

    const { start_at, end_at } = localRangeISO(opts.dateYmd, opts.startHour, opts.hours)
    if (new Date(start_at).getTime() < Date.now() - 5 * 60000) {
      throw new Error('That time has already passed')
    }
    if (!isSlotFree(db, { courtId: opts.court_id, start_at, end_at })) {
      throw new Error('That slot is no longer available')
    }

    // Players with an active membership pay the court's member rate, when it has one.
    const amount = courtRateFor(court, member) * opts.hours
    const booking: Booking = {
      id: uid('bk'),
      club_id: court.club_id,
      venue_id: court.venue_id,
      court_id: opts.court_id,
      member_id: opts.member_id,
      start_at,
      end_at,
      hours: opts.hours,
      amount,
      status: 'pending_payment',
      payment_method: null,
      payment_ref: null,
      session_id: null,
      created_at: todayISO(),
    }
    db.bookings.unshift(booking)
    save(db)
    return hydrateBooking(db, booking)
  },
  confirmBookingPayment(opts: { booking_id: string; method: PaymentMethod; user_id: string }): Booking {
    const db = load()
    const clubId = activeClubId(db)
    const b = db.bookings.find((x) => x.id === opts.booking_id && x.club_id === clubId)
    if (!b) throw new Error('Booking not found')
    if (b.status !== 'pending_payment') throw new Error('Booking is not awaiting payment')
    if (!isSlotFree(db, { courtId: b.court_id, start_at: b.start_at, end_at: b.end_at, ignoreBookingId: b.id })) {
      b.status = 'cancelled'
      save(db)
      throw new Error('Slot taken — booking cancelled. Pick another time.')
    }

    const court = db.courts.find((c) => c.id === b.court_id)
    const ref = makePaymentRef(opts.method)
    b.status = 'confirmed'
    b.payment_method = opts.method
    b.payment_ref = ref

    const session: CourtSession = {
      id: uid('ses'),
      club_id: b.club_id,
      venue_id: b.venue_id,
      court_id: b.court_id,
      member_id: b.member_id,
      start_at: b.start_at,
      end_at: b.end_at,
      status: 'scheduled',
      amount: b.amount,
      created_by: opts.user_id,
      booking_id: b.id,
      notes: `Online booking · ${opts.method} · ${ref}`,
    }
    db.sessions.push(session)
    b.session_id = session.id

    const minsUntil = (new Date(b.start_at).getTime() - Date.now()) / 60000
    if (minsUntil <= 60 && court) court.status = 'occupied'

    // The charge is recorded, not collected: payments are simulated in the demo.
    recordTransaction(db, {
      id: uid('tx'),
      club_id: b.club_id,
      venue_id: b.venue_id ?? null,
      member_id: b.member_id,
      amount: b.amount,
      type: 'booking',
      description: `${court?.name ?? 'Court'} booking · ${opts.method.toUpperCase()} · ${ref}`,
      created_at: todayISO(),
      created_by: opts.user_id,
    }, 'first')
    db.notifications.unshift({
      id: uid('n'),
      club_id: b.club_id,
      venue_id: b.venue_id ?? null,
      user_id: opts.user_id,
      title: 'Booking confirmed',
      body: `${court?.name ?? 'Court'} · ${new Date(b.start_at).toLocaleString()} · Ref ${ref}. Show at desk.`,
      read: false,
      created_at: todayISO(),
    })
    // 1h before start reminder
    const fire = new Date(new Date(b.start_at).getTime() - 60 * 60000)
    db.reminders.push({
      id: uid('rm'),
      club_id: b.club_id,
      venue_id: b.venue_id ?? null,
      user_id: opts.user_id,
      kind: 'booking_reminder',
      title: 'Court in 1 hour',
      body: `${court?.name ?? 'Court'} starts soon. Don't be late!`,
      fire_at: fire.toISOString(),
      sent_at: null,
      booking_id: b.id,
    })
    save(db)
    return hydrateBooking(db, b)
  },
  cancelBooking(bookingId: string, userId: string) {
    const db = load()
    const clubId = activeClubId(db)
    const b = db.bookings.find((x) => x.id === bookingId && x.club_id === clubId)
    if (!b) throw new Error('Booking not found')
    if (b.status === 'cancelled' || b.status === 'completed') return
    b.status = 'cancelled' as BookingStatus
    if (b.session_id) {
      const s = db.sessions.find((x) => x.id === b.session_id)
      if (s && (s.status === 'scheduled' || s.status === 'pending_payment')) s.status = 'cancelled'
    }
    db.notifications.unshift({
      id: uid('n'),
      club_id: b.club_id,
      venue_id: b.venue_id ?? null,
      user_id: userId,
      title: 'Booking cancelled',
      body: 'Your court booking was cancelled.',
      read: false,
      created_at: todayISO(),
    })
    save(db)
  },
  myBookings(memberId: string, venueId?: string) {
    const db = load()
    const clubId = activeClubId(db)
    return db.bookings
      .filter((b) => b.club_id === clubId && b.member_id === memberId && (!venueId || b.venue_id === venueId))
      .sort((a, b) => +new Date(b.start_at) - +new Date(a.start_at))
      .map((b) => hydrateBooking(db, b))
  },
  allBookings(venueId?: string) {
    const db = load()
    const clubId = activeClubId(db)
    return db.bookings
      .filter((booking) => booking.club_id === clubId && (!venueId || booking.venue_id === venueId))
      .slice()
      .sort((a, b) => +new Date(b.start_at) - +new Date(a.start_at))
      .map((b) => hydrateBooking(db, b))
  },
}
