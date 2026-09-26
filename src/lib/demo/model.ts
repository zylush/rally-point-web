import type { Booking, CheckIn, Club, Court, CourtSession, Member, Notification, OpenPlaySession, OpenPlaySignup, Profile, Reminder, StaffVenueGrant, Transaction, Venue, WalkIn } from '../../types'

export interface DemoDB {
  clubs: Club[]
  venues: Venue[]
  staffVenueGrants: StaffVenueGrant[]
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
  walkins: WalkIn[]
  sessionUserId: string | null
}
