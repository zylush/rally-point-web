import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Booking, CheckIn, Court, CourtSession, Member, Notification, OpenPlaySession, Profile, Transaction, Venue, WalkIn } from '../types'
import { api, summarizePlatform } from './api'
import { setActiveClubId } from './clubContext'
import { simulateCheckout, startCheckout } from './payments'

const live = vi.hoisted(() => {
  const clubId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const venueId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab'
  const member: Member = {
    id: 'member-live', club_id: clubId, user_id: 'user-live', member_code: 'RP-LIVE', full_name: 'Live Member',
    email: 'live@example.com', phone: null, membership_type: 'standard', status: 'active',
    join_date: '2025-01-01', expiry_date: '2099-01-01', notes: null, qr_token: null,
    created_at: '2025-01-01T00:00:00.000Z',
  }
  const venue: Venue = { id: venueId, club_id: clubId, slug: 'gensan-main', name: 'Rally Point Gensan', timezone: 'Asia/Manila', open_hour: 6, close_hour: 22, is_active: true }
  const court: Court = { id: 'court-live', club_id: clubId, venue_id: venueId, name: 'Live Court', status: 'available', hourly_rate: 600 }
  const session: CourtSession = {
    id: 'session-live', club_id: clubId, venue_id: venueId, court_id: court.id, member_id: member.id,
    start_at: '2099-09-20T12:00:00.000Z', end_at: '2099-09-20T13:00:00.000Z', status: 'playing', amount: 600, created_by: 'staff-live', court,
  }
  const booking: Booking = {
    id: 'booking-live', club_id: clubId, venue_id: venueId, court_id: court.id, member_id: member.id,
    start_at: '2099-09-20T14:00:00.000Z', end_at: '2099-09-20T15:00:00.000Z', hours: 1, amount: 600, status: 'pending_payment',
    payment_method: null, payment_ref: null, created_at: '2099-09-19T00:00:00.000Z', court, member,
  }
  const profile: Profile = {
    id: 'user-live', email: 'live@example.com', full_name: 'Live Member', role: 'member', phone: null,
    created_at: '2025-01-01T00:00:00.000Z',
  }
  const transaction: Transaction = {
    id: 'tx-live', club_id: clubId, venue_id: venueId, member_id: member.id, amount: 600, type: 'booking', description: 'Live booking',
    created_at: '2099-09-20T00:00:00.000Z', member, verification_status: 'unverified',
  }
  const notification: Notification = {
    id: 'notif-live', club_id: clubId, user_id: profile.id, title: 'Hello', body: 'Live', read: false,
    created_at: '2099-09-20T00:00:00.000Z',
  }
  const checkin: CheckIn = { id: 'checkin-live', club_id: clubId, venue_id: venueId, member_id: member.id, staff_id: 'staff-live', note: 'QR check-in', checked_in_at: '2099-09-20T00:00:00.000Z', member }
  const walkin: WalkIn = { id: 'walkin-live', club_id: clubId, venue_id: venueId, full_name: 'Guest Live', phone: null, purpose: 'Day pass', amount: 300, created_at: '2099-09-20T00:00:00.000Z' }
  const openPlay: OpenPlaySession = {
    id: 'open-live', club_id: clubId, venue_id: venueId, title: 'Live Open Play', court_id: court.id, start_at: '2099-09-20T10:00:00.000Z',
    end_at: '2099-09-20T18:00:00.000Z', capacity: 8, fee: 100, skill_level: 'all', notes: null,
    status: 'open', created_by: 'staff-live', created_at: '2099-09-19T00:00:00.000Z', court, seats_taken: 0, signups: [],
  }
  const signup = { id: 'signup-live', club_id: clubId, venue_id: venueId, open_play_id: openPlay.id, member_id: member.id, status: 'joined', created_at: '2099-09-19T00:00:00.000Z', member }
  const publicBlock = { id: 'public-block', club_id: clubId, venue_id: venueId, court_id: court.id, court_name: court.name, kind: 'booking', title: 'Reserved', start_at: session.start_at, end_at: session.end_at, status: 'reserved', subtitle: 'reserved' }
  const calls: Array<{ table: string; op: string; args: unknown[] }> = []
  let failNext: { table: string; error: Error; op?: string } | null = null
  let failRpc: { name: string; error: Error } | null = null

  function responseFor(query: { table: string; op: string; filters: unknown[][] }, terminal: 'query' | 'single' | 'maybeSingle') {
    const { table, op } = query
    if (failNext?.table === table && (!failNext.op || failNext.op === op)) {
      const error = failNext.error
      failNext = null
      return { data: null, error }
    }
    if (table === 'clubs') return { data: { id: clubId, slug: 'rally-point-gensan', name: 'Rally Point Gensan', default_timezone: 'Asia/Manila', is_active: true }, error: null }
    if (table === 'venues') return { data: [venue], error: null }
    if (table === 'member_admin' || table === 'member_roster') {
      if (terminal === 'single' || terminal === 'maybeSingle') return { data: member, error: null }
      return { data: [member], error: null }
    }
    if (table === 'member_self') return { data: member, error: null }
    if (table === 'staff_accounts') return { data: [{ user_id: 'staff-live', email: 'staff@example.com', full_name: 'Staff Live', phone: null, role: 'staff', venue_ids: [venueId] }], error: null }
    if (table === 'courts') return { data: [court], error: null }
    if (table === 'court_sessions') return { data: [session], error: null }
    if (table === 'bookings') return { data: [{ ...booking, status: 'confirmed' }], error: null }
    if (table === 'transactions') return { data: [transaction], error: null }
    if (table === 'notifications') return { data: [notification], error: null }
    if (table === 'checkins') return { data: [checkin], error: null }
    if (table === 'walkins') return { data: walkin, error: null }
    if (table === 'open_plays') return { data: [openPlay], error: null }
    if (table === 'open_play_signups') return { data: [signup], error: null }
    if (table === 'open_play_seat_counts') return { data: [{ open_play_id: openPlay.id, seats_taken: 8 }], error: null }
    if (table === 'public_schedule') return { data: [publicBlock], error: null }
    if (op === 'insert' || op === 'update') return { data: null, error: null }
    return { data: [], error: null }
  }

  const from = vi.fn((table: string) => {
    const query = {
      table,
      op: 'select',
      filters: [] as unknown[][],
    } as {
      table: string
      op: string
      filters: unknown[][]
      select: (...args: unknown[]) => any
      insert: (...args: unknown[]) => any
      update: (...args: unknown[]) => any
      eq: (...args: unknown[]) => any
      in: (...args: unknown[]) => any
      lt: (...args: unknown[]) => any
      gt: (...args: unknown[]) => any
      gte: (...args: unknown[]) => any
      order: (...args: unknown[]) => any
      limit: (...args: unknown[]) => any
      single: () => Promise<any>
      maybeSingle: () => Promise<any>
      then: (resolve: (value: any) => unknown, reject?: (reason: unknown) => unknown) => Promise<unknown>
    }
    const chain = (name: string, args: unknown[]) => {
      calls.push({ table, op: name, args })
      if (name === 'insert' || name === 'update') query.op = name
      if (['eq', 'in', 'lt', 'gt', 'gte'].includes(name)) query.filters.push(args)
      return query
    }
    for (const name of ['select', 'insert', 'update', 'eq', 'in', 'lt', 'gt', 'gte', 'order', 'limit', 'setHeader']) {
      query[name as 'select'] = (...args: unknown[]) => chain(name, args)
    }
    query.single = () => Promise.resolve(responseFor(query, 'single'))
    query.maybeSingle = () => Promise.resolve(responseFor(query, 'maybeSingle'))
    query.then = (resolve, reject) => Promise.resolve(responseFor(query, 'query')).then(resolve, reject)
    return query
  })

  const defaultRpc = async (name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> => {
    calls.push({ table: 'rpc', op: name, args: [args] })
    if (failRpc?.name === name) {
      const error = failRpc.error
      failRpc = null
      return { data: null, error }
    }
    if (name === 'check_in_qr') return { data: { checkin, member }, error: null }
    if (name === 'join_open_play_session') return { data: { signup, session: openPlay }, error: null }
    if (name === 'ensure_member_qr') return { data: { ...member, qr_token: 'q_live' }, error: null }
    if (name === 'admin_upsert_venue') return { data: venue, error: null }
    if (name === 'set_staff_venue_grant') return { data: { club_id: clubId, user_id: 'staff-live', venue_id: venueId, is_active: true }, error: null }
    if (name === 'mark_notification_read' || name === 'leave_open_play_session') return { data: null, error: null }
    if (name === 'create_desk_walkin') return { data: walkin, error: null }
    if (name === 'create_open_play_session') return { data: openPlay, error: null }
    if (name === 'create_unpaid_desk_booking') return { data: booking, error: null }
    if (name === 'create_desk_rental' || name === 'add_member_to_session' || name === 'extend_desk_session' || name === 'end_desk_session') return { data: session, error: null }
    if (name === 'check_in_member') return { data: checkin, error: null }
    if (name === 'admin_upsert_member') return { data: member, error: null }
    if (name === 'list_my_clubs') return { data: [{ club_id: clubId, slug: 'rally-point-gensan', name: 'Rally Point Gensan', role: 'admin' }], error: null }
    if (name === 'get_platform_access') return { data: 'superadmin', error: null }
    if (name === 'get_public_club') return { data: [{ id: clubId, slug: 'rally-point-gensan', name: 'Rally Point Gensan' }], error: null }
    if (name === 'member_list_coach_slots') {
      return {
        data: [{
          slot_id: 'coach-slot-live', coach_id: 'coach-live', club_id: clubId, coach_name: 'Coach Ana',
          headline: 'Beginner lessons', photo_path: null, starts_at: '2099-09-20T12:00:00.000Z',
          ends_at: '2099-09-20T13:00:00.000Z', lesson_type: 'private', pricing_model: 'per_student',
          rate: '600.00', max_students: 1, remaining_students: 1, booking_policy: null,
        }],
        error: null,
      }
    }
    if (name === 'join_club') return { data: 'club-joined', error: null }
    if (name === 'platform_provision_club') return { data: 'club-new', error: null }
    if (name === 'platform_assign_club_admin') return { data: 'user-admin', error: null }
    if (name === 'platform_list_clubs') {
      // Postgres numerics can arrive as strings; the adapter must turn them into numbers.
      return { data: [{ club_id: clubId, slug: 'rally-point-gensan', name: 'Rally Point Gensan', status: 'active', commission_rate: '5.00', city: null, address: null, contact_email: null, contact_phone: null, venue_count: '2', court_count: '4', member_count: '40', admin_count: '1', gross_amount: '1000.00', commission_amount: '50.00', club_net_amount: '950.00', entry_count: '2', created_at: '2099-01-01T00:00:00.000Z' }], error: null }
    }
    if (name === 'platform_commission_ledger') {
      return { data: [{ id: 'commission-live', club_id: clubId, club_name: 'Rally Point Gensan', venue_id: venueId, transaction_id: 'tx-live', description: 'Desk rental — recorded charge', gross_amount: '600.00', commission_rate: '5.00', commission_amount: '30.00', club_net_amount: '570.00', verification_status: 'unverified', created_at: '2099-09-20T00:00:00.000Z' }], error: null }
    }
    if (name === 'platform_club_admins') return { data: [{ user_id: 'user-admin', email: 'admin@example.invalid', full_name: 'Club Admin' }], error: null }
    if (name === 'platform_start_support_session') return { data: 'support-1', error: null }
    if (name === 'platform_my_support_sessions') return { data: [{ id: 'support-1', club_id: clubId, club_name: 'Rally Point Gensan', reason: 'Checking a court complaint', started_at: '2099-09-20T00:00:00.000Z', expires_at: '2099-09-20T00:30:00.000Z', ended_at: null, is_open: true }], error: null }
    if (name === 'platform_support_snapshot') return { data: { session: { id: 'support-1' }, club: { name: 'Rally Point Gensan' }, venues: [], members: { total: 40, active: 38, expired: 2 }, staff_count: 2, today: [], open_inquiries: [] }, error: null }
    if (name === 'platform_recent_actions') return { data: [{ id: 'action-live', actor_email: 'owner@example.invalid', action: 'club.provision', club_id: 'club-new', club_name: 'New Club', details: {}, created_at: '2099-09-20T00:00:00.000Z' }], error: null }
    return { data: null, error: null }
  }
  const rpc = vi.fn(defaultRpc)

  return {
    from, rpc, calls, clubId, venueId, member, venue, court, session, booking, profile, transaction, notification, checkin, walkin, openPlay, signup,
    reset: () => { calls.length = 0; failNext = null; failRpc = null; rpc.mockImplementation(defaultRpc) },
    setFailure: (table: string, error: Error, op?: string) => { failNext = { table, error, op } },
    setRpcFailure: (name: string, error: Error) => { failRpc = { name, error } },
  }
})

vi.mock('./supabase', () => ({
  isDemoMode: false,
  supabase: {
    from: live.from,
    rpc: live.rpc,
    storage: {
      from: () => ({
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.example/court-photos/${path}` } }),
      }),
    },
  },
}))
vi.mock('./payments', () => ({
  paymentConfig: { methods: [{ id: 'gcash', label: 'GCash' }] },
  startCheckout: vi.fn(async (input: { bookingId: string; amount: number }) => ({ ...input, status: 'created', ref: 'PAY-LIVE' })),
  simulateCheckout: vi.fn(async (input: { ref: string; amount: number }) => ({ ...input, status: 'paid', ref: input.ref })),
}))

beforeEach(() => {
  vi.clearAllMocks()
  live.reset()
  // The signed-in person is working in the fixture's club.
  setActiveClubId(live.clubId)
})

describe('api live tenant adapter', () => {
  it('keeps peer reservations unavailable using only the safe schedule projection', async () => {
    const availability = await api.availability('2099-09-20', live.venueId)
    const occupied = availability[0].slots.filter((slot) => !slot.available)
    expect(occupied).not.toHaveLength(0)
    expect(occupied.every((slot) => slot.blocked === 'booked')).toBe(true)
    expect(live.calls.some((call) => ['bookings', 'court_sessions', 'court_allocations'].includes(call.table))).toBe(false)
    expect(live.calls).toContainEqual({ table: 'public_schedule', op: 'eq', args: ['venue_id', live.venueId] })
  })

  it('uses aggregate seats even when RLS exposes only the current member signup', async () => {
    const [session] = await api.listOpenPlays(false, live.venueId)
    expect(session.signups).toHaveLength(1)
    expect(session.seats_taken).toBe(8)
    expect(session.status).toBe('full')
  })

  it('fails closed when availability or seat-count reads fail', async () => {
    live.setFailure('public_schedule', new Error('availability unavailable'))
    await expect(api.availability('2099-09-20', live.venueId)).rejects.toThrow('availability unavailable')
    live.setFailure('open_play_seat_counts', new Error('counts unavailable'))
    await expect(api.listOpenPlays()).rejects.toThrow('counts unavailable')
    live.setFailure('open_play_signups', new Error('signups unavailable'))
    await expect(api.listOpenPlays()).rejects.toThrow('signups unavailable')
  })

  it('treats coach slot commands as writes and does not map incomplete RPC rows as full slots', async () => {
    await expect(api.coachUpsertBookingSlot({
      coach_id: 'coach-live',
      starts_at: '2099-09-20T12:00:00.000Z',
      ends_at: '2099-09-20T13:00:00.000Z',
      lesson_type: 'private',
      pricing_model: 'per_student',
      rate: 600,
      max_students: 1,
    })).resolves.toBeUndefined()
    await expect(api.coachSetBookingSlotOpen('slot-live', false)).resolves.toBeUndefined()
    expect(live.calls.filter((call) => call.table === 'rpc').map((call) => call.op)).toEqual([
      'coach_upsert_booking_slot',
      'coach_set_booking_slot_open',
    ])
  })

  it('maps public coach details and numeric rates from available booking slots', async () => {
    const [slot] = await api.memberListCoachSlots('2099-09-20T00:00:00.000Z', '2099-09-21T00:00:00.000Z')
    expect(slot).toMatchObject({
      slot_id: 'coach-slot-live',
      coach_name: 'Coach Ana',
      coach_headline: 'Beginner lessons',
      coach_photo_url: null,
      rate: 600,
    })
  })

  it('lists public coaches across clubs from list_public_coaches and resolves photos and numbers', async () => {
    live.rpc.mockResolvedValueOnce({
      data: [
        {
          id: 'coach-live-1',
          full_name: 'Coach Ana',
          headline: 'Doubles',
          bio: 'Drills',
          hourly_rate: '650.00',
          contact_phone: '0917 000 0000',
          contact_url: 'https://m.me/coachana',
          photo_path: `${live.clubId}/coaches/ana.webp`,
          booking_policy: 'Arrive early.',
          accepts_requests: true,
          club: { id: live.clubId, slug: 'rally-point-gensan', name: 'Rally Point Gensan', city: 'General Santos City' },
          slots: [
            {
              slot_id: 'slot-1',
              starts_at: '2099-09-20T12:00:00.000Z',
              ends_at: '2099-09-20T13:00:00.000Z',
              lesson_type: 'group',
              pricing_model: 'per_student',
              rate: '400.00',
              max_students: '4',
              remaining_students: '2',
            },
          ],
        },
      ],
      error: null,
    })

    const rows = await api.listPublicCoaches({
      clubSlug: 'rally-point-gensan',
      from: '2099-09-20T00:00:00.000Z',
      until: '2099-10-20T00:00:00.000Z',
    })
    expect(live.rpc).toHaveBeenCalledWith('list_public_coaches', {
      p_club_slug: 'rally-point-gensan',
      p_from: '2099-09-20T00:00:00.000Z',
      p_until: '2099-10-20T00:00:00.000Z',
    })
    expect(rows).toEqual([
      {
        id: 'coach-live-1',
        full_name: 'Coach Ana',
        headline: 'Doubles',
        bio: 'Drills',
        hourly_rate: 650,
        contact_phone: '0917 000 0000',
        contact_url: 'https://m.me/coachana',
        photo_url: `https://cdn.example/court-photos/${live.clubId}/coaches/ana.webp`,
        booking_policy: 'Arrive early.',
        accepts_requests: true,
        club: { id: live.clubId, slug: 'rally-point-gensan', name: 'Rally Point Gensan', city: 'General Santos City' },
        slots: [
          {
            slot_id: 'slot-1',
            starts_at: '2099-09-20T12:00:00.000Z',
            ends_at: '2099-09-20T13:00:00.000Z',
            lesson_type: 'group',
            pricing_model: 'per_student',
            rate: 400,
            max_students: 4,
            remaining_students: 2,
          },
        ],
      },
    ])
  })

  it('falls back to list_public_clubs and get_public_club_profile when list_public_coaches is not on the server yet', async () => {
    live.setRpcFailure('list_public_coaches', Object.assign(new Error('not found'), { code: 'PGRST202' }))
    const baseRpc = live.rpc.getMockImplementation()
    live.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === 'list_public_clubs') {
        return {
          data: [{
            slug: 'rally-point-gensan',
            name: 'Rally Point Gensan',
            city: 'General Santos City',
            address: null,
            cities: ['General Santos City'],
            venue_count: 1,
            court_count: 2,
            min_rate: 500,
            min_member_rate: null,
          }],
          error: null,
        }
      }
      if (name === 'list_public_club_covers') return { data: [], error: null }
      if (name === 'get_public_club_profile') {
        return {
          data: {
            about: null, phone: null, email: null, facebook_url: null, messenger_url: null, instagram_url: null, website_url: null,
            amenities: [], payment_note: null, house_rules: null, cancellation_policy: null, terms: null,
            payment_methods: [], addons: [], gallery: [],
            coaches: [{
              id: 'coach-fallback',
              full_name: 'CoachFallback',
              headline: 'Volleys',
              bio: null,
              hourly_rate: '500.00',
              contact_phone: null,
              contact_url: null,
              photo_path: null,
            }],
          },
          error: null,
        }
      }
      return baseRpc!(name, args)
    })

    const rows = await api.listPublicCoaches()
    expect(rows).toEqual([
      {
        id: 'coach-fallback',
        full_name: 'CoachFallback',
        headline: 'Volleys',
        bio: null,
        hourly_rate: 500,
        contact_phone: null,
        contact_url: null,
        photo_url: null,
        booking_policy: null,
        accepts_requests: false,
        club: { id: live.clubId, slug: 'rally-point-gensan', name: 'Rally Point Gensan', city: 'General Santos City' },
        slots: [],
      },
    ])
  })

  it('reads only the active club and resolves accessible venues', async () => {
    expect((await api.tenantContext(live.profile.id, 'member')).club.id).toBe(live.clubId)
    expect(live.calls).toContainEqual({ table: 'clubs', op: 'eq', args: ['id', live.clubId] })
    expect(live.calls).not.toContainEqual(expect.objectContaining({ table: 'clubs', op: 'eq', args: ['slug', expect.anything()] }))
    expect(await api.listVenues(live.profile.id, 'member')).toEqual([live.venue])
    expect((await api.stats()).members).toBe(1)
    expect(await api.listMembers()).toEqual([live.member])
    expect(await api.getMember(live.member.id)).toEqual(live.member)
    expect(await api.memberForUser(live.profile.id)).toEqual(live.member)
    expect(await api.listCourts(live.venueId)).toEqual([live.court])
    expect(await api.playingSessions(live.venueId)).toEqual([expect.objectContaining({ ...live.session, member: live.member })])
    expect((await api.myBookings(live.member.id, live.venueId))[0].court?.id).toBe(live.court.id)
    expect((await api.listBookings(live.venueId))[0].member?.id).toBe(live.member.id)
  })

  it('blocks live online payment and sends operational writes to scoped RPCs', async () => {
    // Live member checkout (hold_court_booking and the GCash steps) is covered in api.checkout.live.test.ts.
    await expect(api.payMembership(live.member.id, 2500, live.profile.id)).rejects.toThrow('Online renewal')
    expect(startCheckout).not.toHaveBeenCalled()
    expect(simulateCheckout).not.toHaveBeenCalled()

    await api.createDeskBooking({ venue_id: live.venueId, court_id: live.court.id, member_id: live.member.id, dateYmd: '2099-09-20', startHour: 14, hours: 1, user_id: 'staff-live' })
    await api.createRental({ venue_id: live.venueId, court_id: live.court.id, member_id: live.member.id, hours: 1, created_by: 'staff-live' })
    await api.addMemberToSession(live.session.id, live.member.id, 'staff-live')
    await api.extendSession(live.session.id, 1, 'staff-live')
    await api.endSession(live.session.id)
    await api.checkIn(live.member.id, 'staff-live', 'Ready', live.venueId)
    await api.createWalkIn({ venue_id: live.venueId, full_name: 'Guest Live', purpose: 'Day pass', amount: 300 })
    await api.markNotifRead(live.notification.id)
    expect(live.calls.filter((call) => call.table === 'rpc').map((call) => call.op)).toEqual(expect.arrayContaining([
      'create_unpaid_desk_booking', 'create_desk_rental', 'add_member_to_session', 'extend_desk_session', 'end_desk_session', 'check_in_member', 'create_desk_walkin', 'mark_notification_read',
    ]))
    expect(live.calls.some((call) => ['bookings', 'court_sessions', 'transactions', 'members'].includes(call.table) && ['insert', 'update'].includes(call.op))).toBe(false)
  })

  it('uses scoped open-play commands, safe public schedule, and QR RPCs', async () => {
    expect((await api.listOpenPlays(false, live.venueId)).length).toBe(1)
    await api.createOpenPlay({ title: 'New Open', venue_id: live.venueId, court_id: live.court.id, start_at: live.openPlay.start_at, end_at: live.openPlay.end_at, capacity: 8, fee: 100, skill_level: 'all' })
    const joined = await api.joinOpenPlay(live.openPlay.id, live.member.id, live.profile.id)
    expect(joined.signup.status).toBe('joined')
    await api.leaveOpenPlay(live.openPlay.id, live.member.id)
    expect((await api.publicDaySchedule('2099-09-20', live.venueId))[0].title).toBe('Reserved')
    expect((await api.checkInByQr('RP1|RP-LIVE', 'staff-live', live.venueId)).member.id).toBe(live.member.id)
    expect((await api.ensureMemberQr(live.member.id)).qr_token).toBe('q_live')
    expect(live.calls.filter((call) => call.table === 'rpc').map((call) => call.op)).toEqual(expect.arrayContaining([
      'create_open_play_session', 'join_open_play_session', 'leave_open_play_session', 'check_in_qr', 'ensure_member_qr',
    ]))
  })

  it('covers the remaining live reads, admin commands, and optional inputs', async () => {
    expect(await api.listAllVenues()).toEqual([live.venue])
    expect((await api.tenantContext()).role).toBeNull()
    expect((await api.stats(live.venueId)).revenue_today).toBe(600)
    expect(await api.memberRoster()).toEqual([live.member])

    await api.saveMember({ full_name: 'New Member', membership_type: 'basic' })
    await api.saveMember({
      id: live.member.id,
      full_name: live.member.full_name,
      email: live.member.email ?? undefined,
      phone: '09170000000',
      membership_type: 'premium',
      status: 'suspended',
      join_date: '2099-01-01',
      expiry_date: '2099-12-31',
      notes: 'Reviewed',
    })

    expect(await api.listCourts()).toEqual([live.court])
    expect(await api.playingSessions()).toHaveLength(1)
    expect(await api.availability('2099-09-20', live.venueId)).toEqual([
      expect.objectContaining({ court: live.court, slots: expect.any(Array) }),
    ])
    expect(await api.myBookings(live.member.id)).toHaveLength(1)
    expect(await api.listBookings()).toHaveLength(1)
    expect(api.paymentMethods()).toHaveLength(1)

    await api.createRental({ court_id: live.court.id, hours: 1 })
    await api.checkIn(live.member.id)
    expect(await api.recentCheckins(live.venueId)).toHaveLength(1)
    expect(await api.recentCheckins()).toHaveLength(1)
    expect(await api.transactions(live.profile.id, 'member')).toHaveLength(1)
    expect(await api.transactions('staff-live', 'staff')).toHaveLength(1)
    expect(await api.notifications(live.profile.id)).toEqual([live.notification])
    await api.createWalkIn({ full_name: 'No phone', purpose: 'Visit', amount: 0 })

    expect((await api.users())[0]).toEqual(expect.objectContaining({ id: 'staff-live', venue_ids: [live.venueId] }))
    expect(await api.staffAccounts()).toHaveLength(1)
    expect(await api.upsertVenue({ slug: 'north', name: 'North', open_hour: 6, close_hour: 22, is_active: true })).toEqual(live.venue)
    expect(await api.upsertVenue({ id: live.venueId, slug: live.venue.slug, name: live.venue.name, timezone: live.venue.timezone, open_hour: 7, close_hour: 21, is_active: false })).toEqual(live.venue)
    await api.setStaffVenueGrant('staff-live', live.venueId, false)

    expect(await api.listOpenPlays()).toHaveLength(1)
    await api.createOpenPlay({ title: 'Open floor', start_at: live.openPlay.start_at, end_at: live.openPlay.end_at, capacity: 4, fee: 0, skill_level: 'all' })
    expect(await api.daySchedule('2099-09-20')).toHaveLength(3)
    expect(await api.publicDaySchedule('2099-09-20')).toHaveLength(1)
    expect(await api.processDueReminders()).toBe(0)
    expect((await api.checkInByQr('RP-LIVE')).member.id).toBe(live.member.id)
  })

  it('surfaces every live read failure instead of returning partial operational data', async () => {
    const cases: Array<[string, string, () => Promise<unknown>]> = [
      ['venues', 'venues failed', () => api.listAllVenues()],
      ['venues', 'context venues failed', () => api.tenantContext()],
      ['member_roster', 'roster failed', () => api.memberRoster()],
      ['member_admin', 'member failed', () => api.getMember(live.member.id)],
      ['member_self', 'member self failed', () => api.memberForUser(live.profile.id)],
      ['courts', 'courts failed', () => api.listCourts()],
      ['court_sessions', 'sessions failed', () => api.playingSessions()],
      ['bookings', 'my bookings failed', () => api.myBookings(live.member.id)],
      ['bookings', 'bookings failed', () => api.listBookings()],
      ['checkins', 'check-ins failed', () => api.recentCheckins()],
      ['transactions', 'transactions failed', () => api.transactions()],
      ['notifications', 'notifications failed', () => api.notifications(live.profile.id)],
      ['staff_accounts', 'staff accounts failed', () => api.users()],
      ['open_plays', 'open plays failed', () => api.listOpenPlays()],
      ['public_schedule', 'public schedule failed', () => api.publicDaySchedule('2099-09-20')],
    ]

    for (const [table, message, run] of cases) {
      live.setFailure(table, new Error(message))
      await expect(run()).rejects.toThrow(message)
    }
  })

  it('surfaces every scoped command failure', async () => {
    const cases: Array<[string, () => Promise<unknown>]> = [
      ['admin_upsert_member', () => api.saveMember({ full_name: 'Member', membership_type: 'standard' })],
      ['create_unpaid_desk_booking', () => api.createDeskBooking({ venue_id: live.venueId, court_id: live.court.id, member_id: live.member.id, dateYmd: '2099-09-20', startHour: 14, hours: 1, user_id: 'staff-live' })],
      ['create_desk_rental', () => api.createRental({ venue_id: live.venueId, court_id: live.court.id, hours: 1 })],
      ['add_member_to_session', () => api.addMemberToSession(live.session.id, live.member.id)],
      ['extend_desk_session', () => api.extendSession(live.session.id, 1)],
      ['end_desk_session', () => api.endSession(live.session.id)],
      ['check_in_member', () => api.checkIn(live.member.id, 'staff-live', undefined, live.venueId)],
      ['mark_notification_read', () => api.markNotifRead(live.notification.id)],
      ['create_desk_walkin', () => api.createWalkIn({ venue_id: live.venueId, full_name: 'Guest', phone: '0917', purpose: 'Visit', amount: 100 })],
      ['admin_upsert_venue', () => api.upsertVenue({ slug: 'north', name: 'North', timezone: 'Asia/Manila', open_hour: 6, close_hour: 22, is_active: true })],
      ['set_staff_venue_grant', () => api.setStaffVenueGrant('staff-live', live.venueId, true)],
      ['join_open_play_session', () => api.joinOpenPlay(live.openPlay.id, live.member.id, live.profile.id)],
      ['leave_open_play_session', () => api.leaveOpenPlay(live.openPlay.id, live.member.id)],
      ['ensure_member_qr', () => api.ensureMemberQr(live.member.id)],
      ['check_in_qr', () => api.checkInByQr('RP-LIVE', 'staff-live', live.venueId)],
    ]

    for (const [name, run] of cases) {
      live.setRpcFailure(name, new Error(`${name} failed`))
      await expect(run()).rejects.toThrow(`${name} failed`)
    }
  })

  it('surfaces safe-view and RPC failures', async () => {
    live.setFailure('member_admin', new Error('members unavailable'))
    await expect(api.listMembers()).rejects.toThrow('members unavailable')
    live.setRpcFailure('create_open_play_session', new Error('Cannot create'))
    await expect(api.createOpenPlay({ title: 'Open floor', venue_id: live.venueId, start_at: live.openPlay.start_at, end_at: live.openPlay.end_at, capacity: 8, fee: 0, skill_level: 'all' })).rejects.toThrow('Cannot create')
  })
})

describe('api live club context', () => {
  it('scopes every club filter and command to the active club', async () => {
    setActiveClubId('club-davao')
    await api.listMembers()
    await api.createDeskBooking({ venue_id: live.venueId, court_id: live.court.id, member_id: live.member.id, dateYmd: '2099-09-20', startHour: 14, hours: 1, user_id: 'staff-live' })
    expect(live.calls).toContainEqual({ table: 'member_admin', op: 'eq', args: ['club_id', 'club-davao'] })
    expect(live.calls).not.toContainEqual({ table: 'member_admin', op: 'eq', args: ['club_id', live.clubId] })
    expect(live.calls).toContainEqual(expect.objectContaining({ table: 'rpc', op: 'create_unpaid_desk_booking', args: [expect.objectContaining({ p_club_id: 'club-davao' })] }))
  })

  it('refuses club reads when no club is selected', async () => {
    setActiveClubId(null)
    await expect(api.listMembers()).rejects.toThrow('No club is selected')
    // The query is never sent: no club filter was applied and nothing was awaited.
    expect(live.calls).not.toContainEqual(expect.objectContaining({ op: 'eq', args: ['club_id', expect.anything()] }))
  })

  it('sends a TV board club on that request only', async () => {
    setActiveClubId(null)
    await api.publicDaySchedule('2099-09-20', undefined, 'club-tv')
    expect(live.calls).toContainEqual({ table: 'public_schedule', op: 'eq', args: ['club_id', 'club-tv'] })
    expect(live.calls).toContainEqual({ table: 'public_schedule', op: 'setHeader', args: ['x-club-id', 'club-tv'] })
  })

  it('loads the person\'s clubs, platform access and public club lookups through trusted RPCs', async () => {
    expect(await api.myClubs('user-live')).toEqual([{ club_id: live.clubId, slug: 'rally-point-gensan', name: 'Rally Point Gensan', role: 'admin' }])
    expect(await api.platformAccess('user-live')).toBe('superadmin')
    expect(await api.publicClub('rally-point-gensan')).toEqual({ id: live.clubId, slug: 'rally-point-gensan', name: 'Rally Point Gensan' })
    expect(await api.joinClub('user-live', 'rally-point-davao')).toBe('club-joined')
    expect(live.calls).toContainEqual({ table: 'rpc', op: 'get_public_club', args: [{ p_slug: 'rally-point-gensan' }] })
    expect(live.calls).toContainEqual({ table: 'rpc', op: 'join_club', args: [{ p_slug: 'rally-point-davao' }] })
  })

  it('reads platform figures as numbers and sums them for the overview', async () => {
    const clubs = await api.platformClubs()
    expect(clubs[0]).toMatchObject({ commission_rate: 5, member_count: 40, gross_amount: 1000, commission_amount: 50, entry_count: 2 })
    expect(summarizePlatform(clubs)).toEqual({ totalGrossVolume: 1000, totalCommissionsEarned: 50, activeClubsCount: 1, totalEntriesCount: 2 })
    const ledger = await api.platformLedger(live.clubId, 50)
    expect(ledger[0]).toMatchObject({ gross_amount: 600, commission_rate: 5, commission_amount: 30, club_net_amount: 570 })
    expect(live.calls).toContainEqual({ table: 'rpc', op: 'platform_commission_ledger', args: [{ p_club_id: live.clubId, p_limit: 50 }] })
  })

  it('sends platform changes to the audited platform functions', async () => {
    expect(await api.provisionClub({ name: 'Davao Hub', slug: 'davao-hub', city: 'Davao City', address: 'Ecoland', contact_email: 'davao@example.invalid', contact_phone: '0917', commission_rate: 6, court_count: 3 })).toBe('club-new')
    await api.setClubStatus('club-new', 'active')
    await api.setCommissionRate('club-new', 7.5)
    expect(await api.assignClubAdmin('club-new', 'admin@example.invalid')).toBe('user-admin')
    await api.revokeClubAdmin('club-new', 'user-admin')
    expect(await api.platformClubAdmins('club-new')).toEqual([{ user_id: 'user-admin', email: 'admin@example.invalid', full_name: 'Club Admin' }])
    expect((await api.platformRecentActions(5))[0].action).toBe('club.provision')
    expect(live.calls).toEqual(expect.arrayContaining([
      { table: 'rpc', op: 'platform_provision_club', args: [{ p_name: 'Davao Hub', p_slug: 'davao-hub', p_city: 'Davao City', p_address: 'Ecoland', p_contact_email: 'davao@example.invalid', p_contact_phone: '0917', p_commission_rate: 6, p_court_count: 3 }] },
      { table: 'rpc', op: 'platform_set_club_status', args: [{ p_club_id: 'club-new', p_status: 'active' }] },
      { table: 'rpc', op: 'platform_set_commission_rate', args: [{ p_club_id: 'club-new', p_rate: 7.5 }] },
      { table: 'rpc', op: 'platform_assign_club_admin', args: [{ p_club_id: 'club-new', p_email: 'admin@example.invalid' }] },
      { table: 'rpc', op: 'platform_revoke_club_admin', args: [{ p_club_id: 'club-new', p_user_id: 'user-admin' }] },
    ]))
  })

  it('opens, reads and ends support sessions through the audited functions', async () => {
    expect(await api.startSupportSession(live.clubId, 'Checking a court complaint', 30)).toBe('support-1')
    expect((await api.mySupportSessions())[0]).toMatchObject({ id: 'support-1', is_open: true })
    expect((await api.supportSnapshot('support-1')).members.total).toBe(40)
    await api.endSupportSession('support-1')
    expect(live.calls).toEqual(expect.arrayContaining([
      { table: 'rpc', op: 'platform_start_support_session', args: [{ p_club_id: live.clubId, p_reason: 'Checking a court complaint', p_minutes: 30 }] },
      { table: 'rpc', op: 'platform_support_snapshot', args: [{ p_session_id: 'support-1' }] },
      { table: 'rpc', op: 'platform_end_support_session', args: [{ p_session_id: 'support-1' }] },
    ]))
  })

  it('surfaces platform refusals from the database', async () => {
    live.setRpcFailure('platform_list_clubs', new Error('Platform access required'))
    await expect(api.platformClubs()).rejects.toThrow('Platform access required')
  })
})
