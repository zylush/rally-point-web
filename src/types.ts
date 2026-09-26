export type Role = 'member' | 'staff' | 'admin'

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
  created_at: string
  venue_ids?: string[]
}

export interface Member {
  id: string
  club_id?: string
  user_id?: string | null
  member_code: string
  full_name: string
  email?: string | null
  phone?: string | null
  membership_type: MembershipType
  status: MemberStatus
  join_date: string
  expiry_date: string
  notes?: string | null
  qr_token?: string | null
  created_at: string
}

export interface Court {
  id: string
  club_id?: string
  venue_id?: string
  name: string
  status: CourtStatus
  hourly_rate: number
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
  court?: Court
  member?: Member
}

export interface TimeSlot {
  startHour: number
  label: string
  available: boolean
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

export function qrPayload(memberCode: string, token: string) {
  return `RP1|${memberCode}|${token}`
}

export function parseQrPayload(raw: string): { member_code: string; token: string } | null {
  const t = raw.trim()
  const parts = t.split('|')
  if (parts.length === 3 && parts[0] === 'RP1') {
    return { member_code: parts[1], token: parts[2] }
  }
  if (/^RP-\d+/i.test(t)) return { member_code: t.toUpperCase(), token: '' }
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

/** Club open hours (local) */
export const CLUB_OPEN_HOUR = 6
export const CLUB_CLOSE_HOUR = 22

export function peso(n: number) {
  return `Php ${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function fmtDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function fmtTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export function fmtDateTime(iso: string) {
  return `${fmtDate(iso)} · ${fmtTime(iso)}`
}

export function hourLabel(h: number) {
  const d = new Date()
  d.setHours(h, 0, 0, 0)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export function ymdLocal(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function localRangeISO(dateYmd: string, startHour: number, hours: number) {
  const [y, m, d] = dateYmd.split('-').map(Number)
  const start = new Date(y, m - 1, d, startHour, 0, 0, 0)
  const end = new Date(start.getTime() + hours * 3600000)
  return { start_at: start.toISOString(), end_at: end.toISOString() }
}
