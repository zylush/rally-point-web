import type { ScheduleBlock } from '../../types'
import { localRangeISO } from '../../types'
import { todayISO, uid } from './common'
import { load, save } from './persistence'

export const scheduleOperations = {
  daySchedule(dateYmd: string, venueId?: string): ScheduleBlock[] {
    const db = load()
    const dayStart = localRangeISO(dateYmd, 0, 1).start_at
    const dayEnd = localRangeISO(dateYmd, 23, 1).end_at
    const blocks: ScheduleBlock[] = []
    for (const s of db.sessions) {
      if (s.status === 'cancelled' || s.status === 'completed' || (venueId && s.venue_id !== venueId)) continue
      if (!(new Date(s.start_at) < new Date(dayEnd) && new Date(s.end_at) > new Date(dayStart))) continue
      const court = db.courts.find((c) => c.id === s.court_id)
      const venue = db.venues.find((candidate) => candidate.id === s.venue_id)
      const mem = s.member_id ? db.members.find((m) => m.id === s.member_id) : null
      blocks.push({
        id: s.id,
        kind: 'session',
        court_id: s.court_id,
        venue_id: s.venue_id,
        venue_name: venue?.name,
        court_name: court?.name ?? 'Court',
        title: mem?.full_name ?? s.guest_name ?? 'Rental',
        subtitle: s.status,
        start_at: s.start_at,
        end_at: s.end_at,
        status: s.status,
        amount: s.amount,
      })
    }
    for (const b of db.bookings) {
      if (b.status !== 'confirmed' || (venueId && b.venue_id !== venueId)) continue
      if (b.session_id) continue // already as session
      if (!(new Date(b.start_at) < new Date(dayEnd) && new Date(b.end_at) > new Date(dayStart))) continue
      const court = db.courts.find((c) => c.id === b.court_id)
      const venue = db.venues.find((candidate) => candidate.id === b.venue_id)
      const mem = db.members.find((m) => m.id === b.member_id)
      blocks.push({
        id: b.id,
        kind: 'booking',
        court_id: b.court_id,
        venue_id: b.venue_id,
        venue_name: venue?.name,
        court_name: court?.name ?? 'Court',
        title: mem?.full_name ?? 'Booking',
        subtitle: 'online booking',
        start_at: b.start_at,
        end_at: b.end_at,
        status: b.status,
        amount: b.amount,
      })
    }
    for (const op of db.openPlays) {
      if (op.status === 'cancelled' || (venueId && op.venue_id !== venueId)) continue
      if (!(new Date(op.start_at) < new Date(dayEnd) && new Date(op.end_at) > new Date(dayStart))) continue
      const court = op.court_id ? db.courts.find((c) => c.id === op.court_id) : null
      const venue = db.venues.find((candidate) => candidate.id === op.venue_id)
      const seats = db.openPlaySignups.filter((s) => s.open_play_id === op.id && s.status === 'joined').length
      blocks.push({
        id: op.id,
        kind: 'open_play',
        court_id: op.court_id,
        venue_id: op.venue_id,
        venue_name: venue?.name,
        court_name: court?.name ?? 'Open floor',
        title: op.title,
        subtitle: `${seats}/${op.capacity} · ${op.skill_level}`,
        start_at: op.start_at,
        end_at: op.end_at,
        status: op.status,
        amount: op.fee,
      })
    }
    return blocks.sort((a, b) => +new Date(a.start_at) - +new Date(b.start_at))
  },
  processDueReminders() {
    const db = load()
    const now = Date.now()
    let n = 0
    for (const r of db.reminders) {
      if (r.sent_at) continue
      if (new Date(r.fire_at).getTime() > now) continue
      r.sent_at = todayISO()
      db.notifications.unshift({
        id: uid('n'),
        user_id: r.user_id,
        title: r.title,
        body: r.body,
        read: false,
        created_at: todayISO(),
      })
      n++
    }
    if (n) save(db)
    return n
  },
}
