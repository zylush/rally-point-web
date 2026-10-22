import type {
  Court, CourtInput, MyClub, Profile, PublicClub, PublicClubDetail, PublicClubListing, StaffVenueGrant, Venue,
  VenueLocationInput,
} from '../types'
import { daysFromNow, todayISO, uid } from './demo/common'
import { getDemoPassword, normalizeDemoEmail, resetDemoPasswords, setDemoPassword } from './demo/credentials'
import type { DemoDB } from './demo/model'
import { load, resetStorage, save } from './demo/persistence'
import { activeClub, activeClubBySlug, activeClubId, clubRoleFor, defaultClub, isPlatformSuperadmin, myClubsFor, profileWithRole } from './demo/access'
import { bookingOperations } from './demo/booking'
import { checkInOperations } from './demo/checkIn'
import { ledgerOperations } from './demo/ledger'
import { memberOperations, nextMemberCode } from './demo/member'
import { openPlayOperations } from './demo/openPlay'
import { scheduleOperations } from './demo/schedule'
import { staffOperations } from './demo/staff'
import { chooseVenueId, demoClub } from './tenant'
import { inquiryOperations } from './demo/inquiries'
import { platformOperations } from './demo/platform'

export type { DemoDB } from './demo/model'

/** Active club whose account is active too (not still being set up). Mirrors the public directory rules. */
function bookableClubBySlug(db: DemoDB, slug: string) {
  const club = activeClubBySlug(db, slug)
  if (!club) return undefined
  const account = db.clubAccounts.find((row) => row.club_id === club.id)
  return !account || account.status === 'active' ? club : undefined
}

/** A player record with no membership, as public.join_club_as_player creates. */
function addPlayer(db: DemoDB, clubId: string, profile: Profile) {
  if (db.members.some((member) => member.club_id === clubId && member.user_id === profile.id)) return false
  db.members.push({
    id: uid('mem'),
    club_id: clubId,
    user_id: profile.id,
    member_code: nextMemberCode(db, clubId),
    full_name: profile.full_name,
    email: profile.email,
    phone: profile.phone ?? null,
    membership_type: null,
    status: 'active',
    join_date: new Date().toISOString().slice(0, 10),
    expiry_date: null,
    notes: null,
    qr_token: `q_${Math.random().toString(36).slice(2, 10)}`,
    created_at: todayISO(),
  })
  return true
}

/** A 30-day active membership: the terms every sign-up and club join gets. Repeating it changes nothing. */
function addMembership(db: DemoDB, clubId: string, profile: Profile) {
  if (db.members.some((member) => member.club_id === clubId && member.user_id === profile.id)) return false
  db.members.push({
    id: uid('mem'),
    club_id: clubId,
    user_id: profile.id,
    member_code: nextMemberCode(db, clubId),
    full_name: profile.full_name,
    email: profile.email,
    phone: profile.phone ?? null,
    membership_type: 'standard',
    status: 'active',
    join_date: new Date().toISOString().slice(0, 10),
    expiry_date: daysFromNow(30),
    notes: null,
    qr_token: `q_${Math.random().toString(36).slice(2, 10)}`,
    created_at: todayISO(),
  })
  return true
}

export const demoStore = {
  reset() {
    resetDemoPasswords()
    resetStorage()
    return load()
  },
  get() {
    return load()
  },
  set(db: DemoDB) {
    save(db)
  },
  login(email: string, password: string): Profile {
    const db = load()
    const e = normalizeDemoEmail(email)
    if (getDemoPassword(e) !== password) throw new Error('Invalid email or password')
    const profile = db.profiles.find((p) => p.email.toLowerCase() === e)
    if (!profile) throw new Error('Invalid email or password')
    db.sessionUserId = profile.id
    save(db)
    return profileWithRole(db, profile)
  },
  /**
   * Public join — always a member. A join link names the club (clubSlug);
   * otherwise the default club. Admin and staff roles are provisioned separately.
   */
  registerMember(input: { email: string; password: string; full_name: string; phone?: string; clubSlug?: string }): Profile {
    const db = load()
    const e = normalizeDemoEmail(input.email)
    if (db.profiles.some((p) => p.email.toLowerCase() === e)) {
      throw new Error('Unable to create an account. Please check your details or try again.')
    }
    if (input.password.length < 6) throw new Error('Password must be at least 6 characters')
    const slug = input.clubSlug?.trim()
    const club = slug ? activeClubBySlug(db, slug) : defaultClub(db)
    if (slug && !club) throw new Error('This club link is not valid')
    const id = uid('usr')
    const profile: Profile = {
      id,
      email: e,
      full_name: input.full_name.trim(),
      role: 'member',
      phone: input.phone?.trim() || null,
      created_at: todayISO(),
    }
    db.profiles.push(profile)
    setDemoPassword(e, input.password)
    // With the default club closed, keep the profile and skip the membership, as the database does.
    if (club?.is_active) {
      addMembership(db, club.id, profile)
      db.notifications.unshift({
        id: uid('n'),
        club_id: club.id,
        user_id: id,
        title: `Welcome to ${club.name}`,
        body: 'You’re in! Book a court, join open play, or show your QR at the desk.',
        read: false,
        created_at: todayISO(),
      })
    }
    db.sessionUserId = id
    save(db)
    return profile
  },
  logout() {
    const db = load()
    db.sessionUserId = null
    save(db)
  },
  currentUser(): Profile | null {
    const db = load()
    if (!db.sessionUserId) return null
    const profile = db.profiles.find((p) => p.id === db.sessionUserId)
    return profile ? profileWithRole(db, profile) : null
  },
  /** Active clubs the person belongs to, with their role in each (like list_my_clubs). */
  myClubs(userId: string): MyClub[] {
    return myClubsFor(load(), userId)
  },
  platformAccess(userId: string): 'superadmin' | null {
    return isPlatformSuperadmin(load(), userId) ? 'superadmin' : null
  },
  /** Name and link of an active club, for join links and public boards. */
  publicClub(slug: string): PublicClub | null {
    const club = activeClubBySlug(load(), slug)
    return club ? { id: club.id, slug: club.slug, name: club.name } : null
  },
  /** A signed-in player joins another active club on sign-up terms. Repeating it changes nothing. */
  joinClub(userId: string, slug: string): string {
    const db = load()
    if (isPlatformSuperadmin(db, userId)) throw new Error('Platform accounts cannot join clubs')
    const club = activeClubBySlug(db, slug)
    if (!club) throw new Error('This club link is not valid')
    const profile = db.profiles.find((p) => p.id === userId)
    if (!profile) throw new Error('Your profile is not ready yet')
    if (addMembership(db, club.id, profile)) save(db)
    return club.id
  },
  /** Mirrors public.join_club_as_player: a player with no membership. An existing record is kept as it is. */
  joinClubAsPlayer(userId: string, slug: string): string {
    const db = load()
    if (isPlatformSuperadmin(db, userId)) throw new Error('Platform accounts cannot book courts')
    const club = bookableClubBySlug(db, slug)
    if (!club) throw new Error('This club is not taking bookings')
    const profile = db.profiles.find((p) => p.id === userId)
    if (!profile) throw new Error('Your profile is not ready yet')
    if (addPlayer(db, club.id, profile)) save(db)
    return club.id
  },
  /** Mirrors public.list_public_clubs: active clubs with an active venue; rates from in-service courts. */
  publicClubs(): PublicClubListing[] {
    const db = load()
    return db.clubs
      .filter((club) => bookableClubBySlug(db, club.slug))
      .filter((club) => db.venues.some((venue) => venue.club_id === club.id && venue.is_active))
      .map((club) => {
        const account = db.clubAccounts.find((row) => row.club_id === club.id)
        const activeVenueIds = new Set(db.venues.filter((v) => v.club_id === club.id && v.is_active).map((v) => v.id))
        const courts = db.courts.filter((court) =>
          court.club_id === club.id && court.venue_id && activeVenueIds.has(court.venue_id) && court.status !== 'maintenance')
        const min = (values: number[]) => values.length ? Math.min(...values) : null
        const cities = [account?.city, ...db.venues.filter((v) => v.club_id === club.id && v.is_active).map((v) => v.city)]
          .filter((city): city is string => !!city)
        return {
          slug: club.slug,
          name: club.name,
          city: account?.city ?? null,
          address: account?.address ?? null,
          cities: [...new Set(cities)].sort(),
          venue_count: activeVenueIds.size,
          court_count: courts.length,
          min_rate: min(courts.map((court) => court.hourly_rate)),
          min_member_rate: min(courts.map((court) => court.member_rate ?? court.hourly_rate)),
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  },
  /** Mirrors public.get_public_club_detail: venues and courts only, never member details. */
  publicClubDetail(slug: string): PublicClubDetail | null {
    const db = load()
    const club = bookableClubBySlug(db, slug)
    if (!club) return null
    const account = db.clubAccounts.find((row) => row.club_id === club.id)
    return {
      slug: club.slug,
      name: club.name,
      city: account?.city ?? null,
      address: account?.address ?? null,
      venues: db.venues
        .filter((venue) => venue.club_id === club.id && venue.is_active)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((venue) => ({
          id: venue.id,
          name: venue.name,
          open_hour: venue.open_hour,
          close_hour: venue.close_hour,
          address: venue.address ?? null,
          city: venue.city ?? null,
          latitude: venue.latitude ?? null,
          longitude: venue.longitude ?? null,
          courts: db.courts
            .filter((court) => court.club_id === club.id && court.venue_id === venue.id)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((court) => ({
              id: court.id,
              name: court.name,
              hourly_rate: court.hourly_rate,
              member_rate: court.member_rate ?? null,
              in_service: court.status !== 'maintenance',
            })),
        })),
    }
  },
  tenantContext(userId?: string, role?: Profile['role']) {
    const db = load()
    const resolvedUserId = userId ?? db.sessionUserId ?? undefined
    const club = activeClub(db) ?? demoClub
    const resolvedRole = role
      ?? (isPlatformSuperadmin(db, resolvedUserId) ? 'superadmin' : clubRoleFor(db, resolvedUserId, club.id))
    const venues = db.venues.filter((venue) => {
      if (!venue.is_active || venue.club_id !== club.id) return false
      if (resolvedRole !== 'staff') return true
      return db.staffVenueGrants.some(
        (grant) => grant.club_id === club.id && grant.user_id === resolvedUserId && grant.venue_id === venue.id && grant.is_active,
      )
    })
    return { club, venues, role: resolvedRole ?? null }
  },
  venues(userId?: string, role?: Profile['role']) {
    return this.tenantContext(userId, role).venues
  },
  /** All venues of a club (the active club unless one is named, e.g. by a public board). */
  allVenues(clubId?: string | null) {
    const db = load()
    const club = clubId ?? activeClubId(db)
    return db.venues.filter((venue) => venue.club_id === club).sort((a, b) => a.name.localeCompare(b.name))
  },
  chooseVenue(userId: string | undefined, role: Profile['role'] | undefined, requestedId?: string | null) {
    return chooseVenueId(this.venues(userId, role), requestedId, activeClubId(load()))
  },
  /** Staff and admins of the active club, from trusted club roles, with their venue grants. */
  staffAccounts(): Profile[] {
    const db = load()
    const clubId = activeClubId(db)
    const accounts: Profile[] = []
    for (const row of db.clubRoles) {
      if (row.club_id !== clubId || !row.is_active) continue
      const profile = db.profiles.find((candidate) => candidate.id === row.user_id)
      if (!profile) continue
      accounts.push({
        ...profile,
        role: row.role,
        venue_ids: db.staffVenueGrants
          .filter((grant) => grant.club_id === clubId && grant.user_id === row.user_id && grant.is_active)
          .map((grant) => grant.venue_id),
      })
    }
    return accounts
  },
  upsertVenue(input: Omit<Venue, 'id' | 'club_id'> & { id?: string }): Venue {
    const db = load()
    const clubId = activeClubId(db)
    const current = input.id ? db.venues.find((venue) => venue.id === input.id && venue.club_id === clubId) : undefined
    if (input.id && !current && db.venues.some((venue) => venue.id === input.id)) throw new Error('Venue not found')
    const venue: Venue = {
      id: current?.id ?? input.id ?? uid('venue'),
      club_id: clubId,
      slug: input.slug,
      name: input.name,
      timezone: input.timezone,
      open_hour: input.open_hour,
      close_hour: input.close_hour,
      is_active: input.is_active,
    }
    if (current) Object.assign(current, venue)
    else db.venues.push(venue)
    save(db)
    return venue
  },
  /** Mirrors public.admin_update_venue_location: same checks and messages. */
  updateVenueLocation(input: VenueLocationInput): Venue {
    const db = load()
    const clubId = activeClubId(db)
    const address = input.address?.trim() || null
    const city = input.city?.trim() || null
    if ((input.latitude == null) !== (input.longitude == null)) {
      throw new Error('Enter both latitude and longitude, or neither')
    }
    if (input.latitude != null && input.longitude != null && (
      !Number.isFinite(input.latitude) || !Number.isFinite(input.longitude)
      || Math.abs(input.latitude) > 90 || Math.abs(input.longitude) > 180
    )) {
      throw new Error('Latitude must be between -90 and 90, and longitude between -180 and 180')
    }
    if ((address?.length ?? 0) > 200 || (city?.length ?? 0) > 80) {
      throw new Error('Address is limited to 200 characters and city to 80')
    }
    const venue = db.venues.find((row) => row.id === input.venue_id && row.club_id === clubId)
    if (!venue) throw new Error('venue not found')
    const round6 = (n: number | null) => (n == null ? null : Math.round(n * 1e6) / 1e6)
    Object.assign(venue, { address, city, latitude: round6(input.latitude), longitude: round6(input.longitude) })
    save(db)
    return { ...venue }
  },
  /** Mirrors public.admin_upsert_court: same checks and messages. Courts are never deleted. */
  upsertCourt(input: CourtInput): Court {
    const db = load()
    const clubId = activeClubId(db)
    const name = input.name.trim()
    if (name.length < 1 || name.length > 40) throw new Error('Court name must be 1 to 40 characters')
    const rate = input.hourly_rate
    // Compare with a tolerance: 500.1 * 100 is not exactly 50010 in floating point.
    if (!Number.isFinite(rate) || rate < 0 || rate > 100000 || Math.abs(Math.round(rate * 100) - rate * 100) > 1e-6) {
      throw new Error('Hourly rate must be between 0 and 100,000 pesos')
    }
    const memberRate = input.member_rate ?? null
    if (memberRate != null && (!Number.isFinite(memberRate) || memberRate < 0 || memberRate > rate
      || Math.abs(Math.round(memberRate * 100) - memberRate * 100) > 1e-6)) {
      throw new Error('Member rate must be between 0 and the regular rate')
    }
    const current = input.id ? db.courts.find((court) => court.id === input.id && court.club_id === clubId) : undefined
    if (input.id) {
      if (!current) throw new Error('court not found')
      if (input.venue_id !== current.venue_id) throw new Error('A court cannot move to another venue')
      const inUse = current.status === 'occupied'
        || db.sessions.some((session) => session.court_id === current.id && session.status === 'playing')
      if (!input.in_service && current.status !== 'maintenance' && inUse) {
        throw new Error('This court is in use. Take it out of service after the session ends.')
      }
    } else if (!db.venues.some((venue) => venue.id === input.venue_id && venue.club_id === clubId)) {
      throw new Error('venue not found')
    }
    const duplicate = db.courts.some((court) =>
      court.club_id === clubId
      && court.venue_id === input.venue_id
      && court.name.toLowerCase() === name.toLowerCase()
      && court.id !== input.id)
    if (duplicate) throw new Error('This venue already has a court with that name')

    if (current) {
      current.name = name
      current.hourly_rate = rate
      current.member_rate = memberRate
      // Putting a court back in service never overrides 'occupied'.
      if (!input.in_service) current.status = 'maintenance'
      else if (current.status === 'maintenance') current.status = 'available'
      save(db)
      return { ...current }
    }
    const court: Court = {
      id: uid('court'),
      club_id: clubId,
      venue_id: input.venue_id,
      name,
      status: input.in_service ? 'available' : 'maintenance',
      hourly_rate: rate,
      member_rate: memberRate,
    }
    db.courts.push(court)
    save(db)
    return { ...court }
  },
  setStaffVenueGrant(userId: string, venueId: string, isActive: boolean): StaffVenueGrant {
    const db = load()
    const clubId = activeClubId(db)
    if (!db.venues.some((venue) => venue.id === venueId && venue.club_id === clubId)) throw new Error('Venue not found')
    if (!db.clubRoles.some((row) => row.club_id === clubId && row.user_id === userId)) {
      throw new Error('Only club staff can be assigned to venues')
    }
    const existing = db.staffVenueGrants.find((grant) => grant.club_id === clubId && grant.user_id === userId && grant.venue_id === venueId)
    const grant = existing ?? { club_id: clubId, user_id: userId, venue_id: venueId, is_active: isActive }
    grant.is_active = isActive
    if (!existing) db.staffVenueGrants.push(grant)
    save(db)
    return grant
  },
  ...memberOperations,
  ...staffOperations,
  ...bookingOperations,
  ...checkInOperations,
  ...openPlayOperations,
  ...scheduleOperations,
  ...ledgerOperations,
  ...inquiryOperations,
  ...platformOperations,
}
