import { beforeEach, describe, expect, it, vi } from 'vitest'
import { demoStore } from './demoStore'
import { api } from './api'

const futureDate = () => {
  const date = new Date()
  date.setDate(date.getDate() + 2)
  date.setHours(12, 0, 0, 0)
  return date
}

describe('api demo adapter', () => {
  beforeEach(() => {
    localStorage.clear()
    demoStore.reset()
  })

  it('delegates catalog, dashboard, member, and booking reads to demo storage', async () => {
    const date = futureDate()
    expect((await api.stats()).members).toBe(40)
    expect((await api.listMembers())).toHaveLength(40)
    expect((await api.getMember('mem_001'))?.full_name).toBe('Mia Member')
    expect(await api.getMember('missing')).toBeNull()
    expect((await api.memberForUser('user_member'))?.id).toBe('mem_001')
    expect((await api.memberForUser('missing'))).toBeNull()
    await api.saveMember({ full_name: 'API Member', membership_type: 'basic' })
    await api.saveMember({ id: 'mem_001', full_name: 'Mia API', membership_type: 'premium' })
    expect((await api.listCourts())).toHaveLength(4)
    expect((await api.playingSessions()).length).toBeGreaterThan(0)
    expect((await api.availability(date.toISOString().slice(0, 10))).length).toBe(4)

    const booking = await api.createBooking({
      court_id: 'court_2', member_id: 'mem_001', dateYmd: date.toISOString().slice(0, 10), startHour: 12, hours: 1, user_id: 'user_member',
    })
    expect(booking.status).toBe('pending_payment')
    expect((await api.myBookings('mem_001')).length).toBe(1)
    expect((await api.listBookings()).length).toBe(1)
    expect(api.paymentMethods()).toHaveLength(3)
  })

  it('delegates payment, court ops, check-ins, messages, and members', async () => {
    vi.useFakeTimers()
    try {
      const date = futureDate()
      const booking = await api.createBooking({
        court_id: 'court_2', member_id: 'mem_001', dateYmd: date.toISOString().slice(0, 10), startHour: 12, hours: 1, user_id: 'user_member',
      })
      const paidPromise = api.payBooking({ booking_id: booking.id, method: 'gcash', user_id: 'user_member' })
      await vi.advanceTimersByTimeAsync(900)
      expect((await paidPromise).status).toBe('confirmed')

      const rental = await api.createRental({ court_id: 'court_4', guest_name: 'API Guest', hours: 1, created_by: 'user_staff' })
      expect(rental.status).toBe('playing')
      expect((await api.addMemberToSession(rental.id, 'mem_002', 'user_staff')).member?.id).toBe('mem_002')
      await api.extendSession(rental.id, 1, 'user_staff')
      await api.endSession(rental.id)
      expect((await api.checkIn('mem_001', 'user_staff', 'API check-in')).member_id).toBe('mem_001')
      expect((await api.recentCheckins()).length).toBeGreaterThan(0)
      expect((await api.transactions('user_member', 'member')).every((tx) => tx.member_id === 'mem_001')).toBe(true)
      expect((await api.notifications('user_member')).length).toBeGreaterThan(0)
      await api.markNotifRead((await api.notifications('user_member'))[0].id)
      expect((await api.createWalkIn({ full_name: 'API Walk-in', purpose: 'Day pass', amount: 350 })).full_name).toBe('API Walk-in')
      expect((await api.users()).length).toBeGreaterThan(2)
      await api.payMembership('mem_001', 2500, 'user_member')
    } finally {
      vi.useRealTimers()
    }
  })

  it('delegates open play, schedules, reminders, and QR workflows', async () => {
    const openPlays = await api.listOpenPlays()
    expect(openPlays).toHaveLength(2)
    const date = futureDate()
    const created = await api.createOpenPlay({
      title: 'API Mixer', court_id: 'court_4', start_at: date.toISOString(), end_at: new Date(date.getTime() + 3600000).toISOString(), capacity: 4, fee: 0, skill_level: 'all', created_by: 'user_staff',
    })
    expect((await api.joinOpenPlay(created.id, 'mem_001', 'user_member')).signup.status).toBe('joined')
    await api.leaveOpenPlay(created.id, 'mem_001')
    expect((await api.daySchedule(date.toISOString().slice(0, 10))).some((block) => block.id === created.id)).toBe(true)
    expect(await api.processDueReminders()).toBeGreaterThanOrEqual(0)
    expect((await api.ensureMemberQr('mem_001')).qr_token).toBeTruthy()
    expect((await api.checkInByQr('RP-1001', 'user_staff')).member.id).toBe('mem_001')
  })
})
