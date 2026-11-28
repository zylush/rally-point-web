import type { Booking, BookingStatus, CourtDayAvailability, CourtSession, PaymentMethod } from '../../types'
import { BOOKING_HOLD_MINUTES, CONFIRM_PAYMENT_MINUTES, courtRateFor, fmtDateTime, localRangeISO, timeSlot, venueHours } from '../../types'
import { makePaymentRef } from '../payments'
import { activeClubId, clubRoleFor } from './access'
import { hydrateBooking, isSlotFree, todayISO, uid } from './common'
import { recordTransaction } from './commissions'
import type { DemoDB } from './model'
import { load, save } from './persistence'

const HOLD_RAN_OUT = `Your ${BOOKING_HOLD_MINUTES} minutes to pay ran out, so those hours were released. Pick a time again.`
const PAYMENT_SENT = 'You already sent this payment. The club is checking it, and your hours stay held until they do.'

/** Mirrors submit_booking_payment: spaces are dropped, then 6 to 30 letters or digits. */
const PAYMENT_REFERENCE = /^[A-Za-z0-9]{6,30}$/

/** The hold has run out (it may already read as cancelled: see retireLapsedHolds). A sent payment never runs out. */
function holdRanOut(b: Booking, now = Date.now()) {
  return b.hold_expires_at != null
    && !b.payment_submitted_at
    && new Date(b.hold_expires_at).getTime() <= now
    && (b.status === 'pending_payment' || b.status === 'cancelled')
}

/** The signed-in person's own booking in the active club (mirrors the auth.uid() ownership checks). */
function ownBooking(db: DemoDB, bookingId: string) {
  const clubId = activeClubId(db)
  const b = db.bookings.find((x) => x.id === bookingId && x.club_id === clubId)
  if (!b || !db.sessionUserId) return undefined
  return db.members.find((m) => m.id === b.member_id)?.user_id === db.sessionUserId ? b : undefined
}

/** Mirrors the staff checks: an admin of the booking's club, or its staff with that venue. */
function canWorkDesk(db: DemoDB, b: Booking) {
  const role = clubRoleFor(db, db.sessionUserId, b.club_id)
  if (role === 'admin') return true
  return role === 'staff' && db.staffVenueGrants.some((grant) =>
    grant.club_id === b.club_id && grant.user_id === db.sessionUserId && grant.venue_id === b.venue_id && grant.is_active)
}

/** A payment the player has sent and the club has not yet decided on, for a staff member who may decide. */
function sentPayment(db: DemoDB, bookingId: string) {
  const clubId = activeClubId(db)
  const b = db.bookings.find((x) => x.id === bookingId && x.club_id === clubId)
  if (!b) throw new Error('Booking not found')
  if (!canWorkDesk(db, b)) throw new Error('staff access required')
  if (b.status !== 'pending_payment') throw new Error('This payment was already checked.')
  if (!b.payment_submitted_at) throw new Error('The player has not sent a payment for this booking yet.')
  return b
}

function playerUserId(db: DemoDB, b: Booking) {
  return db.members.find((m) => m.id === b.member_id)?.user_id ?? null
}

/**
 * Books the hours for good: a scheduled session, the recorded charge (with its commission),
 * the player's notice and a reminder an hour before. Payments are not collected in the demo.
 */
function bookForGood(db: DemoDB, b: Booking, payment: { method: PaymentMethod; ref: string; actorId: string | null; notifyUserId: string | null }) {
  const court = db.courts.find((c) => c.id === b.court_id)
  const { method, ref, actorId, notifyUserId } = payment
  b.status = 'confirmed'
  b.payment_method = method
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
    created_by: actorId,
    booking_id: b.id,
    notes: `Online booking · ${method} · ${ref}`,
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
    description: `${court?.name ?? 'Court'} booking · ${method.toUpperCase()} · ${ref}`,
    created_at: todayISO(),
    created_by: actorId,
  }, 'first')
  if (!notifyUserId) return
  db.notifications.unshift({
    id: uid('n'),
    club_id: b.club_id,
    venue_id: b.venue_id ?? null,
    user_id: notifyUserId,
    title: 'Booking confirmed',
    body: `${court?.name ?? 'Court'} · ${fmtDateTime(b.start_at)} · Ref ${ref}. Show at desk.`,
    read: false,
    created_at: todayISO(),
  })
  // 1h before start reminder
  const fire = new Date(new Date(b.start_at).getTime() - 60 * 60000)
  db.reminders.push({
    id: uid('rm'),
    club_id: b.club_id,
    venue_id: b.venue_id ?? null,
    user_id: notifyUserId,
    kind: 'booking_reminder',
    title: 'Court in 1 hour',
    body: `${court?.name ?? 'Court'} starts soon. Don't be late!`,
    fire_at: fire.toISOString(),
    sent_at: null,
    booking_id: b.id,
  })
}

export const bookingOperations = {
  availability(dateYmd: string, venueId?: string, clubIdOverride?: string): CourtDayAvailability[] {
    const db = load()
    const clubId = clubIdOverride ?? activeClubId(db)
    const now = new Date()
    return db.courts.filter((court) => court.club_id === clubId && (!venueId || court.venue_id === venueId)).map((court) => {
      const slots = []
      // Only the hours the court's venue is open.
      const { open, close } = venueHours(db.venues.find((venue) => venue.id === court.venue_id))
      for (let h = open; h < close; h++) {
        const { start_at, end_at } = localRangeISO(dateYmd, h, 1)
        slots.push(timeSlot(h, {
          booked: !isSlotFree(db, { courtId: court.id, start_at, end_at }),
          outOfService: court.status === 'maintenance',
          passed: new Date(start_at).getTime() < now.getTime() - 5 * 60000,
        }))
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
    /** An online checkout: the hours are held for BOOKING_HOLD_MINUTES, then released if unpaid. */
    checkoutHold?: boolean
  }): Booking {
    const db = load()
    const clubId = activeClubId(db)
    const court = db.courts.find((c) => c.id === opts.court_id && c.club_id === clubId)
    if (!court) throw new Error('Court not found')
    if (opts.venue_id && court.venue_id !== opts.venue_id) throw new Error('Court is outside the selected venue')
    if (court.status === 'maintenance') throw new Error('Court under maintenance')
    // No maximum length (owner, 2026-11-24): whole hours in a row, at least 1, inside the club's hours.
    if (!Number.isInteger(opts.hours) || opts.hours < 1) throw new Error('Pick at least 1 hour')
    const { open, close } = venueHours(db.venues.find((venue) => venue.id === court.venue_id))
    if (opts.startHour < open || opts.startHour + opts.hours > close) throw new Error('Outside club hours')
    const member = db.members.find((m) => m.id === opts.member_id)
    if (member && member.club_id !== court.club_id) throw new Error('Member belongs to another club')

    const { start_at, end_at } = localRangeISO(opts.dateYmd, opts.startHour, opts.hours)
    if (new Date(start_at).getTime() < Date.now() - 5 * 60000) {
      throw new Error('That time has already passed')
    }
    if (opts.checkoutHold && member?.status === 'suspended') {
      throw new Error('Your account at this club is on hold. Ask the desk.')
    }
    // Mirrors hold_court_booking: one unpaid checkout per player per club, so starting again
    // (after leaving checkout or a refresh) gives back the previous hold. A sent payment and
    // desk bookings (no hold_expires_at) are never touched.
    if (opts.checkoutHold) {
      for (const row of db.bookings) {
        if (row.club_id === court.club_id && row.member_id === opts.member_id && row.status === 'pending_payment'
          && row.hold_expires_at != null && !row.payment_submitted_at) row.status = 'cancelled'
      }
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
      ...(opts.checkoutHold ? { hold_expires_at: new Date(Date.now() + BOOKING_HOLD_MINUTES * 60000).toISOString() } : {}),
    }
    db.bookings.unshift(booking)
    save(db)
    return hydrateBooking(db, booking)
  },
  /**
   * Confirms a booking at once, as if paid. No screen calls this any more (players pay the
   * club's GCash QR and the club confirms it); demo tests use it to set up booked hours.
   */
  confirmBookingPayment(opts: { booking_id: string; method: PaymentMethod; user_id: string }): Booking {
    const db = load()
    const clubId = activeClubId(db)
    const b = db.bookings.find((x) => x.id === opts.booking_id && x.club_id === clubId)
    if (!b) throw new Error('Booking not found')
    if (b.status === 'pending_payment' && b.payment_submitted_at) throw new Error(PAYMENT_SENT)
    // A lapsed hold may already read as cancelled (see retireLapsedHolds); say why either way.
    if (holdRanOut(b)) {
      if (b.status === 'pending_payment') {
        b.status = 'cancelled'
        save(db)
      }
      throw new Error(HOLD_RAN_OUT)
    }
    if (b.status !== 'pending_payment') throw new Error('Booking is not awaiting payment')
    if (!isSlotFree(db, { courtId: b.court_id, start_at: b.start_at, end_at: b.end_at, ignoreBookingId: b.id })) {
      b.status = 'cancelled'
      save(db)
      throw new Error('Slot taken — booking cancelled. Pick another time.')
    }

    bookForGood(db, b, { method: opts.method, ref: makePaymentRef(opts.method), actorId: opts.user_id, notifyUserId: opts.user_id })
    save(db)
    return hydrateBooking(db, b)
  },
  /**
   * Mirrors submit_booking_payment: the player says they paid the club's GCash QR and gives
   * the reference number. From then the hold no longer runs out; the club has
   * CONFIRM_PAYMENT_MINUTES to check it.
   */
  submitBookingPayment(opts: { booking_id: string; reference: string }): Booking {
    const db = load()
    const b = ownBooking(db, opts.booking_id)
    if (!b) throw new Error('Booking not found')
    if (b.payment_submitted_at) {
      throw new Error(b.status === 'pending_payment' ? PAYMENT_SENT : 'This booking is not waiting for payment')
    }
    if (!b.hold_expires_at) throw new Error('This booking is paid at the desk')
    if (holdRanOut(b)) {
      if (b.status === 'pending_payment') {
        b.status = 'cancelled'
        save(db)
      }
      throw new Error(HOLD_RAN_OUT)
    }
    if (b.status !== 'pending_payment') throw new Error('This booking is not waiting for payment')
    const reference = opts.reference.replace(/\s+/g, '')
    if (!PAYMENT_REFERENCE.test(reference)) {
      throw new Error('Enter the reference number from your GCash receipt: 6 to 30 letters or numbers.')
    }
    // Mirrors bookings_club_payment_reference_key: an old receipt cannot pay for a second booking.
    if (db.bookings.some((row) => row.club_id === b.club_id && row.id !== b.id && row.status !== 'cancelled'
      && row.payment_reference?.toUpperCase() === reference.toUpperCase())) {
      throw new Error('This GCash reference number was already used for another booking')
    }
    const now = Date.now()
    b.payment_reference = reference
    b.payment_submitted_at = new Date(now).toISOString()
    b.confirm_by = new Date(now + CONFIRM_PAYMENT_MINUTES * 60000).toISOString()
    b.payment_method = 'gcash'
    save(db)
    return hydrateBooking(db, b)
  },
  /** Mirrors release_booking_hold: the player lets go of an unpaid checkout's hours (Back, or time ran out). */
  releaseBookingHold(bookingId: string) {
    const db = load()
    const b = ownBooking(db, bookingId)
    if (!b) throw new Error('Booking not found')
    // Desk bookings, and bookings already confirmed or released, are left as they are.
    if (b.status !== 'pending_payment' || !b.hold_expires_at) return
    // A payment the player has sent is never let go: the club confirms or rejects it.
    if (b.payment_submitted_at) throw new Error(PAYMENT_SENT)
    b.status = 'cancelled'
    save(db)
  },
  /** One booking, for checking on a checkout: the player's own, or one at a venue this staff member works. */
  myBooking(bookingId: string): Booking | null {
    const db = load()
    const clubId = activeClubId(db)
    const b = db.bookings.find((x) => x.id === bookingId && x.club_id === clubId)
    if (!b) return null
    return ownBooking(db, bookingId) || canWorkDesk(db, b) ? hydrateBooking(db, b) : null
  },
  /** Payments players have sent that the club has not checked yet, oldest first. */
  paymentsToConfirm(venueId?: string): Booking[] {
    const db = load()
    const clubId = activeClubId(db)
    return db.bookings
      .filter((b) => b.club_id === clubId && b.status === 'pending_payment' && !!b.payment_submitted_at
        && (!venueId || b.venue_id === venueId))
      .sort((a, b) => (a.payment_submitted_at ?? '').localeCompare(b.payment_submitted_at ?? ''))
      .map((b) => hydrateBooking(db, b))
  },
  /** Mirrors staff_confirm_booking_payment: the club found the player's GCash payment, so the hours are booked. */
  staffConfirmBookingPayment(bookingId: string): Booking {
    const db = load()
    const b = sentPayment(db, bookingId)
    if (!isSlotFree(db, { courtId: b.court_id, start_at: b.start_at, end_at: b.end_at, ignoreBookingId: b.id })) {
      throw new Error('Another booking has those hours now. Talk to the player before you confirm or reject this payment.')
    }
    bookForGood(db, b, {
      method: b.payment_method ?? 'gcash',
      ref: b.payment_reference ?? makePaymentRef('gcash'),
      actorId: db.sessionUserId,
      notifyUserId: playerUserId(db, b),
    })
    save(db)
    return hydrateBooking(db, b)
  },
  /** Mirrors staff_reject_booking_payment: the club could not find the payment, so the hours are released. */
  staffRejectBookingPayment(bookingId: string, reason: string): Booking {
    const db = load()
    const b = sentPayment(db, bookingId)
    const why = reason.trim()
    if (why.length < 1 || why.length > 200) throw new Error('Say why in 1 to 200 characters, so the player knows what to do.')
    b.status = 'cancelled'
    const userId = playerUserId(db, b)
    if (userId) {
      const court = db.courts.find((c) => c.id === b.court_id)
      db.notifications.unshift({
        id: uid('n'),
        club_id: b.club_id,
        venue_id: b.venue_id ?? null,
        user_id: userId,
        title: 'Payment not confirmed',
        body: `${court?.name ?? 'Court'} · ${fmtDateTime(b.start_at)}. The club says: ${why}. Those hours were released.`,
        read: false,
        created_at: todayISO(),
      })
    }
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
