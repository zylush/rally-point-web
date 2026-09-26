import type { Profile } from '../types'
import { daysFromNow, todayISO, uid } from './demo/common'
import { getDemoPassword, normalizeDemoEmail, resetDemoPasswords, setDemoPassword } from './demo/credentials'
import type { DemoDB } from './demo/model'
import { load, resetStorage, save } from './demo/persistence'
import { bookingOperations } from './demo/booking'
import { checkInOperations } from './demo/checkIn'
import { ledgerOperations } from './demo/ledger'
import { memberOperations } from './demo/member'
import { openPlayOperations } from './demo/openPlay'
import { scheduleOperations } from './demo/schedule'
import { staffOperations } from './demo/staff'
import { DEMO_CLUB_ID, chooseVenueId } from './tenant'

export type { DemoDB } from './demo/model'

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
    return profile
  },
  /** Public join — always member. Admin/staff are seeded only. */
  registerMember(input: { email: string; password: string; full_name: string; phone?: string }): Profile {
    const db = load()
    const e = normalizeDemoEmail(input.email)
    if (db.profiles.some((p) => p.email.toLowerCase() === e)) {
      throw new Error('Unable to create an account. Please check your details or try again.')
    }
    if (input.password.length < 6) throw new Error('Password must be at least 6 characters')
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
    const codeNum = 1000 + db.members.length + 1
    db.members.push({
      id: uid('mem'),
      club_id: DEMO_CLUB_ID,
      user_id: id,
      member_code: `RP-${codeNum}`,
      full_name: profile.full_name,
      email: e,
      phone: profile.phone,
      membership_type: 'standard',
      status: 'active',
      join_date: new Date().toISOString().slice(0, 10),
      expiry_date: daysFromNow(30),
      notes: null,
      qr_token: `q_${Math.random().toString(36).slice(2, 10)}`,
      created_at: todayISO(),
    })
    db.sessionUserId = id
    db.notifications.unshift({
      id: uid('n'),
      club_id: DEMO_CLUB_ID,
      user_id: id,
      title: 'Welcome to Rally Point',
      body: 'You’re in! Book a court, join open play, or show your QR at the desk.',
      read: false,
      created_at: todayISO(),
    })
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
    return db.profiles.find((p) => p.id === db.sessionUserId) ?? null
  },
  tenantContext(userId?: string, role?: Profile['role']) {
    const db = load()
    const resolvedUserId = userId ?? db.sessionUserId ?? undefined
    const resolvedRole = role ?? db.profiles.find((profile) => profile.id === resolvedUserId)?.role
    const venues = db.venues.filter((venue) => {
      if (!venue.is_active) return false
      if (resolvedRole !== 'staff') return venue.club_id === DEMO_CLUB_ID
      return db.staffVenueGrants.some(
        (grant) => grant.user_id === resolvedUserId && grant.venue_id === venue.id && grant.is_active,
      )
    })
    return { club: db.clubs.find((club) => club.id === DEMO_CLUB_ID) ?? db.clubs[0], venues, role: resolvedRole ?? null }
  },
  venues(userId?: string, role?: Profile['role']) {
    return this.tenantContext(userId, role).venues
  },
  allVenues() {
    return load().venues.filter((venue) => venue.club_id === DEMO_CLUB_ID).sort((a, b) => a.name.localeCompare(b.name))
  },
  chooseVenue(userId: string | undefined, role: Profile['role'] | undefined, requestedId?: string | null) {
    return chooseVenueId(this.venues(userId, role), requestedId)
  },
  staffAccounts(): Profile[] {
    const db = load()
    return db.profiles
      .filter((profile) => profile.role === 'staff' || profile.role === 'admin')
      .map((profile) => ({
        ...profile,
        venue_ids: db.staffVenueGrants
          .filter((grant) => grant.user_id === profile.id && grant.is_active)
          .map((grant) => grant.venue_id),
      }))
  },
  upsertVenue(input: Omit<import('../types').Venue, 'id' | 'club_id'> & { id?: string }): import('../types').Venue {
    const db = load()
    const current = input.id ? db.venues.find((venue) => venue.id === input.id) : undefined
    const venue = {
      id: current?.id ?? input.id ?? uid('venue'),
      club_id: DEMO_CLUB_ID,
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
  setStaffVenueGrant(userId: string, venueId: string, isActive: boolean): import('../types').StaffVenueGrant {
    const db = load()
    const existing = db.staffVenueGrants.find((grant) => grant.user_id === userId && grant.venue_id === venueId)
    const grant = existing ?? { club_id: DEMO_CLUB_ID, user_id: userId, venue_id: venueId, is_active: isActive }
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
}
