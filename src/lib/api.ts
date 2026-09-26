import { demoStore } from './demoStore'
import { isDemoMode, supabase } from './supabase'
import { paymentConfig, simulateCheckout, startCheckout } from './payments'
import type {
  Booking,
  CheckIn,
  Club,
  Court,
  CourtDayAvailability,
  CourtSession,
  DashboardStats,
  Member,
  MembershipType,
  MemberStatus,
  Notification,
  OpenPlaySession,
  PaymentMethod,
  Profile,
  Role,
  ScheduleBlock,
  SkillLevel,
  Transaction,
  TenantContext,
  Venue,
  WalkIn,
} from '../types'
import { CLUB_CLOSE_HOUR, CLUB_OPEN_HOUR, hourLabel, localRangeISO } from '../types'
import { RALLY_POINT_CLUB_ID, RALLY_POINT_CLUB_SLUG } from './tenant'

function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  return new Date(aStart) < new Date(bEnd) && new Date(bStart) < new Date(aEnd)
}

export const api = {
  async tenantContext(userId?: string, role?: Role): Promise<TenantContext> {
    if (isDemoMode) return demoStore.tenantContext(userId, role) as TenantContext
    if (!supabase) throw new Error('No backend')
    const { data: club, error: clubError } = await supabase
      .from('clubs')
      .select('id, slug, name, default_timezone, is_active')
      .eq('slug', RALLY_POINT_CLUB_SLUG)
      .eq('is_active', true)
      .maybeSingle()
    if (clubError) throw clubError
    if (!club) throw new Error('Rally Point club is not configured')
    const { data: venues, error: venueError } = await supabase
      .from('venues')
      .select('id, club_id, slug, name, timezone, open_hour, close_hour, is_active')
      .eq('club_id', club.id)
      .eq('is_active', true)
      .order('name')
    if (venueError) throw venueError
    return { club: club as Club, venues: (venues ?? []) as Venue[], role: role ?? null }
  },

  async listVenues(userId?: string, role?: Role): Promise<Venue[]> {
    return (await this.tenantContext(userId, role)).venues
  },

  async listAllVenues(): Promise<Venue[]> {
    if (isDemoMode) return demoStore.allVenues()
    const { data, error } = await supabase!
      .from('venues')
      .select('id, club_id, slug, name, timezone, open_hour, close_hour, is_active')
      .eq('club_id', RALLY_POINT_CLUB_ID)
      .order('name')
    if (error) throw error
    return (data ?? []) as Venue[]
  },

  async stats(venueId?: string): Promise<DashboardStats> {
    if (isDemoMode) return demoStore.stats(venueId)
    if (!supabase) throw new Error('No backend')
    let playingQuery = supabase.from('court_sessions').select('id').eq('club_id', RALLY_POINT_CLUB_ID).eq('status', 'playing')
    let txQuery = supabase.from('transactions').select('amount').eq('club_id', RALLY_POINT_CLUB_ID).gte('created_at', startOfToday())
    let courtQuery = supabase.from('courts').select('status').eq('club_id', RALLY_POINT_CLUB_ID)
    if (venueId) {
      playingQuery = playingQuery.eq('venue_id', venueId)
      txQuery = txQuery.eq('venue_id', venueId)
      courtQuery = courtQuery.eq('venue_id', venueId)
    }
    const [{ data: memberRows }, { data: playing }, { data: txs }, { data: courts }] = await Promise.all([
      supabase.from('member_roster').select('id').eq('club_id', RALLY_POINT_CLUB_ID),
      playingQuery,
      txQuery,
      courtQuery,
    ])
    return {
      members: memberRows?.length ?? 0,
      active_now: playing?.length ?? 0,
      revenue_today: (txs ?? []).reduce((a, t) => a + Number(t.amount), 0),
      courts_occupied: (courts ?? []).filter((c) => c.status === 'occupied').length,
    }
  },

  async listMembers(): Promise<Member[]> {
    if (isDemoMode) return demoStore.members()
    const { data, error } = await supabase!.from('member_admin').select('*').eq('club_id', RALLY_POINT_CLUB_ID).order('full_name')
    if (error) throw error
    return data as Member[]
  },

  async memberRoster(): Promise<Member[]> {
    if (isDemoMode) return demoStore.members().map(({ email: _email, phone: _phone, qr_token: _qr, ...member }) => member)
    const { data, error } = await supabase!.from('member_roster').select('*').eq('club_id', RALLY_POINT_CLUB_ID).order('full_name')
    if (error) throw error
    return data as Member[]
  },

  async getMember(id: string): Promise<Member | null> {
    if (isDemoMode) return demoStore.member(id)
    const { data, error } = await supabase!.from('member_admin').select('*').eq('club_id', RALLY_POINT_CLUB_ID).eq('id', id).maybeSingle()
    if (error) throw error
    return data as Member | null
  },

  async memberForUser(userId: string): Promise<Member | null> {
    if (isDemoMode) return demoStore.memberByUser(userId)
    const { data, error } = await supabase!.from('member_self').select('*').eq('user_id', userId).maybeSingle()
    if (error) throw error
    return data as Member | null
  },

  async saveMember(input: {
    id?: string
    full_name: string
    email?: string
    phone?: string
    membership_type: MembershipType
    status?: MemberStatus
    join_date?: string
    expiry_date?: string
    notes?: string
  }) {
    if (isDemoMode) {
      demoStore.upsertMember(input)
      return
    }
    const { error } = await supabase!.rpc('admin_upsert_member', {
      p_member_id: input.id ?? null,
      p_full_name: input.full_name,
      p_email: input.email ?? null,
      p_phone: input.phone ?? null,
      p_membership_type: input.membership_type,
      p_status: input.status ?? 'active',
      p_join_date: input.join_date ?? new Date().toISOString().slice(0, 10),
      p_expiry_date: input.expiry_date ?? new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      p_notes: input.notes ?? null,
    })
    if (error) throw error
  },

  async listCourts(venueId?: string): Promise<Court[]> {
    if (isDemoMode) return demoStore.courts(venueId)
    let query = supabase!.from('courts').select('*').eq('club_id', RALLY_POINT_CLUB_ID).order('name')
    if (venueId) query = query.eq('venue_id', venueId)
    const { data, error } = await query
    if (error) throw error
    return data as Court[]
  },

  async playingSessions(venueId?: string): Promise<CourtSession[]> {
    if (isDemoMode) return demoStore.sessionsPlaying(venueId)
    let query = supabase!
      .from('court_sessions')
      .select('*, court:courts(*)')
      .eq('club_id', RALLY_POINT_CLUB_ID)
      .in('status', ['playing', 'scheduled'])
      .order('start_at', { ascending: false })
    if (venueId) query = query.eq('venue_id', venueId)
    const { data, error } = await query
    if (error) throw error
    const roster = await this.memberRoster().catch(() => [] as Member[])
    return (data ?? []).map((row) => ({
      ...row,
      court: row.court as Court,
      member: roster.find((member) => member.id === row.member_id),
    })) as CourtSession[]
  },

  async availability(dateYmd: string, venueId?: string): Promise<CourtDayAvailability[]> {
    if (isDemoMode) return demoStore.availability(dateYmd, venueId)
    const courts = await this.listCourts(venueId)
    const dayStart = localRangeISO(dateYmd, CLUB_OPEN_HOUR, 1).start_at
    const dayEnd = localRangeISO(dateYmd, CLUB_CLOSE_HOUR - 1, 1).end_at
    // Private booking/session rows are owner-only for members. The safe schedule
    // preserves peer occupancy (including open play) without exposing identities.
    let scheduleQuery = supabase!
      .from('public_schedule')
      .select('court_id, start_at, end_at')
      .eq('club_id', RALLY_POINT_CLUB_ID)
      .lt('start_at', dayEnd)
      .gt('end_at', dayStart)
    if (venueId) scheduleQuery = scheduleQuery.eq('venue_id', venueId)
    const { data: occupied, error } = await scheduleQuery
    if (error) throw error

    const now = new Date()
    return courts.map((court) => {
      const slots = []
      for (let h = CLUB_OPEN_HOUR; h < CLUB_CLOSE_HOUR; h++) {
        const { start_at, end_at } = localRangeISO(dateYmd, h, 1)
        let available = court.status !== 'maintenance'
        if (new Date(start_at).getTime() < now.getTime() - 5 * 60000) available = false
        for (const s of occupied ?? []) {
          if (s.court_id === court.id && overlaps(start_at, end_at, s.start_at, s.end_at)) available = false
        }
        slots.push({ startHour: h, label: hourLabel(h), available })
      }
      return { court, slots }
    })
  },

  async createBooking(opts: {
    court_id: string
    venue_id?: string
    member_id: string
    dateYmd: string
    startHour: number
    hours: number
    user_id: string
  }): Promise<Booking> {
    if (isDemoMode) return demoStore.createBooking(opts)
    throw new Error('Online checkout is not available yet. Ask the desk to reserve this court.')
  },

  async createDeskBooking(opts: {
    venue_id: string
    court_id: string
    member_id: string
    dateYmd: string
    startHour: number
    hours: number
    user_id: string
  }): Promise<Booking> {
    if (isDemoMode) return demoStore.createBooking(opts)
    const { data, error } = await supabase!.rpc('create_unpaid_desk_booking', {
      p_club_id: RALLY_POINT_CLUB_ID,
      p_venue_id: opts.venue_id,
      p_court_id: opts.court_id,
      p_member_id: opts.member_id,
      p_date: opts.dateYmd,
      p_start_hour: opts.startHour,
      p_hours: opts.hours,
    })
    if (error) throw error
    return data as Booking
  },

  async payBooking(opts: {
    booking_id: string
    method: PaymentMethod
    user_id: string
  }): Promise<Booking> {
    if (isDemoMode) {
      const intent = await startCheckout({
        bookingId: opts.booking_id,
        amount: 1,
        method: opts.method,
        description: 'Court booking',
      })
      const paid = await simulateCheckout(intent)
      if (paid.status !== 'paid') throw new Error('Payment failed')
      return demoStore.confirmBookingPayment(opts)
    }
    throw new Error('Online checkout is not available yet. Ask the desk to reserve this court.')

  },

  async myBookings(memberId: string, venueId?: string): Promise<Booking[]> {
    if (isDemoMode) return demoStore.myBookings(memberId, venueId)
    let query = supabase!
      .from('bookings')
      .select('*, court:courts(*)')
      .eq('club_id', RALLY_POINT_CLUB_ID)
      .eq('member_id', memberId)
      .order('start_at', { ascending: false })
    if (venueId) query = query.eq('venue_id', venueId)
    const { data, error } = await query
    if (error) throw error
    const roster = await this.memberRoster().catch(() => [] as Member[])
    return (data ?? []).map((b) => ({
      ...b,
      court: b.court as Court,
      member: roster.find((member) => member.id === b.member_id),
    })) as Booking[]
  },

  async listBookings(venueId?: string): Promise<Booking[]> {
    if (isDemoMode) return demoStore.allBookings(venueId)
    let query = supabase!
      .from('bookings')
      .select('*, court:courts(*)')
      .eq('club_id', RALLY_POINT_CLUB_ID)
      .order('start_at', { ascending: false })
      .limit(100)
    if (venueId) query = query.eq('venue_id', venueId)
    const { data, error } = await query
    if (error) throw error
    const roster = await this.memberRoster().catch(() => [] as Member[])
    return (data ?? []).map((b) => ({
      ...b,
      court: b.court as Court,
      member: roster.find((member) => member.id === b.member_id),
    })) as Booking[]
  },

  paymentMethods() {
    return paymentConfig.methods
  },

  async createRental(opts: {
    court_id: string
    venue_id?: string
    member_id?: string
    guest_name?: string
    hours: number
    created_by?: string
  }) {
    if (isDemoMode) return demoStore.createRental(opts)
    const { data: rpcData, error: rpcError } = await supabase!.rpc('create_desk_rental', {
      p_club_id: RALLY_POINT_CLUB_ID,
      p_venue_id: opts.venue_id ?? null,
      p_court_id: opts.court_id,
      p_member_id: opts.member_id ?? null,
      p_guest_name: opts.guest_name ?? null,
      p_hours: opts.hours,
    })
    if (rpcError) throw rpcError
    return rpcData as CourtSession
  },

  async addMemberToSession(sessionId: string, memberId: string, staffId?: string): Promise<CourtSession> {
    if (isDemoMode) return demoStore.addMemberToSession(sessionId, memberId, staffId) as CourtSession
    const { data: rpcData, error: rpcError } = await supabase!.rpc('add_member_to_session', {
      p_session_id: sessionId,
      p_member_id: memberId,
    })
    if (rpcError) throw rpcError
    return rpcData as CourtSession
  },

  async extendSession(sessionId: string, hours: number, created_by?: string) {
    if (isDemoMode) return demoStore.extendSession(sessionId, hours, created_by)
    const { data: rpcData, error: rpcError } = await supabase!.rpc('extend_desk_session', {
      p_session_id: sessionId,
      p_hours: hours,
    })
    if (rpcError) throw rpcError
    return rpcData as CourtSession
  },

  async endSession(sessionId: string) {
    if (isDemoMode) return demoStore.endSession(sessionId)
    const { data: rpcData, error: rpcError } = await supabase!.rpc('end_desk_session', { p_session_id: sessionId })
    if (rpcError) throw rpcError
    return rpcData as CourtSession
  },

  async checkIn(memberId: string, staffId?: string, note?: string, venueId?: string) {
    if (isDemoMode) return demoStore.checkIn(memberId, staffId, note, venueId)
    const { data, error } = await supabase!.rpc('check_in_member', {
      p_member_id: memberId,
      p_venue_id: venueId ?? null,
      p_note: note ?? null,
    })
    if (error) throw error
    return data as CheckIn
  },

  async recentCheckins(venueId?: string): Promise<CheckIn[]> {
    if (isDemoMode) return demoStore.recentCheckins(venueId)
    let query = supabase!
      .from('checkins')
      .select('*')
      .eq('club_id', RALLY_POINT_CLUB_ID)
      .order('checked_in_at', { ascending: false })
      .limit(30)
    if (venueId) query = query.eq('venue_id', venueId)
    const { data, error } = await query
    if (error) throw error
    const roster = await this.memberRoster().catch(() => [] as Member[])
    return (data ?? []).map((r) => ({ ...r, member: roster.find((member) => member.id === r.member_id) })) as CheckIn[]
  },

  async transactions(userId?: string, role?: Role): Promise<Transaction[]> {
    if (isDemoMode) return demoStore.transactions(userId, role)
    let q = supabase!.from('transactions').select('*').eq('club_id', RALLY_POINT_CLUB_ID).order('created_at', {
      ascending: false,
    })
    if (role === 'member' && userId) {
      const mem = await this.memberForUser(userId)
      if (!mem) return []
      q = q.eq('member_id', mem.id)
    }
    const { data, error } = await q
    if (error) throw error
    const roster = await this.memberRoster().catch(() => [] as Member[])
    return (data ?? []).map((r) => ({ ...r, member: roster.find((member) => member.id === r.member_id) })) as Transaction[]
  },

  async notifications(userId: string): Promise<Notification[]> {
    if (isDemoMode) return demoStore.notifications(userId)
    const { data, error } = await supabase!
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
    if (error) throw error
    return data as Notification[]
  },

  async markNotifRead(id: string) {
    if (isDemoMode) return demoStore.markNotifRead(id)
    const { error } = await supabase!.rpc('mark_notification_read', { p_notification_id: id })
    if (error) throw error
  },

  async createWalkIn(input: {
    full_name: string
    phone?: string
    purpose: string
    amount: number
    venue_id?: string
    created_by?: string
  }): Promise<WalkIn> {
    if (isDemoMode) return demoStore.createWalkIn(input)
    const { data: rpcData, error: rpcError } = await supabase!.rpc('create_desk_walkin', {
      p_venue_id: input.venue_id ?? null,
      p_full_name: input.full_name,
      p_phone: input.phone ?? null,
      p_purpose: input.purpose,
      p_amount: input.amount,
    })
    if (rpcError) throw rpcError
    return rpcData as WalkIn
  },

  async users(): Promise<Profile[]> {
    if (isDemoMode) return demoStore.users()
    const { data, error } = await supabase!.from('staff_accounts').select('*').order('full_name')
    if (error) throw error
    return (data ?? []).map((row) => ({
      id: row.user_id,
      email: row.email,
      full_name: row.full_name,
      phone: row.phone,
      role: row.role,
      created_at: row.created_at ?? '',
      venue_ids: row.venue_ids ?? [],
    })) as Profile[]
  },

  async staffAccounts(): Promise<Profile[]> {
    if (isDemoMode) return demoStore.staffAccounts()
    return this.users()
  },

  async upsertVenue(input: {
    id?: string
    slug: string
    name: string
    timezone?: string
    open_hour: number
    close_hour: number
    is_active: boolean
  }): Promise<Venue> {
    if (isDemoMode) return demoStore.upsertVenue({
      ...input,
      timezone: input.timezone ?? 'Asia/Manila',
    })
    const { data, error } = await supabase!.rpc('admin_upsert_venue', {
      p_venue_id: input.id ?? null,
      p_slug: input.slug,
      p_name: input.name,
      p_timezone: input.timezone ?? 'Asia/Manila',
      p_open_hour: input.open_hour,
      p_close_hour: input.close_hour,
      p_is_active: input.is_active,
    })
    if (error) throw error
    return data as Venue
  },

  async setStaffVenueGrant(userId: string, venueId: string, isActive: boolean): Promise<void> {
    if (isDemoMode) {
      demoStore.setStaffVenueGrant(userId, venueId, isActive)
      return
    }
    const { error } = await supabase!.rpc('set_staff_venue_grant', {
      p_user_id: userId,
      p_venue_id: venueId,
      p_is_active: isActive,
    })
    if (error) throw error
  },

  async payMembership(memberId: string, amount: number, userId: string) {
    if (isDemoMode) return demoStore.payMembership(memberId, amount, userId)
    throw new Error('Online renewal is not available yet. Renew at the desk.')
  },

    async listOpenPlays(includePast = false, venueId?: string): Promise<OpenPlaySession[]> {
      if (isDemoMode) return demoStore.listOpenPlays(includePast, venueId)
      let query = supabase!
        .from('open_plays')
        .select('*, court:courts(*)')
        .eq('club_id', RALLY_POINT_CLUB_ID)
        .order('start_at', { ascending: true })
      if (venueId) query = query.eq('venue_id', venueId)
      const { data, error } = await query
      if (error) throw error
      const ids = (data ?? []).map((x) => x.id)
      const { data: signups, error: signupError } = await supabase!
        .from('open_play_signups')
        .select('*')
        .eq('club_id', RALLY_POINT_CLUB_ID)
        .in('open_play_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
      if (signupError) throw signupError
      const { data: counts, error: countError } = await supabase!
        .from('open_play_seat_counts')
        .select('open_play_id, seats_taken')
        .eq('club_id', RALLY_POINT_CLUB_ID)
        .in('open_play_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
      if (countError) throw countError
      const roster = await this.memberRoster().catch(() => [] as Member[])
      return (data ?? []).map((op) => {
        const ss = (signups ?? []).filter((s) => s.open_play_id === op.id && s.status !== 'cancelled')
        const seatCount = counts?.find((row) => row.open_play_id === op.id)
        if (!seatCount) throw new Error('Open-play seat count is unavailable. Please refresh.')
        const seats = seatCount.seats_taken
        return {
          ...op,
          court: op.court as Court,
          signups: ss.map((s) => ({ ...s, member: roster.find((member) => member.id === s.member_id) })),
          seats_taken: seats,
          status: op.status === 'open' && seats >= op.capacity ? 'full' : op.status,
        } as OpenPlaySession
      })
    },

    async createOpenPlay(input: {
      title: string
      court_id?: string
      venue_id?: string
      start_at: string
      end_at: string
      capacity: number
      fee: number
      skill_level: SkillLevel
      notes?: string
      created_by?: string
    }) {
      if (isDemoMode) return demoStore.createOpenPlay(input)
      const { data: rpcData, error: rpcError } = await supabase!.rpc('create_open_play_session', {
      p_club_id: RALLY_POINT_CLUB_ID,
        p_venue_id: input.venue_id ?? null,
        p_court_id: input.court_id ?? null,
        p_title: input.title,
        p_start_at: input.start_at,
        p_end_at: input.end_at,
        p_capacity: input.capacity,
        p_fee: input.fee,
        p_skill_level: input.skill_level,
        p_notes: input.notes ?? null,
      })
      if (rpcError) throw rpcError
      return rpcData as OpenPlaySession
    },

    async joinOpenPlay(openPlayId: string, memberId: string, userId: string) {
      if (isDemoMode) return demoStore.joinOpenPlay(openPlayId, memberId, userId)
      const { data: rpcData, error: rpcError } = await supabase!.rpc('join_open_play_session', {
        p_open_play_id: openPlayId,
        p_member_id: memberId,
      })
      if (rpcError) throw rpcError
      return rpcData as { signup: { status: string }; session: OpenPlaySession }
    },

    async leaveOpenPlay(openPlayId: string, memberId: string) {
      if (isDemoMode) return demoStore.leaveOpenPlay(openPlayId, memberId)
      const { error } = await supabase!.rpc('leave_open_play_session', {
        p_open_play_id: openPlayId,
        p_member_id: memberId,
      })
      if (error) throw error
      return
    },

    async daySchedule(dateYmd: string, venueId?: string): Promise<ScheduleBlock[]> {
      if (isDemoMode) return demoStore.daySchedule(dateYmd, venueId)
      // Best-effort live: sessions + bookings
      const sessions = await this.playingSessions(venueId)
      const bookings = await this.listBookings(venueId)
      const open = await this.listOpenPlays(true, venueId)
      const venues = await this.listVenues()
      const venueNames = new Map(venues.map((venue) => [venue.id, venue.name]))
      const dayStart = localRangeISO(dateYmd, 0, 1).start_at
      const dayEnd = localRangeISO(dateYmd, 23, 1).end_at
      const blocks: ScheduleBlock[] = []
      for (const s of sessions) {
        if (!(new Date(s.start_at) < new Date(dayEnd) && new Date(s.end_at) > new Date(dayStart))) continue
        blocks.push({
          id: s.id,
          kind: 'session',
          court_id: s.court_id,
          venue_id: s.venue_id,
          venue_name: s.venue_id ? venueNames.get(s.venue_id) : undefined,
          court_name: s.court?.name ?? 'Court',
          title: s.member?.full_name ?? s.guest_name ?? 'Rental',
          subtitle: s.status,
          start_at: s.start_at,
          end_at: s.end_at,
          status: s.status,
          amount: s.amount,
        })
      }
      for (const b of bookings) {
        if (b.status !== 'confirmed') continue
        if (!(new Date(b.start_at) < new Date(dayEnd) && new Date(b.end_at) > new Date(dayStart))) continue
        blocks.push({
          id: b.id,
          kind: 'booking',
          court_id: b.court_id,
          venue_id: b.venue_id,
          venue_name: b.venue_id ? venueNames.get(b.venue_id) : undefined,
          court_name: b.court?.name ?? 'Court',
          title: b.member?.full_name ?? 'Booking',
          subtitle: 'online',
          start_at: b.start_at,
          end_at: b.end_at,
          status: b.status,
          amount: b.amount,
        })
      }
      for (const op of open) {
        if (!(new Date(op.start_at) < new Date(dayEnd) && new Date(op.end_at) > new Date(dayStart))) continue
        blocks.push({
          id: op.id,
          kind: 'open_play',
          court_id: op.court_id,
          venue_id: op.venue_id,
          venue_name: op.venue_id ? venueNames.get(op.venue_id) : undefined,
          court_name: op.court?.name ?? 'Open floor',
          title: op.title,
          subtitle: `${op.seats_taken ?? 0}/${op.capacity}`,
          start_at: op.start_at,
          end_at: op.end_at,
          status: op.status,
          amount: op.fee,
        })
      }
      return blocks.sort((a, b) => +new Date(a.start_at) - +new Date(b.start_at))
    },

    async publicDaySchedule(dateYmd: string, venueId?: string): Promise<ScheduleBlock[]> {
      if (isDemoMode) {
        return (await this.daySchedule(dateYmd, venueId)).map((block) => ({
          ...block,
          title: block.kind === 'open_play' ? 'Open play' : block.kind === 'booking' ? 'Reserved' : 'In use',
          subtitle: block.status,
          amount: undefined,
        }))
      }
      let query = supabase!
        .from('public_schedule')
        .select('id, venue_id, venue_name, court_id, court_name, title, kind, start_at, end_at, status, subtitle')
        .eq('club_id', RALLY_POINT_CLUB_ID)
        .gte('start_at', localRangeISO(dateYmd, 0, 1).start_at)
        .lt('start_at', localRangeISO(dateYmd, 24, 1).start_at)
      if (venueId) query = query.eq('venue_id', venueId)
      const { data, error } = await query
      if (error) throw error
      return (data ?? []) as ScheduleBlock[]
    },

    async processDueReminders() {
      if (isDemoMode) return demoStore.processDueReminders()
      return 0
    },

    async ensureMemberQr(memberId: string): Promise<Member> {
      if (isDemoMode) return demoStore.ensureMemberQr(memberId)
      const { data, error } = await supabase!.rpc('ensure_member_qr', { p_member_id: memberId })
      if (error) throw error
      return data as Member
    },

    async checkInByQr(payload: string, staffId?: string, venueId?: string) {
      if (isDemoMode) return demoStore.checkInByQr(payload, staffId, venueId)
      const { data, error } = await supabase!.rpc('check_in_qr', {
        p_payload: payload,
        p_venue_id: venueId ?? null,
      })
      if (error) throw error
      return data as { checkin: CheckIn; member: Member }
    },
  }
