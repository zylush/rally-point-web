import type { DashboardStats, Member, MembershipType } from '../../types'
import { daysFromNow, todayISO, uid } from './common'
import { load, save } from './persistence'
import { DEMO_CLUB_ID } from '../tenant'

export const memberOperations = {
  stats(venueId?: string): DashboardStats {
    const db = load()
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const revenue = db.transactions
      .filter((t) => new Date(t.created_at) >= start && (!venueId || t.venue_id === venueId))
      .reduce((a, t) => a + t.amount, 0)
    return {
      members: db.members.filter((m) => !venueId || db.courts.some((court) => court.venue_id === venueId && court.club_id === m.club_id)).length,
      active_now: db.sessions.filter((s) => s.status === 'playing' && (!venueId || s.venue_id === venueId)).length + db.checkins.filter((c) => {
        const age = Date.now() - new Date(c.checked_in_at).getTime()
        return age < 4 * 3600000 && (!venueId || c.venue_id === venueId)
      }).length,
      revenue_today: revenue,
      courts_occupied: db.courts.filter((c) => c.status === 'occupied' && (!venueId || c.venue_id === venueId)).length,
    }
  },
  members() {
    return load().members.slice().sort((a, b) => a.full_name.localeCompare(b.full_name))
  },
  member(id: string) {
    return load().members.find((m) => m.id === id) ?? null
  },
  memberByUser(userId: string) {
    return load().members.find((m) => m.user_id === userId) ?? null
  },
  upsertMember(input: Partial<Member> & { full_name: string; membership_type: MembershipType }) {
    const db = load()
    if (input.id) {
      const i = db.members.findIndex((m) => m.id === input.id)
      if (i >= 0) db.members[i] = { ...db.members[i], ...input }
    } else {
      const codeNum = 1000 + db.members.length + 1
      db.members.push({
        id: uid('mem'),
        club_id: DEMO_CLUB_ID,
        user_id: input.user_id ?? null,
        member_code: input.member_code ?? `RP-${codeNum}`,
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
    return db.members
  },
}
