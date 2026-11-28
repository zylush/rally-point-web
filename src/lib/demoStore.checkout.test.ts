import { beforeEach, describe, expect, it } from 'vitest'
import { CONFIRM_PAYMENT_MINUTES, checkoutState, ymdLocal } from '../types'
import { api } from './api'
import { setActiveClubId } from './clubContext'
import { demoStore, type DemoDB } from './demoStore'
import { DEMO_CLUB_ID, DEMO_DAVAO_CLUB_ID, DEMO_VENUE_ID } from './tenant'

// The demo mirror of the GCash QR checkout: hold, pay the club's QR, the club confirms or rejects.

/** Two days ahead (Philippine time), so none of its hours are over yet. */
const dayAhead = () => ymdLocal(new Date(Date.now() + 2 * 86400000))

const MEMBER = ['member@brinely.info', 'member123'] as const
const STAFF = ['staff@brinely.info', 'staff123'] as const
const ADMIN = ['admin@brinely.info', 'admin123'] as const

function signIn([email, password]: readonly [string, string]) {
  demoStore.logout()
  demoStore.login(email, password)
}

function updateDb(update: (db: DemoDB) => void) {
  const db = demoStore.get()
  update(db)
  demoStore.set(db)
}

/** Mia (mem_001) holds hours for checkout, as api.createBooking does for a player. */
function hold(startHour: number, courtId = 'court_2', date = dayAhead()) {
  return demoStore.createBooking({
    court_id: courtId, member_id: 'mem_001', dateYmd: date, startHour, hours: 1, user_id: 'user_member', checkoutHold: true,
  })
}

const slot = (courtId: string, startHour: number, date = dayAhead()) =>
  demoStore.availability(date).find((row) => row.court.id === courtId)?.slots.find((s) => s.startHour === startHour)

const stored = (id: string) => demoStore.get().bookings.find((row) => row.id === id)

/** Makes the time to pay run out, as if the player had waited too long. */
function runOutHold(id: string) {
  updateDb((db) => {
    const row = db.bookings.find((item) => item.id === id)
    if (row) row.hold_expires_at = new Date(Date.now() - 1000).toISOString()
  })
}

beforeEach(() => {
  localStorage.clear()
  setActiveClubId(null)
  demoStore.reset()
  signIn(MEMBER)
})

describe('demo GCash checkout (mirrors the member_gcash_checkout functions)', () => {
  it('shows the club’s own GCash at checkout, only for the active club', () => {
    expect(demoStore.checkoutPaymentMethods()).toEqual([
      { id: 'pay_gensan_gcash', label: 'GCash', account_name: 'Rally Point Gensan', account_number: '0917 000 0000', qr_url: null },
    ])
    setActiveClubId(DEMO_DAVAO_CLUB_ID)
    expect(demoStore.checkoutPaymentMethods()).toEqual([])
  })

  it('books the hours once the club confirms the payment the player sent', () => {
    const held = hold(15)
    expect(checkoutState(held)).toBe('holding')

    const sentAt = Date.now()
    const sent = demoStore.submitBookingPayment({ booking_id: held.id, reference: '1234567890123' })
    expect(sent).toMatchObject({ status: 'pending_payment', payment_method: 'gcash', payment_reference: '1234567890123' })
    expect(checkoutState(sent)).toBe('awaiting_confirmation')
    const confirmWithin = new Date(sent.confirm_by ?? 0).getTime() - new Date(sent.payment_submitted_at ?? 0).getTime()
    expect(confirmWithin).toBe(CONFIRM_PAYMENT_MINUTES * 60000)
    expect(new Date(sent.payment_submitted_at ?? 0).getTime()).toBeGreaterThanOrEqual(sentAt)
    expect(demoStore.myBooking(held.id)?.payment_reference).toBe('1234567890123')

    signIn(STAFF)
    const waiting = demoStore.paymentsToConfirm(DEMO_VENUE_ID)
    expect(waiting.map((row) => row.id)).toEqual([held.id])
    expect(waiting[0]).toMatchObject({ court: expect.objectContaining({ name: 'Court B' }), member: expect.objectContaining({ full_name: 'Mia Member' }) })
    expect(demoStore.myBooking(held.id)?.id).toBe(held.id)

    const chargesBefore = demoStore.get().transactions.length
    const booked = demoStore.staffConfirmBookingPayment(held.id)
    expect(booked).toMatchObject({ status: 'confirmed', payment_method: 'gcash', payment_ref: '1234567890123' })
    expect(checkoutState(booked)).toBe('booked')
    expect(slot('court_2', 15)).toMatchObject({ available: false, blocked: 'booked' })
    expect(demoStore.paymentsToConfirm(DEMO_VENUE_ID)).toEqual([])

    const db = demoStore.get()
    expect(db.transactions).toHaveLength(chargesBefore + 1)
    expect(db.transactions[0]).toMatchObject({ type: 'booking', amount: held.amount, member_id: 'mem_001', created_by: 'user_staff' })
    expect(db.transactions[0].description).toContain('1234567890123')
    expect(db.commissions.some((line) => line.transaction_id === db.transactions[0].id)).toBe(true)
    expect(db.sessions.find((session) => session.booking_id === held.id)).toMatchObject({ status: 'scheduled', created_by: 'user_staff' })
    expect(db.reminders.find((reminder) => reminder.booking_id === held.id)?.user_id).toBe('user_member')
    // The player hears about it, not the staff member who confirmed.
    expect(demoStore.notifications('user_member')[0]).toMatchObject({ title: 'Booking confirmed' })
    expect(demoStore.notifications('user_member')[0].body).toContain('1234567890123')

    expect(() => demoStore.staffConfirmBookingPayment(held.id)).toThrow('This payment was already checked.')
    expect(() => demoStore.staffRejectBookingPayment(held.id, 'Not found')).toThrow('This payment was already checked.')
  })

  it('frees the hours and tells the player why when the club rejects the payment', () => {
    const held = hold(16)
    demoStore.submitBookingPayment({ booking_id: held.id, reference: 'ABC123' })

    signIn(ADMIN)
    expect(() => demoStore.staffRejectBookingPayment(held.id, '   ')).toThrow('Say why in 1 to 200 characters')
    expect(() => demoStore.staffRejectBookingPayment(held.id, 'x'.repeat(201))).toThrow('Say why in 1 to 200 characters')
    expect(stored(held.id)?.status).toBe('pending_payment')

    const chargesBefore = demoStore.get().transactions.length
    const released = demoStore.staffRejectBookingPayment(held.id, '  No payment with that reference reached our GCash  ')
    expect(released.status).toBe('cancelled')
    expect(checkoutState(released)).toBe('released')
    expect(slot('court_2', 16)?.available).toBe(true)
    expect(demoStore.get().transactions).toHaveLength(chargesBefore)
    const notice = demoStore.notifications('user_member')[0]
    expect(notice.title).toBe('Payment not confirmed')
    expect(notice.body).toContain('No payment with that reference reached our GCash.')
    expect(demoStore.paymentsToConfirm()).toEqual([])
  })

  it('never lets a sent payment run out, and refuses to release it', () => {
    const held = hold(17)
    demoStore.submitBookingPayment({ booking_id: held.id, reference: '9876543210' })
    // The 15 minutes to pay pass, and the club is late too: the hours stay held.
    updateDb((db) => {
      const row = db.bookings.find((item) => item.id === held.id)
      if (!row) return
      row.hold_expires_at = new Date(Date.now() - 20 * 60000).toISOString()
      row.confirm_by = new Date(Date.now() - 5 * 60000).toISOString()
    })
    expect(stored(held.id)?.status).toBe('pending_payment')
    expect(slot('court_2', 17)).toMatchObject({ available: false, blocked: 'booked' })
    expect(() => hold(17)).toThrow('That slot is no longer available')

    expect(() => demoStore.releaseBookingHold(held.id)).toThrow('You already sent this payment')
    expect(stored(held.id)?.status).toBe('pending_payment')
    // Nor can the old instant payment step book it behind the club's back.
    expect(() => demoStore.confirmBookingPayment({ booking_id: held.id, method: 'gcash', user_id: 'user_member' }))
      .toThrow('You already sent this payment')

    signIn(STAFF)
    expect(demoStore.paymentsToConfirm().map((row) => row.id)).toEqual([held.id])
    expect(demoStore.staffConfirmBookingPayment(held.id).status).toBe('confirmed')
  })

  it('checks the reference number and the hold before taking a payment', () => {
    const held = hold(18)
    for (const reference of ['12345', 'GC#12345678', 'x'.repeat(31), '']) {
      expect(() => demoStore.submitBookingPayment({ booking_id: held.id, reference })).toThrow('Enter the reference number from your GCash receipt')
    }
    expect(stored(held.id)?.payment_submitted_at).toBeUndefined()
    // Spaces people type between the digits are dropped.
    expect(demoStore.submitBookingPayment({ booking_id: held.id, reference: ' 1234 567 890 ' }).payment_reference).toBe('1234567890')
    expect(() => demoStore.submitBookingPayment({ booking_id: held.id, reference: '1234567890' })).toThrow('You already sent this payment')

    // Too late: the hours were already released.
    const late = hold(19)
    runOutHold(late.id)
    expect(() => demoStore.submitBookingPayment({ booking_id: late.id, reference: '1234567890' })).toThrow('minutes to pay ran out')
    expect(stored(late.id)?.status).toBe('cancelled')

    // A desk booking is paid at the desk, and nobody can pay for someone else's hold.
    const desk = demoStore.createBooking({ court_id: 'court_2', member_id: 'mem_001', dateYmd: dayAhead(), startHour: 20, hours: 1, user_id: 'user_staff' })
    expect(() => demoStore.submitBookingPayment({ booking_id: desk.id, reference: '1234567890' })).toThrow('This booking is paid at the desk')
    const theirs = demoStore.createBooking({
      court_id: 'court_2', member_id: 'mem_002', dateYmd: dayAhead(), startHour: 21, hours: 1, user_id: 'user_staff', checkoutHold: true,
    })
    expect(() => demoStore.submitBookingPayment({ booking_id: theirs.id, reference: '1234567890' })).toThrow('Booking not found')
    expect(() => demoStore.releaseBookingHold(theirs.id)).toThrow('Booking not found')
    expect(demoStore.myBooking(theirs.id)).toBeNull()
    expect(stored(theirs.id)?.status).toBe('pending_payment')
  })

  it('keeps one unpaid checkout per player in a club: starting again gives back the previous hold', () => {
    const first = hold(9)
    const second = hold(10)
    expect(stored(first.id)?.status).toBe('cancelled')
    expect(slot('court_2', 9)?.available).toBe(true)
    expect(stored(second.id)?.status).toBe('pending_payment')
    // A sent payment is never given back.
    demoStore.submitBookingPayment({ booking_id: second.id, reference: '5555555555' })
    expect(hold(11).status).toBe('pending_payment')
    expect(stored(second.id)?.status).toBe('pending_payment')
    // Desk bookings are not online holds: they never count and are never given back.
    const desk = demoStore.createBooking({ court_id: 'court_2', member_id: 'mem_001', dateYmd: dayAhead(), startHour: 12, hours: 1, user_id: 'user_staff' })
    expect(desk.hold_expires_at).toBeUndefined()
    hold(13)
    expect(stored(desk.id)?.status).toBe('pending_payment')
  })

  it('refuses an old GCash reference, and holds from a suspended account', () => {
    const first = hold(9)
    demoStore.submitBookingPayment({ booking_id: first.id, reference: 'REUSED1234' })
    const second = hold(10)
    expect(() => demoStore.submitBookingPayment({ booking_id: second.id, reference: 'reused 1234' }))
      .toThrow('This GCash reference number was already used for another booking')

    updateDb((db) => {
      const mia = db.members.find((member) => member.id === 'mem_001')
      if (mia) mia.status = 'suspended'
    })
    expect(() => hold(15)).toThrow('Your account at this club is on hold. Ask the desk.')
  })

  it('reads a lapsed unpaid hold as released before anything sweeps it', () => {
    const held = hold(9)
    expect(checkoutState(held)).toBe('holding')
    expect(checkoutState(held, new Date(held.hold_expires_at ?? 0).getTime())).toBe('released')
  })

  it('leaves payment checks to staff of that venue and admins, and only for payments sent', () => {
    const lagao = hold(14, 'court_3')
    demoStore.submitBookingPayment({ booking_id: lagao.id, reference: 'LAGAO12345' })
    const atMain = hold(13)
    // A player cannot confirm their own payment.
    expect(() => demoStore.staffConfirmBookingPayment(lagao.id)).toThrow('staff access required')

    signIn(STAFF)
    // Sam works Gensan Main only, not Lagao.
    expect(() => demoStore.staffConfirmBookingPayment(lagao.id)).toThrow('staff access required')
    expect(() => demoStore.staffRejectBookingPayment(lagao.id, 'Not received')).toThrow('staff access required')
    expect(() => demoStore.staffConfirmBookingPayment(atMain.id)).toThrow('The player has not sent a payment for this booking yet.')
    expect(() => demoStore.staffConfirmBookingPayment('missing')).toThrow('Booking not found')

    signIn(ADMIN)
    expect(demoStore.paymentsToConfirm().map((row) => row.id)).toEqual([lagao.id])
    expect(demoStore.paymentsToConfirm(DEMO_VENUE_ID)).toEqual([])
    expect(demoStore.staffConfirmBookingPayment(lagao.id).status).toBe('confirmed')
  })

  it('lists sent payments oldest first, in the active club only', () => {
    const first = hold(6)
    demoStore.submitBookingPayment({ booking_id: first.id, reference: 'FIRST12345' })
    const second = hold(7)
    demoStore.submitBookingPayment({ booking_id: second.id, reference: 'SECOND1234' })
    updateDb((db) => {
      const a = db.bookings.find((row) => row.id === first.id)
      const b = db.bookings.find((row) => row.id === second.id)
      if (a) a.payment_submitted_at = '2099-01-01T01:00:00.000Z'
      if (b) b.payment_submitted_at = '2099-01-01T00:00:00.000Z'
    })
    signIn(ADMIN)
    setActiveClubId(DEMO_CLUB_ID)
    expect(demoStore.paymentsToConfirm().map((row) => row.id)).toEqual([second.id, first.id])
    setActiveClubId(DEMO_DAVAO_CLUB_ID)
    expect(demoStore.paymentsToConfirm()).toEqual([])
    expect(() => demoStore.staffConfirmBookingPayment(first.id)).toThrow('Booking not found')
  })

  it('runs the same flow through the api adapter in demo mode', async () => {
    const held = await api.createBooking({ court_id: 'court_2', member_id: 'mem_001', dateYmd: dayAhead(), startHour: 8, hours: 1, user_id: 'user_member' })
    expect(held.hold_expires_at).toBeTruthy()
    expect(await api.checkoutPaymentMethods()).toHaveLength(1)
    const sent = await api.submitBookingPayment({ booking_id: held.id, reference: '  0000 1111 2222\n' })
    expect(sent.payment_reference).toBe('000011112222')
    expect((await api.myBooking(held.id))?.payment_submitted_at).toBeTruthy()
    await expect(api.releaseBookingHold(held.id)).rejects.toThrow('You already sent this payment')

    signIn(STAFF)
    expect((await api.paymentsToConfirm(DEMO_VENUE_ID)).map((row) => row.id)).toEqual([held.id])
    await expect(api.rejectBookingPayment(held.id, ' ')).rejects.toThrow('Say why in 1 to 200 characters')
    expect((await api.confirmBookingPayment(held.id)).status).toBe('confirmed')

    signIn(MEMBER)
    const other = await api.createBooking({ court_id: 'court_2', member_id: 'mem_001', dateYmd: dayAhead(), startHour: 9, hours: 1, user_id: 'user_member' })
    await api.submitBookingPayment({ booking_id: other.id, reference: '3333444455' })
    signIn(STAFF)
    expect((await api.rejectBookingPayment(other.id, ' Wrong amount ')).status).toBe('cancelled')
    expect(demoStore.notifications('user_member')[0].body).toContain('Wrong amount.')
  })
})
