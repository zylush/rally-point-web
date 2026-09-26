import type { CheckIn, Court, CourtSession, Member, MembershipType, Notification, OpenPlaySession, OpenPlaySignup, Profile, Reminder, Transaction } from '../../types'
import { daysFromNow, todayISO } from './common'
import type { DemoDB } from './model'
import { DEMO_CLUB_ID, DEMO_VENUE_ID, demoClub } from '../tenant'

export function seed(): DemoDB {
  const adminId = 'user_admin'
  const staffId = 'user_staff'
  const memberUserId = 'user_member'

  const profiles: Profile[] = [
    {
      id: adminId,
      email: 'admin@rallypoint.local',
      full_name: 'Alex Admin',
      role: 'admin',
      phone: '+63 917 000 0001',
      created_at: todayISO(),
    },
    {
      id: staffId,
      email: 'staff@rallypoint.local',
      full_name: 'Sam Staff',
      role: 'staff',
      phone: '+63 917 000 0002',
      created_at: todayISO(),
    },
    {
      id: memberUserId,
      email: 'member@rallypoint.local',
      full_name: 'Mia Member',
      role: 'member',
      phone: '+63 917 555 0101',
      created_at: todayISO(),
    },
  ]

  const members: Member[] = [
    {
      id: 'mem_001',
      user_id: memberUserId,
      member_code: 'RP-1001',
      full_name: 'Mia Member',
      email: 'member@rallypoint.local',
      phone: '+63 917 555 0101',
      membership_type: 'premium',
      status: 'active',
      join_date: daysFromNow(-120),
      expiry_date: daysFromNow(45),
      qr_token: 'QR_MIA_DEMO',
      created_at: todayISO(),
    },
    {
      id: 'mem_002',
      user_id: null,
      member_code: 'RP-1002',
      full_name: 'Jonah Cruz',
      email: 'jonah@email.com',
      phone: '+63 918 222 3344',
      membership_type: 'standard',
      status: 'active',
      join_date: daysFromNow(-40),
      expiry_date: daysFromNow(20),
      created_at: todayISO(),
    },
    {
      id: 'mem_003',
      user_id: null,
      member_code: 'RP-1003',
      full_name: 'Liza Santos',
      email: 'liza@email.com',
      phone: '+63 919 888 1212',
      membership_type: 'basic',
      status: 'expired',
      join_date: daysFromNow(-400),
      expiry_date: daysFromNow(-10),
      created_at: todayISO(),
    },
  ]

  // pad to ~40 for admin stats like Figma
  for (let i = 4; i <= 40; i++) {
    members.push({
      id: `mem_${String(i).padStart(3, '0')}`,
      user_id: null,
      member_code: `RP-${1000 + i}`,
      full_name: `Member ${i}`,
      email: `member${i}@email.com`,
      phone: `+63 900 000 ${String(i).padStart(4, '0')}`,
      membership_type: (['basic', 'standard', 'premium'] as MembershipType[])[i % 3],
      status: i % 9 === 0 ? 'expired' : 'active',
      join_date: daysFromNow(-30 - i),
      expiry_date: daysFromNow(60 - (i % 20)),
      created_at: todayISO(),
    })
  }

  const courts: Court[] = [
    { id: 'court_1', name: 'Court A', status: 'occupied', hourly_rate: 500 },
    { id: 'court_2', name: 'Court B', status: 'available', hourly_rate: 500 },
    { id: 'court_3', name: 'Court C', status: 'occupied', hourly_rate: 650 },
    { id: 'court_4', name: 'Court D', status: 'available', hourly_rate: 650 },
  ]

  const now = Date.now()
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)
  const seededTransactionTime = (ageMs: number) =>
    new Date(Math.max(now - ageMs, todayStart.getTime())).toISOString()
  const sessions: CourtSession[] = [
    {
      id: 'ses_1',
      court_id: 'court_1',
      member_id: 'mem_001',
      players: [
        { id: 'mem_001', full_name: 'Mia Member', member_id: 'mem_001' },
        { id: 'guest_1', full_name: 'Ava Guest', guest_name: 'Ava Guest' },
      ],
      start_at: new Date(now - 40 * 60000).toISOString(),
      end_at: new Date(now + 20 * 60000).toISOString(),
      status: 'playing',
      amount: 500,
      created_by: staffId,
    },
    {
      id: 'ses_2',
      court_id: 'court_3',
      member_id: 'mem_002',
      players: [{ id: 'mem_002', full_name: 'Jonah Cruz', member_id: 'mem_002' }],
      start_at: new Date(now - 15 * 60000).toISOString(),
      end_at: new Date(now + 45 * 60000).toISOString(),
      status: 'playing',
      amount: 650,
      created_by: staffId,
    },
  ]

  const checkins: CheckIn[] = [
    {
      id: 'ci_1',
      member_id: 'mem_001',
      checked_in_at: new Date(now - 50 * 60000).toISOString(),
      staff_id: staffId,
    },
    {
      id: 'ci_2',
      member_id: 'mem_002',
      checked_in_at: new Date(now - 20 * 60000).toISOString(),
      staff_id: staffId,
    },
  ]

  const transactions: Transaction[] = [
    {
      id: 'tx_1',
      member_id: 'mem_001',
      amount: 2500,
      type: 'membership',
      description: 'Premium membership renewal',
      created_at: seededTransactionTime(2 * 3600000),
      created_by: adminId,
    },
    {
      id: 'tx_2',
      member_id: 'mem_002',
      amount: 500,
      type: 'court_rental',
      description: 'Court A — 1 hour',
      created_at: seededTransactionTime(90 * 60000),
      created_by: staffId,
    },
    {
      id: 'tx_3',
      member_id: null,
      amount: 350,
      type: 'walk_in',
      description: 'Walk-in day pass',
      created_at: seededTransactionTime(30 * 60000),
      created_by: staffId,
    },
    {
      id: 'tx_4',
      member_id: 'mem_001',
      amount: 500,
      type: 'extension',
      description: 'Extend Court A +1 hour',
      created_at: seededTransactionTime(10 * 60000),
      created_by: staffId,
    },
  ]

  // bulk today revenue to ~20040 like Figma
  let sum = transactions.reduce((a, t) => a + t.amount, 0)
  let k = 5
  while (sum < 20040) {
    const add = Math.min(800, 20040 - sum)
    transactions.push({
      id: `tx_${k++}`,
      member_id: members[k % members.length].id,
      amount: add,
      type: k % 2 === 0 ? 'court_rental' : 'membership',
      description: k % 2 === 0 ? 'Court rental' : 'Membership fee',
      created_at: seededTransactionTime(k * 600000),
      created_by: adminId,
    })
    sum += add
  }

  const notifications: Notification[] = [
    {
      id: 'n1',
      user_id: memberUserId,
      title: 'Court booking confirmed',
      body: 'Court A is ready. Enjoy your game!',
      read: false,
      created_at: new Date(now - 3600000).toISOString(),
    },
    {
      id: 'n2',
      user_id: memberUserId,
      title: 'Membership reminder',
      body: 'Your premium plan expires in 45 days.',
      read: false,
      created_at: new Date(now - 86400000).toISOString(),
    },
    {
      id: 'n3',
      user_id: memberUserId,
      title: 'Payment received',
      body: 'We received Php 2,500.00 for your renewal.',
      read: true,
      created_at: new Date(now - 2 * 86400000).toISOString(),
    },
  ]


  const later = new Date()
  later.setHours(later.getHours() + 3, 0, 0, 0)
  const laterEnd = new Date(later.getTime() + 2 * 3600000)
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(18, 0, 0, 0)
  const tomorrowEnd = new Date(tomorrow.getTime() + 2 * 3600000)
  const openPlays: OpenPlaySession[] = [
    {
      id: 'op_1',
      title: 'Evening Open Play',
      court_id: 'court_2',
      start_at: later.toISOString(),
      end_at: laterEnd.toISOString(),
      capacity: 8,
      fee: 250,
      skill_level: 'all',
      status: 'open',
      notes: 'Bring your own paddle',
      created_by: staffId,
      created_at: todayISO(),
    },
    {
      id: 'op_2',
      title: 'Beginner Mixer',
      court_id: 'court_4',
      start_at: tomorrow.toISOString(),
      end_at: tomorrowEnd.toISOString(),
      capacity: 12,
      fee: 200,
      skill_level: 'beginner',
      status: 'open',
      notes: null,
      created_by: adminId,
      created_at: todayISO(),
    },
  ]
  const openPlaySignups: OpenPlaySignup[] = []
  const reminders: Reminder[] = []

  const club_id = DEMO_CLUB_ID
  const mainVenue = {
    id: DEMO_VENUE_ID,
    club_id,
    slug: 'gensan-main',
    name: 'Rally Point Gensan',
    timezone: 'Asia/Manila',
    open_hour: 6,
    close_hour: 22,
    is_active: true,
  }
  const secondVenue = {
    id: 'venue_lagao',
    club_id,
    slug: 'lagao',
    name: 'Rally Point Lagao',
    timezone: 'Asia/Manila',
    open_hour: 6,
    close_hour: 22,
    is_active: true,
  }

  return {
    clubs: [demoClub],
    venues: [mainVenue, secondVenue],
    staffVenueGrants: [{ club_id, user_id: staffId, venue_id: DEMO_VENUE_ID, granted_by: adminId, is_active: true }],
    profiles,
    members: members.map((member) => ({ ...member, club_id })),
    courts: courts.map((court, index) => ({
      ...court,
      club_id,
      venue_id: index < 2 ? DEMO_VENUE_ID : secondVenue.id,
    })),
    sessions: sessions.map((session) => ({
      ...session,
      club_id,
      venue_id: session.court_id === 'court_3' ? secondVenue.id : DEMO_VENUE_ID,
    })),
    bookings: [],
    openPlays: openPlays.map((openPlay) => ({ ...openPlay, club_id, venue_id: openPlay.court_id === 'court_4' ? secondVenue.id : DEMO_VENUE_ID })),
    openPlaySignups,
    reminders: reminders.map((reminder) => ({ ...reminder, club_id })),
    checkins: checkins.map((checkin) => ({ ...checkin, club_id, venue_id: checkin.member_id === 'mem_002' ? secondVenue.id : DEMO_VENUE_ID })),
    transactions: transactions.map((transaction) => ({
      ...transaction,
      club_id,
      venue_id: transaction.type === 'membership' ? null : DEMO_VENUE_ID,
      verification_status: 'unverified' as const,
    })),
    notifications: notifications.map((notification) => ({ ...notification, club_id })),
    walkins: [],
    sessionUserId: null,
  }
}
