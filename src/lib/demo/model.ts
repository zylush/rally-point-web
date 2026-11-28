import type { Booking, CheckIn, Club, ClubAccount, ClubAddon, ClubCoach, CoachBookingRequest, CoachBookingSlot, CoachRequestMessage, ClubGalleryPhoto, ClubPaymentMethod, ClubProfileFields, ClubStaffRole, Court, CourtSession, MatchFormat, MatchSide, Member, MembershipRequestStatus, MembershipType, Notification, OpenPlaySession, OpenPlaySignup, OwnerCallRequest, Profile, Reminder, StaffVenueGrant, SupportInquiry, TournamentFormat, TournamentMatchStatus, TournamentStatus, Transaction, Venue, WalkIn } from '../../types'

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

/** One club's business profile, as stored; mirrors public.club_profiles. */
export interface DemoClubProfile extends ClubProfileFields {
  club_id: string
  updated_at: string
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
  /**
   * The club business profile (mirrors the club_business_profile tables). Optional so
   * older browser data still loads. Pictures are data links in photo_url, qr_url and url.
   */
  clubProfiles?: DemoClubProfile[]
  clubAddons?: ClubAddon[]
  clubCoaches?: ClubCoach[]
  /** Optional coach-booking records, for demo browser data created before this feature. */
  coachBookingSlots?: CoachBookingSlot[]
  coachBookingRequests?: CoachBookingRequest[]
  coachRequestMessages?: CoachRequestMessage[]
  clubPaymentMethods?: ClubPaymentMethod[]
  clubGallery?: ClubGalleryPhoto[]
  /** Court owners asking for a call (mirrors public.owner_call_requests). Optional so older browser data still loads. */
  ownerCallRequests?: DemoOwnerCallRequest[]
  /** Owner invites (mirrors public.club_owner_invites). Optional so older browser data still loads. */
  ownerInvites?: DemoOwnerInvite[]
  /** Membership requests (mirrors public.membership_requests). Optional so older browser data still loads. */
  membershipRequests?: DemoMembershipRequest[]
  /** Recorded singles/doubles matches (mirrors public.club_matches). Optional so older browser data still loads. */
  clubMatches?: DemoClubMatch[]
  /** Staff designated as match scorers (mirrors public.club_leaderboard_scorers). */
  leaderboardScorers?: DemoLeaderboardScorer[]
  /** Phase 2 tournaments and live draws (mirrors public.club_tournaments*). */
  clubTournaments?: DemoTournament[]
  clubTournamentPlayers?: DemoTournamentPlayer[]
  clubTournamentTeams?: DemoTournamentTeam[]
  clubTournamentMatches?: DemoTournamentMatch[]
  clubTournamentScorers?: DemoTournamentScorer[]
  sessionUserId: string | null
}

/** A recorded club match as stored in the demo store. */
export interface DemoClubMatch {
  id: string
  club_id: string
  venue_id: string | null
  court_id: string | null
  tournament_id: string | null
  format: MatchFormat
  team_a_ids: string[]
  team_b_ids: string[]
  winner_side: MatchSide
  score_a: number | null
  score_b: number | null
  notes: string | null
  status: 'completed' | 'voided'
  recorded_by: string | null
  voided_by: string | null
  voided_at: string | null
  void_reason: string | null
  played_at: string
  created_at: string
}

/** A staff member authorized to record club matches. */
export interface DemoLeaderboardScorer {
  club_id: string
  user_id: string
  granted_by: string | null
  created_at: string
}

/** A club tournament or queue mixer as stored in the demo store. */
export interface DemoTournament {
  id: string
  club_id: string
  venue_id: string | null
  title: string
  format: TournamentFormat
  team_size: 1 | 2
  status: TournamentStatus
  counts_for_leaderboard: boolean
  scheduled_at: string | null
  notes: string | null
  created_by: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
}

export interface DemoTournamentPlayer {
  club_id: string
  tournament_id: string
  member_id: string
  seed_order: number
  created_at: string
}

export interface DemoTournamentTeam {
  id: string
  club_id: string
  tournament_id: string
  seed: number
  name: string
  player_1_id: string
  player_2_id: string | null
  created_at: string
}

export interface DemoTournamentMatch {
  id: string
  club_id: string
  tournament_id: string
  round_number: number
  match_order: number
  court_id: string | null
  team_a_id: string | null
  team_b_id: string | null
  team_a_player_ids: string[]
  team_b_player_ids: string[]
  status: TournamentMatchStatus
  winner_side: MatchSide | null
  score_a: number | null
  score_b: number | null
  next_match_id: string | null
  next_match_side: MatchSide | null
  club_match_id: string | null
  recorded_by: string | null
  completed_at: string | null
  created_at: string
}

export interface DemoTournamentScorer {
  club_id: string
  tournament_id: string
  user_id: string
  granted_by: string | null
  created_at: string
}

/** A court owner's request, as stored; mirrors public.owner_call_requests. */
export interface DemoOwnerCallRequest extends Omit<OwnerCallRequest, 'handled_by_email'> {
  handled_by: string | null
}

/** A player's request to become a member of a club, as stored; mirrors public.membership_requests. */
export interface DemoMembershipRequest {
  id: string
  club_id: string
  user_id: string
  member_id: string
  status: MembershipRequestStatus
  /** The plan staff chose when approving. */
  membership_type: MembershipType | null
  /** The amount staff recorded as received when approving. */
  amount: number | null
  decline_reason: string | null
  requested_at: string
  decided_at: string | null
  decided_by: string | null
}

/** An owner invite, as stored; mirrors public.club_owner_invites. */
export interface DemoOwnerInvite {
  id: string
  club_id: string
  email: string
  invited_by: string | null
  created_at: string
  claimed_at: string | null
  claimed_by: string | null
  cancelled_at: string | null
}
