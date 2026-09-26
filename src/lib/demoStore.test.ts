import { beforeEach, describe, expect, it, vi } from 'vitest'
import { demoStore, type DemoDB } from './demoStore'
import type { Reminder } from '../types'

const futureDate = (days = 2) => {
  const date = new Date()
  date.setDate(date.getDate() + days)
  date.setHours(12, 0, 0, 0)
  return date
}

const ymd = (date: Date) => date.toISOString().slice(0, 10)

function resetStore() {
  localStorage.clear()
  return demoStore.reset()
}

function updateDb(update: (db: DemoDB) => void) {
  const db = demoStore.get()
  update(db)
  demoStore.set(db)
}

describe('demoStore account and catalog behavior', () => {
  beforeEach(() => resetStore())

  it('keeps seeded revenue on today when demo data is created just after midnight', () => {
    vi.useFakeTimers()
    const justAfterMidnight = new Date()
    justAfterMidnight.setHours(0, 5, 0, 0)
    vi.setSystemTime(justAfterMidnight)

    try {
      resetStore()
      expect(demoStore.stats().revenue_today).toBeGreaterThan(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('loads the seeded catalog and supports login/logout', () => {
    const db = demoStore.get()
    expect(db.profiles).toHaveLength(3)
    expect(demoStore.members()).toHaveLength(40)
    expect(demoStore.courts()).toHaveLength(4)
    expect(demoStore.users().map((user) => user.role)).toEqual(['admin', 'staff', 'member'])
    expect(demoStore.currentUser()).toBeNull()

    expect(demoStore.login(' MEMBER@RALLYPOINT.LOCAL ', 'member123').role).toBe('member')
    expect(demoStore.currentUser()?.id).toBe('user_member')
    demoStore.logout()
    expect(demoStore.currentUser()).toBeNull()
    expect(() => demoStore.login('member@rallypoint.local', 'wrong')).toThrow('Invalid email or password')
  })

  it('registers a member only and keeps credentials out of storage', () => {
    const submittedCredential = ['safe', 'passphrase'].join('-')
    const duplicateCredential = ['another', 'passphrase'].join('-')
    expect(() => demoStore.registerMember({
      email: 'new@example.com',
      password: 'short',
      full_name: 'New Player',
    })).toThrow('Password must be at least 6 characters')

    const profile = demoStore.registerMember({
      email: ' new@example.com ',
      password: submittedCredential,
      full_name: '  New Player  ',
      phone: ' 0917 000 0000 ',
    })
    expect(profile.role).toBe('member')
    expect(profile.full_name).toBe('New Player')
    expect(profile.phone).toBe('0917 000 0000')
    expect(demoStore.memberByUser(profile.id)?.member_code).toMatch(/^RP-/)
    expect(demoStore.currentUser()?.id).toBe(profile.id)
    expect(JSON.stringify(localStorage)).not.toContain(submittedCredential)
    expect(() => demoStore.registerMember({
      email: 'NEW@example.com',
      password: duplicateCredential,
      full_name: 'Duplicate',
    })).toThrow('Unable to create an account')
  })

  it('resolves tenant venues and maintains admin venue assignments', () => {
    const initial = demoStore.get()
    const mainVenue = initial.venues.find((venue) => venue.slug === 'gensan-main')!

    expect(demoStore.tenantContext().role).toBeNull()
    expect(demoStore.tenantContext('user_member').role).toBe('member')
    expect(demoStore.venues('user_staff', 'staff').map((venue) => venue.id)).toContain(mainVenue.id)
    expect(demoStore.allVenues().every((venue) => venue.club_id === initial.clubs[0].id)).toBe(true)
    expect(demoStore.chooseVenue('user_staff', 'staff', mainVenue.id)).toBe(mainVenue.id)
    expect(demoStore.chooseVenue('user_staff', 'staff', 'forged')).toBe(mainVenue.id)

    const staff = demoStore.staffAccounts()
    expect(staff.map((profile) => profile.role)).toEqual(expect.arrayContaining(['staff', 'admin']))
    expect(staff.find((profile) => profile.id === 'user_staff')?.venue_ids).toContain(mainVenue.id)

    const created = demoStore.upsertVenue({
      slug: 'demo-north',
      name: 'Demo North',
      timezone: 'Asia/Manila',
      open_hour: 7,
      close_hour: 21,
      is_active: true,
    })
    expect(created.id).toMatch(/^venue_/)

    const suppliedId = demoStore.upsertVenue({
      id: 'venue-supplied',
      slug: 'demo-supplied',
      name: 'Demo Supplied',
      timezone: 'Asia/Manila',
      open_hour: 6,
      close_hour: 22,
      is_active: true,
    })
    expect(suppliedId.id).toBe('venue-supplied')
    expect(demoStore.upsertVenue({ ...created, name: 'Demo North Updated' }).name).toBe('Demo North Updated')

    expect(demoStore.setStaffVenueGrant('user_staff', created.id, true).is_active).toBe(true)
    expect(demoStore.setStaffVenueGrant('user_staff', created.id, false).is_active).toBe(false)

    const db = demoStore.get()
    db.venues.find((venue) => venue.id === mainVenue.id)!.is_active = false
    db.sessionUserId = 'missing-user'
    demoStore.set(db)
    expect(demoStore.currentUser()).toBeNull()
    expect(demoStore.tenantContext('user_staff', 'staff').venues).not.toContainEqual(
      expect.objectContaining({ id: mainVenue.id }),
    )

  })

  it('rejects a credential whose seeded profile was removed', () => {
    const db = demoStore.get()
    db.profiles = db.profiles.filter((profile) => profile.email !== 'member@rallypoint.local')
    demoStore.set(db)
    expect(() => demoStore.login('member@rallypoint.local', 'member123')).toThrow('Invalid email or password')
  })

  it('finds and upserts members while keeping sorted catalog results', () => {
    const original = demoStore.member('mem_001')!
    expect(original.full_name).toBe('Mia Member')
    expect(demoStore.member('missing')).toBeNull()
    expect(demoStore.memberByUser('missing')).toBeNull()

    demoStore.upsertMember({ id: original.id, full_name: 'Mia Updated', membership_type: 'premium' })
    expect(demoStore.member(original.id)?.full_name).toBe('Mia Updated')

    const members = demoStore.upsertMember({
      full_name: 'Aaron New',
      membership_type: 'basic',
      email: 'aaron@example.com',
      status: 'pending',
      notes: 'Needs welcome call',
    })
    expect(members.some((member) => member.full_name === 'Aaron New')).toBe(true)
    expect(demoStore.members()[0].full_name).toBe('Aaron New')
  })

  it('calculates stats and hydrates playing sessions with fallback players', () => {
    const stats = demoStore.stats()
    expect(stats.members).toBe(40)
    expect(stats.active_now).toBeGreaterThanOrEqual(2)
    expect(stats.revenue_today).toBeGreaterThan(0)
    expect(stats.courts_occupied).toBe(2)

    updateDb((db) => {
      db.sessions.push({
        id: 'fallback-session',
        court_id: 'court_2',
        member_id: 'mem_002',
        guest_name: 'Guest Player',
        start_at: new Date().toISOString(),
        end_at: new Date(Date.now() + 3600000).toISOString(),
        status: 'scheduled',
        amount: 500,
        created_by: null,
      })
    })
    const sessions = demoStore.sessionsPlaying()
    const fallback = sessions.find((session) => session.id === 'fallback-session')!
    expect(fallback.court?.name).toBe('Court B')
    expect(fallback.member?.full_name).toBe('Jonah Cruz')
    expect(fallback.players?.map((player) => player.full_name)).toEqual(['Jonah Cruz', 'Guest Player'])
  })
})

describe('demoStore booking and payment behavior', () => {
  beforeEach(() => resetStore())

  it('reports availability and creates, confirms, lists, and cancels a booking', () => {
    const date = futureDate()
    const availability = demoStore.availability(ymd(date))
    expect(availability).toHaveLength(4)
    expect(availability.every((court) => court.slots.length === 16)).toBe(true)
    expect(availability.find((court) => court.court.id === 'court_2')?.slots.some((slot) => slot.available)).toBe(true)

    const booking = demoStore.createBooking({
      court_id: 'court_2',
      member_id: 'mem_001',
      dateYmd: ymd(date),
      startHour: 12,
      hours: 2,
      user_id: 'user_member',
    })
    expect(booking.status).toBe('pending_payment')
    expect(booking.amount).toBe(1000)
    expect(booking.court?.name).toBe('Court B')
    expect(booking.member?.full_name).toBe('Mia Member')

    const confirmed = demoStore.confirmBookingPayment({
      booking_id: booking.id,
      method: 'gcash',
      user_id: 'user_member',
    })
    expect(confirmed.status).toBe('confirmed')
    expect(confirmed.payment_ref).toMatch(/^GCASH-/)
    expect(confirmed.session_id).toBeTruthy()
    expect(demoStore.get().transactions[0].type).toBe('booking')
    expect(demoStore.notifications('user_member')[0].title).toBe('Booking confirmed')
    expect(demoStore.myBookings('mem_001')).toHaveLength(1)
    expect(demoStore.allBookings()[0].id).toBe(booking.id)
    expect(demoStore.get().reminders).toHaveLength(1)

    demoStore.cancelBooking(booking.id, 'user_member')
    expect(demoStore.get().bookings[0].status).toBe('cancelled')
    expect(demoStore.get().sessions.find((session) => session.id === confirmed.session_id)?.status).toBe('cancelled')
    expect(demoStore.notifications('user_member')[0].title).toBe('Booking cancelled')
    demoStore.cancelBooking(booking.id, 'user_member')
  })

  it('rejects invalid, occupied, and maintenance booking requests', () => {
    const date = futureDate()
    const base = {
      member_id: 'mem_001',
      dateYmd: ymd(date),
      startHour: 12,
      hours: 1,
      user_id: 'user_member',
    }
    expect(() => demoStore.createBooking({ ...base, court_id: 'missing' })).toThrow('Court not found')
    updateDb((db) => { db.courts.find((court) => court.id === 'court_2')!.status = 'maintenance' })
    expect(() => demoStore.createBooking({ ...base, court_id: 'court_2' })).toThrow('Court under maintenance')
    updateDb((db) => { db.courts.find((court) => court.id === 'court_2')!.status = 'available' })
    expect(() => demoStore.createBooking({ ...base, court_id: 'court_2', hours: 0 })).toThrow('Book 1–3 hours')
    expect(() => demoStore.createBooking({ ...base, court_id: 'court_2', hours: 4 })).toThrow('Book 1–3 hours')
    expect(() => demoStore.createBooking({ ...base, court_id: 'court_2', startHour: 21, hours: 2 })).toThrow('Outside club hours')
    expect(() => demoStore.createBooking({ ...base, court_id: 'court_2', dateYmd: ymd(new Date()) , startHour: 6 })).toThrow('That time has already passed')

    const existing = demoStore.createBooking({ ...base, court_id: 'court_2' })
    expect(() => demoStore.createBooking({ ...base, court_id: 'court_2' })).toThrow('That slot is no longer available')
    expect(() => demoStore.confirmBookingPayment({ booking_id: 'missing', method: 'card', user_id: 'user_member' })).toThrow('Booking not found')
    demoStore.confirmBookingPayment({ booking_id: existing.id, method: 'card', user_id: 'user_member' })
    expect(() => demoStore.confirmBookingPayment({ booking_id: existing.id, method: 'card', user_id: 'user_member' })).toThrow('not awaiting payment')
    expect(() => demoStore.cancelBooking('missing', 'user_member')).toThrow('Booking not found')
  })

  it('cancels a pending booking when the held slot becomes occupied', () => {
    const date = futureDate()
    const booking = demoStore.createBooking({
      court_id: 'court_2',
      member_id: 'mem_001',
      dateYmd: ymd(date),
      startHour: 12,
      hours: 1,
      user_id: 'user_member',
    })
    updateDb((db) => {
      db.sessions.push({
        id: 'blocking-session',
        court_id: 'court_2',
        member_id: null,
        start_at: booking.start_at,
        end_at: booking.end_at,
        status: 'playing',
        amount: 500,
        created_by: 'user_staff',
      })
    })
    expect(() => demoStore.confirmBookingPayment({ booking_id: booking.id, method: 'maya', user_id: 'user_member' })).toThrow('Slot taken')
    expect(demoStore.get().bookings.find((row) => row.id === booking.id)?.status).toBe('cancelled')
  })
})

describe('demoStore QR, open play, schedules, and reminders', () => {
  beforeEach(() => resetStore())

  it('ensures QR tokens and accepts code, token, and signed payload check-ins', () => {
    const member = demoStore.member('mem_001')!
    expect(demoStore.ensureMemberQr(member.id).qr_token).toBe('QR_MIA_DEMO')
    updateDb((db) => { db.members.find((row) => row.id === 'mem_002')!.qr_token = null })
    const newToken = demoStore.ensureMemberQr('mem_002').qr_token!
    expect(newToken).toBe('QR_RP1002')
    expect(demoStore.checkInByQr('RP-1001', 'user_staff').member.id).toBe('mem_001')
    expect(demoStore.checkInByQr('QR_RP1002', 'user_staff').member.id).toBe('mem_002')
    expect(demoStore.checkInByQr(`RP1|RP-1001|QR_MIA_DEMO`, 'user_staff').checkin.note).toBe('QR check-in')
    expect(demoStore.checkInByQr('RP1|RP-1001|wrong-token').member.id).toBe('mem_001')
    expect(demoStore.checkInByQr('QR_MIA_DEMO').member.id).toBe('mem_001')
    expect(() => demoStore.ensureMemberQr('missing')).toThrow('Member not found')
    expect(() => demoStore.checkInByQr('bad-code')).toThrow('QR not recognized')
    updateDb((db) => { db.members.find((row) => row.id === 'mem_003')!.qr_token = 'QR_LIZA' })
    expect(() => demoStore.checkInByQr('RP-1003')).toThrow('Membership not active')
  })

  it('creates, joins, waitlists, leaves, and promotes open-play players', () => {
    const date = futureDate()
    const op = demoStore.createOpenPlay({
      title: 'Small Mixer',
      court_id: 'court_4',
      start_at: new Date(date.getTime() + 6 * 3600000).toISOString(),
      end_at: new Date(date.getTime() + 8 * 3600000).toISOString(),
      capacity: 1,
      fee: 100,
      skill_level: 'beginner',
      notes: 'Bring a paddle',
      created_by: 'user_staff',
    })
    expect(op.court?.name).toBe('Court D')
    expect(demoStore.listOpenPlays().some((row) => row.id === op.id)).toBe(true)
    const joined = demoStore.joinOpenPlay(op.id, 'mem_001', 'user_member')
    expect(joined.signup.status).toBe('joined')
    expect(joined.session.status).toBe('full')
    expect(demoStore.get().reminders.some((reminder) => reminder.open_play_id === op.id)).toBe(true)
    expect(() => demoStore.joinOpenPlay(op.id, 'mem_001', 'user_member')).toThrow('Already signed up')
    const waitlisted = demoStore.joinOpenPlay(op.id, 'mem_002', 'user_member')
    expect(waitlisted.signup.status).toBe('waitlist')
    expect(demoStore.get().transactions.filter((tx) => tx.description === 'Open play: Small Mixer')).toHaveLength(1)
    expect(demoStore.get().reminders.filter((reminder) => reminder.open_play_id === op.id)).toHaveLength(1)
    expect(demoStore.notifications('user_member')[0].title).toBe('Waitlisted')
    demoStore.leaveOpenPlay(op.id, 'mem_001')
    expect(demoStore.get().openPlaySignups.find((signup) => signup.member_id === 'mem_002')?.status).toBe('joined')
    demoStore.leaveOpenPlay(op.id, 'unknown')
    updateDb((db) => { db.openPlays.find((row) => row.id === op.id)!.status = 'cancelled' })
    expect(() => demoStore.joinOpenPlay(op.id, 'mem_003', 'user_member')).toThrow('Session closed')
    expect(demoStore.listOpenPlays().some((row) => row.id === op.id)).toBe(false)
    expect(demoStore.listOpenPlays(true).some((row) => row.id === op.id)).toBe(true)
  })

  it('builds a schedule and processes only due reminders', () => {
    const date = futureDate()
    const start = new Date(date.getTime() + 2 * 3600000)
    updateDb((db) => {
      db.sessions.push({
        id: 'schedule-session',
        court_id: 'court_2',
        member_id: null,
        guest_name: 'Schedule Guest',
        start_at: start.toISOString(),
        end_at: new Date(start.getTime() + 3600000).toISOString(),
        status: 'playing',
        amount: 500,
        created_by: 'user_staff',
      })
      db.bookings.push({
        id: 'schedule-booking',
        court_id: 'court_4',
        member_id: 'mem_002',
        start_at: new Date(start.getTime() + 3600000).toISOString(),
        end_at: new Date(start.getTime() + 2 * 3600000).toISOString(),
        hours: 1,
        amount: 650,
        status: 'confirmed',
        session_id: null,
        created_at: new Date().toISOString(),
      })
      db.openPlays.push({
        id: 'schedule-open',
        title: 'Schedule Open Play',
        court_id: null,
        start_at: new Date(start.getTime() + 2 * 3600000).toISOString(),
        end_at: new Date(start.getTime() + 3 * 3600000).toISOString(),
        capacity: 8,
        fee: 0,
        skill_level: 'all',
        status: 'open',
        created_at: new Date().toISOString(),
      })
      const reminders: Reminder[] = [
        { id: 'due', user_id: 'user_member', kind: 'booking_reminder', title: 'Due', body: 'Due now', fire_at: new Date(Date.now() - 1000).toISOString(), sent_at: null },
        { id: 'future', user_id: 'user_member', kind: 'booking_reminder', title: 'Future', body: 'Later', fire_at: new Date(Date.now() + 86400000).toISOString(), sent_at: null },
        { id: 'sent', user_id: 'user_member', kind: 'booking_reminder', title: 'Sent', body: 'Already sent', fire_at: new Date(Date.now() - 86400000).toISOString(), sent_at: new Date().toISOString() },
      ]
      db.reminders = reminders
    })
    const blocks = demoStore.daySchedule(ymd(date))
    expect(blocks.map((block) => block.id)).toEqual(['schedule-session', 'schedule-booking', 'schedule-open'])
    expect(blocks[0].title).toBe('Schedule Guest')
    expect(blocks[2].court_name).toBe('Open floor')
    expect(demoStore.processDueReminders()).toBe(1)
    expect(demoStore.processDueReminders()).toBe(0)
    expect(demoStore.notifications('user_member')[0].title).toBe('Due')
  })
})

describe('demoStore staff and member operations', () => {
  beforeEach(() => resetStore())

  it('creates rentals, adds players, extends and ends sessions', () => {
    expect(() => demoStore.createRental({ court_id: 'missing', hours: 1 })).toThrow('Court not found')
    updateDb((db) => { db.courts.find((court) => court.id === 'court_4')!.status = 'maintenance' })
    expect(() => demoStore.createRental({ court_id: 'court_4', hours: 1 })).toThrow('Court under maintenance')
    const rental = demoStore.createRental({
      court_id: 'court_2',
      member_id: 'mem_001',
      guest_name: 'Walk-in Guest',
      hours: 2,
      created_by: 'user_staff',
    })
    expect(rental.amount).toBe(1000)
    expect(rental.players).toHaveLength(2)
    expect(demoStore.addMemberToSession(rental.id, 'mem_002', 'user_staff').players).toHaveLength(3)
    expect(demoStore.addMemberToSession(rental.id, 'mem_002').players).toHaveLength(3)
    expect(() => demoStore.addMemberToSession('missing', 'mem_001')).toThrow('Session not found')
    expect(() => demoStore.addMemberToSession(rental.id, 'missing')).toThrow('Member not found')
    const oldEnd = rental.end_at
    const extended = demoStore.extendSession(rental.id, 1, 'user_staff')
    expect(new Date(extended.end_at).getTime()).toBeGreaterThan(new Date(oldEnd).getTime())
    expect(extended.amount).toBe(1500)
    expect(() => demoStore.extendSession('missing', 1)).toThrow('Session not found')
    demoStore.endSession(rental.id)
    expect(demoStore.get().sessions.find((session) => session.id === rental.id)?.status).toBe('completed')
    expect(demoStore.courts().find((court) => court.id === 'court_2')?.status).toBe('available')
    expect(() => demoStore.endSession('missing')).toThrow('Session not found')
  })

  it('keeps a court occupied when another session is still playing', () => {
    const first = demoStore.createRental({ court_id: 'court_2', hours: 1 })
    const second = demoStore.createRental({ court_id: 'court_2', hours: 1 })
    demoStore.endSession(first.id)
    expect(demoStore.get().sessions.find((session) => session.id === second.id)?.status).toBe('playing')
    expect(demoStore.courts().find((court) => court.id === 'court_2')?.status).toBe('occupied')
  })

  it('records check-ins, walk-ins, transactions, notifications, and membership payments', () => {
    expect(() => demoStore.checkIn('missing')).toThrow('Member not found')
    const checkin = demoStore.checkIn('mem_001', 'user_staff', 'Welcome')
    expect(checkin.note).toBe('Welcome')
    expect(demoStore.recentCheckins()[0].member?.full_name).toBe('Mia Member')

    const walkIn = demoStore.createWalkIn({
      full_name: 'Walk In',
      purpose: 'Day pass',
      amount: 350,
      created_by: 'user_staff',
    })
    expect(walkIn.phone).toBeNull()
    expect(demoStore.get().walkins[0].full_name).toBe('Walk In')
    expect(demoStore.transactions('user_member', 'member').every((tx) => tx.member_id === 'mem_001')).toBe(true)
    expect(demoStore.transactions(undefined, 'admin').length).toBeGreaterThan(0)
    expect(demoStore.notifications('user_member').some((notification) => !notification.read)).toBe(true)
    const notification = demoStore.notifications('user_member')[0]
    demoStore.markNotifRead(notification.id)
    expect(demoStore.notifications('user_member').find((row) => row.id === notification.id)?.read).toBe(true)
    demoStore.markNotifRead('missing')

    const beforeExpiry = demoStore.member('mem_003')!.expiry_date
    demoStore.payMembership('mem_003', 2500, 'user_member')
    const paidMember = demoStore.member('mem_003')!
    expect(paidMember.status).toBe('active')
    expect(paidMember.expiry_date).not.toBe(beforeExpiry)
    expect(demoStore.notifications('user_member')[0].title).toBe('Payment successful')
    expect(() => demoStore.payMembership('missing', 2500, 'user_member')).toThrow('Member not found')
  })
})

describe('demoStore storage migration behavior', () => {
  it('repairs malformed legacy storage and preserves safe defaults', () => {
    localStorage.clear()
    localStorage.setItem('rally_point_demo_v3', JSON.stringify({
      profiles: [{ id: 'user_member', email: 'member@rallypoint.local', full_name: 'Mia', role: 'member', created_at: new Date().toISOString() }],
      members: [{ id: 'mem_1', member_code: 'RP-1', full_name: 'Mia', membership_type: 'basic', status: 'active', join_date: '2026-01-01', expiry_date: '2026-12-31', created_at: new Date().toISOString() }],
      courts: [],
      sessions: [],
      transactions: [],
      notifications: [],
      checkins: [],
      walkins: [],
      sessionUserId: 'user_member',
      passwords: { member: 'should-not-persist' },
    }))
    const db = demoStore.get()
    expect(db.bookings).toEqual([])
    expect(db.openPlays).toEqual([])
    expect(db.openPlaySignups).toEqual([])
    expect(db.reminders).toEqual([])
    expect(db.members[0].qr_token).toBe('QR_RP1')
    expect(db.sessionUserId).toBe('user_member')
    expect(localStorage.getItem('rally_point_demo_v3')).not.toContain('passwords')
  })
})
