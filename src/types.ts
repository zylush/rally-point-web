export type Role = 'member' | 'staff' | 'admin' | 'superadmin'

export type MembershipType = 'basic' | 'standard' | 'premium'
export type MemberStatus = 'active' | 'expired' | 'pending' | 'suspended'
export type SessionStatus = 'scheduled' | 'playing' | 'completed' | 'cancelled' | 'pending_payment'
export type TxType = 'membership' | 'court_rental' | 'walk_in' | 'extension' | 'booking' | 'other'
export type CourtStatus = 'available' | 'occupied' | 'maintenance'
export type PaymentMethod = 'gcash' | 'maya' | 'card' | 'demo_wallet'
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'cancelled'
export type BookingStatus = 'pending_payment' | 'confirmed' | 'cancelled' | 'completed' | 'no_show'
export type OpenPlayStatus = 'open' | 'full' | 'cancelled' | 'completed'
export type OpenPlaySignupStatus = 'joined' | 'waitlist' | 'cancelled'
export type ReminderKind = 'booking_confirm' | 'booking_reminder' | 'open_play_reminder'
export type SkillLevel = 'all' | 'beginner' | 'intermediate' | 'advanced'
export type InquiryCategory = 'booking' | 'membership' | 'payment' | 'technical' | 'other'
export type InquiryStatus = 'open' | 'in_progress' | 'resolved'

export interface Club {
  id: string
  slug: string
  name: string
  default_timezone: string
  is_active: boolean
}

export interface Venue {
  id: string
  club_id: string
  slug: string
  name: string
  timezone: string
  open_hour: number
  close_hour: number
  is_active: boolean
  /** Where this location is, shown to players with a map. Optional until the club fills it in. */
  address?: string | null
  city?: string | null
  latitude?: number | null
  longitude?: number | null
}

/** What an admin sends to set a location's address and map pin. */
export interface VenueLocationInput {
  venue_id: string
  address: string | null
  city: string | null
  latitude: number | null
  longitude: number | null
}

export interface StaffVenueGrant {
  club_id: string
  user_id: string
  venue_id: string
  granted_by?: string | null
  is_active: boolean
}

export interface TenantContext {
  club: Club
  venues: Venue[]
  role?: Role | null
}

export interface Profile {
  id: string
  email: string
  full_name: string
  role: Role
  phone?: string | null
  avatar_url?: string | null
  /** What the person likes to be called in the app (1–30 characters); null when not set. */
  nickname?: string | null
  /** Their profile photo in the public member-photos bucket: `<user id>/<uuid>.<ext>`. */
  photo_path?: string | null
  created_at: string
  venue_ids?: string[]
}

export type ClubRole = Exclude<Role, 'superadmin'>

/** A club the signed-in person can act in, resolved from trusted access records. */
export interface MyClub {
  club_id: string
  slug: string
  name: string
  role: ClubRole
}

/** The only club fields shown before sign-in (join links, public TV board). */
export type PublicClub = Pick<Club, 'id' | 'slug' | 'name'>

export type ClubStatus = 'provisioning' | 'active' | 'suspended'

/** Trusted staff assignment within one club. */
export interface ClubStaffRole {
  club_id: string
  user_id: string
  role: 'staff' | 'admin'
  is_active: boolean
}

/** Platform-owned commercial terms for a club. Club admins may read their own. */
export interface ClubAccount {
  club_id: string
  status: ClubStatus
  commission_rate: number
  city: string | null
  address: string | null
  contact_email: string | null
  contact_phone: string | null
  created_at: string
  updated_at: string
}

/** A club as the platform superadmin sees it: terms and totals, never member details. */
export interface PlatformClub {
  club_id: string
  slug: string
  name: string
  status: ClubStatus
  commission_rate: number
  city: string | null
  address: string | null
  contact_email: string | null
  contact_phone: string | null
  venue_count: number
  court_count: number
  member_count: number
  admin_count: number
  gross_amount: number
  commission_amount: number
  club_net_amount: number
  entry_count: number
  created_at: string
}

/** Commission recorded from a court-time charge. Charges are recorded, not collected, today. */
export interface PlatformCommission {
  id: string
  club_id: string
  club_name: string
  venue_id: string | null
  transaction_id: string
  description: string
  gross_amount: number
  commission_rate: number
  commission_amount: number
  club_net_amount: number
  verification_status: 'unverified' | 'verified'
  created_at: string
}

/** An active admin of a club, as listed for the platform superadmin. */
export interface PlatformClubAdmin {
  user_id: string
  email: string
  full_name: string
}

export interface PlatformAction {
  id: string
  actor_email: string | null
  action: string
  club_id: string | null
  club_name: string | null
  details: Record<string, unknown>
  created_at: string
}

/** A superadmin's time-limited, read-only support view of one club. */
export interface SupportSession {
  id: string
  club_id: string
  club_name: string
  reason: string
  started_at: string
  expires_at: string
  ended_at: string | null
  is_open: boolean
}

/** What a support session shows: settings, counts and today's activity, never member details. */
export interface SupportSnapshot {
  session: { id: string; club_id: string; reason: string; started_at: string; expires_at: string }
  club: { id: string; name: string; slug: string; is_active: boolean; status: ClubStatus | null }
  venues: { id: string; name: string; is_active: boolean; courts: number }[]
  members: { total: number; active: number; expired: number }
  staff_count: number
  today: { kind: 'session' | 'booking' | 'open_play'; court_name: string; venue_name: string; start_at: string; end_at: string; status: string }[]
  open_inquiries: { category: string; subject: string; status: string; created_at: string }[]
}

export interface ProvisionClubInput {
  name: string
  slug: string
  city: string
  address: string
  contact_email: string
  contact_phone: string
  commission_rate: number
  court_count: number
}

/** When a court owner would like bRineLy to call. */
export type OwnerCallTime = 'morning' | 'afternoon' | 'evening'
export type OwnerCallStatus = 'new' | 'called' | 'closed'

/** What a court owner sends from the public "I own a court" page. Blank text means "not given". */
export interface OwnerCallRequestInput {
  full_name: string
  club_name: string
  city: string
  court_count: number
  phone: string
  email: string
  /** YYYY-MM-DD, Philippine time. */
  preferred_date: string
  preferred_time: OwnerCallTime
  message: string
}

/** An owner's request, as the platform superadmin sees it. */
export interface OwnerCallRequest {
  id: string
  full_name: string
  club_name: string
  city: string
  court_count: number
  phone: string | null
  email: string | null
  preferred_date: string
  preferred_time: OwnerCallTime
  message: string | null
  status: OwnerCallStatus
  created_at: string
  handled_at: string | null
  handled_by_email: string | null
}

/** An open invite: the person becomes the club's admin once they sign up with this email and confirm it. */
export interface ClubOwnerInvite {
  id: string
  email: string
  created_at: string
}

/** A club the signed-in person owns through an invite, with its platform status. */
export interface OwnerClub {
  club_id: string
  name: string
  status: ClubStatus
}

export interface SuperadminStats {
  totalGrossVolume: number
  totalCommissionsEarned: number
  activeClubsCount: number
  totalEntriesCount: number
}

export interface Member {
  id: string
  club_id?: string
  user_id?: string | null
  member_code: string
  full_name: string
  email?: string | null
  phone?: string | null
  /** NULL for a player with no membership at this club; set together with expiry_date. */
  membership_type: MembershipType | null
  status: MemberStatus
  join_date: string
  expiry_date: string | null
  notes?: string | null
  qr_token?: string | null
  created_at: string
}

/** What the person can change on their own account; the full name also goes to every club's member card. */
export interface AccountInput {
  full_name: string
  /** Empty or null clears the nickname. */
  nickname?: string | null
}

export type MembershipRequestStatus = 'pending' | 'approved' | 'declined' | 'cancelled'

/** The person's latest membership request at one club, as they see it on their pass. */
export interface MyMembershipRequest {
  id: string
  status: MembershipRequestStatus
  decline_reason: string | null
  requested_at: string
  decided_at: string | null
}

/**
 * One club's check-in pass in the person's QR wallet (from list_my_member_passes).
 * Each club's code works only at that club, so a person in two clubs holds two passes.
 */
export interface MemberPass {
  club_id: string
  club_slug: string
  club_name: string
  member_id: string
  member_code: string
  full_name: string
  membership_type: MembershipType | null
  status: MemberStatus
  expiry_date: string | null
  /** A plan, status 'active' and an expiry not yet passed (Philippine date): the member rate applies. */
  is_active_member: boolean
  qr_token: string
  /** The latest request at this club, or null when there has never been one. */
  request: MyMembershipRequest | null
}

/** A membership request as the club's staff and admins see it. */
export interface MembershipRequest {
  id: string
  member_id: string
  member_code: string
  full_name: string
  nickname: string | null
  photo_url: string | null
  /** The member's current plan, before this request is decided. */
  membership_type: MembershipType | null
  member_status: MemberStatus
  expiry_date: string | null
  status: MembershipRequestStatus
  requested_at: string
  decided_at: string | null
  decline_reason: string | null
  /** Amount staff recorded as received when approving; null otherwise. */
  amount: number | null
}

/** What staff enter to approve a request: the plan and the amount the player paid (0 when free). */
export interface MembershipApproval {
  membership_type: MembershipType
  amount: number
}

/** Whether a court has a roof over it. A court an admin has not set yet has no type (null). */
export type CourtType = 'indoor' | 'outdoor'

export function isCourtType(value: unknown): value is CourtType {
  return value === 'indoor' || value === 'outdoor'
}

/** "Indoor" or "Outdoor"; null when the court's type is not set, so nothing is shown. */
export function courtTypeLabel(type: CourtType | null | undefined): string | null {
  if (type === 'indoor') return 'Indoor'
  if (type === 'outdoor') return 'Outdoor'
  return null
}

export interface Court {
  id: string
  club_id?: string
  venue_id?: string
  name: string
  status: CourtStatus
  hourly_rate: number
  /** Lower price for players with an active membership; NULL means the regular rate. */
  member_rate?: number | null
  /** Indoor or outdoor; null or missing means the admin has not set it. */
  court_type?: CourtType | null
}

/** What an admin sends to add or edit a court. Out of service is the 'maintenance' status. */
export interface CourtInput {
  id?: string
  venue_id: string
  name: string
  hourly_rate: number
  /** Optional lower member price; null or omitted means members pay the regular rate. */
  member_rate?: number | null
  in_service: boolean
  /** Indoor, outdoor, or null to clear it. Omitted leaves the court's type as it is. */
  court_type?: CourtType | null
}

/** One club in the public "Find a court" list. */
export interface PublicClubListing {
  slug: string
  name: string
  city: string | null
  address: string | null
  /** Cities of the club's locations (and the club's own city), for the city filter. */
  cities: string[]
  venue_count: number
  court_count: number
  min_rate: number | null
  min_member_rate: number | null
  /** Photo for the club card (a location cover or a court photo); null shows a sample picture. */
  cover_photo?: string | null
  /** In-service indoor and outdoor courts at active locations; courts with no type are in neither. */
  indoor_courts: number
  outdoor_courts: number
}

/** A club's public page: its active venues and their courts. */
export interface PublicClubDetail {
  slug: string
  name: string
  city: string | null
  address: string | null
  venues: {
    id: string
    name: string
    open_hour: number
    close_hour: number
    address: string | null
    city: string | null
    latitude: number | null
    longitude: number | null
    /** The location's cover photo, if it has one. */
    cover_photo?: string | null
    courts: {
      id: string
      name: string
      hourly_rate: number
      member_rate: number | null
      in_service: boolean
      /** Indoor or outdoor; null when the club has not set it. */
      court_type?: CourtType | null
      /** Photo links, main photo first. Empty means a sample picture is shown. */
      photos?: string[]
    }[]
  }[]
}

/**
 * A photo an admin added. court_id null means the location's cover photo.
 * `url` is ready to show; `path` is where the file is stored.
 */
export interface CourtPhoto {
  id: string
  club_id: string
  venue_id: string
  court_id: string | null
  path: string
  url: string
  position: number
  created_at: string
}

/** Up to this many photos per court, as the database enforces. */
export const MAX_COURT_PHOTOS = 8

// ---- Club business profile (see the club_business_profile migration) ----

export type AddonUnit = 'per_hour' | 'per_booking' | 'per_item' | 'per_person'

export type Amenity =
  | 'parking' | 'restrooms' | 'showers' | 'lockers' | 'drinking_water' | 'wifi' | 'seating'
  | 'canteen' | 'pro_shop' | 'covered_courts' | 'night_lights' | 'air_conditioning' | 'first_aid'

/** What a club tells players about itself. Null means not filled in, so it is not shown. */
export interface ClubProfileFields {
  about: string | null
  phone: string | null
  email: string | null
  facebook_url: string | null
  messenger_url: string | null
  instagram_url: string | null
  website_url: string | null
  amenities: Amenity[]
  payment_note: string | null
  house_rules: string | null
  cancellation_policy: string | null
  terms: string | null
}

/** An extra the club offers, such as paddle rental. Shown on the club page; nothing charges for it yet. */
export interface ClubAddon {
  id: string
  club_id: string
  name: string
  description: string | null
  price: number
  unit: AddonUnit
  is_active: boolean
  position: number
  created_at: string
}

export interface ClubAddonInput {
  id?: string
  name: string
  description: string | null
  price: number
  unit: AddonUnit
  is_active: boolean
}

/** A coach the club lists. Not linked to a member record. */
export interface ClubCoach {
  id: string
  club_id: string
  /** Linked through trusted club-admin provisioning; never supplied by public signup. */
  account_user_id?: string | null
  full_name: string
  headline: string | null
  bio: string | null
  hourly_rate: number | null
  booking_policy?: string | null
  contact_phone: string | null
  contact_url: string | null
  photo_path: string | null
  /** Ready to show, or null when the coach has no photo. */
  photo_url: string | null
  is_active: boolean
  position: number
  created_at: string
}

export interface ClubCoachInput {
  id?: string
  full_name: string
  headline: string | null
  bio: string | null
  hourly_rate: number | null
  contact_phone: string | null
  contact_url: string | null
  is_active: boolean
}

export type CoachLessonType = 'private' | 'group'
export type CoachPricingModel = 'per_student' | 'per_session'
export type CoachRequestStatus = 'requested' | 'accepted' | 'declined' | 'cancelled' | 'completed' | 'no_show'

/** One future time a linked coach makes available for a private or group lesson. */
export interface CoachBookingSlot {
  slot_id: string
  coach_id: string
  club_id: string
  coach_name: string
  coach_headline?: string | null
  coach_photo_url?: string | null
  starts_at: string
  ends_at: string
  lesson_type: CoachLessonType
  pricing_model: CoachPricingModel
  rate: number
  max_students: number
  remaining_students?: number
  is_open?: boolean
  active_students?: number
  club_name?: string
  booking_policy?: string | null
}

export interface CoachProfileAccess {
  coach_id: string
  club_id: string
  club_slug: string
  club_name: string
  full_name: string
  headline: string | null
  bio: string | null
  hourly_rate: number | null
  photo_path: string | null
  is_active: boolean
  booking_policy: string | null
}

/** A player's request for available coach time. The court is arranged separately. */
export interface CoachBookingRequest {
  request_id: string
  slot_id: string
  club_id: string
  coach_id?: string
  coach_name: string
  player_user_id?: string
  player_name?: string
  player_email?: string
  starts_at: string
  ends_at: string
  lesson_type: CoachLessonType
  pricing_model: CoachPricingModel
  rate: number
  student_count: number
  quoted_amount: number
  message: string | null
  status: CoachRequestStatus
  created_at: string
  updated_at?: string
  club_name?: string
}

export interface CoachRequestMessage {
  id: string
  request_id: string
  sender_user_id: string
  body: string
  created_at: string
}

/** One open future coach lesson slot shown on the public Rent a coach page. */
export interface PublicCoachSlot {
  slot_id: string
  starts_at: string
  ends_at: string
  lesson_type: CoachLessonType
  pricing_model: CoachPricingModel
  rate: number
  max_students: number
  remaining_students: number
}

/** One active coach across any active club, with open lesson times (public Rent a coach page). */
export interface PublicCoachListing {
  id: string
  full_name: string
  headline: string | null
  bio: string | null
  hourly_rate: number | null
  contact_phone: string | null
  contact_url: string | null
  photo_url: string | null
  booking_policy: string | null
  accepts_requests: boolean
  club: {
    id: string
    slug: string
    name: string
    city: string | null
  }
  slots: PublicCoachSlot[]
}

/** A way to pay the club directly (GCash, Maya, a bank). bRineLy does not take or check these payments. */
export interface ClubPaymentMethod {
  id: string
  club_id: string
  label: string
  account_name: string | null
  account_number: string | null
  qr_path: string | null
  /** The QR code picture, ready to show, or null. */
  qr_url: string | null
  is_active: boolean
  position: number
  created_at: string
}

export interface ClubPaymentMethodInput {
  id?: string
  label: string
  account_name: string | null
  account_number: string | null
  is_active: boolean
}

export interface ClubGalleryPhoto {
  id: string
  club_id: string
  path: string
  url: string
  caption: string | null
  position: number
  created_at: string
}

/**
 * What happened to the old picture file after a club picture was replaced or removed.
 * The bucket is public, so a file left behind still opens from its old link.
 */
export interface PictureCleanup {
  fileLeftBehind: boolean
}

/** Everything on the admin Business profile screen, inactive items included. */
export interface AdminClubProfile {
  profile: ClubProfileFields
  addons: ClubAddon[]
  coaches: ClubCoach[]
  payment_methods: ClubPaymentMethod[]
  gallery: ClubGalleryPhoto[]
}

/** The public part of a club's profile, for its club page: active items only, links ready to show. */
export interface PublicClubProfile extends ClubProfileFields {
  payment_methods: Pick<ClubPaymentMethod, 'id' | 'label' | 'account_name' | 'account_number' | 'qr_url'>[]
  addons: Pick<ClubAddon, 'id' | 'name' | 'description' | 'price' | 'unit'>[]
  coaches: Pick<ClubCoach, 'id' | 'full_name' | 'headline' | 'bio' | 'hourly_rate' | 'contact_phone' | 'contact_url' | 'photo_url'>[]
  gallery: Pick<ClubGalleryPhoto, 'id' | 'url' | 'caption'>[]
}

/** A membership counts when it has a plan, is active, and has not expired. Players have no plan. */
export function hasActiveMembership(member: Pick<Member, 'membership_type' | 'status' | 'expiry_date'> | null | undefined, today = new Date()) {
  if (!member?.membership_type || !member.expiry_date || member.status !== 'active') return false
  const todayYmd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  return member.expiry_date.slice(0, 10) >= todayYmd
}

/** The hourly price this person pays for a court: the member rate only with an active membership. */
export function courtRateFor(court: Pick<Court, 'hourly_rate' | 'member_rate'>, member: Parameters<typeof hasActiveMembership>[0]) {
  return hasActiveMembership(member) && court.member_rate != null ? court.member_rate : court.hourly_rate
}

export interface CourtSessionPlayer {
  id: string
  full_name: string
  member_id?: string | null
  guest_name?: string | null
}

export interface CourtSession {
  id: string
  club_id?: string
  venue_id?: string
  court_id: string
  member_id?: string | null
  guest_name?: string | null
  start_at: string
  end_at: string
  status: SessionStatus
  amount: number
  created_by?: string | null
  notes?: string | null
  booking_id?: string | null
  court?: Court
  member?: Member
  players?: CourtSessionPlayer[]
}

export interface Booking {
  id: string
  club_id?: string
  venue_id?: string
  court_id: string
  member_id: string
  start_at: string
  end_at: string
  hours: number
  amount: number
  status: BookingStatus
  payment_method?: PaymentMethod | null
  payment_ref?: string | null
  session_id?: string | null
  created_at: string
  /** An online checkout holds its hours until then; unpaid desk bookings have none. */
  hold_expires_at?: string | null
  /** The GCash reference number the player entered after paying the club's QR. */
  payment_reference?: string | null
  /** When the player said they paid. From then the hours stay held until the club decides. */
  payment_submitted_at?: string | null
  /** When the club should have checked the payment; after it the request shows as overdue. */
  confirm_by?: string | null
  court?: Court
  member?: Member
}

/** Minutes a player has to pay before the hours they picked are released. */
export const BOOKING_HOLD_MINUTES = 15

/** Minutes the club has to check a GCash payment before the request shows as overdue. */
export const CONFIRM_PAYMENT_MINUTES = 15

/**
 * Where an online checkout stands. A payment the player has sent is never released by
 * the clock: the club confirms it (booked) or says it was not received (released).
 */
export type CheckoutState = 'holding' | 'awaiting_confirmation' | 'booked' | 'released'

export function checkoutState(
  booking: Pick<Booking, 'status' | 'payment_submitted_at' | 'hold_expires_at'>,
  now = Date.now(),
): CheckoutState {
  if (booking.status === 'confirmed' || booking.status === 'completed' || booking.status === 'no_show') return 'booked'
  if (booking.status !== 'pending_payment') return 'released'
  if (booking.payment_submitted_at) return 'awaiting_confirmation'
  // The database clears a lapsed hold only when the next hold comes in, so the time decides.
  if (booking.hold_expires_at && new Date(booking.hold_expires_at).getTime() <= now) return 'released'
  return 'holding'
}

/** A club's way to be paid, as a player sees it at checkout. */
export type CheckoutPaymentMethod = Pick<ClubPaymentMethod, 'id' | 'label' | 'account_name' | 'account_number' | 'qr_url'>

/** Why an hour cannot be booked: someone has it, it is over, or the court is out of service. */
export type SlotBlock = 'booked' | 'passed' | 'out_of_service'

export interface TimeSlot {
  startHour: number
  label: string
  available: boolean
  /** Set whenever `available` is false. */
  blocked?: SlotBlock
}

export interface CourtDayAvailability {
  court: Court
  slots: TimeSlot[]
}

export interface PaymentIntent {
  id: string
  booking_id: string
  amount: number
  method: PaymentMethod
  status: PaymentStatus
  checkout_url?: string | null
  created_at: string
}

export interface CheckIn {
  id: string
  club_id?: string
  venue_id?: string
  member_id: string
  checked_in_at: string
  staff_id?: string | null
  note?: string | null
  member?: Member
}

/** The member a scanned pass belongs to, with what the desk needs to recognise them. */
export interface CheckInMember extends Member {
  nickname?: string | null
  photo_url?: string | null
  is_active_member: boolean
}

/** What check_in_qr returns: the new check-in and who it was for. */
export interface CheckInResult {
  checkin: CheckIn
  member: CheckInMember
}

export interface Transaction {
  id: string
  club_id?: string
  venue_id?: string | null
  verification_status?: 'unverified' | 'verified'
  member_id?: string | null
  amount: number
  type: TxType
  description: string
  created_at: string
  created_by?: string | null
  member?: Member
}

export interface Notification {
  id: string
  club_id?: string
  venue_id?: string | null
  user_id: string
  title: string
  body: string
  read: boolean
  created_at: string
}

export interface SupportInquiry {
  id: string
  club_id: string
  user_id: string
  category: InquiryCategory
  subject: string
  message: string
  status: InquiryStatus
  created_at: string
  response?: string | null
  responded_by?: string | null
  responded_at?: string | null
  sender?: Pick<Profile, 'id' | 'full_name' | 'email'> | null
}

export interface WalkIn {
  id: string
  club_id?: string
  venue_id?: string
  full_name: string
  phone?: string | null
  purpose: string
  amount: number
  created_at: string
  created_by?: string | null
}

export interface DashboardStats {
  members: number
  active_now: number
  revenue_today: number
  courts_occupied: number
}


export interface OpenPlaySession {
  id: string
  club_id?: string
  venue_id?: string
  title: string
  court_id?: string | null
  start_at: string
  end_at: string
  capacity: number
  fee: number
  skill_level: SkillLevel
  status: OpenPlayStatus
  notes?: string | null
  created_by?: string | null
  created_at: string
  court?: Court
  signups?: OpenPlaySignup[]
  seats_taken?: number
}

export interface OpenPlaySignup {
  id: string
  club_id?: string
  venue_id?: string
  open_play_id: string
  member_id: string
  status: OpenPlaySignupStatus
  created_at: string
  member?: Member
}

export interface ScheduleBlock {
  id: string
  kind: 'session' | 'booking' | 'open_play'
  court_id?: string | null
  venue_id?: string | null
  venue_name?: string
  court_name: string
  title: string
  subtitle?: string
  start_at: string
  end_at: string
  status: string
  amount?: number
}

export interface Reminder {
  id: string
  club_id?: string
  venue_id?: string | null
  user_id: string
  kind: ReminderKind
  title: string
  body: string
  fire_at: string
  sent_at?: string | null
  booking_id?: string | null
  open_play_id?: string | null
}

export type MatchFormat = 'doubles' | 'singles'
export type LeaderboardFormatFilter = 'all' | MatchFormat
export type LeaderboardPeriod = 'month' | 'all'
export type MatchSide = 'a' | 'b'

/** Safe display identity for a player on the club leaderboard or match card (no contact or billing fields). */
export interface LeaderboardPlayerSummary {
  member_id: string
  full_name: string
  nickname?: string | null
  photo_path?: string | null
  photo_url?: string | null
}

/** One ranked player row computed from completed matches in scope. */
export interface LeaderboardEntry extends LeaderboardPlayerSummary {
  rank: number
  points: number
  wins: number
  losses: number
  games_played: number
  win_pct: number
  score_diff: number
  streak: number
}

/** One recorded club match (completed or voided). */
export interface ClubMatch {
  id: string
  club_id: string
  venue_id?: string | null
  venue_name?: string | null
  court_id?: string | null
  court_name?: string | null
  tournament_id?: string | null
  tournament_title?: string | null
  format: MatchFormat
  winner_side: MatchSide
  score_a?: number | null
  score_b?: number | null
  notes?: string | null
  status: 'completed' | 'voided'
  void_reason?: string | null
  played_at: string
  created_at: string
  team_a: LeaderboardPlayerSummary[]
  team_b: LeaderboardPlayerSummary[]
}

/** Public or signed-in club leaderboard response. */
export interface ClubLeaderboardSnapshot {
  club: PublicClub | null
  period: LeaderboardPeriod
  format: LeaderboardFormatFilter
  entries: LeaderboardEntry[]
  recent_matches: ClubMatch[]
  total_players: number
  total_matches: number
  my_member_id?: string | null
  my_entry?: LeaderboardEntry | null
  can_score?: boolean
}

export interface RecordMatchInput {
  format: MatchFormat
  team_a: string[]
  team_b: string[]
  winner_side: MatchSide
  score_a?: number | null
  score_b?: number | null
  venue_id?: string | null
  court_id?: string | null
  notes?: string | null
}

/** A club staff member who can be designated by an admin to record match results. */
export interface LeaderboardScorerStaff {
  user_id: string
  full_name: string
  email: string
  can_score: boolean
}

// ---- Phase 2: Club tournaments (Single-Elimination Bracket & Random Queue Mixer) ----

export type TournamentFormat = 'single_elimination' | 'random_queue'
export type TournamentStatus = 'setup' | 'live' | 'completed' | 'cancelled'
export type TournamentMatchStatus = 'pending' | 'ready' | 'playing' | 'completed' | 'bye' | 'voided'

/** Staff assignment row returned for club admins managing per-tournament scorers. */
export interface TournamentScorerStaff {
  user_id: string
  full_name: string
  email: string
  is_club_scorer: boolean
  can_score: boolean
}

export interface TournamentTeam {
  id: string
  seed: number
  name: string
  players: LeaderboardPlayerSummary[]
}

export interface TournamentMatch {
  id: string
  tournament_id: string
  round_number: number
  match_order: number
  round_label: string
  court_id?: string | null
  court_name?: string | null
  team_a_id?: string | null
  team_b_id?: string | null
  team_a_name?: string | null
  team_b_name?: string | null
  team_a_seed?: number | null
  team_b_seed?: number | null
  team_a_players: LeaderboardPlayerSummary[]
  team_b_players: LeaderboardPlayerSummary[]
  status: TournamentMatchStatus
  winner_side?: MatchSide | null
  score_a?: number | null
  score_b?: number | null
  next_match_id?: string | null
  next_match_side?: MatchSide | null
  club_match_id?: string | null
  completed_at?: string | null
  created_at: string
}

export interface TournamentSummary {
  id: string
  club_id: string
  venue_id?: string | null
  venue_name?: string | null
  title: string
  format: TournamentFormat
  team_size: 1 | 2
  status: TournamentStatus
  counts_for_leaderboard: boolean
  scheduled_at?: string | null
  notes?: string | null
  started_at?: string | null
  completed_at?: string | null
  created_at: string
  player_count: number
  team_count: number
  active_matches: number
  completed_matches: number
  total_matches: number
  champion_label?: string | null
}

/** The club a tournament is played at, as the cross-club Tournaments page shows it. */
export interface PublicTournamentClub {
  slug: string
  name: string
  city?: string | null
}

/** A tournament on the public Tournaments page: the club summary plus where it is played. */
export interface PublicTournamentSummary extends TournamentSummary {
  club: PublicTournamentClub
}

/** Which tournaments the public Tournaments page asks for; null means all of them. */
export type PublicTournamentFilter = 'live' | 'setup' | 'completed' | null

export interface TournamentDetail {
  club: PublicClub | null
  tournament: TournamentSummary
  players: LeaderboardPlayerSummary[]
  teams: TournamentTeam[]
  matches: TournamentMatch[]
  standings: LeaderboardEntry[]
  scorers?: TournamentScorerStaff[]
  my_member_id?: string | null
  can_score?: boolean
  can_manage?: boolean
}

export interface CreateTournamentInput {
  title: string
  format: TournamentFormat
  team_size: 1 | 2
  venue_id?: string | null
  counts_for_leaderboard?: boolean
  scheduled_at?: string | null
  notes?: string | null
  player_ids?: string[]
}

export interface ScoreTournamentMatchInput {
  tournament_id: string
  match_id: string
  winner_side: MatchSide
  score_a?: number | null
  score_b?: number | null
  court_id?: string | null
}

export function qrPayload(memberCode: string, token: string) {
  return `RP1|${memberCode}|${token}`
}

export function parseQrPayload(raw: string): { member_code: string; token: string } | null {
  const t = raw.trim()
  const parts = t.split('|')
  if (parts.length === 3 && parts[0] === 'RP1') {
    return { member_code: parts[1], token: parts[2] }
  }
  // A typed code: BR- for codes made since 2026-11-24, RP- for older ones (both stay valid).
  if (/^(BR|RP)-[0-9A-Z]+/i.test(t)) return { member_code: t.toUpperCase(), token: '' }
  return null
}

/** Plain English for mixed-age UI */
export function friendlyStatus(status: string): string {
  const map: Record<string, string> = {
    active: 'Active',
    expired: 'Expired — renew',
    pending: 'Pending',
    suspended: 'On hold',
    confirmed: 'Confirmed',
    pending_payment: 'Waiting for payment',
    cancelled: 'Cancelled',
    completed: 'Done',
    no_show: 'No-show',
    scheduled: 'Reserved',
    playing: 'Playing now',
    open: 'Open',
    full: 'Full',
    joined: "You're in",
    waitlist: 'On waitlist',
    available: 'Free',
    occupied: 'In use',
    maintenance: 'Closed for maintenance',
    basic: 'Basic',
    standard: 'Standard',
    premium: 'Premium',
  }
  return map[status] ?? status.replace(/_/g, ' ')
}

/**
 * Courts can be booked around the clock (Philippine time). A booking ends by
 * midnight: the server's booking functions require start + hours <= 24.
 */
export const CLUB_OPEN_HOUR = 0
export const CLUB_CLOSE_HOUR = 24

export function peso(n: number) {
  return `Php ${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * Every club and venue is in the Philippines, so the app shows and books times in
 * Philippine time whatever the phone's own timezone. Asia/Manila is UTC+8 all year
 * (no daylight saving), which keeps the arithmetic below exact.
 */
export const APP_TIME_ZONE = 'Asia/Manila'
const APP_UTC_OFFSET_HOURS = 8

export function fmtDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: APP_TIME_ZONE })
}

export function fmtTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: APP_TIME_ZONE })
}

export function fmtDateTime(iso: string) {
  return `${fmtDate(iso)} · ${fmtTime(iso)}`
}

/** "6:00 AM" for hour 6; hour 0 and hour 24 are both midnight ("12:00 AM"). */
export function hourLabel(h: number) {
  const hour = ((h % 24) + 24) % 24
  const twelve = hour % 12 === 0 ? 12 : hour % 12
  return `${twelve}:00 ${hour < 12 ? 'AM' : 'PM'}`
}

/**
 * One hour of a court's day. A booked hour reads "Booked" even once it has started,
 * so every hour of a booking shows as taken.
 */
export function timeSlot(startHour: number, state: { booked: boolean; outOfService: boolean; passed: boolean }): TimeSlot {
  const blocked: SlotBlock | undefined = state.booked
    ? 'booked'
    : state.outOfService
      ? 'out_of_service'
      : state.passed
        ? 'passed'
        : undefined
  return blocked
    ? { startHour, label: hourLabel(startHour), available: false, blocked }
    : { startHour, label: hourLabel(startHour), available: true }
}

/** "Open 24 hours", or "Open 6:00 AM to 10:00 PM" for a venue with set hours. */
export function openingHoursLabel(openHour: number, closeHour: number) {
  return openHour === 0 && closeHour === 24 ? 'Open 24 hours' : `Open ${hourLabel(openHour)} to ${hourLabel(closeHour)}`
}

/** The hours a venue takes bookings (a booking ends by its closing hour); without a venue, all day. */
export function venueHours(venue: Pick<Venue, 'open_hour' | 'close_hour'> | null | undefined) {
  return { open: venue?.open_hour ?? CLUB_OPEN_HOUR, close: venue?.close_hour ?? CLUB_CLOSE_HOUR }
}

/** The hour of day (0–23) of an instant, in Philippine time. */
export function appHour(iso: string) {
  return (new Date(iso).getUTCHours() + APP_UTC_OFFSET_HOURS) % 24
}

/** The calendar date (YYYY-MM-DD) of an instant, in Philippine time. */
export function ymdLocal(d: Date) {
  const shifted = new Date(d.getTime() + APP_UTC_OFFSET_HOURS * 3600000)
  const y = shifted.getUTCFullYear()
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const day = String(shifted.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** A booking range that starts at `startHour` Philippine time on `dateYmd`. */
export function localRangeISO(dateYmd: string, startHour: number, hours: number) {
  const [y, m, d] = dateYmd.split('-').map(Number)
  const start = new Date(Date.UTC(y, m - 1, d, startHour - APP_UTC_OFFSET_HOURS, 0, 0, 0))
  const end = new Date(start.getTime() + hours * 3600000)
  return { start_at: start.toISOString(), end_at: end.toISOString() }
}
