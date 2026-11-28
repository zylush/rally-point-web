import type {
  CheckIn, ClubAccount, ClubCoach, ClubStaffRole, CoachBookingSlot, Court, CourtSession, Member, MembershipType,
  Notification, OpenPlaySession, OpenPlaySignup, Profile, Reminder, Transaction,
} from '../../types'
import { ymdLocal } from '../../types'
import { daysFromNow, todayISO } from './common'
import { recordCommission } from './commissions'
import type { DemoClubMatch, DemoDB, DemoLeaderboardScorer, DemoTournament, DemoTournamentMatch, DemoTournamentPlayer, DemoTournamentScorer, DemoTournamentTeam } from './model'
import { DEMO_CLUB_ID, DEMO_DAVAO_CLUB_ID, DEMO_DAVAO_VENUE_ID, DEMO_VENUE_ID, demoClub, demoDavaoClub } from '../tenant'

export function seed(): DemoDB {
  const superadminId = 'user_superadmin'
  const adminId = 'user_admin'
  const staffId = 'user_staff'
  const memberUserId = 'user_member'
  const davaoAdminId = 'user_davao_admin'

  // Profiles are identity only. Authority comes from clubRoles, members and platformRoles.
  const profiles: Profile[] = [
    {
      id: superadminId,
      email: 'superadmin@brinely.info',
      full_name: 'Morgan Superadmin',
      role: 'superadmin',
      created_at: todayISO(),
    },
    {
      id: adminId,
      email: 'admin@brinely.info',
      full_name: 'Alex Admin',
      role: 'admin',
      phone: '+63 917 000 0001',
      created_at: todayISO(),
    },
    {
      id: staffId,
      email: 'staff@brinely.info',
      full_name: 'Sam Staff',
      role: 'staff',
      phone: '+63 917 000 0002',
      created_at: todayISO(),
    },
    {
      id: memberUserId,
      email: 'member@brinely.info',
      full_name: 'Mia Member',
      role: 'member',
      phone: '+63 917 555 0101',
      created_at: todayISO(),
    },
    {
      id: davaoAdminId,
      email: 'davao.admin@brinely.info',
      full_name: 'Dana Davao',
      role: 'admin',
      phone: '+63 917 000 0003',
      created_at: todayISO(),
    },
  ]

  const members: Member[] = [
    {
      id: 'mem_001',
      user_id: memberUserId,
      member_code: 'RP-1001',
      full_name: 'Mia Member',
      email: 'member@brinely.info',
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

  const namedPlayers = ['Marco Reyes', 'Kyla Tan', 'Paolo Lim', 'Tricia Gomez', 'Carlo Dela Cruz']
  // pad to ~40 for admin stats like Figma
  for (let i = 4; i <= 40; i++) {
    members.push({
      id: `mem_${String(i).padStart(3, '0')}`,
      user_id: null,
      member_code: `RP-${1000 + i}`,
      full_name: namedPlayers[i - 4] ?? `Member ${i}`,
      email: `member${i}@email.com`,
      phone: `+63 900 000 ${String(i).padStart(4, '0')}`,
      membership_type: (['basic', 'standard', 'premium'] as MembershipType[])[i % 3],
      status: i % 9 === 0 ? 'expired' : 'active',
      // Spread over the last six months so the owner dashboard shows sign-ups over time.
      join_date: daysFromNow(-(2 + ((i * 47) % 170))),
      expiry_date: daysFromNow(60 - (i % 20)),
      created_at: todayISO(),
    })
  }

  // Courts A and B (Rally Point Gensan) are indoor; C and D (Lagao) are outdoor.
  const courts: Court[] = [
    { id: 'court_1', name: 'Court A', status: 'occupied', hourly_rate: 500, court_type: 'indoor' },
    { id: 'court_2', name: 'Court B', status: 'available', hourly_rate: 500, court_type: 'indoor' },
    { id: 'court_3', name: 'Court C', status: 'occupied', hourly_rate: 650, member_rate: 550, court_type: 'outdoor' },
    { id: 'court_4', name: 'Court D', status: 'available', hourly_rate: 650, member_rate: 550, court_type: 'outdoor' },
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
    open_hour: 0,
    close_hour: 24,
    is_active: true,
    // Sample location for the demo, not a real address.
    address: 'Sample address, City Heights',
    city: 'General Santos City',
    latitude: 6.1164,
    longitude: 125.1716,
  }
  const secondVenue = {
    id: 'venue_lagao',
    club_id,
    slug: 'lagao',
    name: 'Rally Point Lagao',
    timezone: 'Asia/Manila',
    open_hour: 0,
    close_hour: 24,
    is_active: true,
    address: 'Sample address, Lagao',
    city: 'General Santos City',
    latitude: 6.134,
    longitude: 125.183,
  }

  // A second, independent club with its own venue, courts, admin and members.
  const davaoVenue = {
    id: DEMO_DAVAO_VENUE_ID,
    club_id: DEMO_DAVAO_CLUB_ID,
    slug: 'davao-main',
    name: 'Rally Point Davao',
    timezone: 'Asia/Manila',
    open_hour: 0,
    close_hour: 24,
    is_active: true,
    address: 'Sample address, Lanang',
    city: 'Davao City',
    latitude: 7.103,
    longitude: 125.631,
  }
  // Davao Court 2 is left "not set", as every court starts before its admin picks.
  const davaoCourts: Court[] = [
    { id: 'court_davao_1', club_id: DEMO_DAVAO_CLUB_ID, venue_id: DEMO_DAVAO_VENUE_ID, name: 'Davao Court 1', status: 'available', hourly_rate: 450, member_rate: 400, court_type: 'indoor' },
    { id: 'court_davao_2', club_id: DEMO_DAVAO_CLUB_ID, venue_id: DEMO_DAVAO_VENUE_ID, name: 'Davao Court 2', status: 'available', hourly_rate: 450, member_rate: 400, court_type: null },
  ]
  // Mia belongs to both clubs: each membership is owned by its club and has its own code.
  const davaoMembers: Member[] = [
    {
      id: 'mem_davao_001',
      club_id: DEMO_DAVAO_CLUB_ID,
      user_id: memberUserId,
      member_code: 'DV-1001',
      full_name: 'Mia Member',
      email: 'member@brinely.info',
      phone: '+63 917 555 0101',
      membership_type: 'standard',
      status: 'active',
      join_date: daysFromNow(-14),
      expiry_date: daysFromNow(16),
      qr_token: 'QR_MIA_DAVAO',
      created_at: todayISO(),
    },
    {
      id: 'mem_davao_002',
      club_id: DEMO_DAVAO_CLUB_ID,
      user_id: null,
      member_code: 'DV-1002',
      full_name: 'Rico Dela Cruz',
      email: 'rico@email.com',
      phone: '+63 917 333 1001',
      membership_type: 'premium',
      status: 'active',
      join_date: daysFromNow(-60),
      expiry_date: daysFromNow(30),
      created_at: todayISO(),
    },
    {
      id: 'mem_davao_003',
      club_id: DEMO_DAVAO_CLUB_ID,
      user_id: null,
      member_code: 'DV-1003',
      full_name: 'Ana Reyes',
      email: 'ana@email.com',
      phone: '+63 917 333 1002',
      membership_type: 'basic',
      status: 'active',
      join_date: daysFromNow(-20),
      expiry_date: daysFromNow(10),
      created_at: todayISO(),
    },
  ]
  const davaoTransactions: Transaction[] = [
    {
      id: 'tx_davao_1',
      club_id: DEMO_DAVAO_CLUB_ID,
      venue_id: DEMO_DAVAO_VENUE_ID,
      verification_status: 'unverified',
      member_id: 'mem_davao_002',
      amount: 900,
      type: 'court_rental',
      description: 'Davao Court 1 — 2 hours',
      created_at: seededTransactionTime(3 * 3600000),
      created_by: davaoAdminId,
    },
    {
      id: 'tx_davao_2',
      club_id: DEMO_DAVAO_CLUB_ID,
      venue_id: DEMO_DAVAO_VENUE_ID,
      verification_status: 'unverified',
      member_id: 'mem_davao_002',
      amount: 450,
      type: 'extension',
      description: 'Extend Davao Court 1 +1 hour',
      created_at: seededTransactionTime(100 * 60000),
      created_by: davaoAdminId,
    },
    {
      id: 'tx_davao_3',
      club_id: DEMO_DAVAO_CLUB_ID,
      venue_id: null,
      verification_status: 'unverified',
      member_id: 'mem_davao_003',
      amount: 2000,
      type: 'membership',
      description: 'Basic membership',
      created_at: seededTransactionTime(60 * 60000),
      created_by: davaoAdminId,
    },
    {
      id: 'tx_davao_4',
      club_id: DEMO_DAVAO_CLUB_ID,
      venue_id: DEMO_DAVAO_VENUE_ID,
      verification_status: 'unverified',
      member_id: null,
      amount: 300,
      type: 'walk_in',
      description: 'Walk-in day pass',
      created_at: seededTransactionTime(20 * 60000),
      created_by: davaoAdminId,
    },
  ]
  const davaoNotifications: Notification[] = [
    {
      id: 'n_davao_1',
      club_id: DEMO_DAVAO_CLUB_ID,
      venue_id: null,
      user_id: memberUserId,
      title: 'Welcome to Rally Point Davao',
      body: 'Your Davao membership is active. Book a court or show your QR at the desk.',
      read: false,
      created_at: new Date(now - 2 * 3600000).toISOString(),
    },
  ]

  const clubAccounts: ClubAccount[] = [
    {
      club_id: DEMO_CLUB_ID,
      status: 'active',
      commission_rate: 5,
      city: 'General Santos City',
      address: 'General Santos City',
      contact_email: 'gensan@brinely.info',
      contact_phone: '+63 917 555 0100',
      // On the platform well before the demo history starts.
      created_at: `${daysFromNow(-400)}T02:00:00.000Z`,
      updated_at: todayISO(),
    },
    {
      club_id: DEMO_DAVAO_CLUB_ID,
      status: 'active',
      commission_rate: 6,
      city: 'Davao City',
      address: 'Davao City',
      contact_email: 'davao@brinely.info',
      contact_phone: '+63 917 555 0200',
      // Joined the platform during the demo history, so the superadmin sees a new club.
      created_at: `${daysFromNow(-140)}T02:00:00.000Z`,
      updated_at: todayISO(),
    },
  ]
  const clubRoles: ClubStaffRole[] = [
    { club_id: DEMO_CLUB_ID, user_id: adminId, role: 'admin', is_active: true },
    { club_id: DEMO_CLUB_ID, user_id: staffId, role: 'staff', is_active: true },
    { club_id: DEMO_DAVAO_CLUB_ID, user_id: davaoAdminId, role: 'admin', is_active: true },
  ]

  const monthStartMs = new Date(`${ymdLocal(new Date(now)).slice(0, 7)}-01T00:00:00+08:00`).getTime()
  const matchInMonth = (ageHours: number, fallbackOrder: number) =>
    new Date(Math.max(now - ageHours * 3600000, monthStartMs + fallbackOrder * 60000)).toISOString()
  const matchLastMonth = (daysBeforeMonth: number) =>
    new Date(monthStartMs - daysBeforeMonth * 86400000).toISOString()

  const leaderboardScorers: DemoLeaderboardScorer[] = [
    { club_id: DEMO_CLUB_ID, user_id: staffId, granted_by: adminId, created_at: todayISO() },
  ]

  const clubMatches: DemoClubMatch[] = [
    {
      id: 'match_01',
      club_id: DEMO_CLUB_ID,
      venue_id: DEMO_VENUE_ID,
      court_id: 'court_1',
      tournament_id: 'tour_live_bracket',
      format: 'doubles',
      team_a_ids: ['mem_001', 'mem_002'],
      team_b_ids: ['mem_004', 'mem_005'],
      winner_side: 'a',
      score_a: 11,
      score_b: 7,
      notes: 'Weekend Doubles Bracket · Semifinals',
      status: 'completed',
      recorded_by: staffId,
      voided_by: null,
      voided_at: null,
      void_reason: null,
      played_at: matchInMonth(2, 6),
      created_at: matchInMonth(2, 6),
    },
    {
      id: 'match_02',
      club_id: DEMO_CLUB_ID,
      venue_id: DEMO_VENUE_ID,
      court_id: 'court_2',
      tournament_id: null,
      format: 'singles',
      team_a_ids: ['mem_002'],
      team_b_ids: ['mem_004'],
      winner_side: 'a',
      score_a: 11,
      score_b: 9,
      notes: null,
      status: 'completed',
      recorded_by: staffId,
      voided_by: null,
      voided_at: null,
      void_reason: null,
      played_at: matchInMonth(5, 5),
      created_at: matchInMonth(5, 5),
    },
    {
      id: 'match_03',
      club_id: DEMO_CLUB_ID,
      venue_id: secondVenue.id,
      court_id: 'court_3',
      tournament_id: 'tour_live_queue',
      format: 'doubles',
      team_a_ids: ['mem_004', 'mem_006'],
      team_b_ids: ['mem_007', 'mem_008'],
      winner_side: 'a',
      score_a: 15,
      score_b: 12,
      notes: 'Friday Night Queue Mixer · Game 1',
      status: 'completed',
      recorded_by: adminId,
      voided_by: null,
      voided_at: null,
      void_reason: null,
      played_at: matchInMonth(18, 4),
      created_at: matchInMonth(18, 4),
    },
    {
      id: 'match_04',
      club_id: DEMO_CLUB_ID,
      venue_id: DEMO_VENUE_ID,
      court_id: 'court_2',
      tournament_id: null,
      format: 'singles',
      team_a_ids: ['mem_005'],
      team_b_ids: ['mem_003'],
      winner_side: 'a',
      score_a: 11,
      score_b: 6,
      notes: null,
      status: 'completed',
      recorded_by: staffId,
      voided_by: null,
      voided_at: null,
      void_reason: null,
      played_at: matchInMonth(28, 3),
      created_at: matchInMonth(28, 3),
    },
    {
      id: 'match_05',
      club_id: DEMO_CLUB_ID,
      venue_id: DEMO_VENUE_ID,
      court_id: 'court_1',
      tournament_id: null,
      format: 'doubles',
      team_a_ids: ['mem_001', 'mem_006'],
      team_b_ids: ['mem_003', 'mem_007'],
      winner_side: 'a',
      score_a: 11,
      score_b: 8,
      notes: null,
      status: 'completed',
      recorded_by: adminId,
      voided_by: null,
      voided_at: null,
      void_reason: null,
      played_at: matchInMonth(42, 2),
      created_at: matchInMonth(42, 2),
    },
    {
      id: 'match_06',
      club_id: DEMO_CLUB_ID,
      venue_id: secondVenue.id,
      court_id: 'court_4',
      tournament_id: null,
      format: 'doubles',
      team_a_ids: ['mem_002', 'mem_008'],
      team_b_ids: ['mem_005', 'mem_007'],
      winner_side: 'b',
      score_a: 9,
      score_b: 11,
      notes: null,
      status: 'completed',
      recorded_by: staffId,
      voided_by: null,
      voided_at: null,
      void_reason: null,
      played_at: matchInMonth(60, 1),
      created_at: matchInMonth(60, 1),
    },
    {
      id: 'match_07',
      club_id: DEMO_CLUB_ID,
      venue_id: DEMO_VENUE_ID,
      court_id: 'court_1',
      tournament_id: null,
      format: 'singles',
      team_a_ids: ['mem_001'],
      team_b_ids: ['mem_002'],
      winner_side: 'b',
      score_a: 8,
      score_b: 11,
      notes: 'Last month challenge',
      status: 'completed',
      recorded_by: adminId,
      voided_by: null,
      voided_at: null,
      void_reason: null,
      played_at: matchLastMonth(10),
      created_at: matchLastMonth(10),
    },
    {
      id: 'match_08',
      club_id: DEMO_CLUB_ID,
      venue_id: DEMO_VENUE_ID,
      court_id: 'court_2',
      tournament_id: null,
      format: 'doubles',
      team_a_ids: ['mem_004', 'mem_008'],
      team_b_ids: ['mem_003', 'mem_006'],
      winner_side: 'a',
      score_a: 11,
      score_b: 5,
      notes: null,
      status: 'completed',
      recorded_by: staffId,
      voided_by: null,
      voided_at: null,
      void_reason: null,
      played_at: matchLastMonth(14),
      created_at: matchLastMonth(14),
    },
  ]

  const clubTournaments: DemoTournament[] = [
    {
      id: 'tour_live_bracket',
      club_id: DEMO_CLUB_ID,
      venue_id: DEMO_VENUE_ID,
      title: 'Weekend Doubles Bracket',
      format: 'single_elimination',
      team_size: 2,
      status: 'live',
      counts_for_leaderboard: true,
      scheduled_at: matchInMonth(6, 5),
      notes: 'Random paired 4-team doubles knockout. Winners feed the club leaderboard.',
      created_by: adminId,
      started_at: matchInMonth(4, 5),
      completed_at: null,
      created_at: matchInMonth(8, 5),
    },
    {
      id: 'tour_live_queue',
      club_id: DEMO_CLUB_ID,
      venue_id: null,
      title: 'Friday Night Queue Mixer',
      format: 'random_queue',
      team_size: 2,
      status: 'live',
      counts_for_leaderboard: true,
      scheduled_at: matchInMonth(20, 4),
      notes: 'Open mixer — the app picks random partners and next court games.',
      created_by: adminId,
      started_at: matchInMonth(19, 4),
      completed_at: null,
      created_at: matchInMonth(22, 4),
    },
  ]

  const bracketMemberIds = ['mem_001', 'mem_002', 'mem_003', 'mem_004', 'mem_005', 'mem_006', 'mem_007', 'mem_008']
  const clubTournamentPlayers: DemoTournamentPlayer[] = [
    ...bracketMemberIds.map((memberId, index) => ({
      club_id: DEMO_CLUB_ID,
      tournament_id: 'tour_live_bracket',
      member_id: memberId,
      seed_order: index + 1,
      created_at: matchInMonth(8, 5),
    })),
    ...bracketMemberIds.map((memberId, index) => ({
      club_id: DEMO_CLUB_ID,
      tournament_id: 'tour_live_queue',
      member_id: memberId,
      seed_order: index + 1,
      created_at: matchInMonth(22, 4),
    })),
  ]

  const clubTournamentTeams: DemoTournamentTeam[] = [
    {
      id: 'tteam_b_1',
      club_id: DEMO_CLUB_ID,
      tournament_id: 'tour_live_bracket',
      seed: 1,
      name: 'Mia Member / Jonah Cruz',
      player_1_id: 'mem_001',
      player_2_id: 'mem_002',
      created_at: matchInMonth(6, 5),
    },
    {
      id: 'tteam_b_2',
      club_id: DEMO_CLUB_ID,
      tournament_id: 'tour_live_bracket',
      seed: 2,
      name: 'Liza Santos / Paolo Lim',
      player_1_id: 'mem_003',
      player_2_id: 'mem_006',
      created_at: matchInMonth(6, 5),
    },
    {
      id: 'tteam_b_3',
      club_id: DEMO_CLUB_ID,
      tournament_id: 'tour_live_bracket',
      seed: 3,
      name: 'Tricia Gomez / Carlo Dela Cruz',
      player_1_id: 'mem_007',
      player_2_id: 'mem_008',
      created_at: matchInMonth(6, 5),
    },
    {
      id: 'tteam_b_4',
      club_id: DEMO_CLUB_ID,
      tournament_id: 'tour_live_bracket',
      seed: 4,
      name: 'Marco Reyes / Kyla Tan',
      player_1_id: 'mem_004',
      player_2_id: 'mem_005',
      created_at: matchInMonth(6, 5),
    },
  ]

  const clubTournamentMatches: DemoTournamentMatch[] = [
    {
      id: 'tmatch_b_f',
      club_id: DEMO_CLUB_ID,
      tournament_id: 'tour_live_bracket',
      round_number: 2,
      match_order: 1,
      court_id: 'court_1',
      team_a_id: 'tteam_b_1',
      team_b_id: null,
      team_a_player_ids: ['mem_001', 'mem_002'],
      team_b_player_ids: [],
      status: 'pending',
      winner_side: null,
      score_a: null,
      score_b: null,
      next_match_id: null,
      next_match_side: null,
      club_match_id: null,
      recorded_by: null,
      completed_at: null,
      created_at: matchInMonth(4, 5),
    },
    {
      id: 'tmatch_b_sf1',
      club_id: DEMO_CLUB_ID,
      tournament_id: 'tour_live_bracket',
      round_number: 1,
      match_order: 1,
      court_id: 'court_1',
      team_a_id: 'tteam_b_1',
      team_b_id: 'tteam_b_4',
      team_a_player_ids: ['mem_001', 'mem_002'],
      team_b_player_ids: ['mem_004', 'mem_005'],
      status: 'completed',
      winner_side: 'a',
      score_a: 11,
      score_b: 7,
      next_match_id: 'tmatch_b_f',
      next_match_side: 'a',
      club_match_id: 'match_01',
      recorded_by: staffId,
      completed_at: matchInMonth(2, 6),
      created_at: matchInMonth(4, 5),
    },
    {
      id: 'tmatch_b_sf2',
      club_id: DEMO_CLUB_ID,
      tournament_id: 'tour_live_bracket',
      round_number: 1,
      match_order: 2,
      court_id: 'court_2',
      team_a_id: 'tteam_b_2',
      team_b_id: 'tteam_b_3',
      team_a_player_ids: ['mem_003', 'mem_006'],
      team_b_player_ids: ['mem_007', 'mem_008'],
      status: 'ready',
      winner_side: null,
      score_a: null,
      score_b: null,
      next_match_id: 'tmatch_b_f',
      next_match_side: 'b',
      club_match_id: null,
      recorded_by: null,
      completed_at: null,
      created_at: matchInMonth(4, 5),
    },
    {
      id: 'tmatch_q_1',
      club_id: DEMO_CLUB_ID,
      tournament_id: 'tour_live_queue',
      round_number: 1,
      match_order: 1,
      court_id: 'court_3',
      team_a_id: null,
      team_b_id: null,
      team_a_player_ids: ['mem_004', 'mem_006'],
      team_b_player_ids: ['mem_007', 'mem_008'],
      status: 'completed',
      winner_side: 'a',
      score_a: 15,
      score_b: 12,
      next_match_id: null,
      next_match_side: null,
      club_match_id: 'match_03',
      recorded_by: adminId,
      completed_at: matchInMonth(18, 4),
      created_at: matchInMonth(19, 4),
    },
    {
      id: 'tmatch_q_2',
      club_id: DEMO_CLUB_ID,
      tournament_id: 'tour_live_queue',
      round_number: 1,
      match_order: 2,
      court_id: 'court_4',
      team_a_id: null,
      team_b_id: null,
      team_a_player_ids: ['mem_001', 'mem_005'],
      team_b_player_ids: ['mem_002', 'mem_003'],
      status: 'ready',
      winner_side: null,
      score_a: null,
      score_b: null,
      next_match_id: null,
      next_match_side: null,
      club_match_id: null,
      recorded_by: null,
      completed_at: null,
      created_at: matchInMonth(1, 5),
    },
  ]

  const clubTournamentScorers: DemoTournamentScorer[] = []

  const coachDay = (daysAhead: number, hour: number, minute = 0) => {
    const day = ymdLocal(new Date(now + daysAhead * 86400000))
    return new Date(`${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+08:00`).toISOString()
  }

  const clubCoaches: ClubCoach[] = [
    {
      id: 'coach_gensan_1',
      club_id: DEMO_CLUB_ID,
      account_user_id: adminId,
      full_name: 'Coach Marco Santos',
      headline: 'DUPR 4.5+ · Drills, third-shot drops & doubles strategy',
      bio: 'Helps intermediate players sharpen soft-game resets, kitchen positioning, and match tactics.',
      hourly_rate: 700,
      booking_policy: 'Please arrive 10 minutes before your slot. Court booking is arranged separately after confirmation.',
      contact_phone: '+63 917 555 0141',
      contact_url: 'https://m.me/rallypointgensan',
      photo_path: null,
      photo_url: null,
      is_active: true,
      position: 0,
      created_at: todayISO(),
    },
    {
      id: 'coach_gensan_2',
      club_id: DEMO_CLUB_ID,
      account_user_id: null,
      full_name: 'Coach Rica Villanueva',
      headline: 'Beginner & youth foundations',
      bio: 'Friendly intro sessions covering grip, serve, scoring, and rally consistency.',
      hourly_rate: 550,
      booking_policy: null,
      contact_phone: '+63 917 555 0142',
      contact_url: 'https://m.me/rallypointgensan',
      photo_path: null,
      photo_url: null,
      is_active: true,
      position: 1,
      created_at: todayISO(),
    },
    {
      id: 'coach_davao_1',
      club_id: DEMO_DAVAO_CLUB_ID,
      account_user_id: davaoAdminId,
      full_name: 'Coach Noel Ramos',
      headline: 'Footwork, serves & tournament prep',
      bio: 'Structured footwork and point-construction sessions for singles and doubles.',
      hourly_rate: 650,
      booking_policy: 'Cancellations at least 12 hours ahead, please.',
      contact_phone: '+63 917 555 0241',
      contact_url: null,
      photo_path: null,
      photo_url: null,
      is_active: true,
      position: 0,
      created_at: todayISO(),
    },
  ]

  const coachBookingSlots: CoachBookingSlot[] = [
    {
      slot_id: 'slot_gensan_1',
      coach_id: 'coach_gensan_1',
      club_id: DEMO_CLUB_ID,
      coach_name: 'Coach Marco Santos',
      starts_at: coachDay(1, 9),
      ends_at: coachDay(1, 10),
      lesson_type: 'private',
      pricing_model: 'per_session',
      rate: 700,
      max_students: 1,
      is_open: true,
    },
    {
      slot_id: 'slot_gensan_2',
      coach_id: 'coach_gensan_1',
      club_id: DEMO_CLUB_ID,
      coach_name: 'Coach Marco Santos',
      starts_at: coachDay(2, 17),
      ends_at: coachDay(2, 18, 30),
      lesson_type: 'group',
      pricing_model: 'per_student',
      rate: 450,
      max_students: 4,
      is_open: true,
    },
    {
      slot_id: 'slot_davao_1',
      coach_id: 'coach_davao_1',
      club_id: DEMO_DAVAO_CLUB_ID,
      coach_name: 'Coach Noel Ramos',
      starts_at: coachDay(1, 15),
      ends_at: coachDay(1, 16),
      lesson_type: 'private',
      pricing_model: 'per_session',
      rate: 650,
      max_students: 1,
      is_open: true,
    },
    {
      slot_id: 'slot_davao_2',
      coach_id: 'coach_davao_1',
      club_id: DEMO_DAVAO_CLUB_ID,
      coach_name: 'Coach Noel Ramos',
      starts_at: coachDay(3, 8),
      ends_at: coachDay(3, 9),
      lesson_type: 'group',
      pricing_model: 'per_student',
      rate: 400,
      max_students: 4,
      is_open: true,
    },
  ]

  const db: DemoDB = {
    clubs: [demoClub, demoDavaoClub],
    clubAccounts,
    clubRoles,
    platformRoles: [{ user_id: superadminId, role: 'superadmin' }],
    auditLog: [],
    venues: [mainVenue, secondVenue, davaoVenue],
    staffVenueGrants: [{ club_id, user_id: staffId, venue_id: DEMO_VENUE_ID, granted_by: adminId, is_active: true }],
    commissions: [],
    profiles,
    members: [...members.map((member) => ({ ...member, club_id })), ...davaoMembers],
    courts: [
      ...courts.map((court, index) => ({
        ...court,
        club_id,
        venue_id: index < 2 ? DEMO_VENUE_ID : secondVenue.id,
      })),
      ...davaoCourts,
    ],
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
    transactions: [
      ...transactions.map((transaction) => ({
        ...transaction,
        club_id,
        venue_id: transaction.type === 'membership' ? null : DEMO_VENUE_ID,
        verification_status: 'unverified' as const,
      })),
      ...davaoTransactions,
    ],
    notifications: [...notifications.map((notification) => ({ ...notification, club_id })), ...davaoNotifications],
    inquiries: [],
    walkins: [],
    clubMatches,
    leaderboardScorers,
    clubTournaments,
    clubTournamentPlayers,
    clubTournamentTeams,
    clubTournamentMatches,
    clubTournamentScorers,
    clubCoaches,
    coachBookingSlots,
    // Players pay the club's own GCash at checkout. The admin uploads the QR picture on the business profile.
    clubPaymentMethods: [{
      id: 'pay_gensan_gcash',
      club_id,
      label: 'GCash',
      account_name: 'Rally Point Gensan',
      account_number: '0917 000 0000',
      qr_path: null,
      qr_url: null,
      is_active: true,
      position: 0,
      created_at: todayISO(),
    }],
    sessionUserId: null,
  }

  // Seeded court-time charges get their commission lines, oldest first so the newest lead.
  for (const transaction of db.transactions.slice().sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    recordCommission(db, transaction)
  }
  return db
}
