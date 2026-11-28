import type { Role, WalkIn } from '../../types'
import { activeClubId } from './access'
import { tidyName } from './account'
import { todayISO, uid } from './common'
import { recordTransaction } from './commissions'
import { load, save } from './persistence'

// Mirrors create_desk_walkin (20261128100500_desk_walkin_checks.sql): the same limits and messages.
const WALKIN_NAME_MAX = 80
const WALKIN_PHONE_MAX = 24
const WALKIN_PURPOSE_MAX = 200
const WALKIN_AMOUNT_MAX = 100000

/** Length as Postgres counts it (characters, not UTF-16 units). */
function charLength(text: string) {
  return Array.from(text).length
}

export const ledgerOperations = {
  transactions(userId?: string, role?: Role) {
    const db = load()
    const clubId = activeClubId(db)
    let list = db.transactions
      .filter((t) => t.club_id === clubId)
      .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
    if (role === 'member' && userId) {
      const mem = db.members.find((m) => m.user_id === userId && m.club_id === clubId)
      list = list.filter((t) => t.member_id && mem && t.member_id === mem.id)
    }
    return list.map((t) => ({
      ...t,
      member: t.member_id ? db.members.find((m) => m.id === t.member_id) : undefined,
    }))
  },
  /** A person's messages in the active club (live notifications are club-scoped too). */
  notifications(userId: string) {
    const db = load()
    const clubId = activeClubId(db)
    return db.notifications
      .filter((n) => n.user_id === userId && n.club_id === clubId)
      .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
  },
  markNotifRead(id: string) {
    const db = load()
    const n = db.notifications.find((x) => x.id === id)
    if (n) n.read = true
    save(db)
  },
  createWalkIn(input: { full_name: string; phone?: string; purpose: string; amount: number; venue_id?: string; created_by?: string }) {
    const fullName = tidyName(input.full_name)
    if (!fullName) throw new Error("Please enter the guest's full name")
    if (charLength(fullName) > WALKIN_NAME_MAX) throw new Error(`Full name is limited to ${WALKIN_NAME_MAX} characters`)
    const phone = tidyName(input.phone) || null
    if (phone && charLength(phone) > WALKIN_PHONE_MAX) throw new Error(`Phone is limited to ${WALKIN_PHONE_MAX} characters`)
    const purpose = tidyName(input.purpose)
    if (charLength(purpose) > WALKIN_PURPOSE_MAX) throw new Error(`Purpose is limited to ${WALKIN_PURPOSE_MAX} characters`)
    const amount = input.amount
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > WALKIN_AMOUNT_MAX) {
      throw new Error('Amount must be between 0 and 100,000 pesos')
    }
    const db = load()
    const venueClub = input.venue_id ? db.venues.find((venue) => venue.id === input.venue_id)?.club_id : undefined
    const clubId = venueClub ?? activeClubId(db)
    const row: WalkIn = {
      id: uid('wi'),
      club_id: clubId,
      venue_id: input.venue_id,
      full_name: fullName,
      phone,
      purpose,
      amount,
      created_at: todayISO(),
      created_by: input.created_by ?? null,
    }
    db.walkins.unshift(row)
    recordTransaction(db, {
      id: uid('tx'),
      club_id: clubId,
      venue_id: input.venue_id ?? null,
      member_id: null,
      amount,
      type: 'walk_in',
      description: `Walk-in: ${fullName} — ${purpose}`,
      created_at: todayISO(),
      created_by: input.created_by ?? null,
    })
    save(db)
    return row
  },
  users() {
    return load().profiles
  },
  payMembership(memberId: string, amount: number, userId: string) {
    const db = load()
    const m = db.members.find((x) => x.id === memberId)
    if (!m) throw new Error('Member not found')
    // A player with no membership starts a standard one; a member extends theirs.
    const exp = m.expiry_date ? new Date(m.expiry_date) : new Date()
    if (exp < new Date()) exp.setTime(Date.now())
    exp.setDate(exp.getDate() + 30)
    m.expiry_date = exp.toISOString().slice(0, 10)
    m.membership_type = m.membership_type ?? 'standard'
    m.status = 'active'
    recordTransaction(db, {
      id: uid('tx'),
      club_id: m.club_id,
      venue_id: null,
      member_id: memberId,
      amount,
      type: 'membership',
      description: 'Online membership payment',
      created_at: todayISO(),
      created_by: userId,
    })
    db.notifications.unshift({
      id: uid('n'),
      club_id: m.club_id,
      venue_id: null,
      user_id: userId,
      title: 'Payment successful',
      body: `Received ${amount.toLocaleString('en-PH', { style: 'currency', currency: 'PHP' })} for membership.`,
      read: false,
      created_at: todayISO(),
    })
    save(db)
  },
}
