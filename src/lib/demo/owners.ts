import type {
  ClubOwnerInvite,
  OwnerCallRequest,
  OwnerCallRequestInput,
  OwnerCallStatus,
  OwnerClub,
} from '../../types'
import {
  OWNER_CALL_DAILY_LIMIT,
  OWNER_CALL_HOURLY_LIMIT,
  cleanOwnerCallRequest,
  ownerCallProblem,
  phoneDigits,
} from '../ownerRequests'
import { todayISO, uid } from './common'
import { defaultClubAccount } from './commissions'
import { normalizeDemoEmail } from './credentials'
import type { DemoDB, DemoOwnerInvite } from './model'
import { load, save } from './persistence'
import { audit, findClub, requirePlatform } from './platform'

const STATUSES: OwnerCallStatus[] = ['new', 'called', 'closed']
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

function requests(db: DemoDB) {
  return db.ownerCallRequests ?? (db.ownerCallRequests = [])
}

function invites(db: DemoDB) {
  return db.ownerInvites ?? (db.ownerInvites = [])
}

function isOpen(invite: DemoOwnerInvite) {
  return !invite.claimed_at && !invite.cancelled_at
}

/** Mirrors handle_new_user: a sign-up whose email has an open owner invite gets no default membership. */
export function hasOpenOwnerInvite(db: DemoDB, email: string) {
  const wanted = normalizeDemoEmail(email)
  return (db.ownerInvites ?? []).some((invite) => isOpen(invite) && invite.email === wanted)
}

function makeAdmin(db: DemoDB, clubId: string, userId: string) {
  const existing = db.clubRoles.find((row) => row.club_id === clubId && row.user_id === userId)
  if (existing) {
    existing.role = 'admin'
    existing.is_active = true
  } else {
    db.clubRoles.push({ club_id: clubId, user_id: userId, role: 'admin', is_active: true })
  }
}

export const ownerOperations = {
  /** Mirrors request_owner_call: anyone may ask, with the same checks and flood limits. */
  requestOwnerCall(input: OwnerCallRequestInput, now = new Date()): string {
    const problem = ownerCallProblem(input, now)
    if (problem) throw new Error(problem)
    const request = cleanOwnerCallRequest(input)
    const db = load()
    const rows = requests(db)
    const dayAgo = now.getTime() - 86400000
    const hourAgo = now.getTime() - 3600000
    const digits = phoneDigits(request.phone)
    const sameContact = rows.filter((row) => Date.parse(row.created_at) > dayAgo
      && ((digits && phoneDigits(row.phone) === digits) || (request.email && row.email === request.email)))
    if (sameContact.length >= OWNER_CALL_DAILY_LIMIT) throw new Error('You already asked us to call. We will contact you soon.')
    if (rows.filter((row) => Date.parse(row.created_at) > hourAgo).length >= OWNER_CALL_HOURLY_LIMIT) {
      throw new Error('We are getting many requests right now. Please try again in an hour.')
    }
    const id = uid('owner-request')
    rows.unshift({
      id,
      ...request,
      status: 'new',
      created_at: now.toISOString(),
      handled_at: null,
      handled_by: null,
    })
    save(db)
    return id
  },
  /** Mirrors platform_owner_call_requests: newest first, optionally one status. */
  platformOwnerCallRequests(status?: OwnerCallStatus | null, limit = 100): OwnerCallRequest[] {
    const db = load()
    requirePlatform(db)
    if (status && !STATUSES.includes(status)) throw new Error('Unknown request status')
    const cap = Math.min(Math.max(Math.trunc(limit) || 100, 1), 500)
    return requests(db)
      .filter((row) => !status || row.status === status)
      .slice()
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, cap)
      .map(({ handled_by, ...row }) => ({
        ...row,
        handled_by_email: handled_by ? db.profiles.find((profile) => profile.id === handled_by)?.email ?? null : null,
      }))
  },
  /** Mirrors platform_set_owner_call_status; the audit keeps the request id only. */
  setOwnerCallStatus(requestId: string, status: OwnerCallStatus) {
    const db = load()
    const actor = requirePlatform(db)
    if (!STATUSES.includes(status)) throw new Error('Unknown request status')
    const row = requests(db).find((request) => request.id === requestId)
    if (!row) throw new Error('Request not found')
    const from = row.status
    row.status = status
    row.handled_at = status === 'new' ? null : todayISO()
    row.handled_by = status === 'new' ? null : actor
    audit(db, actor, 'owner_request.status', null, { request_id: requestId, from, to: status })
    save(db)
  },
  /**
   * Mirrors platform_invite_club_owner: someone who already has an account
   * becomes the club's admin now; anyone else is invited and becomes the admin
   * once they sign up with that email.
   */
  inviteClubOwner(clubId: string, email: string): 'assigned' | 'invited' {
    const db = load()
    const actor = requirePlatform(db)
    findClub(db, clubId)
    const wanted = normalizeDemoEmail(email)
    if (!wanted || wanted.length > 254 || !EMAIL.test(wanted)) throw new Error('Enter an email like name@example.com')
    const profile = db.profiles.find((row) => row.email.toLowerCase() === wanted)
    if (profile) {
      makeAdmin(db, clubId, profile.id)
      audit(db, actor, 'club.admin_assign', clubId, { user_id: profile.id, email: wanted })
      save(db)
      return 'assigned'
    }
    if (!invites(db).some((invite) => isOpen(invite) && invite.club_id === clubId && invite.email === wanted)) {
      const invite: DemoOwnerInvite = {
        id: uid('owner-invite'),
        club_id: clubId,
        email: wanted,
        invited_by: actor,
        created_at: todayISO(),
        claimed_at: null,
        claimed_by: null,
        cancelled_at: null,
      }
      invites(db).push(invite)
      audit(db, actor, 'club.owner_invite', clubId, { invite_id: invite.id, email: wanted })
      save(db)
    }
    return 'invited'
  },
  /** Mirrors platform_club_owner_invites: the club's open invites, oldest first. */
  clubOwnerInvites(clubId: string): ClubOwnerInvite[] {
    const db = load()
    requirePlatform(db)
    return (db.ownerInvites ?? [])
      .filter((invite) => invite.club_id === clubId && isOpen(invite))
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map(({ id, email, created_at }) => ({ id, email, created_at }))
  },
  cancelClubOwnerInvite(inviteId: string) {
    const db = load()
    const actor = requirePlatform(db)
    const invite = (db.ownerInvites ?? []).find((row) => row.id === inviteId && isOpen(row))
    if (!invite) throw new Error('That invite is no longer open')
    invite.cancelled_at = todayISO()
    audit(db, actor, 'club.owner_invite_cancel', invite.club_id, { invite_id: invite.id })
    save(db)
  },
  /**
   * Mirrors claim_my_owner_clubs: open invites for the signed-in person's email
   * make them the club's admin, but only for an account made after the invite
   * (the demo has no email confirmation step). Then lists the clubs they own.
   */
  claimOwnerClubs(): OwnerClub[] {
    const db = load()
    const userId = db.sessionUserId
    const profile = userId ? db.profiles.find((row) => row.id === userId) : null
    if (!profile) return []
    const email = profile.email.toLowerCase()
    let changed = false
    for (const invite of db.ownerInvites ?? []) {
      if (!isOpen(invite) || invite.email !== email || invite.created_at > profile.created_at) continue
      if (!db.clubs.some((club) => club.id === invite.club_id)) continue
      makeAdmin(db, invite.club_id, profile.id)
      invite.claimed_at = todayISO()
      invite.claimed_by = profile.id
      audit(db, profile.id, 'club.owner_claim', invite.club_id, { invite_id: invite.id, user_id: profile.id })
      changed = true
    }
    if (changed) save(db)
    return (db.ownerInvites ?? [])
      .filter((invite) => invite.claimed_by === profile.id)
      .filter((invite) => db.clubRoles.some((row) =>
        row.club_id === invite.club_id && row.user_id === profile.id && row.role === 'admin' && row.is_active))
      .map((invite) => {
        const club = db.clubs.find((row) => row.id === invite.club_id)!
        const account = db.clubAccounts.find((row) => row.club_id === club.id) ?? defaultClubAccount(club.id, club.is_active)
        return { club_id: club.id, name: club.name, status: account.status }
      })
      .filter((club, index, all) => all.findIndex((other) => other.club_id === club.club_id) === index)
      .sort((a, b) => a.name.localeCompare(b.name))
  },
}
