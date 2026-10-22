import type { ClubAccount, ClubStatus, PlatformAction, PlatformClub, PlatformClubAdmin, PlatformCommission, ProvisionClubInput, SupportSession, SupportSnapshot } from '../../types'
import { DEFAULT_CLUB_SLUG } from '../tenant'
import { normalizeSlug } from './access'
import { todayISO, uid } from './common'
import { defaultClubAccount, round2 } from './commissions'
import { normalizeDemoEmail } from './credentials'
import type { DemoDB } from './model'
import { load, save } from './persistence'

const CLUB_STATUSES: ClubStatus[] = ['provisioning', 'active', 'suspended']
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/

/** Mirrors private.require_platform_superadmin: only a trusted platform role may act. */
function requirePlatform(db: DemoDB): string {
  const actor = db.sessionUserId
  if (!actor || !db.platformRoles.some((row) => row.user_id === actor && row.role === 'superadmin')) {
    throw new Error('Platform access required')
  }
  return actor
}

function audit(db: DemoDB, actorId: string, action: string, clubId: string | null, details: Record<string, unknown>) {
  db.auditLog.unshift({ id: uid('audit'), actor_id: actorId, action, club_id: clubId, details, created_at: todayISO() })
}

function findClub(db: DemoDB, clubId: string) {
  const club = db.clubs.find((row) => row.id === clubId)
  if (!club) throw new Error('Club not found')
  return club
}

/** The club's account, created on the fly for clubs saved without one. */
function accountFor(db: DemoDB, clubId: string): ClubAccount {
  let account = db.clubAccounts.find((row) => row.club_id === clubId)
  if (!account) {
    account = defaultClubAccount(clubId, db.clubs.find((club) => club.id === clubId)?.is_active ?? false)
    db.clubAccounts.push(account)
  }
  return account
}

function hasActiveAdmin(db: DemoDB, clubId: string) {
  return db.clubRoles.some((row) => row.club_id === clubId && row.role === 'admin' && row.is_active)
}

function sumOf(values: number[]) {
  return round2(values.reduce((total, value) => total + value, 0))
}

function newestFirst<T extends { created_at: string }>(rows: T[]) {
  // Stored newest first; a stable sort keeps that order for rows made in the same instant.
  return rows.slice().sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export const platformOperations = {
  /** Every club with its terms and totals. No member details leave this view. */
  platformClubs(): PlatformClub[] {
    const db = load()
    requirePlatform(db)
    return db.clubs
      .map((club) => {
        const account = db.clubAccounts.find((row) => row.club_id === club.id) ?? defaultClubAccount(club.id, club.is_active)
        const lines = db.commissions.filter((line) => line.club_id === club.id)
        return {
          club_id: club.id,
          slug: club.slug,
          name: club.name,
          status: account.status,
          commission_rate: account.commission_rate,
          city: account.city,
          address: account.address,
          contact_email: account.contact_email,
          contact_phone: account.contact_phone,
          venue_count: db.venues.filter((venue) => venue.club_id === club.id).length,
          court_count: db.courts.filter((court) => court.club_id === club.id).length,
          member_count: db.members.filter((member) => member.club_id === club.id).length,
          admin_count: db.clubRoles.filter((row) => row.club_id === club.id && row.role === 'admin' && row.is_active).length,
          gross_amount: sumOf(lines.map((line) => line.gross_amount)),
          commission_amount: sumOf(lines.map((line) => line.commission_amount)),
          club_net_amount: sumOf(lines.map((line) => line.club_net_amount)),
          entry_count: lines.length,
          created_at: account.created_at,
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name) || a.club_id.localeCompare(b.club_id))
  },
  /** Commission lines, newest first, optionally for one club. Amounts are recorded, not collected. */
  platformLedger(clubId?: string | null, limit = 200): PlatformCommission[] {
    const db = load()
    requirePlatform(db)
    const cap = Math.min(Math.max(Math.trunc(limit) || 200, 1), 1000)
    return newestFirst(db.commissions.filter((line) => !clubId || line.club_id === clubId))
      .slice(0, cap)
      .map((line) => ({
        ...line,
        club_name: db.clubs.find((club) => club.id === line.club_id)?.name ?? 'Unknown club',
        description: db.transactions.find((tx) => tx.id === line.transaction_id)?.description ?? 'Court charge',
      }))
  },
  /** Sets up a club in provisioning (hidden from players) with one main venue and its courts. */
  provisionClub(input: ProvisionClubInput): string {
    const db = load()
    const actor = requirePlatform(db)
    const name = input.name.trim()
    const slug = normalizeSlug(input.slug)
    const courtCount = input.court_count ?? 2
    if (!name) throw new Error('Enter the club name')
    if (!SLUG_PATTERN.test(slug)) throw new Error('Use 3 to 50 lowercase letters, numbers or dashes for the link name')
    if (db.clubs.some((club) => club.slug.toLowerCase() === slug)) throw new Error('That link name is already used by another club')
    if (!Number.isFinite(input.commission_rate) || input.commission_rate < 0 || input.commission_rate > 100) {
      throw new Error('Commission rate must be between 0 and 100')
    }
    if (!Number.isInteger(courtCount) || courtCount < 1 || courtCount > 12) throw new Error('Choose between 1 and 12 courts')

    const now = todayISO()
    const clubId = uid('club')
    const venueId = uid('venue')
    const rate = round2(input.commission_rate)
    db.clubs.push({ id: clubId, slug, name, default_timezone: 'Asia/Manila', is_active: false })
    db.clubAccounts.push({
      ...defaultClubAccount(clubId, false, now),
      status: 'provisioning',
      commission_rate: rate,
      city: input.city.trim() || null,
      address: input.address.trim() || null,
      contact_email: normalizeDemoEmail(input.contact_email) || null,
      contact_phone: input.contact_phone.trim() || null,
    })
    db.venues.push({ id: venueId, club_id: clubId, slug: 'main', name, timezone: 'Asia/Manila', open_hour: 0, close_hour: 24, is_active: true })
    for (let n = 1; n <= courtCount; n++) {
      db.courts.push({ id: uid('court'), club_id: clubId, venue_id: venueId, name: `Court ${n}`, status: 'available', hourly_rate: 500 })
    }
    audit(db, actor, 'club.provision', clubId, { slug, name, commission_rate: rate, court_count: courtCount })
    save(db)
    return clubId
  },
  /** Keeps the club's open/closed state in step with its account status. */
  setClubStatus(clubId: string, status: ClubStatus) {
    const db = load()
    const actor = requirePlatform(db)
    if (!CLUB_STATUSES.includes(status)) throw new Error('Unknown club status')
    const club = findClub(db, clubId)
    // Sign-ups without a club link join the default club, so it must stay open.
    if (club.slug === DEFAULT_CLUB_SLUG && status !== 'active') throw new Error('The default sign-up club must stay active')
    if (status === 'active' && !hasActiveAdmin(db, clubId)) throw new Error('Assign a club admin before activating this club')
    const account = accountFor(db, clubId)
    const from = account.status
    account.status = status
    account.updated_at = todayISO()
    club.is_active = status === 'active'
    audit(db, actor, 'club.status', clubId, { from, to: status })
    save(db)
  },
  setCommissionRate(clubId: string, rate: number) {
    const db = load()
    const actor = requirePlatform(db)
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new Error('Commission rate must be between 0 and 100')
    findClub(db, clubId)
    const account = accountFor(db, clubId)
    const from = account.commission_rate
    account.commission_rate = round2(rate)
    account.updated_at = todayISO()
    audit(db, actor, 'club.commission_rate', clubId, { from, to: account.commission_rate })
    save(db)
  },
  /** The person must already have an account (they sign up through the club link). */
  assignClubAdmin(clubId: string, email: string): string {
    const db = load()
    const actor = requirePlatform(db)
    findClub(db, clubId)
    const wanted = normalizeDemoEmail(email)
    const profile = db.profiles.find((row) => row.email.toLowerCase() === wanted)
    if (!wanted || !profile) throw new Error('No account uses that email yet. Ask them to sign up first.')
    const existing = db.clubRoles.find((row) => row.club_id === clubId && row.user_id === profile.id)
    if (existing) {
      existing.role = 'admin'
      existing.is_active = true
    } else {
      db.clubRoles.push({ club_id: clubId, user_id: profile.id, role: 'admin', is_active: true })
    }
    audit(db, actor, 'club.admin_assign', clubId, { user_id: profile.id, email: wanted })
    save(db)
    return profile.id
  },
  revokeClubAdmin(clubId: string, userId: string) {
    const db = load()
    const actor = requirePlatform(db)
    const role = db.clubRoles.find((row) => row.club_id === clubId && row.user_id === userId && row.role === 'admin' && row.is_active)
    if (!role) throw new Error('That person is not an active admin of this club')
    role.is_active = false
    audit(db, actor, 'club.admin_revoke', clubId, { user_id: userId })
    save(db)
  },
  /** Active admins of one club, by name. */
  platformClubAdmins(clubId: string): PlatformClubAdmin[] {
    const db = load()
    requirePlatform(db)
    return db.clubRoles
      .filter((row) => row.club_id === clubId && row.role === 'admin' && row.is_active)
      .map((row) => db.profiles.find((profile) => profile.id === row.user_id))
      .filter((profile): profile is NonNullable<typeof profile> => !!profile)
      .map((profile) => ({ user_id: profile.id, email: profile.email, full_name: profile.full_name }))
      .sort((a, b) => a.full_name.localeCompare(b.full_name) || a.user_id.localeCompare(b.user_id))
  },
  /** The platform audit trail, newest first. */
  platformRecentActions(limit = 50): PlatformAction[] {
    const db = load()
    requirePlatform(db)
    const cap = Math.min(Math.max(Math.trunc(limit) || 50, 1), 200)
    return newestFirst(db.auditLog)
      .slice(0, cap)
      .map((entry) => ({
        id: entry.id,
        actor_email: db.profiles.find((profile) => profile.id === entry.actor_id)?.email ?? null,
        action: entry.action,
        club_id: entry.club_id,
        club_name: entry.club_id ? db.clubs.find((club) => club.id === entry.club_id)?.name ?? null : null,
        details: entry.details,
        created_at: entry.created_at,
      }))
  },
  /** Mirrors platform_start_support_session: one club, a reason, at most two hours. */
  startSupportSession(clubId: string, reason: string, minutes = 60): string {
    const db = load()
    const actor = requirePlatform(db)
    findClub(db, clubId)
    const text = reason.trim()
    if (text.length < 10) throw new Error('Give a reason of at least 10 characters')
    if (text.length > 500) throw new Error('Keep the reason under 500 characters')
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 120) throw new Error('Choose between 5 and 120 minutes')
    const now = Date.now()
    const sessions = db.supportSessions ?? (db.supportSessions = [])
    // One open session at a time: close any others and log that they were replaced.
    for (const open of sessions) {
      if (open.actor_id === actor && !open.ended_at && Date.parse(open.expires_at) > now) {
        open.ended_at = new Date(now).toISOString()
        audit(db, actor, 'support.end', open.club_id, { session_id: open.id, ended_by: 'new session' })
      }
    }
    const session = {
      id: uid('support'),
      club_id: clubId,
      actor_id: actor,
      reason: text,
      started_at: new Date(now).toISOString(),
      expires_at: new Date(now + minutes * 60000).toISOString(),
      ended_at: null,
    }
    sessions.unshift(session)
    audit(db, actor, 'support.start', clubId, { session_id: session.id, reason: text, minutes })
    save(db)
    return session.id
  },
  endSupportSession(sessionId: string) {
    const db = load()
    const actor = requirePlatform(db)
    const session = (db.supportSessions ?? []).find((row) => row.id === sessionId && row.actor_id === actor && !row.ended_at)
    if (!session) throw new Error('Support session not found or already ended')
    session.ended_at = todayISO()
    audit(db, actor, 'support.end', session.club_id, { session_id: session.id })
    save(db)
  },
  /** The signed-in superadmin's own sessions, newest first. */
  mySupportSessions(): SupportSession[] {
    const db = load()
    const actor = requirePlatform(db)
    const now = Date.now()
    return (db.supportSessions ?? [])
      .filter((row) => row.actor_id === actor)
      .sort((a, b) => b.started_at.localeCompare(a.started_at))
      .slice(0, 20)
      .map((row) => ({
        ...row,
        club_name: db.clubs.find((club) => club.id === row.club_id)?.name ?? 'Unknown club',
        is_open: !row.ended_at && Date.parse(row.expires_at) > now,
      }))
  },
  /** Mirrors platform_support_snapshot: settings, counts and today's activity, never member details. */
  supportSnapshot(sessionId: string): SupportSnapshot {
    const db = load()
    const actor = requirePlatform(db)
    const session = (db.supportSessions ?? []).find((row) => row.id === sessionId && row.actor_id === actor)
    if (!session) throw new Error('Support session not found')
    if (session.ended_at || Date.parse(session.expires_at) <= Date.now()) throw new Error('This support session has ended')
    const club = findClub(db, session.club_id)
    const dayStart = new Date()
    dayStart.setHours(0, 0, 0, 0)
    const dayEnd = new Date(dayStart.getTime() + 86400000)
    const isToday = (start: string, end: string) => new Date(start) < dayEnd && new Date(end) > dayStart
    const courtName = (courtId?: string | null) => db.courts.find((court) => court.id === courtId)?.name ?? 'Open floor'
    const venueName = (venueId?: string | null) => db.venues.find((venue) => venue.id === venueId)?.name ?? ''
    const members = db.members.filter((member) => member.club_id === club.id)
    const today: SupportSnapshot['today'] = [
      ...db.sessions
        .filter((row) => row.club_id === club.id && ['scheduled', 'playing', 'pending_payment'].includes(row.status) && isToday(row.start_at, row.end_at))
        .map((row) => ({ kind: 'session' as const, court_name: courtName(row.court_id), venue_name: venueName(row.venue_id), start_at: row.start_at, end_at: row.end_at, status: row.status })),
      ...db.bookings
        .filter((row) => row.club_id === club.id && !row.session_id && ['pending_payment', 'confirmed'].includes(row.status) && isToday(row.start_at, row.end_at))
        .map((row) => ({ kind: 'booking' as const, court_name: courtName(row.court_id), venue_name: venueName(row.venue_id), start_at: row.start_at, end_at: row.end_at, status: row.status })),
      ...db.openPlays
        .filter((row) => row.club_id === club.id && ['open', 'full'].includes(row.status) && isToday(row.start_at, row.end_at))
        .map((row) => ({ kind: 'open_play' as const, court_name: courtName(row.court_id), venue_name: venueName(row.venue_id), start_at: row.start_at, end_at: row.end_at, status: row.status })),
    ].sort((a, b) => a.start_at.localeCompare(b.start_at) || a.court_name.localeCompare(b.court_name))
    const snapshot: SupportSnapshot = {
      session: { id: session.id, club_id: session.club_id, reason: session.reason, started_at: session.started_at, expires_at: session.expires_at },
      club: { id: club.id, name: club.name, slug: club.slug, is_active: club.is_active, status: accountFor(db, club.id).status },
      venues: db.venues
        .filter((venue) => venue.club_id === club.id)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((venue) => ({ id: venue.id, name: venue.name, is_active: venue.is_active, courts: db.courts.filter((court) => court.venue_id === venue.id).length })),
      members: {
        total: members.length,
        active: members.filter((member) => member.status === 'active').length,
        expired: members.filter((member) => member.status === 'expired').length,
      },
      staff_count: db.clubRoles.filter((row) => row.club_id === club.id && row.is_active).length,
      today,
      open_inquiries: db.inquiries
        .filter((inquiry) => inquiry.club_id === club.id && inquiry.status !== 'resolved')
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, 20)
        .map((inquiry) => ({ category: inquiry.category, subject: inquiry.subject, status: inquiry.status, created_at: inquiry.created_at })),
    }
    audit(db, actor, 'support.read', club.id, { session_id: session.id })
    save(db)
    return snapshot
  },
}
