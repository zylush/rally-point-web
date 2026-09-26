import type { DemoDB } from './model'
import { seed } from './seed'
import { hasDemoPassword, normalizeDemoEmail } from './credentials'
import { DEMO_CLUB_ID, DEMO_VENUE_ID, demoClub } from '../tenant'

const KEY = 'rally_point_demo_v3'

export function resetStorage() {
  localStorage.removeItem(KEY)
  localStorage.removeItem('rally_point_demo_v1')
  localStorage.removeItem('rally_point_demo_v2')
}

export function normalizeStored(
  stored: DemoDB & { passwords?: unknown },
  isKnownEmail: (email: string) => boolean,
): { db: DemoDB; repaired: boolean } {
  const { passwords: legacyPasswords, ...withoutPasswords } = stored
  const storedVenues = Array.isArray(withoutPasswords.venues) && withoutPasswords.venues.length
    ? withoutPasswords.venues
    : [{ id: DEMO_VENUE_ID, club_id: DEMO_CLUB_ID, slug: 'gensan-main', name: 'Rally Point Gensan', timezone: 'Asia/Manila', open_hour: 6, close_hour: 22, is_active: true }]
  const venues = storedVenues.some((venue) => venue.id === 'venue_lagao')
    ? storedVenues
    : [...storedVenues, { id: 'venue_lagao', club_id: DEMO_CLUB_ID, slug: 'gensan-lagao', name: 'Rally Point Lagao', timezone: 'Asia/Manila', open_hour: 6, close_hour: 22, is_active: true }]
  const db: DemoDB = {
    ...withoutPasswords,
    clubs: Array.isArray(withoutPasswords.clubs) && withoutPasswords.clubs.length ? withoutPasswords.clubs : [demoClub],
    venues,
    staffVenueGrants: Array.isArray(withoutPasswords.staffVenueGrants) ? withoutPasswords.staffVenueGrants : [],
    bookings: Array.isArray(withoutPasswords.bookings) ? withoutPasswords.bookings : [],
    openPlays: Array.isArray(withoutPasswords.openPlays) ? withoutPasswords.openPlays : [],
    openPlaySignups: Array.isArray(withoutPasswords.openPlaySignups)
      ? withoutPasswords.openPlaySignups
      : [],
    reminders: Array.isArray(withoutPasswords.reminders) ? withoutPasswords.reminders : [],
  }
  if (
    db.profiles.some((profile) => profile.id === 'user_staff' && profile.role === 'staff') &&
    !db.staffVenueGrants.some((grant) => grant.user_id === 'user_staff' && grant.venue_id === DEMO_VENUE_ID)
  ) {
    db.staffVenueGrants.push({ club_id: DEMO_CLUB_ID, user_id: 'user_staff', venue_id: DEMO_VENUE_ID, is_active: true })
  }
  const courts = db.courts.map((court, index) => ({
    ...court,
    club_id: court.club_id ?? DEMO_CLUB_ID,
    venue_id: court.venue_id ?? (db.venues[index < 2 ? 0 : 1]?.id ?? DEMO_VENUE_ID),
  }))
  const venueForCourt = (courtId?: string | null) => courts.find((court) => court.id === courtId)?.venue_id ?? DEMO_VENUE_ID
  const membersWithOwnership = db.members.map((member) => ({ ...member, club_id: member.club_id ?? DEMO_CLUB_ID }))
  const sessions = db.sessions.map((session) => ({ ...session, club_id: session.club_id ?? DEMO_CLUB_ID, venue_id: session.venue_id ?? venueForCourt(session.court_id) }))
  const bookings = db.bookings.map((booking) => ({ ...booking, club_id: booking.club_id ?? DEMO_CLUB_ID, venue_id: booking.venue_id ?? venueForCourt(booking.court_id) }))
  const openPlays = db.openPlays.map((openPlay) => ({ ...openPlay, club_id: openPlay.club_id ?? DEMO_CLUB_ID, venue_id: openPlay.venue_id ?? venueForCourt(openPlay.court_id) }))
  const openPlaySignups = db.openPlaySignups.map((signup) => ({ ...signup, club_id: signup.club_id ?? DEMO_CLUB_ID, venue_id: signup.venue_id ?? openPlays.find((openPlay) => openPlay.id === signup.open_play_id)?.venue_id ?? DEMO_VENUE_ID }))
  const checkins = db.checkins.map((checkin) => ({ ...checkin, club_id: checkin.club_id ?? DEMO_CLUB_ID, venue_id: checkin.venue_id ?? DEMO_VENUE_ID }))
  const transactions = db.transactions.map((transaction) => ({ ...transaction, club_id: transaction.club_id ?? DEMO_CLUB_ID, venue_id: transaction.venue_id === undefined ? null : transaction.venue_id, verification_status: transaction.verification_status ?? 'unverified' as const }))
  const notifications = db.notifications.map((notification) => ({ ...notification, club_id: notification.club_id ?? DEMO_CLUB_ID }))
  const reminders = db.reminders.map((reminder) => ({ ...reminder, club_id: reminder.club_id ?? DEMO_CLUB_ID }))
  const normalizedOwnership = { ...db, courts, members: membersWithOwnership, sessions, bookings, openPlays, openPlaySignups, checkins, transactions, notifications, reminders }
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
    members.some((member, index) => member !== normalizedOwnership.members[index]) ||
    sessionUserId !== normalizedOwnership.sessionUserId ||
    !Array.isArray(withoutPasswords.clubs) ||
    !Array.isArray(withoutPasswords.venues) ||
    !withoutPasswords.venues?.some((venue) => venue.id === 'venue_lagao') ||
    !Array.isArray(withoutPasswords.staffVenueGrants) ||
    courts.some((court, index) => court !== db.courts[index]) ||
    !Array.isArray(withoutPasswords.bookings) ||
    !Array.isArray(withoutPasswords.openPlays) ||
    !Array.isArray(withoutPasswords.openPlaySignups) ||
    !Array.isArray(withoutPasswords.reminders)

  return { db: normalizedDb, repaired }
}

export function load(): DemoDB {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const stored = JSON.parse(raw) as DemoDB & { passwords?: unknown }
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
