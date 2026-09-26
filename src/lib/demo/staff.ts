import type { CourtSession } from '../../types'
import { todayISO, uid } from './common'
import { load, save } from './persistence'

export const staffOperations = {
  courts(venueId?: string) {
    return load().courts.filter((court) => !venueId || court.venue_id === venueId)
  },
  sessionsPlaying(venueId?: string) {
    const db = load()
    return db.sessions
      .filter((s) => (s.status === 'playing' || s.status === 'scheduled') && (!venueId || s.venue_id === venueId))
      .map((s) => {
        const players = s.players?.length
          ? s.players
          : [
              s.member_id ? { id: s.member_id, full_name: db.members.find((m) => m.id === s.member_id)?.full_name ?? 'Member', member_id: s.member_id } : null,
              s.guest_name ? { id: `${s.id}-guest`, full_name: s.guest_name, guest_name: s.guest_name } : null,
            ].filter(Boolean) as Array<{ id: string; full_name: string; member_id?: string | null; guest_name?: string | null }>

        return {
          ...s,
          court: db.courts.find((c) => c.id === s.court_id),
          member: s.member_id ? db.members.find((m) => m.id === s.member_id) : undefined,
          players,
        }
      })
  },
  createRental(opts: {
    court_id: string
    venue_id?: string
    member_id?: string
    guest_name?: string
    hours: number
    created_by?: string
  }) {
    const db = load()
    const court = db.courts.find((c) => c.id === opts.court_id)
    if (!court) throw new Error('Court not found')
    if (court.status === 'maintenance') throw new Error('Court under maintenance')
    if (opts.venue_id && court.venue_id !== opts.venue_id) throw new Error('Court is outside the selected venue')
    const start = new Date()
    const end = new Date(start.getTime() + opts.hours * 3600000)
    const amount = court.hourly_rate * opts.hours
    const players = [
      opts.member_id ? { id: opts.member_id, full_name: db.members.find((m) => m.id === opts.member_id)?.full_name ?? 'Member', member_id: opts.member_id } : null,
      opts.guest_name ? { id: uid('guest'), full_name: opts.guest_name, guest_name: opts.guest_name } : null,
    ].filter(Boolean) as Array<{ id: string; full_name: string; member_id?: string | null; guest_name?: string | null }>

    const session: CourtSession = {
      id: uid('ses'),
      court_id: opts.court_id,
      club_id: court.club_id,
      venue_id: court.venue_id,
      member_id: opts.member_id ?? null,
      guest_name: opts.guest_name ?? null,
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      status: 'playing',
      amount,
      created_by: opts.created_by ?? null,
      players,
    }
    db.sessions.push(session)
    court.status = 'occupied'
    db.transactions.push({
      id: uid('tx'),
      club_id: court.club_id,
      venue_id: court.venue_id,
      member_id: opts.member_id ?? null,
      amount,
      type: 'court_rental',
      description: `${court.name} — ${opts.hours}h rental`,
      created_at: todayISO(),
      created_by: opts.created_by ?? null,
    })
    save(db)
    return session
  },
  addMemberToSession(sessionId: string, memberId: string, staffId?: string) {
    const db = load()
    const session = db.sessions.find((x) => x.id === sessionId)
    if (!session) throw new Error('Session not found')
    const member = db.members.find((m) => m.id === memberId)
    if (!member) throw new Error('Member not found')

    const players = session.players ?? []
    if (!players.some((p) => p.member_id === member.id || p.id === member.id)) {
      players.push({ id: member.id, full_name: member.full_name, member_id: member.id })
      session.players = players
    }
    if (!session.member_id) session.member_id = member.id
    session.created_by = staffId ?? session.created_by
    save(db)
    return { ...session, court: db.courts.find((c) => c.id === session.court_id), member }
  },
  extendSession(sessionId: string, hours: number, created_by?: string) {
    const db = load()
    const s = db.sessions.find((x) => x.id === sessionId)
    if (!s) throw new Error('Session not found')
    const court = db.courts.find((c) => c.id === s.court_id)
    const add = (court?.hourly_rate ?? 500) * hours
    s.end_at = new Date(new Date(s.end_at).getTime() + hours * 3600000).toISOString()
    s.amount += add
    db.transactions.push({
      id: uid('tx'),
      member_id: s.member_id ?? null,
      amount: add,
      type: 'extension',
      description: `Extend ${court?.name ?? 'court'} +${hours}h`,
      created_at: todayISO(),
      created_by: created_by ?? null,
    })
    save(db)
    return s
  },
  endSession(sessionId: string) {
    const db = load()
    const s = db.sessions.find((x) => x.id === sessionId)
    if (!s) throw new Error('Session not found')
    s.status = 'completed'
    const court = db.courts.find((c) => c.id === s.court_id)
    if (court) {
      const still = db.sessions.some(
        (x) => x.court_id === court.id && x.id !== s.id && x.status === 'playing',
      )
      if (!still) court.status = 'available'
    }
    save(db)
  },
}
