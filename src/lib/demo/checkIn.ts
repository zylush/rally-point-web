import type { CheckIn, CheckInMember, CheckInResult, Member } from '../../types'
import { hasActiveMembership } from '../../types'
import { activeClubId } from './access'
import { todayISO, uid } from './common'
import { load, save } from './persistence'

export const checkInOperations = {
  ensureMemberQr(memberId: string) {
    const db = load()
    const clubId = activeClubId(db)
    const m = db.members.find((x) => x.id === memberId && x.club_id === clubId)
    if (!m) throw new Error('Member not found')
    if (!m.qr_token) {
      m.qr_token = `QR_${m.member_code.replace(/[^A-Z0-9]/gi, '')}_${Math.random().toString(36).slice(2, 6).toUpperCase()}`
      save(db)
    }
    return m
  },
  checkInByQr(payload: string, staffId?: string, venueId?: string): CheckInResult {
    const db = load()
    const clubId = activeClubId(db)
    // Member codes are unique only within a club, so lookups stay inside the active club.
    const clubMembers = db.members.filter((m) => m.club_id === clubId)
    const parts = payload.trim().split('|')
    let member: Member | undefined
    if (parts[0] === 'RP1' && parts.length >= 3) {
      member = clubMembers.find((m) => m.member_code === parts[1] && m.qr_token === parts[2])
      if (!member) member = clubMembers.find((m) => m.member_code === parts[1])
    } else {
      const code = payload.trim().toUpperCase()
      member = clubMembers.find((m) => m.member_code.toUpperCase() === code || m.qr_token === payload.trim())
    }
    if (!member) throw new Error('QR not recognized')
    if (member.status !== 'active') throw new Error('Membership not active')
    // What the desk needs to recognise the person: their photo, nickname and membership state.
    const profile = member.user_id ? db.profiles.find((p) => p.id === member.user_id) : undefined
    const scanned: CheckInMember = {
      ...member,
      nickname: profile?.nickname ?? null,
      photo_url: profile?.photo_path ?? null,
      is_active_member: hasActiveMembership(member),
    }
    const row: CheckIn = {
      id: uid('ci'),
      club_id: member.club_id,
      venue_id: venueId,
      member_id: member.id,
      checked_in_at: todayISO(),
      staff_id: staffId ?? null,
      note: 'QR check-in',
    }
    db.checkins.unshift(row)
    save(db)
    return { checkin: row, member: scanned }
  },
  checkIn(memberId: string, staffId?: string, note?: string, venueId?: string) {
    const db = load()
    const clubId = activeClubId(db)
    const member = db.members.find((m) => m.id === memberId && m.club_id === clubId)
    if (!member) throw new Error('Member not found')
    const row: CheckIn = {
      id: uid('ci'),
      club_id: member.club_id,
      venue_id: venueId,
      member_id: memberId,
      checked_in_at: todayISO(),
      staff_id: staffId ?? null,
      note: note ?? null,
    }
    db.checkins.unshift(row)
    save(db)
    return row
  },
  recentCheckins(venueId?: string) {
    const db = load()
    const clubId = activeClubId(db)
    return db.checkins
      .filter((checkin) => checkin.club_id === clubId && (!venueId || checkin.venue_id === venueId))
      .slice(0, 30)
      .map((c) => ({
        ...c,
        member: db.members.find((m) => m.id === c.member_id),
      }))
  },
}
