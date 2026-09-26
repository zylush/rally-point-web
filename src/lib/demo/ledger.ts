import type { Role, WalkIn } from '../../types'
import { todayISO, uid } from './common'
import { load, save } from './persistence'

export const ledgerOperations = {
  transactions(userId?: string, role?: Role) {
    const db = load()
    let list = db.transactions.slice().sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
    if (role === 'member' && userId) {
      const mem = db.members.find((m) => m.user_id === userId)
      list = list.filter((t) => t.member_id && mem && t.member_id === mem.id)
    }
    return list.map((t) => ({
      ...t,
      member: t.member_id ? db.members.find((m) => m.id === t.member_id) : undefined,
    }))
  },
  notifications(userId: string) {
    return load()
      .notifications.filter((n) => n.user_id === userId)
      .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
  },
  markNotifRead(id: string) {
    const db = load()
    const n = db.notifications.find((x) => x.id === id)
    if (n) n.read = true
    save(db)
  },
  createWalkIn(input: { full_name: string; phone?: string; purpose: string; amount: number; venue_id?: string; created_by?: string }) {
    const db = load()
    const row: WalkIn = {
      id: uid('wi'),
      club_id: db.clubs[0]?.id,
      venue_id: input.venue_id,
      full_name: input.full_name,
      phone: input.phone ?? null,
      purpose: input.purpose,
      amount: input.amount,
      created_at: todayISO(),
      created_by: input.created_by ?? null,
    }
    db.walkins.unshift(row)
    db.transactions.push({
      id: uid('tx'),
      club_id: db.clubs[0]?.id,
      venue_id: input.venue_id ?? null,
      verification_status: 'unverified',
      member_id: null,
      amount: input.amount,
      type: 'walk_in',
      description: `Walk-in: ${input.full_name} — ${input.purpose}`,
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
    const exp = new Date(m.expiry_date)
    if (exp < new Date()) exp.setTime(Date.now())
    exp.setDate(exp.getDate() + 30)
    m.expiry_date = exp.toISOString().slice(0, 10)
    m.status = 'active'
    db.transactions.push({
      id: uid('tx'),
      club_id: m.club_id,
      venue_id: null,
      verification_status: 'unverified',
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
