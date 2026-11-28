import type { AccountInput, MemberPass, MembershipApproval, MembershipRequest, MembershipType, MyMembershipRequest } from '../../types'
import { hasActiveMembership } from '../../types'
import { activeClubId, clubRoleFor } from './access'
import { recordTransaction } from './commissions'
import { todayISO, uid } from './common'
import type { DemoDB, DemoMembershipRequest } from './model'
import { load, save } from './persistence'

// Mirrors the member_profile and membership_requests migrations: the same limits and messages.

const FULL_NAME_MAX = 80
const NICKNAME_MAX = 30
const DECLINE_REASON_MAX = 300
const MEMBERSHIP_DAYS = 30
const REQUESTS_PER_DAY = 5
const MEMBERSHIP_TYPES: MembershipType[] = ['basic', 'standard', 'premium']

/** Mirrors private.tidy_name: one space between words; control, zero-width and direction characters dropped. */
function tidyName(text: string | null | undefined) {
  return (text ?? '')
    .replace(/\s+/g, ' ')
    .replace(/[\p{Cc}\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/gu, '')
    .replace(/ {2,}/g, ' ')
    .trim()
}

function requests(db: DemoDB): DemoMembershipRequest[] {
  db.membershipRequests ??= []
  return db.membershipRequests
}

function ymd(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** 30 days on from today, or from the current expiry when it has not passed yet. */
function extendedExpiry(current: string | null, today = new Date()) {
  const todayYmd = ymd(today)
  const from = current && current.slice(0, 10) > todayYmd ? new Date(`${current.slice(0, 10)}T00:00:00`) : new Date(`${todayYmd}T00:00:00`)
  from.setDate(from.getDate() + MEMBERSHIP_DAYS)
  return ymd(from)
}

function latestRequest(db: DemoDB, clubId: string, userId: string): MyMembershipRequest | null {
  const row = requests(db)
    .filter((request) => request.club_id === clubId && request.user_id === userId)
    .sort((a, b) => b.requested_at.localeCompare(a.requested_at))[0]
  return row
    ? { id: row.id, status: row.status, decline_reason: row.decline_reason, requested_at: row.requested_at, decided_at: row.decided_at }
    : null
}

/** Staff or admin of the active club; otherwise the same refusal the database gives. */
function requireDeskRole(db: DemoDB, staffId: string) {
  const clubId = activeClubId(db)
  const role = clubRoleFor(db, staffId, clubId)
  if (role !== 'staff' && role !== 'admin') throw new Error('Only club staff can manage membership requests')
  // Owner decision (2026-11-25): staff need an active venue of the club; admins do not.
  if (role === 'staff' && !db.staffVenueGrants.some((grant) =>
    grant.club_id === clubId && grant.user_id === staffId && grant.is_active
    && db.venues.some((venue) => venue.id === grant.venue_id && venue.club_id === clubId && venue.is_active))) {
    throw new Error("Only staff assigned to one of this club's venues can manage membership requests")
  }
  return clubId
}

function pendingRequestAtClub(db: DemoDB, clubId: string, requestId: string) {
  const request = requests(db).find((row) => row.id === requestId && row.club_id === clubId)
  if (!request) throw new Error('Membership request not found')
  if (request.status !== 'pending') throw new Error('This request has already been decided')
  return request
}

/** Owner decision (2026-11-25): nobody decides their own request. */
function notOwnRequest(request: DemoMembershipRequest, staffId: string) {
  if (request.user_id === staffId) throw new Error('You cannot decide your own membership request. Ask another staff member or admin.')
}

export const accountOperations = {
  /** Mirrors update_my_account: one full name everywhere (account and every club card), plus a nickname. */
  updateMyAccount(userId: string, input: AccountInput) {
    const db = load()
    const profile = db.profiles.find((row) => row.id === userId)
    if (!profile) throw new Error('Account not found')
    const fullName = tidyName(input.full_name)
    if (!fullName) throw new Error('Please enter your name')
    if (fullName.length > FULL_NAME_MAX) throw new Error(`Your name is limited to ${FULL_NAME_MAX} characters`)
    const nickname = tidyName(input.nickname) || null
    if (nickname && nickname.length > NICKNAME_MAX) throw new Error(`Your nickname is limited to ${NICKNAME_MAX} characters`)
    profile.full_name = fullName
    profile.nickname = nickname
    for (const member of db.members) {
      if (member.user_id === userId) member.full_name = fullName
    }
    save(db)
  },

  /** Mirrors set_my_photo; in the demo the photo is kept as a data link. Null removes it. */
  setMyPhoto(userId: string, dataUrl: string | null) {
    const db = load()
    const profile = db.profiles.find((row) => row.id === userId)
    if (!profile) throw new Error('Account not found')
    profile.photo_path = dataUrl
    save(db)
    return dataUrl
  },

  /** Mirrors list_my_member_passes: one pass per active club the person belongs to, whatever club is active. */
  myMemberPasses(userId: string): MemberPass[] {
    const db = load()
    let changed = false
    const passes = db.members
      .filter((member) => member.user_id === userId)
      .flatMap((member) => {
        const club = db.clubs.find((row) => row.id === member.club_id && row.is_active)
        if (!club) return []
        if (!member.qr_token) {
          member.qr_token = `q_${Math.random().toString(36).slice(2, 10)}`
          changed = true
        }
        const pass: MemberPass = {
          club_id: club.id,
          club_slug: club.slug,
          club_name: club.name,
          member_id: member.id,
          member_code: member.member_code,
          full_name: member.full_name,
          membership_type: member.membership_type,
          status: member.status,
          expiry_date: member.expiry_date,
          is_active_member: hasActiveMembership(member),
          qr_token: member.qr_token,
          request: latestRequest(db, club.id, userId),
        }
        return [pass]
      })
      .sort((a, b) => a.club_name.localeCompare(b.club_name))
    if (changed) save(db)
    return passes
  },

  /** Mirrors request_club_membership: only at a club the person already belongs to, one open request at a time. */
  requestMembership(userId: string, clubId: string) {
    const db = load()
    const club = db.clubs.find((row) => row.id === clubId && row.is_active)
    const member = club ? db.members.find((row) => row.club_id === club.id && row.user_id === userId) : undefined
    if (!club || !member) throw new Error('Join this club before asking for a membership')
    if (member.status === 'suspended') throw new Error('Your account at this club is on hold. Please talk to the club.')
    if (requests(db).some((row) => row.club_id === clubId && row.user_id === userId && row.status === 'pending')) {
      throw new Error('You already asked this club. Staff will confirm it at the desk.')
    }
    // Mirrors the database's flood limit: 5 requests a person across all clubs in the last day.
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000
    if (requests(db).filter((row) => row.user_id === userId && Date.parse(row.requested_at) > dayAgo).length >= REQUESTS_PER_DAY) {
      throw new Error('You have asked for a membership many times today. Please try again tomorrow.')
    }
    const request: DemoMembershipRequest = {
      id: uid('mreq'),
      club_id: clubId,
      user_id: userId,
      member_id: member.id,
      status: 'pending',
      membership_type: null,
      amount: null,
      decline_reason: null,
      requested_at: todayISO(),
      decided_at: null,
      decided_by: null,
    }
    requests(db).push(request)
    save(db)
    return request.id
  },

  /** Mirrors cancel_my_membership_request: only the person's own pending request. */
  cancelMembershipRequest(userId: string, requestId: string) {
    const db = load()
    const request = requests(db).find((row) => row.id === requestId && row.user_id === userId)
    if (!request) throw new Error('Membership request not found')
    if (request.status !== 'pending') throw new Error('This request has already been decided')
    request.status = 'cancelled'
    request.decided_at = todayISO()
    save(db)
  },

  /** Mirrors staff_list_membership_requests: the active club only, for its staff and admins. */
  membershipRequests(which: 'pending' | 'decided' = 'pending'): MembershipRequest[] {
    const db = load()
    const clubId = requireDeskRole(db, db.sessionUserId ?? '')
    const rows = requests(db).filter((row) =>
      row.club_id === clubId && (which === 'pending' ? row.status === 'pending' : row.status === 'approved' || row.status === 'declined'),
    )
    rows.sort((a, b) =>
      which === 'pending' ? a.requested_at.localeCompare(b.requested_at) : (b.decided_at ?? '').localeCompare(a.decided_at ?? ''),
    )
    return rows.slice(0, which === 'pending' ? 200 : 50).flatMap((row) => {
      const member = db.members.find((m) => m.id === row.member_id && m.club_id === clubId)
      if (!member) return []
      const profile = db.profiles.find((p) => p.id === row.user_id)
      const result: MembershipRequest = {
        id: row.id,
        member_id: member.id,
        member_code: member.member_code,
        full_name: member.full_name,
        nickname: profile?.nickname ?? null,
        photo_url: profile?.photo_path ?? null,
        membership_type: member.membership_type,
        member_status: member.status,
        expiry_date: member.expiry_date,
        status: row.status,
        requested_at: row.requested_at,
        decided_at: row.decided_at,
        decline_reason: row.decline_reason,
        amount: row.amount,
      }
      return [result]
    })
  },

  /** Mirrors staff_approve_membership_request: starts or extends 30 days and records what was paid. */
  approveMembershipRequest(requestId: string, approval: MembershipApproval, staffId: string) {
    const db = load()
    const clubId = requireDeskRole(db, staffId)
    const request = pendingRequestAtClub(db, clubId, requestId)
    notOwnRequest(request, staffId)
    if (!MEMBERSHIP_TYPES.includes(approval.membership_type)) throw new Error('Choose a membership plan')
    if (!Number.isFinite(approval.amount) || approval.amount < 0 || approval.amount > 1_000_000) {
      throw new Error('Enter the amount received (0 or more)')
    }
    const member = db.members.find((row) => row.id === request.member_id && row.club_id === clubId)
    if (!member) throw new Error('Member not found')
    if (member.status === 'suspended') throw new Error('This member is suspended. Lift the suspension in Members first.')
    const renewing = hasActiveMembership(member)
    member.membership_type = approval.membership_type
    member.status = 'active'
    member.expiry_date = extendedExpiry(renewing ? member.expiry_date : null)
    const now = todayISO()
    request.status = 'approved'
    request.membership_type = approval.membership_type
    request.amount = approval.amount
    request.decided_at = now
    request.decided_by = staffId
    if (approval.amount > 0) {
      recordTransaction(db, {
        id: uid('tx'),
        club_id: clubId,
        venue_id: null,
        member_id: member.id,
        amount: approval.amount,
        type: 'membership',
        description: renewing ? 'Membership renewal (confirmed by staff)' : 'New membership (confirmed by staff)',
        created_at: now,
        created_by: staffId,
      })
    }
    db.notifications.unshift({
      id: uid('n'),
      club_id: clubId,
      venue_id: null,
      user_id: request.user_id,
      title: renewing ? 'Membership renewed' : 'Membership approved',
      body: `Your membership is active until ${member.expiry_date}. You now pay the member rate where a court has one.`,
      read: false,
      created_at: now,
    })
    save(db)
  },

  /** Mirrors staff_decline_membership_request: the player sees the reason. */
  declineMembershipRequest(requestId: string, reason: string, staffId: string) {
    const db = load()
    const clubId = requireDeskRole(db, staffId)
    const request = pendingRequestAtClub(db, clubId, requestId)
    notOwnRequest(request, staffId)
    const text = reason.trim()
    if (!text) throw new Error('Please give a reason the player will see')
    if (text.length > DECLINE_REASON_MAX) throw new Error(`The reason is limited to ${DECLINE_REASON_MAX} characters`)
    const now = todayISO()
    request.status = 'declined'
    request.decline_reason = text
    request.decided_at = now
    request.decided_by = staffId
    db.notifications.unshift({
      id: uid('n'),
      club_id: clubId,
      venue_id: null,
      user_id: request.user_id,
      title: 'Membership request declined',
      body: text,
      read: false,
      created_at: now,
    })
    save(db)
  },
}
