import type { OpenPlaySession, OpenPlaySignup, SkillLevel } from '../../types'
import { todayISO, uid } from './common'
import type { DemoDB } from './model'
import { load, save } from './persistence'

export const openPlayOperations = {
  hydrateOpenPlay(db: DemoDB, op: OpenPlaySession): OpenPlaySession {
    const signups = db.openPlaySignups
      .filter((s) => s.open_play_id === op.id && s.status !== 'cancelled')
      .map((s) => ({ ...s, member: db.members.find((m) => m.id === s.member_id) }))
    const seats = signups.filter((s) => s.status === 'joined').length
    return {
      ...op,
      court: op.court_id ? db.courts.find((c) => c.id === op.court_id) : undefined,
      signups,
      seats_taken: seats,
      status: op.status === 'open' && seats >= op.capacity ? 'full' : op.status,
    }
  },
  listOpenPlays(includePast = false, venueId?: string) {
    const db = load()
    const now = Date.now() - 30 * 60000
    return db.openPlays
      .filter((op) => (!venueId || op.venue_id === venueId) && (includePast || (op.status !== 'cancelled' && new Date(op.end_at).getTime() >= now)))
      .sort((a, b) => +new Date(a.start_at) - +new Date(b.start_at))
      .map((op) => this.hydrateOpenPlay(db, op))
  },
  createOpenPlay(input: {
    title: string
    court_id?: string
    venue_id?: string
    start_at: string
    end_at: string
    capacity: number
    fee: number
    skill_level: SkillLevel
    notes?: string
    created_by?: string
  }) {
    const db = load()
    const court = input.court_id ? db.courts.find((candidate) => candidate.id === input.court_id) : undefined
    if (input.court_id && !court) throw new Error('Court not found')
    const op: OpenPlaySession = {
      id: uid('op'),
      club_id: court?.club_id ?? db.clubs[0]?.id,
      venue_id: input.venue_id ?? court?.venue_id,
      title: input.title,
      court_id: input.court_id ?? null,
      start_at: input.start_at,
      end_at: input.end_at,
      capacity: input.capacity,
      fee: input.fee,
      skill_level: input.skill_level,
      status: 'open',
      notes: input.notes ?? null,
      created_by: input.created_by ?? null,
      created_at: todayISO(),
    }
    db.openPlays.unshift(op)
    save(db)
    return this.hydrateOpenPlay(db, op)
  },
  joinOpenPlay(openPlayId: string, memberId: string, userId: string) {
    const db = load()
    const op = db.openPlays.find((x) => x.id === openPlayId)
    if (!op) throw new Error('Session not found')
    if (op.status === 'cancelled' || op.status === 'completed') throw new Error('Session closed')
    const existing = db.openPlaySignups.find(
      (s) => s.open_play_id === openPlayId && s.member_id === memberId && s.status !== 'cancelled',
    )
    if (existing) throw new Error('Already signed up')
    const joined = db.openPlaySignups.filter((s) => s.open_play_id === openPlayId && s.status === 'joined').length
    const status = joined >= op.capacity ? 'waitlist' : 'joined'
    const row: OpenPlaySignup = {
      id: uid('ops'),
      club_id: op.club_id,
      venue_id: op.venue_id,
      open_play_id: openPlayId,
      member_id: memberId,
      status,
      created_at: todayISO(),
    }
    db.openPlaySignups.push(row)
    if (status === 'joined' && op.fee > 0) {
      db.transactions.unshift({
        id: uid('tx'),
        club_id: op.club_id,
        venue_id: op.venue_id ?? null,
        verification_status: 'unverified',
        member_id: memberId,
        amount: op.fee,
        type: 'other',
        description: `Open play: ${op.title}`,
        created_at: todayISO(),
        created_by: userId,
      })
    }
    db.notifications.unshift({
      id: uid('n'),
      club_id: op.club_id,
      venue_id: op.venue_id ?? null,
      user_id: userId,
      title: status === 'joined' ? 'Open play joined' : 'Waitlisted',
      body:
        status === 'joined'
          ? `${op.title} · ${new Date(op.start_at).toLocaleString()}. You're in!`
          : `${op.title} is full — you're on the waitlist.`,
      read: false,
      created_at: todayISO(),
    })
    if (status === 'joined') {
      const fire = new Date(new Date(op.start_at).getTime() - 60 * 60000)
      db.reminders.push({
        id: uid('rm'),
        club_id: op.club_id,
        venue_id: op.venue_id ?? null,
        user_id: userId,
        kind: 'open_play_reminder',
        title: 'Open play in 1 hour',
        body: op.title,
        fire_at: fire.toISOString(),
        sent_at: null,
        open_play_id: op.id,
      })
    }
    save(db)
    return { signup: row, session: this.hydrateOpenPlay(db, op) }
  },
  leaveOpenPlay(openPlayId: string, memberId: string) {
    const db = load()
    const s = db.openPlaySignups.find(
      (x) => x.open_play_id === openPlayId && x.member_id === memberId && x.status !== 'cancelled',
    )
    if (!s) return
    s.status = 'cancelled'
    // promote waitlist
    const wait = db.openPlaySignups
      .filter((x) => x.open_play_id === openPlayId && x.status === 'waitlist')
      .sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at))[0]
    if (wait) wait.status = 'joined'
    save(db)
  },
}
