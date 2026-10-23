import type { Booking, CheckIn, Club, ClubAccount, ClubStaffRole, Court, CourtSession, Member, Notification, OpenPlaySession, OpenPlaySignup, Profile, Reminder, StaffVenueGrant, SupportInquiry, Transaction, Venue, WalkIn } from '../../types'

/** Platform role, granted by trusted provisioning only. */
export interface DemoPlatformRole {
  user_id: string
  role: 'superadmin'
}

/** Commission line as stored; the club name is added when it is read. */
export interface DemoCommission {
  id: string
  club_id: string
  venue_id: string | null
  transaction_id: string
  gross_amount: number
  commission_rate: number
  commission_amount: number
  club_net_amount: number
  verification_status: 'unverified' | 'verified'
  created_at: string
}

export interface DemoAuditEntry {
  id: string
  actor_id: string | null
  action: string
  club_id: string | null
  details: Record<string, unknown>
  created_at: string
}

/** A court photo (court_id set) or a location cover (court_id null); mirrors public.court_photos. */
export interface DemoPhoto {
  id: string
  club_id: string
  venue_id: string
  court_id: string | null
  /** The photo itself, as a data link. */
  url: string
  position: number
  created_at: string
}

/** A superadmin's support session, as stored; mirrors platform_support_sessions. */
export interface DemoSupportSession {
  id: string
  club_id: string
  actor_id: string
  reason: string
  started_at: string
  expires_at: string
  ended_at: string | null
}

export interface DemoDB {
  clubs: Club[]
  clubAccounts: ClubAccount[]
  /** Trusted staff and admin assignments per club. Authority never comes from profiles.role. */
  clubRoles: ClubStaffRole[]
  platformRoles: DemoPlatformRole[]
  auditLog: DemoAuditEntry[]
  venues: Venue[]
  staffVenueGrants: StaffVenueGrant[]
  commissions: DemoCommission[]
  profiles: Profile[]
  members: Member[]
  courts: Court[]
  sessions: CourtSession[]
  bookings: Booking[]
  openPlays: OpenPlaySession[]
  openPlaySignups: OpenPlaySignup[]
  reminders: Reminder[]
  checkins: CheckIn[]
  transactions: Transaction[]
  notifications: Notification[]
  inquiries: SupportInquiry[]
  walkins: WalkIn[]
  /** Optional so browser data saved before support sessions existed still loads. */
  supportSessions?: DemoSupportSession[]
  /** Optional so browser data saved before court photos existed still loads. */
  photos?: DemoPhoto[]
  sessionUserId: string | null
}
