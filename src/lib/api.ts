import { demoStore } from './demoStore'
import { isDemoMode, supabase } from './supabase'
import { paymentConfig } from './payments'
import type {
  AdminClubProfile,
  Booking,
  AccountInput,
  CheckIn,
  CheckInResult,
  CheckoutPaymentMethod,
  Club,
  ClubAddon,
  ClubAddonInput,
  ClubCoach,
  ClubCoachInput,
  CoachBookingRequest,
  CoachBookingSlot,
  CoachProfileAccess,
  CoachRequestMessage,
  PublicCoachListing,
  PublicCoachSlot,
  ClubGalleryPhoto,
  PictureCleanup,
  ClubPaymentMethod,
  ClubPaymentMethodInput,
  ClubProfileFields,
  PublicClubProfile,
  Court,
  CourtInput,
  CourtPhoto,
  PublicClubDetail,
  PublicClubListing,
  VenueLocationInput,
  CourtDayAvailability,
  CourtSession,
  DashboardStats,
  Member,
  MemberPass,
  MembershipApproval,
  MembershipRequest,
  MembershipRequestStatus,
  MembershipType,
  MemberStatus,
  Notification,
  OpenPlaySession,
  Profile,
  Role,
  ScheduleBlock,
  SkillLevel,
  Transaction,
  TenantContext,
  Venue,
  WalkIn,
  SupportInquiry,
  InquiryCategory,
  InquiryStatus,
  ClubStatus,
  MyClub,
  PlatformAction,
  PlatformClub,
  PlatformClubAdmin,
  PlatformCommission,
  ProvisionClubInput,
  PublicClub,
  SuperadminStats,
  SupportSession,
  SupportSnapshot,
  ClubOwnerInvite,
  OwnerCallRequest,
  OwnerCallRequestInput,
  OwnerCallStatus,
  OwnerClub,
  ClubLeaderboardSnapshot,
  ClubMatch,
  LeaderboardEntry,
  LeaderboardFormatFilter,
  LeaderboardPeriod,
  LeaderboardPlayerSummary,
  LeaderboardScorerStaff,
  RecordMatchInput,
  CreateTournamentInput,
  ScoreTournamentMatchInput,
  TournamentDetail,
  TournamentMatch,
  TournamentScorerStaff,
  TournamentSummary,
  PublicTournamentFilter,
  PublicTournamentSummary,
  TournamentTeam,
} from '../types'
import { CLUB_CLOSE_HOUR, CLUB_OPEN_HOUR, fmtDateTime, fmtTime, isCourtType, localRangeISO, timeSlot, venueHours } from '../types'
import { CLUB_HEADER, getActiveClubId, notifyClubUnavailable, requireActiveClubId } from './clubContext'
import { emitClubLiveUpdate } from './livePulse'
import { MEMBER_PHOTO_BUCKET, PHOTO_BUCKET, memberPhotoUrl, photoUrl, shrinkPhoto, shrinkPhotoToDataUrl } from './photos'
import { emptyClubProfile, normalizeProfile } from './clubProfile'
import { DEFAULT_CLUB_SLUG } from './tenant'
import type { BookingStatus, TxType } from '../types'
import { analyticsWindow, buildClubAnalytics, buildPlatformAnalytics, rangeInstants } from './analytics'
import type { AnalyticsPeriod, ClubAnalytics, ClubTotals, DayRange, PlatformAnalytics, PlatformTotals } from './analytics'

export type { AnalyticsPeriod, ClubAnalytics, PlatformAnalytics } from './analytics'

/** A commission line as a club admin may read it for the dashboard. */
export interface ClubCommissionLine {
  commission_amount: number
  gross_amount: number
  created_at: string
}

type OccupiedInterval = { court_id: string | null; start_at: string; end_at: string }

function buildCourtAvailability(
  courts: Court[],
  hoursFor: (venueId: string | null | undefined) => { open: number; close: number },
  occupied: OccupiedInterval[],
  dateYmd: string,
): CourtDayAvailability[] {
  const now = new Date()
  return courts.map((court) => {
    const slots = []
    const { open, close } = hoursFor(court.venue_id)
    for (let h = open; h < close; h++) {
      const { start_at, end_at } = localRangeISO(dateYmd, h, 1)
      // Each hour says why it cannot be booked, so every hour of a booking reads "Booked".
      slots.push(timeSlot(h, {
        booked: occupied.some((s) => s.court_id === court.id && overlaps(start_at, end_at, s.start_at, s.end_at)),
        outOfService: court.status === 'maintenance',
        passed: new Date(start_at).getTime() < now.getTime() - 5 * 60000,
      }))
    }
    return { court, slots }
  })
}

/**
 * Deletes stored photo files; returns how many are gone. Storage answers a refused delete
 * with an empty list and no error, exactly as it answers for a file that was already gone,
 * so a file it does not name as deleted is looked up: only one still there counts as left.
 * The bucket is public: a file left behind still opens from its old link.
 */
async function deletePhotoFiles(paths: string[]): Promise<{ deleted: number; left: number }> {
  if (paths.length === 0) return { deleted: 0, left: 0 }
  const bucket = supabase!.storage.from(PHOTO_BUCKET)
  let named = new Set<string>()
  try {
    const { data, error } = await bucket.remove(paths)
    if (!error) named = new Set((data ?? []).map((file) => file.name))
  } catch {
    // Treated like a refusal: each file is looked up below.
  }
  let left = 0
  for (const path of paths.filter((path) => !named.has(path))) {
    try {
      const { data: stillThere } = await bucket.exists(path)
      if (stillThere) left += 1
    } catch {
      left += 1
    }
  }
  return { deleted: paths.length - left, left }
}

/** Deletes one stored photo file; returns false when it is still there. */
async function deletePhotoFile(path: string | null | undefined): Promise<boolean> {
  return !path || (await deletePhotoFiles([path])).left === 0
}

/**
 * Deletes the club picture a save replaced or removed. `kept` is the path now in use, which is
 * never deleted, even if the database hands it back.
 */
async function deleteReplacedPicture(old: unknown, kept: string | null = null): Promise<PictureCleanup> {
  const path = typeof old === 'string' && old !== kept ? old : null
  return { fileLeftBehind: !(await deletePhotoFile(path)) }
}

/** Uploads a prepared photo to `path`, never overwriting a file; returns the path. */
/**
 * Deletes files in the person's own photo folder other than their current photo: leftovers from a
 * swap whose clean-up failed. Best effort; the folder limit (3 files) is enforced by the database.
 */
async function clearLeftoverMemberPhotos(userId: string, keepPath: string | null | undefined) {
  const { data, error } = await supabase!.storage.from(MEMBER_PHOTO_BUCKET).list(userId, { limit: 100 })
  if (error || !data) return
  const leftovers = data.map((file) => `${userId}/${file.name}`).filter((path) => path !== keepPath)
  if (leftovers.length) await supabase!.storage.from(MEMBER_PHOTO_BUCKET).remove(leftovers)
}

/** A row of list_my_member_passes: the pass with its latest request flattened into columns. */
interface MemberPassRow extends Omit<MemberPass, 'request'> {
  request_id: string | null
  request_status: MembershipRequestStatus | null
  request_decline_reason: string | null
  request_requested_at: string | null
  request_decided_at: string | null
}

function passFromRow(row: MemberPassRow): MemberPass {
  const { request_id, request_status, request_decline_reason, request_requested_at, request_decided_at, ...pass } = row
  return {
    ...pass,
    request:
      request_id && request_status && request_requested_at
        ? {
            id: request_id,
            status: request_status,
            decline_reason: request_decline_reason,
            requested_at: request_requested_at,
            decided_at: request_decided_at,
          }
        : null,
  }
}

async function storePhoto(path: string, prepared: Awaited<ReturnType<typeof shrinkPhoto>>) {
  const { error } = await supabase!.storage.from(PHOTO_BUCKET).upload(path, prepared.blob, {
    contentType: prepared.type,
    cacheControl: '31536000',
    upsert: false,
  })
  if (error) throw new Error(`The photo could not be uploaded: ${error.message}`)
  return path
}

/** Shrinks and uploads a photo into a court's or location's folder; returns its stored path. */
async function uploadPhoto(kind: 'courts' | 'venues', ownerId: string, file: File) {
  const prepared = await shrinkPhoto(file)
  return storePhoto(`${requireActiveClubId()}/${kind}/${ownerId}/${crypto.randomUUID()}.${prepared.ext}`, prepared)
}

/** Shrinks and uploads a club picture (gallery photo, payment QR code, coach photo); returns its stored path. */
async function uploadClubPicture(folder: 'gallery' | 'payment' | 'coaches', file: File) {
  // A QR code keeps more detail, so it still scans after shrinking.
  const prepared = folder === 'payment' ? await shrinkPhoto(file, 1200, 0.95) : await shrinkPhoto(file)
  return storePhoto(`${requireActiveClubId()}/${folder}/${crypto.randomUUID()}.${prepared.ext}`, prepared)
}

type StoredCoach = Omit<ClubCoach, 'photo_url'>
type StoredPaymentMethod = Omit<ClubPaymentMethod, 'qr_url'>
type StoredGalleryPhoto = Omit<ClubGalleryPhoto, 'url'>

function toAddon(row: ClubAddon): ClubAddon {
  return { ...row, price: Number(row.price) }
}

function toCoach(row: StoredCoach): ClubCoach {
  return {
    ...row,
    hourly_rate: row.hourly_rate == null ? null : Number(row.hourly_rate),
    photo_url: row.photo_path ? photoUrl(row.photo_path) : null,
  }
}

function toCoachProfile(row: CoachProfileAccess): CoachProfileAccess {
  return { ...row, hourly_rate: row.hourly_rate == null ? null : Number(row.hourly_rate) }
}

function toCoachSlot(row: CoachBookingSlot): CoachBookingSlot {
  const raw = row as CoachBookingSlot & { id?: string; headline?: string | null; photo_path?: string | null }
  const slotId = raw.slot_id || raw.id
  if (!slotId) throw new Error('Coach slot response is missing its id')
  return {
    ...raw,
    slot_id: slotId,
    rate: Number(raw.rate),
    coach_headline: raw.headline ?? raw.coach_headline ?? null,
    coach_photo_url: raw.photo_path ? photoUrl(raw.photo_path) : raw.coach_photo_url ?? null,
  }
}

function toCoachRequest(row: CoachBookingRequest): CoachBookingRequest {
  return { ...row, rate: Number(row.rate), quoted_amount: Number(row.quoted_amount) }
}

function toPaymentMethod(row: StoredPaymentMethod): ClubPaymentMethod {
  return { ...row, qr_url: row.qr_path ? photoUrl(row.qr_path) : null }
}

function toGalleryPhoto(row: StoredGalleryPhoto): ClubGalleryPhoto {
  return { ...row, url: photoUrl(row.path) }
}

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
      .eq('id', requireActiveClubId())
      .eq('is_active', true)
      .maybeSingle()
    if (clubError) throw clubError
    if (!club) {
      // The club may have been suspended; let the app re-check where this person can act.
      notifyClubUnavailable()
      throw new Error('This club is not available right now. Please sign in again.')
    }
    const { data: venues, error: venueError } = await supabase
      .from('venues')
      .select('id, club_id, slug, name, timezone, open_hour, close_hour, is_active, address, city, latitude, longitude')
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
      .select('id, club_id, slug, name, timezone, open_hour, close_hour, is_active, address, city, latitude, longitude')
      .eq('club_id', requireActiveClubId())
      .order('name')
    if (error) throw error
    return (data ?? []) as Venue[]
  },

  async stats(venueId?: string): Promise<DashboardStats> {
    if (isDemoMode) return demoStore.stats(venueId)
    if (!supabase) throw new Error('No backend')
    let playingQuery = supabase.from('court_sessions').select('id').eq('club_id', requireActiveClubId()).eq('status', 'playing')
    let txQuery = supabase.from('transactions').select('amount').eq('club_id', requireActiveClubId()).gte('created_at', startOfToday())
    let courtQuery = supabase.from('courts').select('status').eq('club_id', requireActiveClubId())
    if (venueId) {
      playingQuery = playingQuery.eq('venue_id', venueId)
      txQuery = txQuery.eq('venue_id', venueId)
      courtQuery = courtQuery.eq('venue_id', venueId)
    }
    const [{ data: memberRows }, { data: playing }, { data: txs }, { data: courts }] = await Promise.all([
      supabase.from('member_roster').select('id').eq('club_id', requireActiveClubId()),
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
    const { data, error } = await supabase!.from('member_admin').select('*').eq('club_id', requireActiveClubId()).order('full_name')
    if (error) throw error
    return data as Member[]
  },

  async memberRoster(): Promise<Member[]> {
    if (isDemoMode) return demoStore.members().map(({ email: _email, phone: _phone, qr_token: _qr, ...member }) => member)
    const { data, error } = await supabase!.from('member_roster').select('*').eq('club_id', requireActiveClubId()).order('full_name')
    if (error) throw error
    return data as Member[]
  },

  async getMember(id: string): Promise<Member | null> {
    if (isDemoMode) return demoStore.member(id)
    const { data, error } = await supabase!.from('member_admin').select('*').eq('club_id', requireActiveClubId()).eq('id', id).maybeSingle()
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
    let query = supabase!.from('courts').select('*').eq('club_id', requireActiveClubId()).order('name')
    if (venueId) query = query.eq('venue_id', venueId)
    const { data, error } = await query
    if (error) throw error
    return data as Court[]
  },

  async playingSessions(venueId?: string): Promise<CourtSession[]> {
    if (isDemoMode) return demoStore.sessionsPlaying(venueId)
    let query = supabase!
      // Each of these tables links to courts three times (court_id plus two club/venue keys), so
      // PostgREST needs the plain court_id link named, or it refuses the request as ambiguous.
      .from('court_sessions')
      .select('*, court:courts!court_sessions_court_id_fkey(*)')
      .eq('club_id', requireActiveClubId())
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
    // Each venue's own opening hours decide which slots it offers.
    const venueIds = [...new Set(courts.map((court) => court.venue_id).filter(Boolean))] as string[]
    const { data: venueRows, error: venueError } = venueIds.length
      ? await supabase!.from('venues').select('id, open_hour, close_hour').in('id', venueIds)
      : { data: [], error: null }
    if (venueError) throw venueError
    const venueById = new Map((venueRows ?? []).map((venue) => [venue.id as string, venue as Pick<Venue, 'open_hour' | 'close_hour'>]))
    // A venue this account cannot read (closed, or not shared with it) offers no slots,
    // rather than falling back to all day.
    const hoursFor = (id: string | null | undefined) => {
      const venue = id ? venueById.get(id) : undefined
      return venue ? venueHours(venue) : { open: 0, close: 0 }
    }
    const dayStart = localRangeISO(dateYmd, CLUB_OPEN_HOUR, 1).start_at
    const dayEnd = localRangeISO(dateYmd, CLUB_CLOSE_HOUR - 1, 1).end_at
    // Private booking/session rows are owner-only for members. The safe schedule
    // preserves peer occupancy (including open play) without exposing identities.
    let scheduleQuery = supabase!
      .from('public_schedule')
      .select('court_id, start_at, end_at')
      .eq('club_id', requireActiveClubId())
      .lt('start_at', dayEnd)
      .gt('end_at', dayStart)
    if (venueId) scheduleQuery = scheduleQuery.eq('venue_id', venueId)
    const { data: occupied, error } = await scheduleQuery
    if (error) throw error

    return buildCourtAvailability(courts, hoursFor, (occupied ?? []) as OccupiedInterval[], dateYmd)
  },

  // ---- GCash QR checkout: the player holds hours, pays the club's QR, and the club confirms ----

  /**
   * A player's own checkout: holds the hours for BOOKING_HOLD_MINUTES while they pay. The
   * database finds the caller's own player record in the active club, so `member_id` and
   * `user_id` are not sent.
   */
  async createBooking(opts: {
    court_id: string
    venue_id?: string
    member_id: string
    dateYmd: string
    startHour: number
    hours: number
    user_id: string
  }): Promise<Booking> {
    if (isDemoMode) return demoStore.createBooking({ ...opts, checkoutHold: true })
    const clubId = requireActiveClubId()
    // Read first: the checkout shows the court, and a player looking at every venue sends none.
    const { data: court, error: courtError } = await supabase!
      .from('courts')
      .select('*')
      .eq('club_id', clubId)
      .eq('id', opts.court_id)
      .maybeSingle()
    if (courtError) throw checkoutError(courtError)
    if (!court) throw new Error('Court not found')
    const { data, error } = await supabase!.rpc('hold_court_booking', {
      p_club_id: clubId,
      p_venue_id: opts.venue_id ?? court.venue_id,
      p_court_id: opts.court_id,
      p_date: opts.dateYmd,
      p_start_hour: opts.startHour,
      p_hours: opts.hours,
    })
    if (error) throw checkoutError(error)
    return { ...bookingRow(data), court: court as Court }
  },

  /** Releases an unpaid checkout's hours (Back, or the time to pay ran out). Refused once a payment was sent. */
  async releaseBookingHold(bookingId: string): Promise<void> {
    if (isDemoMode) return demoStore.releaseBookingHold(bookingId)
    const { error } = await supabase!.rpc('release_booking_hold', { p_booking_id: bookingId })
    if (error) throw checkoutError(error)
  },

  /**
   * The player says they paid the club's GCash QR and gives the reference number. From then
   * the hours stay held until the club confirms or rejects the payment.
   */
  async submitBookingPayment(opts: { booking_id: string; reference: string }): Promise<Booking> {
    // Spaces and line breaks a person types or pastes are dropped; the database checks the rest.
    const reference = opts.reference.replace(/\s+/g, '')
    if (isDemoMode) return demoStore.submitBookingPayment({ booking_id: opts.booking_id, reference })
    const { data, error } = await supabase!.rpc('submit_booking_payment', { p_booking_id: opts.booking_id, p_reference: reference })
    if (error) throw checkoutError(error)
    return bookingRow(data)
  },

  /** One booking of the player's own (staff may read their venues' too), for checking on a checkout. */
  async myBooking(bookingId: string): Promise<Booking | null> {
    if (isDemoMode) return demoStore.myBooking(bookingId)
    const { data, error } = await supabase!
      .from('bookings')
      .select('*, court:courts!bookings_court_id_fkey(*)')
      .eq('club_id', requireActiveClubId())
      .eq('id', bookingId)
      .maybeSingle()
    if (error) throw checkoutError(error)
    return data ? ({ ...data, court: data.court as Court } as Booking) : null
  },

  /** The active club's ways to pay at checkout: the same active methods its public club page shows. */
  async checkoutPaymentMethods(): Promise<CheckoutPaymentMethod[]> {
    if (isDemoMode) return demoStore.checkoutPaymentMethods()
    const { data: club, error } = await supabase!.from('clubs').select('slug').eq('id', requireActiveClubId()).maybeSingle()
    if (error) throw checkoutError(error)
    if (!club) return []
    let profile: PublicClubProfile | null
    try {
      profile = await api.publicClubProfile(club.slug as string)
    } catch (profileError) {
      throw checkoutError(profileError)
    }
    return (profile?.payment_methods ?? []).map(({ id, label, account_name, account_number, qr_url }) => ({
      id, label, account_name, account_number, qr_url,
    }))
  },

  /** Staff and admins: payments players have sent that nobody has checked yet, oldest first. */
  async paymentsToConfirm(venueId?: string): Promise<Booking[]> {
    if (isDemoMode) return demoStore.paymentsToConfirm(venueId)
    let query = supabase!
      .from('bookings')
      .select('*, court:courts!bookings_court_id_fkey(*)')
      .eq('club_id', requireActiveClubId())
      .eq('status', 'pending_payment')
      .not('payment_submitted_at', 'is', null)
      .order('payment_submitted_at', { ascending: true })
      .limit(100)
    if (venueId) query = query.eq('venue_id', venueId)
    const { data, error } = await query
    if (error) throw checkoutError(error, PAYMENT_CHECKS_UNAVAILABLE)
    const roster = await this.memberRoster().catch(() => [] as Member[])
    return (data ?? []).map((b) => ({
      ...b,
      court: b.court as Court,
      member: roster.find((member) => member.id === b.member_id),
    })) as Booking[]
  },

  /** Staff and admins: the club found the player's GCash payment, so the hours are booked. */
  async confirmBookingPayment(bookingId: string): Promise<Booking> {
    if (isDemoMode) return demoStore.staffConfirmBookingPayment(bookingId)
    const { data, error } = await supabase!.rpc('staff_confirm_booking_payment', { p_booking_id: bookingId })
    if (error) throw checkoutError(error, PAYMENT_CHECKS_UNAVAILABLE)
    return bookingRow(data)
  },

  /** Staff and admins: the payment was not received, so the hours are released and the player is told why. */
  async rejectBookingPayment(bookingId: string, reason: string): Promise<Booking> {
    const why = reason.trim()
    if (isDemoMode) return demoStore.staffRejectBookingPayment(bookingId, why)
    if (why.length < 1 || why.length > 200) throw new Error('Say why in 1 to 200 characters, so the player knows what to do.')
    const { data, error } = await supabase!.rpc('staff_reject_booking_payment', { p_booking_id: bookingId, p_reason: why })
    if (error) throw checkoutError(error, PAYMENT_CHECKS_UNAVAILABLE)
    return bookingRow(data)
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
      p_club_id: requireActiveClubId(),
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

  async myBookings(memberId: string, venueId?: string): Promise<Booking[]> {
    if (isDemoMode) return demoStore.myBookings(memberId, venueId)
    let query = supabase!
      .from('bookings')
      .select('*, court:courts!bookings_court_id_fkey(*)')
      .eq('club_id', requireActiveClubId())
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
      .select('*, court:courts!bookings_court_id_fkey(*)')
      .eq('club_id', requireActiveClubId())
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

  /**
   * The active club's bookings that start in [from, to), oldest first, with their court.
   * Read-only, for the owner dashboard: admins and staff read bookings under RLS
   * (bookings_access_select plus the restrictive private_read_scope). Capped at
   * ANALYTICS_ROW_CAP rows; past the cap the oldest are left out.
   */
  async bookingsBetween(fromIso: string, toIso: string): Promise<Booking[]> {
    if (isDemoMode) return demoStore.bookingsBetween(fromIso, toIso)
    const clubId = requireActiveClubId()
    const rows = await readPages<Booking>((first, last) => supabase!
      .from('bookings')
      .select('*, court:courts!bookings_court_id_fkey(*)')
      .eq('club_id', clubId)
      .gte('start_at', fromIso)
      .lt('start_at', toIso)
      .order('start_at', { ascending: false })
      .order('id', { ascending: false })
      .range(first, last))
    return rows.reverse().map((b) => ({ ...b, hours: Number(b.hours), amount: Number(b.amount), court: b.court as Court }))
  },

  /** The active club's charges recorded in [from, to), oldest first. Capped like bookingsBetween. */
  async transactionsBetween(fromIso: string, toIso: string): Promise<Transaction[]> {
    if (isDemoMode) return demoStore.transactionsBetween(fromIso, toIso)
    const clubId = requireActiveClubId()
    const rows = await readPages<Transaction>((first, last) => supabase!
      .from('transactions')
      .select('id, club_id, venue_id, member_id, amount, type, description, verification_status, created_at')
      .eq('club_id', clubId)
      .gte('created_at', fromIso)
      .lt('created_at', toIso)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(first, last))
    return rows.reverse().map((tx) => ({ ...tx, amount: Number(tx.amount) }))
  },

  /**
   * The active club's own commission lines recorded in [from, to). Club admins may read
   * them (policy platform_commissions_admin_select); anyone else gets an error or nothing.
   */
  async myClubCommission(fromIso: string, toIso: string): Promise<ClubCommissionLine[]> {
    if (isDemoMode) return demoStore.clubCommissionBetween(fromIso, toIso)
    const clubId = requireActiveClubId()
    const rows = await readPages<ClubCommissionLine>((first, last) => supabase!
      .from('platform_commissions')
      .select('commission_amount, gross_amount, created_at')
      .eq('club_id', clubId)
      .gte('created_at', fromIso)
      .lt('created_at', toIso)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(first, last))
    return rows.map((row) => ({
      commission_amount: Number(row.commission_amount),
      gross_amount: Number(row.gross_amount),
      created_at: row.created_at,
    }))
  },

  /**
   * The owner dashboard figures for the active club: the last `days` days and the days
   * before them. Uses the server summary when the database has it; otherwise (and in the
   * demo) adds the figures up in the browser from rows a club admin can already read.
   */
  async clubAnalytics(days: AnalyticsPeriod): Promise<ClubAnalytics> {
    if (!isDemoMode) {
      const { data, error } = await supabase!.rpc('admin_club_analytics', { p_club_id: requireActiveClubId(), p_days: days })
      if (!error && data) return normalizeClubAnalytics(Array.isArray(data) ? data[0] : data)
      if (error && !isUnavailableFunction(error)) throw error
    }
    const now = new Date()
    const window = analyticsWindow(days, now)
    const from = rangeInstants(window.previous).from
    const to = rangeInstants(window.current).to
    const [transactions, bookings, members, courts, venues, commissions] = await Promise.all([
      api.transactionsBetween(from, to),
      api.bookingsBetween(from, to),
      api.memberRoster(),
      api.listCourts(),
      api.listAllVenues(),
      api.myClubCommission(from, to).catch(() => [] as ClubCommissionLine[]),
    ])
    return buildClubAnalytics({ window, transactions, bookings, members, courts, venues, commissions, now })
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
      p_club_id: requireActiveClubId(),
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
      .eq('club_id', requireActiveClubId())
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
    let q = supabase!.from('transactions').select('*').eq('club_id', requireActiveClubId()).order('created_at', {
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

  async createInquiry(input: {
    user_id: string
    category: InquiryCategory
    subject: string
    message: string
  }): Promise<SupportInquiry> {
    if (isDemoMode) return demoStore.createInquiry(input)
    const { data, error } = await supabase!
      .from('support_inquiries')
      .insert({ ...input, club_id: requireActiveClubId(), status: 'open' })
      .select()
      .single()
    if (error) throw error
    return data as SupportInquiry
  },

  async inquiries(userId: string, role: Role): Promise<SupportInquiry[]> {
    if (isDemoMode) {
      return role === 'admin'
        ? demoStore.allInquiries()
        : demoStore.inquiriesForUser(userId)
    }
    const base = supabase!
      .from('support_inquiries')
      .select('*')
      .eq('club_id', requireActiveClubId())
      .order('created_at', { ascending: false })
    const query = role === 'admin' ? base : base.eq('user_id', userId)
    const { data, error } = await query
    if (error) throw error
    const rows = (data ?? []) as SupportInquiry[]
    if (role !== 'admin') return rows
    const accounts = await this.staffAccounts()
    return rows.map((row) => ({
      ...row,
      sender: accounts.find((account) => account.id === row.user_id) ?? null,
    }))
  },

  async updateInquiry(input: {
    id: string
    status: InquiryStatus
    response?: string
  }): Promise<SupportInquiry> {
    if (isDemoMode) {
      return demoStore.respondToInquiry(input)
    }
    const { data, error } = await supabase!.rpc('admin_update_support_inquiry', {
      p_inquiry_id: input.id,
      p_status: input.status,
      p_response: input.response?.trim() || null,
    }).single()
    if (error) throw error
    return data as SupportInquiry
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

  /** Admin only: set or clear a location's address, city and map pin. */
  async updateVenueLocation(input: VenueLocationInput): Promise<Venue> {
    if (isDemoMode) return demoStore.updateVenueLocation(input)
    const { data, error } = await supabase!.rpc('admin_update_venue_location', {
      p_venue_id: input.venue_id,
      p_address: input.address,
      p_city: input.city,
      p_latitude: input.latitude,
      p_longitude: input.longitude,
    })
    if (error) throw error
    return data as Venue
  },

  /** Admin only: add a court to a venue, or rename, re-price, or take one out of service. */
  async upsertCourt(input: CourtInput): Promise<Court> {
    if (isDemoMode) return demoStore.upsertCourt(input)
    const { data, error } = await supabase!.rpc('admin_upsert_court', {
      p_court_id: input.id ?? null,
      p_venue_id: input.venue_id,
      p_name: input.name,
      p_hourly_rate: input.hourly_rate,
      p_member_rate: input.member_rate ?? null,
      p_in_service: input.in_service,
    })
    if (error) throw error
    const court = data as Court
    // The type has its own function; it is called only when the admin changed it.
    if (input.court_type === undefined || (court.court_type ?? null) === input.court_type) return court
    const { data: typed, error: typeError } = await supabase!.rpc('admin_set_court_type', {
      p_court_id: court.id,
      p_court_type: input.court_type,
    })
    if (typeError) throw typeError
    return typed as Court
  },

  // ---- Court and location photos (admins only; public as soon as saved) ----

  /** Every photo of the active club, main photos first. */
  async listCourtPhotos(): Promise<CourtPhoto[]> {
    if (isDemoMode) return demoStore.listCourtPhotos()
    const { data, error } = await supabase!
      .from('court_photos')
      .select('id, club_id, venue_id, court_id, path, position, created_at')
      .eq('club_id', requireActiveClubId())
      .order('position')
      .order('created_at')
    if (error) throw error
    return ((data ?? []) as Omit<CourtPhoto, 'url'>[]).map((row) => ({ ...row, url: photoUrl(row.path) }))
  },

  /** Adds a photo to a court. The photo is shrunk in the browser first. */
  async addCourtPhoto(courtId: string, file: File): Promise<CourtPhoto> {
    if (isDemoMode) return demoStore.addCourtPhoto(courtId, await shrinkPhotoToDataUrl(file))
    const path = await uploadPhoto('courts', courtId, file)
    const { data, error } = await supabase!.rpc('admin_add_court_photo', { p_court_id: courtId, p_path: path })
    if (error) {
      await deletePhotoFile(path)
      throw error
    }
    const row = data as Omit<CourtPhoto, 'url'>
    return { ...row, url: photoUrl(row.path) }
  },

  /** Shows this photo first on the court's card. */
  async makeMainCourtPhoto(photoId: string): Promise<void> {
    if (isDemoMode) return demoStore.makeMainCourtPhoto(photoId)
    const { error } = await supabase!.rpc('admin_make_main_court_photo', { p_photo_id: photoId })
    if (error) throw error
  },

  async removeCourtPhoto(photoId: string): Promise<PictureCleanup> {
    if (isDemoMode) {
      demoStore.removeCourtPhoto(photoId)
      return { fileLeftBehind: false }
    }
    const { data, error } = await supabase!.rpc('admin_remove_court_photo', { p_photo_id: photoId })
    if (error) throw error
    return deleteReplacedPicture(data)
  },

  /** Sets a location's cover photo, or removes it when `file` is null. */
  async setVenueCover(venueId: string, file: File | null): Promise<PictureCleanup> {
    if (isDemoMode) {
      demoStore.setVenueCover(venueId, file ? await shrinkPhotoToDataUrl(file) : null)
      return { fileLeftBehind: false }
    }
    const path = file ? await uploadPhoto('venues', venueId, file) : null
    const { data, error } = await supabase!.rpc('admin_set_venue_cover', { p_venue_id: venueId, p_path: path })
    if (error) {
      await deletePhotoFile(path)
      throw error
    }
    return deleteReplacedPicture(data, path)
  },

  /**
   * The club's picture files that nothing uses any more (older than an hour): files whose
   * delete failed, and uploads that were never saved. The demo stores no files.
   */
  async unusedClubPictures(): Promise<string[]> {
    if (isDemoMode) return []
    const { data, error } = await supabase!.rpc('admin_unused_club_pictures')
    if (error) throw error
    return (data as string[] | null) ?? []
  },

  /**
   * Deletes the files `unusedClubPictures` lists, asking the database again first so only
   * files nothing uses are deleted. Up to 200 at a time; `more` says when to run it again.
   */
  async deleteUnusedClubPictures(): Promise<{ deleted: number; left: number; more: boolean }> {
    const paths = await this.unusedClubPictures()
    const { deleted, left } = await deletePhotoFiles(paths)
    return { deleted, left, more: paths.length >= 200 }
  },

  // ---- Club business profile (admins write it; the club page shows it to everyone) ----

  /** Everything on the Business profile screen for the active club, inactive items included. */
  async adminClubProfile(): Promise<AdminClubProfile> {
    if (isDemoMode) return demoStore.clubProfile()
    const { data, error } = await supabase!.rpc('admin_club_profile')
    if (error) throw error
    const row = data as {
      profile: ClubProfileFields | null
      addons: ClubAddon[]
      coaches: StoredCoach[]
      payment_methods: StoredPaymentMethod[]
      gallery: StoredGalleryPhoto[]
    }
    return {
      profile: row.profile ? normalizeProfile(row.profile) : emptyClubProfile(),
      addons: (row.addons ?? []).map(toAddon),
      coaches: (row.coaches ?? []).map(toCoach),
      payment_methods: (row.payment_methods ?? []).map(toPaymentMethod),
      gallery: (row.gallery ?? []).map(toGalleryPhoto),
    }
  },

  /** Saves the whole profile. Empty fields are cleared. */
  async updateClubProfile(fields: ClubProfileFields): Promise<void> {
    // Tidied here, because the database trims spaces only: a pasted line break would
    // otherwise fail its link checks, or keep a blank box as if it were filled in.
    const clean = normalizeProfile(fields)
    if (isDemoMode) {
      demoStore.updateClubProfile(clean)
      return
    }
    const { error } = await supabase!.rpc('admin_update_club_profile', {
      p_about: clean.about,
      p_phone: clean.phone,
      p_email: clean.email,
      p_facebook_url: clean.facebook_url,
      p_messenger_url: clean.messenger_url,
      p_instagram_url: clean.instagram_url,
      p_website_url: clean.website_url,
      p_amenities: clean.amenities,
      p_payment_note: clean.payment_note,
      p_house_rules: clean.house_rules,
      p_cancellation_policy: clean.cancellation_policy,
      p_terms: clean.terms,
    })
    if (error) throw error
  },

  async upsertClubAddon(input: ClubAddonInput): Promise<ClubAddon> {
    if (isDemoMode) return demoStore.upsertClubAddon(input)
    const { data, error } = await supabase!.rpc('admin_upsert_club_addon', {
      p_addon_id: input.id ?? null,
      p_name: input.name.trim(),
      p_description: input.description,
      p_price: input.price,
      p_unit: input.unit,
      p_is_active: input.is_active,
    })
    if (error) throw error
    return toAddon(data as ClubAddon)
  },

  async removeClubAddon(addonId: string): Promise<void> {
    if (isDemoMode) return demoStore.removeClubAddon(addonId)
    const { error } = await supabase!.rpc('admin_remove_club_addon', { p_addon_id: addonId })
    if (error) throw error
  },

  async upsertClubCoach(input: ClubCoachInput): Promise<ClubCoach> {
    if (isDemoMode) return demoStore.upsertClubCoach(input)
    const { data, error } = await supabase!.rpc('admin_upsert_club_coach', {
      p_coach_id: input.id ?? null,
      p_full_name: input.full_name.trim(),
      p_headline: input.headline,
      p_bio: input.bio,
      p_hourly_rate: input.hourly_rate,
      p_contact_phone: input.contact_phone,
      p_contact_url: input.contact_url,
      p_is_active: input.is_active,
    })
    if (error) throw error
    return toCoach(data as StoredCoach)
  },

  /** Sets a coach's photo, or removes it when `file` is null. */
  async setClubCoachPhoto(coachId: string, file: File | null): Promise<PictureCleanup> {
    if (isDemoMode) {
      demoStore.setClubCoachPhoto(coachId, file ? await shrinkPhotoToDataUrl(file) : null)
      return { fileLeftBehind: false }
    }
    const path = file ? await uploadClubPicture('coaches', file) : null
    const { data, error } = await supabase!.rpc('admin_set_club_coach_photo', { p_coach_id: coachId, p_path: path })
    if (error) {
      await deletePhotoFile(path)
      throw error
    }
    return deleteReplacedPicture(data, path)
  },

  async removeClubCoach(coachId: string): Promise<PictureCleanup> {
    if (isDemoMode) {
      demoStore.removeClubCoach(coachId)
      return { fileLeftBehind: false }
    }
    const { data, error } = await supabase!.rpc('admin_remove_club_coach', { p_coach_id: coachId })
    if (error) throw error
    return deleteReplacedPicture(data)
  },

  async linkClubCoachAccount(coachId: string, email: string | null): Promise<void> {
    if (isDemoMode) return demoStore.linkClubCoachAccount(coachId, email)
    const { error } = await supabase!.rpc('admin_link_club_coach_account', {
      p_coach_id: coachId,
      p_email: email,
    })
    if (error) throw error
  },

  async coachMyProfiles(): Promise<CoachProfileAccess[]> {
    if (isDemoMode) return demoStore.coachMyProfiles()
    const { data, error } = await supabase!.rpc('coach_my_profiles')
    if (error) throw error
    return ((data ?? []) as CoachProfileAccess[]).map(toCoachProfile)
  },

  async coachSetBookingPolicy(coachId: string, policy: string): Promise<void> {
    if (isDemoMode) return demoStore.coachSetBookingPolicy(coachId, policy)
    const { error } = await supabase!.rpc('coach_set_booking_policy', {
      p_coach_id: coachId,
      p_policy: policy.trim(),
    })
    if (error) throw error
  },

  async coachListMySlots(): Promise<CoachBookingSlot[]> {
    if (isDemoMode) return demoStore.coachListMySlots()
    const { data, error } = await supabase!.rpc('coach_list_my_slots')
    if (error) throw error
    return ((data ?? []) as CoachBookingSlot[]).map(toCoachSlot)
  },

  async coachUpsertBookingSlot(input: {
    id?: string
    coach_id: string
    starts_at: string
    ends_at: string
    lesson_type: 'private' | 'group'
    pricing_model: 'per_student' | 'per_session'
    rate: number
    max_students: number
  }): Promise<void> {
    if (isDemoMode) {
      demoStore.coachUpsertBookingSlot(input)
      return
    }
    const { error } = await supabase!.rpc('coach_upsert_booking_slot', {
      p_slot_id: input.id ?? null,
      p_coach_id: input.coach_id,
      p_starts_at: input.starts_at,
      p_ends_at: input.ends_at,
      p_lesson_type: input.lesson_type,
      p_pricing_model: input.pricing_model,
      p_rate: input.rate,
      p_max_students: input.max_students,
    })
    if (error) throw error
  },

  async coachSetBookingSlotOpen(slotId: string, isOpen: boolean): Promise<void> {
    if (isDemoMode) {
      demoStore.coachSetBookingSlotOpen(slotId, isOpen)
      return
    }
    const { error } = await supabase!.rpc('coach_set_booking_slot_open', {
      p_slot_id: slotId,
      p_is_open: isOpen,
    })
    if (error) throw error
  },

  /** Active coaches and open future lesson times across every active club (the public Rent a coach page). */
  async listPublicCoaches(options?: { clubSlug?: string | null; from?: string; until?: string }): Promise<PublicCoachListing[]> {
    const from = options?.from ?? new Date().toISOString()
    const until = options?.until ?? new Date(Date.now() + 30 * 86400000).toISOString()
    const clubSlug = options?.clubSlug?.trim() || null
    if (isDemoMode) return demoStore.listPublicCoaches({ clubSlug, from, until })
    const { data, error } = await supabase!.rpc('list_public_coaches', {
      p_club_slug: clubSlug,
      p_from: from,
      p_until: until,
    })
    if (error) {
      if (isMissingFunction(error)) {
        const wantedSlug = clubSlug?.toLowerCase() ?? null
        const allClubs = await api.listPublicClubs()
        const matchingClubs = (wantedSlug
          ? allClubs.filter((club) => club.slug.toLowerCase() === wantedSlug)
          : allClubs
        ).slice().sort((a, b) =>
          (a.slug === DEFAULT_CLUB_SLUG ? 0 : 1) - (b.slug === DEFAULT_CLUB_SLUG ? 0 : 1)
          || a.name.localeCompare(b.name),
        )
        const targets = matchingClubs.length > 0 || !wantedSlug
          ? matchingClubs.map((club) => ({
              slug: club.slug,
              name: club.name,
              city: club.city ?? club.cities[0] ?? null,
            }))
          : [{ slug: clubSlug!, name: '', city: null as string | null }]

        const listings = await Promise.all(
          targets.map(async (target) => {
            const [profile, clubInfo] = await Promise.all([
              api.publicClubProfile(target.slug).catch(() => null),
              api.publicClub(target.slug).catch(() => null),
            ])
            if (!profile || profile.coaches.length === 0) return []
            const clubMeta = {
              id: clubInfo?.id ?? target.slug,
              slug: clubInfo?.slug ?? target.slug,
              name: clubInfo?.name ?? (target.name || target.slug),
              city: target.city,
            }
            return profile.coaches.map((coach): PublicCoachListing => ({
              id: coach.id,
              full_name: coach.full_name,
              headline: coach.headline,
              bio: coach.bio,
              hourly_rate: coach.hourly_rate,
              contact_phone: coach.contact_phone,
              contact_url: coach.contact_url,
              photo_url: coach.photo_url,
              booking_policy: null,
              accepts_requests: false,
              club: clubMeta,
              slots: [],
            }))
          }),
        )
        return listings.flat()
      }
      throw error
    }

    type RawPublicCoachRow = Omit<PublicCoachListing, 'photo_url' | 'slots'> & {
      photo_path?: string | null
      photo_url?: string | null
      slots?: PublicCoachSlot[]
    }
    return ((data ?? []) as RawPublicCoachRow[])
      .map((row) => ({
        id: String(row.id ?? ''),
        full_name: String(row.full_name ?? ''),
        headline: row.headline ?? null,
        bio: row.bio ?? null,
        hourly_rate: row.hourly_rate == null ? null : Number(row.hourly_rate),
        contact_phone: row.contact_phone ?? null,
        contact_url: row.contact_url ?? null,
        photo_url: row.photo_path ? photoUrl(row.photo_path) : row.photo_url ?? null,
        booking_policy: row.booking_policy ?? null,
        accepts_requests: Boolean(row.accepts_requests),
        club: {
          id: String(row.club?.id ?? ''),
          slug: String(row.club?.slug ?? ''),
          name: String(row.club?.name ?? ''),
          city: row.club?.city ?? null,
        },
        slots: (row.slots ?? []).map((slot) => ({
          slot_id: String(slot.slot_id),
          starts_at: slot.starts_at,
          ends_at: slot.ends_at,
          lesson_type: slot.lesson_type,
          pricing_model: slot.pricing_model,
          rate: Number(slot.rate),
          max_students: Number(slot.max_students),
          remaining_students: Number(slot.remaining_students),
        })),
      }))
      .filter((row) => row.id !== '' && row.club.slug !== '')
  },

  async memberListCoachSlots(from: string, until: string): Promise<CoachBookingSlot[]> {
    if (isDemoMode) return demoStore.memberListCoachSlots(from, until)
    const { data, error } = await supabase!.rpc('member_list_coach_slots', {
      p_from: from,
      p_until: until,
    })
    if (error) throw error
    return ((data ?? []) as CoachBookingSlot[]).map(toCoachSlot)
  },

  async memberRequestCoachSlot(input: {
    slot: CoachBookingSlot
    student_count: number
    message: string
  }): Promise<CoachBookingRequest> {
    if (isDemoMode) return demoStore.memberRequestCoachSlot(input)
    const { data, error } = await supabase!.rpc('member_request_coach_slot', {
      p_slot_id: input.slot.slot_id,
      p_student_count: input.student_count,
      p_message: input.message,
    })
    if (error) throw error
    const row = data as {
      id: string
      slot_id: string
      club_id: string
      student_count: number
      quoted_amount: number
      message: string | null
      status: CoachBookingRequest['status']
      created_at: string
    }
    return {
      request_id: row.id,
      slot_id: row.slot_id,
      club_id: row.club_id,
      coach_id: input.slot.coach_id,
      coach_name: input.slot.coach_name,
      starts_at: input.slot.starts_at,
      ends_at: input.slot.ends_at,
      lesson_type: input.slot.lesson_type,
      pricing_model: input.slot.pricing_model,
      rate: input.slot.rate,
      student_count: row.student_count,
      quoted_amount: Number(row.quoted_amount),
      message: row.message,
      status: row.status,
      created_at: row.created_at,
    }
  },

  async coachListMyRequests(): Promise<CoachBookingRequest[]> {
    if (isDemoMode) return demoStore.coachListMyRequests()
    const { data, error } = await supabase!.rpc('coach_list_my_requests')
    if (error) throw error
    return ((data ?? []) as CoachBookingRequest[]).map(toCoachRequest)
  },

  async memberListMyCoachRequests(): Promise<CoachBookingRequest[]> {
    if (isDemoMode) return demoStore.memberListMyCoachRequests()
    const { data, error } = await supabase!.rpc('member_list_my_coach_requests')
    if (error) throw error
    return ((data ?? []) as CoachBookingRequest[]).map(toCoachRequest)
  },

  async coachRespondToBookingRequest(requestId: string, accept: boolean): Promise<void> {
    if (isDemoMode) return demoStore.coachRespondToBookingRequest(requestId, accept)
    const { error } = await supabase!.rpc('coach_respond_to_booking_request', {
      p_request_id: requestId,
      p_accept: accept,
    })
    if (error) throw error
  },

  async memberCancelCoachRequest(requestId: string): Promise<void> {
    if (isDemoMode) return demoStore.memberCancelCoachRequest(requestId)
    const { error } = await supabase!.rpc('member_cancel_coach_request', { p_request_id: requestId })
    if (error) throw error
  },

  async coachSendRequestMessage(requestId: string, body: string): Promise<CoachRequestMessage> {
    if (isDemoMode) return demoStore.coachSendRequestMessage(requestId, body)
    const { data, error } = await supabase!.rpc('coach_send_request_message', {
      p_request_id: requestId,
      p_body: body.trim(),
    })
    if (error) throw error
    return data as CoachRequestMessage
  },

  async coachListRequestMessages(requestId: string): Promise<CoachRequestMessage[]> {
    if (isDemoMode) return demoStore.coachListRequestMessages(requestId)
    const { data, error } = await supabase!.rpc('coach_list_request_messages', {
      p_request_id: requestId,
    })
    if (error) throw error
    return (data ?? []) as CoachRequestMessage[]
  },

  async upsertClubPaymentMethod(input: ClubPaymentMethodInput): Promise<ClubPaymentMethod> {
    if (isDemoMode) return demoStore.upsertClubPaymentMethod(input)
    const { data, error } = await supabase!.rpc('admin_upsert_club_payment_method', {
      p_method_id: input.id ?? null,
      p_label: input.label.trim(),
      p_account_name: input.account_name,
      p_account_number: input.account_number,
      p_is_active: input.is_active,
    })
    if (error) throw error
    return toPaymentMethod(data as StoredPaymentMethod)
  },

  /** Sets a payment method's QR code picture, or removes it when `file` is null. */
  async setClubPaymentQr(methodId: string, file: File | null): Promise<PictureCleanup> {
    if (isDemoMode) {
      demoStore.setClubPaymentQr(methodId, file ? await shrinkPhotoToDataUrl(file) : null)
      return { fileLeftBehind: false }
    }
    const path = file ? await uploadClubPicture('payment', file) : null
    const { data, error } = await supabase!.rpc('admin_set_club_payment_qr', { p_method_id: methodId, p_path: path })
    if (error) {
      await deletePhotoFile(path)
      throw error
    }
    return deleteReplacedPicture(data, path)
  },

  async removeClubPaymentMethod(methodId: string): Promise<PictureCleanup> {
    if (isDemoMode) {
      demoStore.removeClubPaymentMethod(methodId)
      return { fileLeftBehind: false }
    }
    const { data, error } = await supabase!.rpc('admin_remove_club_payment_method', { p_method_id: methodId })
    if (error) throw error
    return deleteReplacedPicture(data)
  },

  /** Adds a photo to the club's gallery. The photo is shrunk in the browser first. */
  async addClubPhoto(file: File, caption: string | null): Promise<ClubGalleryPhoto> {
    if (isDemoMode) return demoStore.addClubPhoto(await shrinkPhotoToDataUrl(file), caption)
    const path = await uploadClubPicture('gallery', file)
    const { data, error } = await supabase!.rpc('admin_add_club_photo', { p_path: path, p_caption: caption })
    if (error) {
      await deletePhotoFile(path)
      throw error
    }
    return toGalleryPhoto(data as StoredGalleryPhoto)
  },

  async removeClubPhoto(photoId: string): Promise<PictureCleanup> {
    if (isDemoMode) {
      demoStore.removeClubPhoto(photoId)
      return { fileLeftBehind: false }
    }
    const { data, error } = await supabase!.rpc('admin_remove_club_photo', { p_photo_id: photoId })
    if (error) throw error
    return deleteReplacedPicture(data)
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

  // ---- Member account: name, nickname and photo (the person's own profile) ----

  /** Changes the person's full name (on their account and every club's member card) and nickname. */
  async updateMyAccount(userId: string, input: AccountInput): Promise<void> {
    if (isDemoMode) return demoStore.updateMyAccount(userId, input)
    const { error } = await supabase!.rpc('update_my_account', {
      p_full_name: input.full_name,
      p_nickname: input.nickname?.trim() ? input.nickname : null,
    })
    if (error) throw error
  },

  /**
   * Sets the person's profile photo, or removes it when `file` is null. Uploads into their own
   * folder of the public member-photos bucket, then deletes the photo it replaced.
   * Returns the new photo's link, or null when removed.
   */
  async setMyPhoto(userId: string, file: File | null, previousPath?: string | null): Promise<string | null> {
    if (isDemoMode) {
      const dataUrl = file ? await shrinkPhotoToDataUrl(file) : null
      return demoStore.setMyPhoto(userId, dataUrl)
    }
    let path: string | null = null
    if (file) {
      // A face needs far less than a court photo.
      const prepared = await shrinkPhoto(file, 800)
      // The folder holds at most 3 files, so clear anything left by an earlier failed swap first.
      await clearLeftoverMemberPhotos(userId, previousPath)
      path = `${userId}/${crypto.randomUUID()}.${prepared.ext}`
      const { error: uploadError } = await supabase!.storage.from(MEMBER_PHOTO_BUCKET).upload(path, prepared.blob, {
        contentType: prepared.type,
        // A day, not a year: a removed photo should stop showing soon after.
        cacheControl: '86400',
        upsert: false,
      })
      if (uploadError) {
        if (/row-level security/i.test(uploadError.message)) {
          throw new Error('You have too many photo files saved. Remove your photo, then add the new one.')
        }
        throw new Error(`The photo could not be uploaded: ${uploadError.message}`)
      }
    }
    const { error } = await supabase!.rpc('set_my_photo', { p_path: path })
    if (error) {
      if (path) await supabase!.storage.from(MEMBER_PHOTO_BUCKET).remove([path])
      throw error
    }
    // The old file is no longer linked; a failed clean-up leaves only an unlisted file behind.
    if (previousPath && previousPath !== path && !previousPath.startsWith('data:')) {
      await supabase!.storage.from(MEMBER_PHOTO_BUCKET).remove([previousPath])
    }
    return path ? memberPhotoUrl(path) : null
  },

  // ---- QR wallet and membership requests ----

  /** One check-in pass per club the person belongs to; ignores the active club. */
  async myMemberPasses(userId: string): Promise<MemberPass[]> {
    if (isDemoMode) return demoStore.myMemberPasses(userId)
    const { data, error } = await supabase!.rpc('list_my_member_passes')
    if (error) throw error
    return ((data ?? []) as MemberPassRow[]).map(passFromRow)
  },

  /** Asks a club the person already belongs to for a membership (or a renewal). Returns the request id. */
  async requestMembership(userId: string, clubId: string): Promise<string> {
    if (isDemoMode) return demoStore.requestMembership(userId, clubId)
    const { data, error } = await supabase!.rpc('request_club_membership', { p_club_id: clubId })
    if (error) throw error
    return data as string
  },

  /** Withdraws the person's own pending request. */
  async cancelMembershipRequest(userId: string, requestId: string): Promise<void> {
    if (isDemoMode) return demoStore.cancelMembershipRequest(userId, requestId)
    const { error } = await supabase!.rpc('cancel_my_membership_request', { p_request_id: requestId })
    if (error) throw error
  },

  /** The active club's membership requests, for its staff and admins: pending ones, or recently decided ones. */
  async membershipRequests(which: 'pending' | 'decided' = 'pending'): Promise<MembershipRequest[]> {
    if (isDemoMode) return demoStore.membershipRequests(which)
    const { data, error } = await supabase!.rpc('staff_list_membership_requests', { p_which: which })
    if (error) throw error
    return ((data ?? []) as (Omit<MembershipRequest, 'photo_url'> & { photo_path: string | null })[]).map(
      ({ photo_path, ...row }) => ({
        ...row,
        amount: row.amount == null ? null : Number(row.amount),
        photo_url: photo_path ? memberPhotoUrl(photo_path) : null,
      }),
    )
  },

  /** Starts or extends the membership by 30 days and records the amount received as a membership charge. */
  async approveMembershipRequest(requestId: string, approval: MembershipApproval, staffId: string): Promise<void> {
    if (isDemoMode) return demoStore.approveMembershipRequest(requestId, approval, staffId)
    const { error } = await supabase!.rpc('staff_approve_membership_request', {
      p_request_id: requestId,
      p_membership_type: approval.membership_type,
      p_amount: approval.amount,
    })
    if (error) throw error
  },

  /** Declines a request with a reason the player sees. */
  async declineMembershipRequest(requestId: string, reason: string, staffId: string): Promise<void> {
    if (isDemoMode) return demoStore.declineMembershipRequest(requestId, reason, staffId)
    const { error } = await supabase!.rpc('staff_decline_membership_request', { p_request_id: requestId, p_reason: reason })
    if (error) throw error
  },

    async listOpenPlays(includePast = false, venueId?: string): Promise<OpenPlaySession[]> {
      if (isDemoMode) return demoStore.listOpenPlays(includePast, venueId)
      let query = supabase!
        .from('open_plays')
        .select('*, court:courts!open_plays_court_id_fkey(*)')
        .eq('club_id', requireActiveClubId())
        .order('start_at', { ascending: true })
      if (venueId) query = query.eq('venue_id', venueId)
      const { data, error } = await query
      if (error) throw error
      const ids = (data ?? []).map((x) => x.id)
      const { data: signups, error: signupError } = await supabase!
        .from('open_play_signups')
        .select('*')
        .eq('club_id', requireActiveClubId())
        .in('open_play_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
      if (signupError) throw signupError
      const { data: counts, error: countError } = await supabase!
        .from('open_play_seat_counts')
        .select('open_play_id, seats_taken')
        .eq('club_id', requireActiveClubId())
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
      p_club_id: requireActiveClubId(),
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

    /**
     * Public board data. A TV link names its club, which is sent on this request
     * only, so an anonymous board tab never changes the signed-in club.
     */
    async publicDaySchedule(dateYmd: string, venueId?: string, clubId?: string | null): Promise<ScheduleBlock[]> {
      if (isDemoMode) {
        return demoStore.daySchedule(dateYmd, venueId, clubId).map((block) => ({
          ...block,
          title: block.kind === 'open_play' ? 'Open play' : block.kind === 'booking' ? 'Reserved' : 'In use',
          subtitle: block.status,
          amount: undefined,
        }))
      }
      const club = clubId ?? getActiveClubId()
      let query = supabase!
        .from('public_schedule')
        .select('id, venue_id, venue_name, court_id, court_name, title, kind, start_at, end_at, status, subtitle')
        .gte('start_at', localRangeISO(dateYmd, 0, 1).start_at)
        .lt('start_at', localRangeISO(dateYmd, 24, 1).start_at)
      if (club) query = query.eq('club_id', club).setHeader(CLUB_HEADER, club)
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

    async checkInByQr(payload: string, staffId?: string, venueId?: string): Promise<CheckInResult> {
      if (isDemoMode) return demoStore.checkInByQr(payload, staffId, venueId)
      const { data, error } = await supabase!.rpc('check_in_qr', {
        p_payload: payload,
        p_venue_id: venueId ?? null,
      })
      if (error) throw error
      const result = data as {
        checkin: CheckIn
        member: Omit<CheckInResult['member'], 'photo_url'> & { photo_path?: string | null }
      }
      const { photo_path, ...member } = result.member
      return { checkin: result.checkin, member: { ...member, photo_url: photo_path ? memberPhotoUrl(photo_path) : null } }
    },

    // ---- Club membership and access (club list ignores the active club) ----

    async myClubs(userId: string): Promise<MyClub[]> {
      if (isDemoMode) return demoStore.myClubs(userId)
      const { data, error } = await supabase!.rpc('list_my_clubs')
      if (error) throw error
      return ((data ?? []) as MyClub[]).map((club) => ({ club_id: club.club_id, slug: club.slug, name: club.name, role: club.role }))
    },

    async platformAccess(userId: string): Promise<'superadmin' | null> {
      if (isDemoMode) return demoStore.platformAccess(userId)
      const { data, error } = await supabase!.rpc('get_platform_access')
      if (error) throw error
      return data === 'superadmin' ? 'superadmin' : null
    },

    async publicClub(slug: string): Promise<PublicClub | null> {
      if (isDemoMode) return demoStore.publicClub(slug)
      const { data, error } = await supabase!.rpc('get_public_club', { p_slug: slug })
      if (error) throw error
      const row = Array.isArray(data) ? data[0] : data
      return row ? { id: row.id, slug: row.slug, name: row.name } : null
    },

    async joinClub(userId: string, slug: string): Promise<string> {
      if (isDemoMode) return demoStore.joinClub(userId, slug)
      const { data, error } = await supabase!.rpc('join_club', { p_slug: slug })
      if (error) throw error
      return data as string
    },

    // ---- Find a court: public club list and pages, and booking as a player ----

    /** Every club taking bookings, for the public "Find a court" list. */
    async listPublicClubs(): Promise<PublicClubListing[]> {
      if (isDemoMode) return demoStore.publicClubs()
      const [{ data, error }, covers, courtTypes] = await Promise.all([
        supabase!.rpc('list_public_clubs'),
        // Photos are extra: the list still shows, with sample pictures, if they cannot load.
        Promise.resolve(supabase!.rpc('list_public_club_covers')).then(
          ({ data: rows, error: coverError }) => coverError ? [] : (rows ?? []) as { slug: string; cover_photo: string | null }[],
          () => [],
        ),
        // Indoor and outdoor counts are extra too: without them every club counts zero of each.
        Promise.resolve(supabase!.rpc('list_public_club_court_types')).then(
          ({ data: rows, error: typeError }) => typeError
            ? []
            : (rows ?? []) as { slug: string; indoor_courts: number | string | null; outdoor_courts: number | string | null }[],
          () => [],
        ),
      ])
      if (error) throw error
      const coverBySlug = new Map(covers.map((row) => [row.slug, row.cover_photo]))
      const typesBySlug = new Map(courtTypes.map((row) => [row.slug, row]))
      const count = (value: number | string | null | undefined) => {
        const n = Number(value ?? 0)
        return Number.isFinite(n) && n > 0 ? n : 0
      }
      return ((data ?? []) as PublicClubListing[]).map((row) => ({
        ...row,
        cover_photo: coverBySlug.get(row.slug) ? photoUrl(coverBySlug.get(row.slug)!) : null,
        indoor_courts: count(typesBySlug.get(row.slug)?.indoor_courts),
        outdoor_courts: count(typesBySlug.get(row.slug)?.outdoor_courts),
        venue_count: Number(row.venue_count),
        court_count: Number(row.court_count),
        min_rate: row.min_rate == null ? null : Number(row.min_rate),
        min_member_rate: row.min_member_rate == null ? null : Number(row.min_member_rate),
      }))
    },

    /** One club's public page: venues, courts and rates. Null when the club is not taking bookings. */
    async publicClubDetail(slug: string): Promise<PublicClubDetail | null> {
      if (isDemoMode) return demoStore.publicClubDetail(slug)
      const { data, error } = await supabase!.rpc('get_public_club_detail', { p_slug: slug })
      if (error) throw error
      if (!data) return null
      const detail = data as PublicClubDetail
      return {
        ...detail,
        venues: detail.venues.map((venue) => ({
          ...venue,
          cover_photo: venue.cover_photo ? photoUrl(venue.cover_photo) : null,
          courts: venue.courts.map((court) => ({
            ...court,
            photos: (court.photos ?? []).map(photoUrl),
            hourly_rate: Number(court.hourly_rate),
            member_rate: court.member_rate == null ? null : Number(court.member_rate),
            court_type: isCourtType(court.court_type) ? court.court_type : null,
          })),
        })),
      }
    },

    /** What a club tells players: about, contacts, links, payment, add-ons, coaches, gallery, rules. Null when the club is not taking bookings. */
    async publicClubProfile(slug: string): Promise<PublicClubProfile | null> {
      if (isDemoMode) return demoStore.publicClubProfile(slug)
      const { data, error } = await supabase!.rpc('get_public_club_profile', { p_slug: slug })
      if (error) throw error
      if (!data) return null
      const row = data as ClubProfileFields & {
        payment_methods: (Pick<ClubPaymentMethod, 'id' | 'label' | 'account_name' | 'account_number'> & { qr_path: string | null })[]
        addons: PublicClubProfile['addons']
        coaches: (Omit<PublicClubProfile['coaches'][number], 'photo_url'> & { photo_path: string | null })[]
        gallery: { id: string; path: string; caption: string | null }[]
      }
      return {
        ...normalizeProfile(row),
        payment_methods: (row.payment_methods ?? []).map(({ qr_path, ...method }) => ({
          ...method,
          qr_url: qr_path ? photoUrl(qr_path) : null,
        })),
        addons: (row.addons ?? []).map((addon) => ({ ...addon, price: Number(addon.price) })),
        coaches: (row.coaches ?? []).map(({ photo_path, ...coach }) => ({
          ...coach,
          hourly_rate: coach.hourly_rate == null ? null : Number(coach.hourly_rate),
          photo_url: photo_path ? photoUrl(photo_path) : null,
        })),
        gallery: (row.gallery ?? []).map(({ path, ...photo }) => ({ ...photo, url: photoUrl(path) })),
      }
    },

    /** Visitor-safe availability for any public club (reads public detail + public_schedule with x-club-id). */
    async publicClubAvailability(slug: string, dateYmd: string, venueId?: string): Promise<CourtDayAvailability[]> {
      if (isDemoMode) return demoStore.publicClubAvailability(slug, dateYmd, venueId)
      const [club, detail] = await Promise.all([
        this.publicClub(slug),
        this.publicClubDetail(slug),
      ])
      if (!club || !detail) return []
      const filteredVenues = venueId
        ? detail.venues.filter((venue) => venue.id === venueId)
        : detail.venues
      const venueById = new Map(filteredVenues.map((venue) => [venue.id, venue]))
      const courts: Court[] = filteredVenues.flatMap((venue) =>
        venue.courts.map((ct) => ({
          id: ct.id,
          club_id: club.id,
          venue_id: venue.id,
          name: ct.name,
          status: ct.in_service ? 'available' : 'maintenance',
          hourly_rate: ct.hourly_rate,
          member_rate: ct.member_rate,
          court_type: ct.court_type ?? null,
        })),
      )
      const dayStart = localRangeISO(dateYmd, CLUB_OPEN_HOUR, 1).start_at
      const dayEnd = localRangeISO(dateYmd, CLUB_CLOSE_HOUR - 1, 1).end_at
      let scheduleQuery = supabase!
        .from('public_schedule')
        .select('court_id, start_at, end_at')
        .eq('club_id', club.id)
        .setHeader(CLUB_HEADER, club.id)
        .lt('start_at', dayEnd)
        .gt('end_at', dayStart)
      if (venueId) scheduleQuery = scheduleQuery.eq('venue_id', venueId)
      const { data: occupied, error } = await scheduleQuery
      if (error) throw error
      return buildCourtAvailability(
        courts,
        (id) => {
          const v = id ? venueById.get(id) : undefined
          return v ? venueHours(v) : { open: 0, close: 0 }
        },
        (occupied ?? []) as OccupiedInterval[],
        dateYmd,
      )
    },

    /** Sends a booking email card ('booking_submitted' or 'booking_confirmed') via the Resend Edge Function (or simulates cleanly in demo mode). */
    async sendBookingConfirmationEmail(opts: {
      booking: Booking
      clubName: string
      venueName?: string
      recipientEmail: string
      kind?: 'booking_submitted' | 'booking_confirmed'
    }): Promise<{ sent: boolean; preview: string }> {
      const timeWindow = `${fmtDateTime(opts.booking.start_at)} – ${fmtTime(opts.booking.end_at)} (${opts.booking.hours}h)`
      const preview = `Receipt sent to ${opts.recipientEmail} for ${opts.booking.court?.name ?? 'Court'} · ${timeWindow}`
      if (isDemoMode) return { sent: true, preview }
      try {
        const { error } = await supabase!.functions.invoke('send-booking-email', {
          body: {
            kind: opts.kind ?? 'booking_confirmed',
            bookingId: opts.booking.id,
            clubName: opts.clubName,
            venueName: opts.venueName ?? null,
            courtName: opts.booking.court?.name ?? 'Court',
            startAt: opts.booking.start_at,
            endAt: opts.booking.end_at,
            hours: opts.booking.hours,
            amount: opts.booking.amount,
            paymentRef: opts.booking.payment_ref ?? null,
            recipientEmail: opts.recipientEmail,
          },
        })
        if (error) return { sent: false, preview }
        return { sent: true, preview }
      } catch {
        return { sent: false, preview }
      }
    },

    /** Adds the signed-in person to a club as a player (no membership), so they can book there. */
    async joinClubAsPlayer(userId: string, slug: string): Promise<string> {
      if (isDemoMode) return demoStore.joinClubAsPlayer(userId, slug)
      const { data, error } = await supabase!.rpc('join_club_as_player', { p_slug: slug })
      if (error) throw error
      return data as string
    },

    // ---- Platform superadmin (every call is checked and audited in the database) ----

    async platformClubs(): Promise<PlatformClub[]> {
      if (isDemoMode) return demoStore.platformClubs()
      const { data, error } = await supabase!.rpc('platform_list_clubs')
      if (error) throw error
      return ((data ?? []) as PlatformClub[]).map(normalizePlatformClub)
    },

    async platformLedger(clubId?: string | null, limit = 200): Promise<PlatformCommission[]> {
      if (isDemoMode) return demoStore.platformLedger(clubId ?? null, limit)
      const { data, error } = await supabase!.rpc('platform_commission_ledger', { p_club_id: clubId ?? null, p_limit: limit })
      if (error) throw error
      return ((data ?? []) as PlatformCommission[]).map(normalizeCommission)
    },

    /**
     * The superadmin dashboard figures across clubs. Only platform_* functions are
     * called, so no member rows are ever read. Without the server summary it adds up
     * the newest PLATFORM_LEDGER_LIMIT ledger lines (ledger_capped says when that cut
     * anything off).
     */
    async platformAnalytics(days: AnalyticsPeriod): Promise<PlatformAnalytics> {
      const window = analyticsWindow(days)
      if (isDemoMode) {
        const { ledger, requests } = demoStore.platformAnalyticsRows(rangeInstants(window.previous).from, rangeInstants(window.current).to)
        return buildPlatformAnalytics({ window, clubs: demoStore.platformClubs(), ledger, requests })
      }
      const { data, error } = await supabase!.rpc('platform_analytics', { p_days: days })
      if (!error && data) return normalizePlatformAnalytics(Array.isArray(data) ? data[0] : data)
      if (error && !isUnavailableFunction(error)) throw error
      const [clubs, ledger, requests] = await Promise.all([
        api.platformClubs(),
        api.platformLedger(null, PLATFORM_LEDGER_LIMIT),
        api.platformOwnerCallRequests().catch(() => null),
      ])
      return buildPlatformAnalytics({ window, clubs, ledger, requests, ledgerLimit: PLATFORM_LEDGER_LIMIT })
    },

    async platformClubAdmins(clubId: string): Promise<PlatformClubAdmin[]> {
      if (isDemoMode) return demoStore.platformClubAdmins(clubId)
      const { data, error } = await supabase!.rpc('platform_club_admins', { p_club_id: clubId })
      if (error) throw error
      return (data ?? []) as PlatformClubAdmin[]
    },

    async platformRecentActions(limit = 50): Promise<PlatformAction[]> {
      if (isDemoMode) return demoStore.platformRecentActions(limit)
      const { data, error } = await supabase!.rpc('platform_recent_actions', { p_limit: limit })
      if (error) throw error
      return (data ?? []) as PlatformAction[]
    },

    async provisionClub(input: ProvisionClubInput): Promise<string> {
      if (isDemoMode) return demoStore.provisionClub(input)
      const { data, error } = await supabase!.rpc('platform_provision_club', {
        p_name: input.name,
        p_slug: input.slug,
        p_city: input.city,
        p_address: input.address,
        p_contact_email: input.contact_email,
        p_contact_phone: input.contact_phone,
        p_commission_rate: input.commission_rate,
        p_court_count: input.court_count,
      })
      if (error) throw error
      return data as string
    },

    async setClubStatus(clubId: string, status: ClubStatus): Promise<void> {
      if (isDemoMode) return demoStore.setClubStatus(clubId, status)
      const { error } = await supabase!.rpc('platform_set_club_status', { p_club_id: clubId, p_status: status })
      if (error) throw error
    },

    async setCommissionRate(clubId: string, rate: number): Promise<void> {
      if (isDemoMode) return demoStore.setCommissionRate(clubId, rate)
      const { error } = await supabase!.rpc('platform_set_commission_rate', { p_club_id: clubId, p_rate: rate })
      if (error) throw error
    },

    async assignClubAdmin(clubId: string, email: string): Promise<string> {
      if (isDemoMode) return demoStore.assignClubAdmin(clubId, email)
      const { data, error } = await supabase!.rpc('platform_assign_club_admin', { p_club_id: clubId, p_email: email })
      if (error) throw error
      return data as string
    },

    async revokeClubAdmin(clubId: string, userId: string): Promise<void> {
      if (isDemoMode) return demoStore.revokeClubAdmin(clubId, userId)
      const { error } = await supabase!.rpc('platform_revoke_club_admin', { p_club_id: clubId, p_user_id: userId })
      if (error) throw error
    },

    // ---- Court owners: call requests and owner invites ----

    /** Open to visitors: a court owner asks bRineLy to call about listing their club. */
    async requestOwnerCall(input: OwnerCallRequestInput): Promise<string> {
      if (isDemoMode) return demoStore.requestOwnerCall(input)
      const { data, error } = await supabase!.rpc('request_owner_call', {
        p_full_name: input.full_name,
        p_club_name: input.club_name,
        p_city: input.city,
        p_court_count: input.court_count,
        p_phone: input.phone,
        p_email: input.email,
        p_preferred_date: input.preferred_date,
        p_preferred_time: input.preferred_time,
        p_message: input.message,
      })
      if (error) {
        throw isMissingFunction(error) ? new Error('We cannot take requests yet. Please try again later.') : error
      }
      return data as string
    },

    async platformOwnerCallRequests(status?: OwnerCallStatus | null): Promise<OwnerCallRequest[]> {
      if (isDemoMode) return demoStore.platformOwnerCallRequests(status ?? null)
      const { data, error } = await supabase!.rpc('platform_owner_call_requests', { p_status: status ?? null, p_limit: 200 })
      if (error) throw error
      return ((data ?? []) as OwnerCallRequest[]).map((row) => ({ ...row, court_count: Number(row.court_count) }))
    },

    async setOwnerCallStatus(requestId: string, status: OwnerCallStatus): Promise<void> {
      if (isDemoMode) return demoStore.setOwnerCallStatus(requestId, status)
      const { error } = await supabase!.rpc('platform_set_owner_call_status', { p_request_id: requestId, p_status: status })
      if (error) throw error
    },

    /** Makes someone with an account the club's admin now; anyone else is invited until they sign up and confirm the email. */
    async inviteClubOwner(clubId: string, email: string): Promise<'assigned' | 'invited'> {
      if (isDemoMode) return demoStore.inviteClubOwner(clubId, email)
      const { data, error } = await supabase!.rpc('platform_invite_club_owner', { p_club_id: clubId, p_email: email })
      if (error) {
        // Until the owner-invite migration reaches this database, keep the older step:
        // an existing account becomes the admin, and anyone else is asked to sign up first.
        if (isMissingFunction(error)) {
          await api.assignClubAdmin(clubId, email)
          return 'assigned'
        }
        throw error
      }
      return data === 'assigned' ? 'assigned' : 'invited'
    },

    async clubOwnerInvites(clubId: string): Promise<ClubOwnerInvite[]> {
      if (isDemoMode) return demoStore.clubOwnerInvites(clubId)
      const { data, error } = await supabase!.rpc('platform_club_owner_invites', { p_club_id: clubId })
      if (error) {
        if (isMissingFunction(error)) return []
        throw error
      }
      return (data ?? []) as ClubOwnerInvite[]
    },

    async cancelClubOwnerInvite(inviteId: string): Promise<void> {
      if (isDemoMode) return demoStore.cancelClubOwnerInvite(inviteId)
      const { error } = await supabase!.rpc('platform_cancel_club_owner_invite', { p_invite_id: inviteId })
      if (error) throw error
    },

    /**
     * Takes up any owner invites for the signed-in person's confirmed email, then
     * lists the clubs they own that way. It never fails a sign-in: when the
     * database cannot answer (for example before this feature is released there),
     * it reports no owner clubs.
     */
    async claimOwnerClubs(): Promise<OwnerClub[]> {
      if (isDemoMode) return demoStore.claimOwnerClubs()
      try {
        const { data, error } = await supabase!.rpc('claim_my_owner_clubs')
        if (error) throw error
        return (data ?? []) as OwnerClub[]
      } catch (error) {
        console.warn('Owner invites could not be checked', error)
        return []
      }
    },

    // ---- Support sessions: time-limited, read-only, logged views of one club ----

    async startSupportSession(clubId: string, reason: string, minutes: number): Promise<string> {
      if (isDemoMode) return demoStore.startSupportSession(clubId, reason, minutes)
      const { data, error } = await supabase!.rpc('platform_start_support_session', { p_club_id: clubId, p_reason: reason, p_minutes: minutes })
      if (error) throw error
      return data as string
    },

    async endSupportSession(sessionId: string): Promise<void> {
      if (isDemoMode) return demoStore.endSupportSession(sessionId)
      const { error } = await supabase!.rpc('platform_end_support_session', { p_session_id: sessionId })
      if (error) throw error
    },

    async mySupportSessions(): Promise<SupportSession[]> {
      if (isDemoMode) return demoStore.mySupportSessions()
      const { data, error } = await supabase!.rpc('platform_my_support_sessions')
      if (error) throw error
      return (data ?? []) as SupportSession[]
    },

    async supportSnapshot(sessionId: string): Promise<SupportSnapshot> {
      if (isDemoMode) return demoStore.supportSnapshot(sessionId)
      const { data, error } = await supabase!.rpc('platform_support_snapshot', { p_session_id: sessionId })
      if (error) throw error
      return data as SupportSnapshot
    },

    // ---- Club leaderboard and match scoring ----

    async publicClubLeaderboard(
      slug: string,
      period: LeaderboardPeriod = 'month',
      format: LeaderboardFormatFilter = 'all',
      limit = 50,
    ): Promise<ClubLeaderboardSnapshot | null> {
      if (isDemoMode) return demoStore.publicClubLeaderboard(slug, period, format, limit)
      const { data, error } = await supabase!.rpc('get_public_club_leaderboard', {
        p_slug: slug,
        p_period: period,
        p_format: format,
        p_limit: limit,
      })
      if (error) {
        if (isMissingFunction(error)) return null
        throw error
      }
      return data ? normalizeLeaderboardSnapshot(data as ClubLeaderboardSnapshot) : null
    },

    async publicPlayerMatches(slug: string, memberId: string, limit = 15): Promise<ClubMatch[] | null> {
      if (isDemoMode) return demoStore.publicPlayerMatches(slug, memberId, limit)
      const { data, error } = await supabase!.rpc('get_public_player_matches', {
        p_slug: slug,
        p_member_id: memberId,
        p_limit: limit,
      })
      if (error) {
        if (isMissingFunction(error)) return []
        throw error
      }
      return data ? ((data as ClubMatch[]).map(normalizeClubMatch)) : null
    },

    async clubLeaderboard(
      period: LeaderboardPeriod = 'month',
      format: LeaderboardFormatFilter = 'all',
      limit = 100,
    ): Promise<ClubLeaderboardSnapshot> {
      if (isDemoMode) return demoStore.clubLeaderboard(period, format, limit)
      const { data, error } = await supabase!.rpc('get_club_leaderboard', {
        p_period: period,
        p_format: format,
        p_limit: limit,
      })
      if (error) throw error
      return normalizeLeaderboardSnapshot(data as ClubLeaderboardSnapshot)
    },

    async recordClubMatch(input: RecordMatchInput, clubSlug?: string): Promise<ClubMatch> {
      if (isDemoMode) {
        const match = demoStore.recordClubMatch(input)
        emitClubLiveUpdate([match.club_id, getActiveClubId(), clubSlug])
        return match
      }
      const { data, error } = await supabase!.rpc('staff_record_club_match', {
        p_format: input.format,
        p_team_a: input.team_a,
        p_team_b: input.team_b,
        p_winner_side: input.winner_side,
        p_score_a: input.score_a ?? null,
        p_score_b: input.score_b ?? null,
        p_venue_id: input.venue_id ?? null,
        p_court_id: input.court_id ?? null,
        p_notes: input.notes ?? null,
      })
      if (error) throw error
      const match = normalizeClubMatch(data as ClubMatch)
      emitClubLiveUpdate([match.club_id, getActiveClubId(), clubSlug])
      return match
    },

    async voidClubMatch(matchId: string, reason?: string, clubSlug?: string): Promise<void> {
      if (isDemoMode) {
        demoStore.voidClubMatch(matchId, reason)
        emitClubLiveUpdate([getActiveClubId(), clubSlug])
        return
      }
      const { error } = await supabase!.rpc('staff_void_club_match', {
        p_match_id: matchId,
        p_reason: reason ?? null,
      })
      if (error) throw error
      emitClubLiveUpdate([getActiveClubId(), clubSlug])
    },

    async listLeaderboardScorers(): Promise<LeaderboardScorerStaff[]> {
      if (isDemoMode) return demoStore.listLeaderboardScorers()
      const { data, error } = await supabase!.rpc('admin_list_leaderboard_scorers')
      if (error) throw error
      return (data ?? []) as LeaderboardScorerStaff[]
    },

    async setLeaderboardScorer(userId: string, canScore: boolean): Promise<void> {
      if (isDemoMode) return demoStore.setLeaderboardScorer(userId, canScore)
      const { error } = await supabase!.rpc('admin_set_leaderboard_scorer', {
        p_user_id: userId,
        p_can_score: canScore,
      })
      if (error) throw error
    },

    // ---- Phase 2: Club tournaments & matchmaking ----

    /** Tournaments from every active club, each naming its club (the public Tournaments page). */
    async listPublicTournaments(status: PublicTournamentFilter = null, limit = 30): Promise<PublicTournamentSummary[]> {
      if (isDemoMode) return demoStore.listPublicTournaments(status, limit)
      const { data, error } = await supabase!.rpc('list_public_tournaments', {
        p_status: status,
        p_limit: limit,
      })
      if (error) {
        if (isMissingFunction(error)) return []
        throw error
      }
      return ((data ?? []) as PublicTournamentSummary[]).map((row) => ({
        ...normalizeTournamentSummary(row),
        club: { slug: String(row.club?.slug ?? ''), name: String(row.club?.name ?? ''), city: row.club?.city ?? null },
      })).filter((row) => row.club.slug !== '')
    },

    async listPublicClubTournaments(slug: string, limit = 20): Promise<TournamentSummary[] | null> {
      if (isDemoMode) return demoStore.listPublicClubTournaments(slug, limit)
      const { data, error } = await supabase!.rpc('list_public_club_tournaments', {
        p_slug: slug,
        p_limit: limit,
      })
      if (error) {
        if (isMissingFunction(error)) return []
        throw error
      }
      return data ? (data as TournamentSummary[]).map(normalizeTournamentSummary) : null
    },

    async publicTournament(slug: string, tournamentId: string): Promise<TournamentDetail | null> {
      if (isDemoMode) return demoStore.publicTournament(slug, tournamentId)
      const { data, error } = await supabase!.rpc('get_public_tournament', {
        p_slug: slug,
        p_tournament_id: tournamentId,
      })
      if (error) {
        if (isMissingFunction(error)) return null
        throw error
      }
      return data ? normalizeTournamentDetail(data as TournamentDetail) : null
    },

    async listClubTournaments(limit = 50): Promise<TournamentSummary[]> {
      if (isDemoMode) return demoStore.listClubTournaments(limit)
      const { data, error } = await supabase!.rpc('list_club_tournaments', { p_limit: limit })
      if (error) throw error
      return ((data ?? []) as TournamentSummary[]).map(normalizeTournamentSummary)
    },

    async clubTournament(tournamentId: string): Promise<TournamentDetail> {
      if (isDemoMode) return demoStore.clubTournament(tournamentId)
      const { data, error } = await supabase!.rpc('get_club_tournament', {
        p_tournament_id: tournamentId,
      })
      if (error) throw error
      return normalizeTournamentDetail(data as TournamentDetail)
    },

    async createTournament(input: CreateTournamentInput, clubSlug?: string): Promise<TournamentDetail> {
      if (isDemoMode) {
        const detail = demoStore.createTournament(input)
        emitClubLiveUpdate([detail.club?.id, getActiveClubId(), clubSlug])
        return detail
      }
      const { data, error } = await supabase!.rpc('admin_create_tournament', {
        p_title: input.title,
        p_format: input.format,
        p_team_size: input.team_size,
        p_venue_id: input.venue_id ?? null,
        p_counts_for_leaderboard: input.counts_for_leaderboard ?? true,
        p_scheduled_at: input.scheduled_at ?? null,
        p_notes: input.notes ?? null,
        p_player_ids: input.player_ids ?? [],
      })
      if (error) throw error
      const detail = normalizeTournamentDetail(data as TournamentDetail)
      emitClubLiveUpdate([detail.club?.id, getActiveClubId(), clubSlug])
      return detail
    },

    async setTournamentPlayers(
      tournamentId: string,
      playerIds: string[],
      clubSlug?: string,
    ): Promise<TournamentDetail> {
      if (isDemoMode) {
        const detail = demoStore.setTournamentPlayers(tournamentId, playerIds)
        emitClubLiveUpdate([detail.club?.id, getActiveClubId(), clubSlug])
        return detail
      }
      const { data, error } = await supabase!.rpc('admin_set_tournament_players', {
        p_tournament_id: tournamentId,
        p_player_ids: playerIds,
      })
      if (error) throw error
      const detail = normalizeTournamentDetail(data as TournamentDetail)
      emitClubLiveUpdate([detail.club?.id, getActiveClubId(), clubSlug])
      return detail
    },

    async generateTournamentDraw(tournamentId: string, clubSlug?: string): Promise<TournamentDetail> {
      if (isDemoMode) {
        const detail = demoStore.generateTournamentDraw(tournamentId)
        emitClubLiveUpdate([detail.club?.id, getActiveClubId(), clubSlug])
        return detail
      }
      const { data, error } = await supabase!.rpc('admin_generate_tournament_draw', {
        p_tournament_id: tournamentId,
      })
      if (error) throw error
      const detail = normalizeTournamentDetail(data as TournamentDetail)
      emitClubLiveUpdate([detail.club?.id, getActiveClubId(), clubSlug])
      return detail
    },

    async startTournament(tournamentId: string, clubSlug?: string): Promise<TournamentDetail> {
      if (isDemoMode) {
        const detail = demoStore.startTournament(tournamentId)
        emitClubLiveUpdate([detail.club?.id, getActiveClubId(), clubSlug])
        return detail
      }
      const { data, error } = await supabase!.rpc('admin_start_tournament', {
        p_tournament_id: tournamentId,
      })
      if (error) throw error
      const detail = normalizeTournamentDetail(data as TournamentDetail)
      emitClubLiveUpdate([detail.club?.id, getActiveClubId(), clubSlug])
      return detail
    },

    async setTournamentScorer(
      tournamentId: string,
      userId: string,
      canScore: boolean,
      clubSlug?: string,
    ): Promise<void> {
      if (isDemoMode) {
        demoStore.setTournamentScorer(tournamentId, userId, canScore)
        emitClubLiveUpdate([getActiveClubId(), clubSlug])
        return
      }
      const { error } = await supabase!.rpc('admin_set_tournament_scorer', {
        p_tournament_id: tournamentId,
        p_user_id: userId,
        p_can_score: canScore,
      })
      if (error) throw error
      emitClubLiveUpdate([getActiveClubId(), clubSlug])
    },

    async completeTournament(tournamentId: string, clubSlug?: string): Promise<TournamentDetail> {
      if (isDemoMode) {
        const detail = demoStore.completeTournament(tournamentId)
        emitClubLiveUpdate([detail.club?.id, getActiveClubId(), clubSlug])
        return detail
      }
      const { data, error } = await supabase!.rpc('admin_complete_tournament', {
        p_tournament_id: tournamentId,
      })
      if (error) throw error
      const detail = normalizeTournamentDetail(data as TournamentDetail)
      emitClubLiveUpdate([detail.club?.id, getActiveClubId(), clubSlug])
      return detail
    },

    async cancelTournament(tournamentId: string, clubSlug?: string): Promise<TournamentDetail> {
      if (isDemoMode) {
        const detail = demoStore.cancelTournament(tournamentId)
        emitClubLiveUpdate([detail.club?.id, getActiveClubId(), clubSlug])
        return detail
      }
      const { data, error } = await supabase!.rpc('admin_cancel_tournament', {
        p_tournament_id: tournamentId,
      })
      if (error) throw error
      const detail = normalizeTournamentDetail(data as TournamentDetail)
      emitClubLiveUpdate([detail.club?.id, getActiveClubId(), clubSlug])
      return detail
    },

    async drawTournamentQueueMatch(
      tournamentId: string,
      courtId?: string | null,
      clubSlug?: string,
    ): Promise<TournamentDetail> {
      if (isDemoMode) {
        const detail = demoStore.drawTournamentQueueMatch(tournamentId, courtId)
        emitClubLiveUpdate([detail.club?.id, getActiveClubId(), clubSlug])
        return detail
      }
      const { data, error } = await supabase!.rpc('staff_draw_tournament_queue_match', {
        p_tournament_id: tournamentId,
        p_court_id: courtId ?? null,
      })
      if (error) throw error
      const detail = normalizeTournamentDetail(data as TournamentDetail)
      emitClubLiveUpdate([detail.club?.id, getActiveClubId(), clubSlug])
      return detail
    },

    /** Undo a finished tournament result (any tournament, counted for the leaderboard or not). */
    async undoTournamentMatch(
      tournamentId: string,
      matchId: string,
      reason?: string,
      clubSlug?: string,
    ): Promise<TournamentDetail> {
      if (isDemoMode) {
        const detail = demoStore.voidTournamentMatch(tournamentId, matchId, reason)
        emitClubLiveUpdate([detail.club?.id, getActiveClubId(), clubSlug])
        return detail
      }
      const { data, error } = await supabase!.rpc('staff_void_tournament_match', {
        p_tournament_id: tournamentId,
        p_match_id: matchId,
        p_reason: reason ?? null,
      })
      if (error) throw error
      const detail = normalizeTournamentDetail(data as TournamentDetail)
      emitClubLiveUpdate([detail.club?.id, getActiveClubId(), clubSlug])
      return detail
    },

    async assignTournamentMatchCourt(
      tournamentId: string,
      matchId: string,
      courtId?: string | null,
      clubSlug?: string,
    ): Promise<TournamentDetail> {
      if (isDemoMode) {
        const detail = demoStore.assignTournamentMatchCourt(tournamentId, matchId, courtId)
        emitClubLiveUpdate([detail.club?.id, getActiveClubId(), clubSlug])
        return detail
      }
      const { data, error } = await supabase!.rpc('staff_assign_tournament_match_court', {
        p_tournament_id: tournamentId,
        p_match_id: matchId,
        p_court_id: courtId ?? null,
      })
      if (error) throw error
      const detail = normalizeTournamentDetail(data as TournamentDetail)
      emitClubLiveUpdate([detail.club?.id, getActiveClubId(), clubSlug])
      return detail
    },

    async cancelTournamentQueueMatch(
      tournamentId: string,
      matchId: string,
      clubSlug?: string,
    ): Promise<TournamentDetail> {
      if (isDemoMode) {
        const detail = demoStore.cancelTournamentQueueMatch(tournamentId, matchId)
        emitClubLiveUpdate([detail.club?.id, getActiveClubId(), clubSlug])
        return detail
      }
      const { data, error } = await supabase!.rpc('staff_cancel_tournament_queue_match', {
        p_tournament_id: tournamentId,
        p_match_id: matchId,
      })
      if (error) throw error
      const detail = normalizeTournamentDetail(data as TournamentDetail)
      emitClubLiveUpdate([detail.club?.id, getActiveClubId(), clubSlug])
      return detail
    },

    async scoreTournamentMatch(
      input: ScoreTournamentMatchInput,
      clubSlug?: string,
    ): Promise<TournamentDetail> {
      if (isDemoMode) {
        const detail = demoStore.scoreTournamentMatch(input)
        emitClubLiveUpdate([detail.club?.id, getActiveClubId(), clubSlug])
        return detail
      }
      const { data, error } = await supabase!.rpc('staff_score_tournament_match', {
        p_tournament_id: input.tournament_id,
        p_match_id: input.match_id,
        p_winner_side: input.winner_side,
        p_score_a: input.score_a ?? null,
        p_score_b: input.score_b ?? null,
        p_court_id: input.court_id ?? null,
      })
      if (error) throw error
      const detail = normalizeTournamentDetail(data as TournamentDetail)
      emitClubLiveUpdate([detail.club?.id, getActiveClubId(), clubSlug])
      return detail
    },
  }

/** PostgREST answers PGRST202 (and Postgres 42883) when a database function is not there yet. */
function isMissingFunction(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code
  return code === 'PGRST202' || code === '42883'
}

/** Not on this database yet, or not granted to this role: the screen can add the figures up itself. */
function isUnavailableFunction(error: unknown) {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown }
  return isMissingFunction(error) || (code === '42501' && typeof message === 'string' && /permission denied for function/i.test(message))
}

/** Most rows an analytics read takes; older rows past it are left out. */
const ANALYTICS_ROW_CAP = 5000
/** Rows asked for per request (supabase/config.toml answers at most max_rows = 1000 at a time). */
const ANALYTICS_PAGE_ROWS = 1000
/** Ledger lines the browser fallback of the platform dashboard reads. */
const PLATFORM_LEDGER_LIMIT = 1000

/**
 * Reads a query page by page, up to ANALYTICS_ROW_CAP rows. It stops at the first empty
 * page, so a server that answers fewer rows per request than asked is still read in full.
 */
async function readPages<T>(
  page: (first: number, last: number) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = []
  while (rows.length < ANALYTICS_ROW_CAP) {
    const first = rows.length
    const last = Math.min(first + ANALYTICS_PAGE_ROWS, ANALYTICS_ROW_CAP) - 1
    const { data, error } = await page(first, last)
    if (error) throw error
    const batch = (data ?? []) as T[]
    if (!batch.length) break
    rows.push(...batch.slice(0, ANALYTICS_ROW_CAP - rows.length))
  }
  return rows
}

type Loose = Record<string, unknown> | null | undefined

const num = (value: unknown) => Number(value) || 0
const looseList = (value: unknown): Loose[] => (Array.isArray(value) ? (value as Loose[]) : [])

function dayRange(raw: unknown): DayRange {
  const row = raw as Loose
  return { from: String(row?.from ?? ''), to: String(row?.to ?? ''), days: num(row?.days) }
}

function clubTotals(raw: unknown): ClubTotals {
  const row = raw as Loose
  return {
    charges: num(row?.charges),
    bookings: num(row?.bookings),
    hours: num(row?.hours),
    open_hours: num(row?.open_hours),
    new_members: num(row?.new_members),
    new_players: num(row?.new_players),
    cancellations: num(row?.cancellations),
    avg_booking: num(row?.avg_booking),
    commission: num(row?.commission),
  }
}

/** The server summary with every Postgres numeric turned into a number. */
function normalizeClubAnalytics(raw: unknown): ClubAnalytics {
  const row = (raw ?? {}) as Record<string, unknown>
  const members = row.members as Loose
  const coaching = row.coaching as Loose
  const split = row.payment_split as Loose
  const busy = Array.isArray(row.busy_hours) ? (row.busy_hours as unknown[]) : []
  return {
    period: dayRange(row.period),
    previous_period: dayRange(row.previous_period),
    current: clubTotals(row.current),
    previous: clubTotals(row.previous),
    by_day: looseList(row.by_day).map((d) => ({
      day: String(d?.day ?? ''),
      charges: num(d?.charges),
      bookings: num(d?.bookings),
      hours: num(d?.hours),
      new_members: num(d?.new_members),
      cancellations: num(d?.cancellations),
      commission: num(d?.commission),
    })),
    charges_by_type: looseList(row.charges_by_type).map((d) => ({ type: d?.type as TxType, amount: num(d?.amount) })),
    charges_by_venue: looseList(row.charges_by_venue).map((d) => ({
      venue_id: typeof d?.venue_id === 'string' ? d.venue_id : null,
      name: String(d?.name ?? ''),
      amount: num(d?.amount),
    })),
    bookings_by_status: looseList(row.bookings_by_status).map((d) => ({ status: d?.status as BookingStatus, count: num(d?.count) })),
    courts: looseList(row.courts).map((d) => ({
      court_id: String(d?.court_id ?? ''),
      name: String(d?.name ?? ''),
      venue_name: String(d?.venue_name ?? ''),
      hours: num(d?.hours),
      open_hours: num(d?.open_hours),
    })),
    busy_hours: Array.from({ length: 7 }, (_, w) => {
      const day = Array.isArray(busy[w]) ? (busy[w] as unknown[]) : []
      return Array.from({ length: 24 }, (_, h) => num(day[h]))
    }),
    payment_split: { online: num(split?.online), desk: num(split?.desk) },
    members: { active_members: num(members?.active_members), ending_soon: num(members?.ending_soon), players: num(members?.players) },
    coaching: coaching ? { requests: num(coaching.requests), previous_requests: num(coaching.previous_requests), accepted: num(coaching.accepted) } : null,
    source: 'server',
  }
}

function platformTotals(raw: unknown): PlatformTotals {
  const row = raw as Loose
  return { gross: num(row?.gross), commission: num(row?.commission), lines: num(row?.lines), new_clubs: num(row?.new_clubs), requests: num(row?.requests) }
}

/** The platform server summary with every Postgres numeric turned into a number. */
function normalizePlatformAnalytics(raw: unknown): PlatformAnalytics {
  const row = (raw ?? {}) as Record<string, unknown>
  return {
    period: dayRange(row.period),
    previous_period: dayRange(row.previous_period),
    current: platformTotals(row.current),
    previous: platformTotals(row.previous),
    by_day: looseList(row.by_day).map((d) => ({
      day: String(d?.day ?? ''),
      gross: num(d?.gross),
      commission: num(d?.commission),
      lines: num(d?.lines),
      new_clubs: num(d?.new_clubs),
      requests: num(d?.requests),
    })),
    top_clubs: looseList(row.top_clubs).map((d) => ({
      club_id: String(d?.club_id ?? ''),
      name: String(d?.name ?? ''),
      gross: num(d?.gross),
      commission: num(d?.commission),
      lines: num(d?.lines),
    })),
    clubs_by_status: looseList(row.clubs_by_status).map((d) => ({ status: d?.status as ClubStatus, count: num(d?.count) })),
    requests_by_status: looseList(row.requests_by_status).map((d) => ({ status: d?.status as OwnerCallStatus, count: num(d?.count) })),
    requests_by_city: looseList(row.requests_by_city).map((d) => ({ city: String(d?.city ?? ''), count: num(d?.count) })),
    ledger_capped: row.ledger_capped === true,
    source: 'server',
  }
}

const CHECKOUT_UNAVAILABLE = 'Online checkout is not available yet. Ask the desk to reserve this court.'
const PAYMENT_CHECKS_UNAVAILABLE = 'Payment checks are not available yet. Please try again later.'

/**
 * A checkout answer from the database as an Error a screen can show. PostgREST hands back
 * plain objects, and screens show only an Error's message. The checkout functions raise
 * messages written for players and staff, so those are kept as they are.
 */
function checkoutError(error: unknown, unavailable = CHECKOUT_UNAVAILABLE): Error {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown }
  const text = typeof message === 'string' ? message.trim() : ''
  // Not on this database yet (function or column missing), or paused (execute revoked).
  if (isMissingFunction(error) || code === '42703' || (code === '42501' && /permission denied for function/i.test(text))) {
    return new Error(unavailable)
  }
  // The court_allocations no-overlap rule: someone else got those hours first.
  if (code === '23P01') return new Error('Someone else just took those hours. Pick another time.')
  if (/failed to fetch|networkerror|load failed/i.test(text)) {
    return new Error('Could not reach bRineLy. Check your connection and try again.')
  }
  return new Error(text || 'Something went wrong. Please try again.')
}

/** A function that returns one public.bookings row; PostgREST may send it inside a list. */
function bookingRow(data: unknown): Booking {
  const row = (Array.isArray(data) ? data[0] : data) as Booking | null | undefined
  if (!row) throw new Error('Something went wrong. Please try again.')
  return { ...row, amount: Number(row.amount) }
}

/** Postgres numerics can arrive as strings; the portal works with numbers. */
function normalizePlatformClub(club: PlatformClub): PlatformClub {
  return {
    ...club,
    commission_rate: Number(club.commission_rate),
    venue_count: Number(club.venue_count),
    court_count: Number(club.court_count),
    member_count: Number(club.member_count),
    admin_count: Number(club.admin_count),
    gross_amount: Number(club.gross_amount),
    commission_amount: Number(club.commission_amount),
    club_net_amount: Number(club.club_net_amount),
    entry_count: Number(club.entry_count),
  }
}

function normalizeCommission(row: PlatformCommission): PlatformCommission {
  return {
    ...row,
    gross_amount: Number(row.gross_amount),
    commission_rate: Number(row.commission_rate),
    commission_amount: Number(row.commission_amount),
    club_net_amount: Number(row.club_net_amount),
  }
}

function normalizeLeaderboardPlayer(player: LeaderboardPlayerSummary): LeaderboardPlayerSummary {
  const path = player.photo_path ?? null
  return {
    ...player,
    photo_url: player.photo_url ?? (path ? memberPhotoUrl(path) : null),
  }
}

function normalizeLeaderboardEntry(entry: LeaderboardEntry): LeaderboardEntry {
  return {
    ...normalizeLeaderboardPlayer(entry),
    rank: Number(entry.rank),
    points: Number(entry.points),
    wins: Number(entry.wins),
    losses: Number(entry.losses),
    games_played: Number(entry.games_played),
    win_pct: Number(entry.win_pct),
    score_diff: Number(entry.score_diff),
    streak: Number(entry.streak),
  }
}

function normalizeClubMatch(match: ClubMatch): ClubMatch {
  return {
    ...match,
    score_a: match.score_a == null ? null : Number(match.score_a),
    score_b: match.score_b == null ? null : Number(match.score_b),
    team_a: (match.team_a ?? []).map(normalizeLeaderboardPlayer),
    team_b: (match.team_b ?? []).map(normalizeLeaderboardPlayer),
  }
}

function normalizeLeaderboardSnapshot(raw: ClubLeaderboardSnapshot): ClubLeaderboardSnapshot {
  return {
    ...raw,
    entries: (raw.entries ?? []).map(normalizeLeaderboardEntry),
    recent_matches: (raw.recent_matches ?? []).map(normalizeClubMatch),
    total_players: Number(raw.total_players ?? 0),
    total_matches: Number(raw.total_matches ?? 0),
    my_entry: raw.my_entry ? normalizeLeaderboardEntry(raw.my_entry) : null,
  }
}

function normalizeTournamentSummary(raw: TournamentSummary): TournamentSummary {
  return {
    ...raw,
    team_size: Number(raw.team_size) === 1 ? 1 : 2,
    player_count: Number(raw.player_count ?? 0),
    team_count: Number(raw.team_count ?? 0),
    active_matches: Number(raw.active_matches ?? 0),
    completed_matches: Number(raw.completed_matches ?? 0),
    total_matches: Number(raw.total_matches ?? 0),
  }
}

function normalizeTournamentTeam(raw: TournamentTeam): TournamentTeam {
  return {
    ...raw,
    seed: Number(raw.seed),
    players: (raw.players ?? []).map(normalizeLeaderboardPlayer),
  }
}

function normalizeTournamentMatch(raw: TournamentMatch): TournamentMatch {
  return {
    ...raw,
    round_number: Number(raw.round_number),
    match_order: Number(raw.match_order),
    team_a_seed: raw.team_a_seed == null ? null : Number(raw.team_a_seed),
    team_b_seed: raw.team_b_seed == null ? null : Number(raw.team_b_seed),
    score_a: raw.score_a == null ? null : Number(raw.score_a),
    score_b: raw.score_b == null ? null : Number(raw.score_b),
    team_a_players: (raw.team_a_players ?? []).map(normalizeLeaderboardPlayer),
    team_b_players: (raw.team_b_players ?? []).map(normalizeLeaderboardPlayer),
  }
}

function normalizeTournamentDetail(raw: TournamentDetail): TournamentDetail {
  return {
    ...raw,
    tournament: normalizeTournamentSummary(raw.tournament),
    players: (raw.players ?? []).map(normalizeLeaderboardPlayer),
    teams: (raw.teams ?? []).map(normalizeTournamentTeam),
    matches: (raw.matches ?? []).map(normalizeTournamentMatch),
    standings: (raw.standings ?? []).map(normalizeLeaderboardEntry),
    scorers: (raw.scorers ?? []) as TournamentScorerStaff[],
  }
}

/** Platform-wide totals, added up from the per-club figures the server returns. */
export function summarizePlatform(clubs: PlatformClub[]): SuperadminStats {
  return {
    totalGrossVolume: clubs.reduce((sum, club) => sum + club.gross_amount, 0),
    totalCommissionsEarned: clubs.reduce((sum, club) => sum + club.commission_amount, 0),
    activeClubsCount: clubs.filter((club) => club.status === 'active').length,
    totalEntriesCount: clubs.reduce((sum, club) => sum + club.entry_count, 0),
  }
}
