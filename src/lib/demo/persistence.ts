import type { ClubAccount, ClubStaffRole, Court } from '../../types'
import type { DemoDB, DemoPlatformRole } from './model'
import { seed } from './seed'
import { hasDemoPassword, normalizeDemoEmail } from './credentials'
import { defaultClubAccount } from './commissions'
import { DEMO_CLUB_ID, DEMO_VENUE_ID, demoClub } from '../tenant'

const KEY = 'rally_point_demo_v4'
const LEGACY_KEYS = ['rally_point_demo_v1', 'rally_point_demo_v2', 'rally_point_demo_v3']

export function resetStorage() {
  localStorage.removeItem(KEY)
  for (const key of LEGACY_KEYS) localStorage.removeItem(key)
}

type StoredDemo = DemoDB & { passwords?: unknown; branches?: unknown }

function isCommissionLine(value: unknown): value is DemoDB['commissions'][number] {
  const row = value as Partial<DemoDB['commissions'][number]> | null
  return !!row && typeof row.club_id === 'string' && typeof row.transaction_id === 'string'
}

export function normalizeStored(
  stored: StoredDemo,
  isKnownEmail: (email: string) => boolean,
): { db: DemoDB; repaired: boolean } {
  const { passwords: legacyPasswords, branches: legacyBranches, ...withoutLegacy } = stored
  const defaults = seed()
  const storedVenues = Array.isArray(withoutLegacy.venues) && withoutLegacy.venues.length
    ? withoutLegacy.venues
    : [{ id: DEMO_VENUE_ID, club_id: DEMO_CLUB_ID, slug: 'gensan-main', name: 'Rally Point Gensan', timezone: 'Asia/Manila', open_hour: 0, close_hour: 24, is_active: true }]
  const venues = storedVenues.some((venue) => venue.id === 'venue_lagao')
    ? storedVenues
    : [...storedVenues, { id: 'venue_lagao', club_id: DEMO_CLUB_ID, slug: 'gensan-lagao', name: 'Rally Point Lagao', timezone: 'Asia/Manila', open_hour: 0, close_hour: 24, is_active: true }]
  const profiles = Array.isArray(withoutLegacy.profiles) ? withoutLegacy.profiles : defaults.profiles
  const clubs = Array.isArray(withoutLegacy.clubs) && withoutLegacy.clubs.length ? withoutLegacy.clubs : [demoClub]
  // Legacy single-club data: staff and admin profiles all belonged to the one club.
  const clubRoles: ClubStaffRole[] = Array.isArray(withoutLegacy.clubRoles)
    ? withoutLegacy.clubRoles
    : profiles
        .filter((profile) => profile.role === 'staff' || profile.role === 'admin')
        .map((profile) => ({ club_id: DEMO_CLUB_ID, user_id: profile.id, role: profile.role as 'staff' | 'admin', is_active: true }))
  const platformRoles: DemoPlatformRole[] = Array.isArray(withoutLegacy.platformRoles)
    ? withoutLegacy.platformRoles
    : profiles.filter((profile) => profile.role === 'superadmin').map((profile) => ({ user_id: profile.id, role: 'superadmin' as const }))
  // Every club has an account, as the clubs insert trigger guarantees in the database.
  const storedAccounts: ClubAccount[] = Array.isArray(withoutLegacy.clubAccounts) ? withoutLegacy.clubAccounts : []
  const clubAccounts = [
    ...storedAccounts,
    ...clubs
      .filter((club) => !storedAccounts.some((account) => account.club_id === club.id))
      .map((club) => defaultClubAccount(club.id, club.is_active)),
  ]
  // Branch-era commission rows have no club or transaction; they cannot be kept.
  const storedCommissions: unknown[] = Array.isArray(withoutLegacy.commissions) ? withoutLegacy.commissions : []
  const commissions = storedCommissions.filter(isCommissionLine)

  const db: DemoDB = {
    ...withoutLegacy,
    profiles,
    clubs,
    clubAccounts,
    clubRoles,
    platformRoles,
    auditLog: Array.isArray(withoutLegacy.auditLog) ? withoutLegacy.auditLog : [],
    venues,
    staffVenueGrants: Array.isArray(withoutLegacy.staffVenueGrants) ? withoutLegacy.staffVenueGrants : [],
    commissions,
    members: Array.isArray(withoutLegacy.members) ? withoutLegacy.members : [],
    courts: Array.isArray(withoutLegacy.courts) ? withoutLegacy.courts : [],
    sessions: Array.isArray(withoutLegacy.sessions) ? withoutLegacy.sessions : [],
    bookings: Array.isArray(withoutLegacy.bookings) ? withoutLegacy.bookings : [],
    openPlays: Array.isArray(withoutLegacy.openPlays) ? withoutLegacy.openPlays : [],
    openPlaySignups: Array.isArray(withoutLegacy.openPlaySignups)
      ? withoutLegacy.openPlaySignups
      : [],
    reminders: Array.isArray(withoutLegacy.reminders) ? withoutLegacy.reminders : [],
    checkins: Array.isArray(withoutLegacy.checkins) ? withoutLegacy.checkins : [],
    transactions: Array.isArray(withoutLegacy.transactions) ? withoutLegacy.transactions : [],
    notifications: Array.isArray(withoutLegacy.notifications) ? withoutLegacy.notifications : [],
    inquiries: Array.isArray(withoutLegacy.inquiries) ? withoutLegacy.inquiries : [],
    walkins: Array.isArray(withoutLegacy.walkins) ? withoutLegacy.walkins : [],
  }
  if (
    db.clubRoles.some((role) => role.user_id === 'user_staff' && role.club_id === DEMO_CLUB_ID && role.role === 'staff' && role.is_active) &&
    !db.staffVenueGrants.some((grant) => grant.user_id === 'user_staff' && grant.venue_id === DEMO_VENUE_ID)
  ) {
    db.staffVenueGrants.push({ club_id: DEMO_CLUB_ID, user_id: 'user_staff', venue_id: DEMO_VENUE_ID, is_active: true })
  }
  // Rows saved without ownership take it from their court or member, then the default club.
  const courts = db.courts.map((court, index) => {
    const { branch_id: legacyBranch, ...rest } = court as Court & { branch_id?: unknown }
    if (court.club_id && court.venue_id && legacyBranch === undefined) return court
    return {
      ...rest,
      club_id: court.club_id ?? DEMO_CLUB_ID,
      venue_id: court.venue_id ?? (db.venues[index < 2 ? 0 : 1]?.id ?? DEMO_VENUE_ID),
    }
  })
  const courtById = new Map(courts.map((court) => [court.id, court]))
  const clubForCourt = (courtId?: string | null) => (courtId ? courtById.get(courtId)?.club_id : undefined)
  const venueForCourt = (courtId?: string | null) => (courtId ? courtById.get(courtId)?.venue_id : undefined) ?? DEMO_VENUE_ID
  const membersWithOwnership = db.members.map((member) => (member.club_id ? member : { ...member, club_id: DEMO_CLUB_ID }))
  const clubForMember = (memberId?: string | null) => (memberId ? membersWithOwnership.find((member) => member.id === memberId)?.club_id : undefined)
  const sessions = db.sessions.map((session) => ({ ...session, club_id: session.club_id ?? clubForCourt(session.court_id) ?? DEMO_CLUB_ID, venue_id: session.venue_id ?? venueForCourt(session.court_id) }))
  const bookings = db.bookings.map((booking) => ({ ...booking, club_id: booking.club_id ?? clubForCourt(booking.court_id) ?? DEMO_CLUB_ID, venue_id: booking.venue_id ?? venueForCourt(booking.court_id) }))
  const openPlays = db.openPlays.map((openPlay) => ({ ...openPlay, club_id: openPlay.club_id ?? clubForCourt(openPlay.court_id) ?? DEMO_CLUB_ID, venue_id: openPlay.venue_id ?? venueForCourt(openPlay.court_id) }))
  const openPlaySignups = db.openPlaySignups.map((signup) => {
    const openPlay = openPlays.find((row) => row.id === signup.open_play_id)
    return { ...signup, club_id: signup.club_id ?? openPlay?.club_id ?? DEMO_CLUB_ID, venue_id: signup.venue_id ?? openPlay?.venue_id ?? DEMO_VENUE_ID }
  })
  const checkins = db.checkins.map((checkin) => ({ ...checkin, club_id: checkin.club_id ?? clubForMember(checkin.member_id) ?? DEMO_CLUB_ID, venue_id: checkin.venue_id ?? DEMO_VENUE_ID }))
  const transactions = db.transactions.map((transaction) => ({ ...transaction, club_id: transaction.club_id ?? clubForMember(transaction.member_id) ?? DEMO_CLUB_ID, venue_id: transaction.venue_id === undefined ? null : transaction.venue_id, verification_status: transaction.verification_status ?? 'unverified' as const }))
  const notifications = db.notifications.map((notification) => ({ ...notification, club_id: notification.club_id ?? DEMO_CLUB_ID }))
  const reminders = db.reminders.map((reminder) => ({ ...reminder, club_id: reminder.club_id ?? DEMO_CLUB_ID }))
  const inquiries = db.inquiries.map((inquiry) => ({ ...inquiry, club_id: inquiry.club_id ?? DEMO_CLUB_ID }))
  const walkins = db.walkins.map((walkin) => ({ ...walkin, club_id: walkin.club_id ?? DEMO_CLUB_ID }))
  const normalizedOwnership = { ...db, courts, members: membersWithOwnership, sessions, bookings, openPlays, openPlaySignups, checkins, transactions, notifications, reminders, inquiries, walkins }
  const members = normalizedOwnership.members.map((member) =>
    member.qr_token
      ? member
      : {
          ...member,
          qr_token: `QR_${member.member_code.replace(/[^A-Z0-9]/gi, '')}`,
        },
  )
  const sessionProfile = normalizedOwnership.sessionUserId
    ? normalizedOwnership.profiles.find((profile) => profile.id === normalizedOwnership.sessionUserId)
    : undefined
  const sessionUserId =
    sessionProfile && isKnownEmail(normalizeDemoEmail(sessionProfile.email))
      ? normalizedOwnership.sessionUserId
      : null
  const normalizedDb = { ...normalizedOwnership, members, sessionUserId }
  const repaired =
    legacyPasswords !== undefined ||
    legacyBranches !== undefined ||
    members.some((member, index) => member !== db.members[index]) ||
    sessionUserId !== normalizedOwnership.sessionUserId ||
    !Array.isArray(withoutLegacy.clubs) ||
    !Array.isArray(withoutLegacy.clubAccounts) ||
    clubAccounts.length !== storedAccounts.length ||
    !Array.isArray(withoutLegacy.clubRoles) ||
    !Array.isArray(withoutLegacy.platformRoles) ||
    !Array.isArray(withoutLegacy.auditLog) ||
    !Array.isArray(withoutLegacy.commissions) ||
    commissions.length !== storedCommissions.length ||
    !Array.isArray(withoutLegacy.venues) ||
    !withoutLegacy.venues?.some((venue) => venue.id === 'venue_lagao') ||
    !Array.isArray(withoutLegacy.staffVenueGrants) ||
    courts.some((court, index) => court !== db.courts[index]) ||
    !Array.isArray(withoutLegacy.bookings) ||
    !Array.isArray(withoutLegacy.openPlays) ||
    !Array.isArray(withoutLegacy.openPlaySignups) ||
    !Array.isArray(withoutLegacy.reminders) ||
    !Array.isArray(withoutLegacy.inquiries) ||
    db.inquiries.some((inquiry) => !inquiry.club_id)

  return { db: normalizedDb, repaired }
}

export function load(): DemoDB {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const stored = JSON.parse(raw) as StoredDemo
      const { db, repaired } = normalizeStored(stored, hasDemoPassword)
      if (repaired) save(db)
      return db
    }
  } catch {
    /* ignore */
  }
  const db = seed()
  save(db)
  return db
}

export function save(db: DemoDB) {
  const { passwords: _legacyPasswords, ...safeDb } = db as DemoDB & {
    passwords?: unknown
  }
  localStorage.setItem(KEY, JSON.stringify(safeDb))
}
