import type { DashboardStats, Member, MembershipType } from '../../types'
import { activeClubId } from './access'
import { daysFromNow, todayISO, uid } from './common'
import type { DemoDB } from './model'
import { load, save } from './persistence'

/** Next member code that is unused within one club (codes are unique per club). */
export function nextMemberCode(db: DemoDB, clubId: string, prefix = 'BR-') {
  const taken = new Set(db.members.filter((member) => member.club_id === clubId).map((member) => member.member_code))
  let n = 1000 + taken.size + 1
  while (taken.has(`${prefix}${n}`)) n++
  return `${prefix}${n}`
}

export const memberOperations = {
  stats(venueId?: string): DashboardStats {
    const db = load()
    const clubId = activeClubId(db)
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const inVenue = (rowVenueId?: string | null) => !venueId || rowVenueId === venueId
    const revenue = db.transactions
      .filter((t) => t.club_id === clubId && new Date(t.created_at) >= start && inVenue(t.venue_id))
      .reduce((a, t) => a + t.amount, 0)
    return {
      // Membership is club-wide, so the member count is the club's even for one venue.
      members: db.members.filter((m) => m.club_id === clubId).length,
      active_now: db.sessions.filter((s) => s.club_id === clubId && s.status === 'playing' && inVenue(s.venue_id)).length + db.checkins.filter((c) => {
        const age = Date.now() - new Date(c.checked_in_at).getTime()
        return c.club_id === clubId && age < 4 * 3600000 && inVenue(c.venue_id)
      }).length,
      revenue_today: revenue,
      courts_occupied: db.courts.filter((c) => c.club_id === clubId && c.status === 'occupied' && inVenue(c.venue_id)).length,
    }
  },
  members() {
    const db = load()
    const clubId = activeClubId(db)
    return db.members.filter((m) => m.club_id === clubId).sort((a, b) => a.full_name.localeCompare(b.full_name))
  },
  member(id: string) {
    const db = load()
    const clubId = activeClubId(db)
    return db.members.find((m) => m.id === id && m.club_id === clubId) ?? null
  },
  memberByUser(userId: string) {
    const db = load()
    const clubId = activeClubId(db)
    return db.members.find((m) => m.user_id === userId && m.club_id === clubId) ?? null
  },
  upsertMember(input: Partial<Member> & { full_name: string; membership_type: MembershipType }) {
    const db = load()
    const clubId = activeClubId(db)
    if (input.id) {
      const i = db.members.findIndex((m) => m.id === input.id && m.club_id === clubId)
      if (i >= 0) db.members[i] = { ...db.members[i], ...input, club_id: clubId }
    } else {
      db.members.push({
        id: uid('mem'),
        club_id: clubId,
        user_id: input.user_id ?? null,
        member_code: input.member_code ?? nextMemberCode(db, clubId),
        full_name: input.full_name,
        email: input.email ?? null,
        phone: input.phone ?? null,
        membership_type: input.membership_type,
        status: input.status ?? 'active',
        join_date: input.join_date ?? new Date().toISOString().slice(0, 10),
        expiry_date: input.expiry_date ?? daysFromNow(30),
        notes: input.notes ?? null,
        created_at: todayISO(),
      })
    }
    save(db)
    return db.members.filter((m) => m.club_id === clubId)
  },
}
