import { beforeEach, describe, expect, it } from 'vitest'
import type { ClubCoach } from '../../types'
import { setActiveClubId } from '../clubContext'
import { demoStore } from '../demoStore'
import { DEMO_CLUB_ID, DEMO_DAVAO_CLUB_ID } from '../tenant'

const memberLogin = ['member@brinely.info', 'member123'] as const
const coachLogin = ['admin@brinely.info', 'admin123'] as const
const secondPlayerLogin = ['second.player@example.com', 'second123'] as const
const start = new Date(Date.now() + 2 * 86400000)
start.setMinutes(0, 0, 0)
const startsAt = start.toISOString()
const endsAt = new Date(start.getTime() + 3600000).toISOString()
const COACH_ID = 'coach-rent-a-coach'

function signIn([email, password]: readonly [string, string]) {
  demoStore.logout()
  demoStore.login(email, password)
}

function addSecondPlayer() {
  demoStore.registerMember({
    email: 'second.player@example.com',
    password: 'second123',
    full_name: 'Second Player',
  })
}

function addCoach() {
  const db = demoStore.get()
  const coach: ClubCoach = {
    id: COACH_ID,
    club_id: DEMO_CLUB_ID,
    account_user_id: 'user_admin',
    full_name: 'Coach Ana',
    headline: 'Beginner lessons',
    bio: null,
    hourly_rate: 600,
    booking_policy: null,
    contact_phone: null,
    contact_url: null,
    photo_path: null,
    photo_url: null,
    is_active: true,
    position: 0,
    created_at: new Date().toISOString(),
  }
  db.clubCoaches = [coach]
  demoStore.set(db)
}

function slot() {
  signIn(coachLogin)
  return demoStore.coachUpsertBookingSlot({
    coach_id: COACH_ID,
    starts_at: startsAt,
    ends_at: endsAt,
    lesson_type: 'group',
    pricing_model: 'per_student',
    rate: 600,
    max_students: 4,
  })
}

beforeEach(() => {
  localStorage.clear()
  setActiveClubId(DEMO_CLUB_ID)
  demoStore.reset()
  addCoach()
  addSecondPlayer()
})

describe('rent-a-coach demo', () => {
  it('holds a group time while the coach decides, then enforces remaining seats', () => {
    const coachSlot = slot()

    signIn(memberLogin)
    const pending = demoStore.memberRequestCoachSlot({
      slot: coachSlot,
      student_count: 3,
      message: 'Three players, please.',
    })
    expect(demoStore.memberListCoachSlots(startsAt, endsAt)).toEqual([])

    signIn(coachLogin)
    expect(() => demoStore.memberRequestCoachSlot({
      slot: coachSlot,
      student_count: 1,
      message: '',
    })).toThrow('Join this club as a player')

    expect(() => demoStore.coachSetBookingSlotOpen(coachSlot.slot_id, false))
      .toThrow('A slot with active requests cannot be closed')
    demoStore.coachRespondToBookingRequest(pending.request_id, true)
    expect(demoStore.coachListMyRequests()[0]).toMatchObject({ status: 'accepted', quoted_amount: 1800 })

    signIn(secondPlayerLogin)
    const available = demoStore.memberListCoachSlots(startsAt, endsAt)
    expect(available[0]).toMatchObject({ remaining_students: 1 })
    expect(() => demoStore.memberRequestCoachSlot({
      slot: available[0],
      student_count: 2,
      message: '',
    })).toThrow('Not enough places remain for this group')
    const secondRequest = demoStore.memberRequestCoachSlot({
      slot: available[0],
      student_count: 1,
      message: '',
    })
    expect(secondRequest.quoted_amount).toBe(600)
  })

  it('keeps the request conversation private to the player and linked coach', () => {
    const coachSlot = slot()
    signIn(memberLogin)
    const request = demoStore.memberRequestCoachSlot({
      slot: coachSlot,
      student_count: 1,
      message: '',
    })
    const message = demoStore.coachSendRequestMessage(request.request_id, 'Can we play at the north court?')
    expect(demoStore.coachListRequestMessages(request.request_id)).toEqual([message])

    signIn(secondPlayerLogin)
    expect(() => demoStore.coachListRequestMessages(request.request_id))
      .toThrow('Coaching request not found')
  })

  it('gives the coach the player’s name but never their email', () => {
    // Mirrors coach_list_my_requests (20261128100700_coach_account_checks.sql). Owner decision
    // (2026-11-28): coaches talk to players in the request's conversation.
    const coachSlot = slot()
    signIn(memberLogin)
    const request = demoStore.memberRequestCoachSlot({ slot: coachSlot, student_count: 1, message: '' })
    expect(demoStore.get().coachBookingRequests?.find((row) => row.request_id === request.request_id))
      .not.toHaveProperty('player_email')

    signIn(coachLogin)
    expect(demoStore.coachListMyRequests()).toMatchObject([{ player_name: 'Mia Member', player_email: null }])
    // Not even for a request saved with an email before this rule.
    const db = demoStore.get()
    for (const row of db.coachBookingRequests ?? []) row.player_email = 'member@brinely.info'
    demoStore.set(db)
    expect(JSON.stringify(demoStore.coachListMyRequests())).not.toContain('member@brinely.info')
  })

  it('stops a removed coach, or one whose club is suspended, from working as a coach', () => {
    // Mirrors private.coach_can_act (20261128100700_coach_account_checks.sql).
    const coachSlot = slot()
    signIn(memberLogin)
    const request = demoStore.memberRequestCoachSlot({ slot: coachSlot, student_count: 1, message: '' })
    const change = (update: (db: ReturnType<typeof demoStore.get>) => void) => {
      const db = demoStore.get()
      update(db)
      demoStore.set(db)
    }

    // The club removes the coach; the account link stays.
    change((db) => {
      const coach = db.clubCoaches?.find((row) => row.id === COACH_ID)
      if (coach) coach.is_active = false
    })
    signIn(coachLogin)
    expect(demoStore.coachListMyRequests()).toEqual([])
    expect(demoStore.coachListMySlots()).toEqual([])
    expect(() => demoStore.coachRespondToBookingRequest(request.request_id, true)).toThrow('Coaching request not found')
    expect(() => demoStore.coachSendRequestMessage(request.request_id, 'Still on?')).toThrow('Coaching request not found')
    expect(() => demoStore.coachListRequestMessages(request.request_id)).toThrow('Coaching request not found')
    expect(() => demoStore.coachSetBookingSlotOpen(coachSlot.slot_id, false)).toThrow('Coach slot not found')
    expect(() => demoStore.coachSetBookingPolicy(COACH_ID, 'New rules')).toThrow('Coach profile not found')
    expect(() => demoStore.coachUpsertBookingSlot({
      coach_id: COACH_ID,
      starts_at: new Date(start.getTime() + 5 * 3600000).toISOString(),
      ends_at: new Date(start.getTime() + 6 * 3600000).toISOString(),
      lesson_type: 'private',
      pricing_model: 'per_session',
      rate: 600,
      max_students: 1,
    })).toThrow('This coach profile is not available to your account')
    expect(demoStore.get().coachBookingRequests?.find((row) => row.request_id === request.request_id)?.status).toBe('requested')

    // The player's side keeps working.
    signIn(memberLogin)
    expect(demoStore.coachSendRequestMessage(request.request_id, 'Is this still on?').body).toBe('Is this still on?')
    expect(demoStore.coachListRequestMessages(request.request_id)).toHaveLength(1)

    // Active again, but the club is suspended.
    change((db) => {
      const coach = db.clubCoaches?.find((row) => row.id === COACH_ID)
      if (coach) coach.is_active = true
      const club = db.clubs.find((row) => row.id === DEMO_CLUB_ID)
      if (club) club.is_active = false
    })
    signIn(coachLogin)
    expect(demoStore.coachListMyRequests()).toEqual([])
    expect(() => demoStore.coachRespondToBookingRequest(request.request_id, true)).toThrow('Coaching request not found')
  })

  it('lists the latest 200 messages, takes no more, and closes the conversation with the request', () => {
    // Mirrors coach_send_request_message and coach_list_request_messages.
    const coachSlot = slot()
    signIn(memberLogin)
    const request = demoStore.memberRequestCoachSlot({ slot: coachSlot, student_count: 1, message: '' })
    const message = (id: string, minutesAgo: number) => ({
      id, request_id: request.request_id, sender_user_id: 'user_member', body: id,
      created_at: new Date(Date.now() - minutesAgo * 60000).toISOString(),
    })
    const seeded = demoStore.get()
    seeded.coachRequestMessages = Array.from({ length: 199 }, (_, n) => message(`m${n + 1}`, 300 - n))
    demoStore.set(seeded)
    expect(demoStore.coachSendRequestMessage(request.request_id, 'Message 200').body).toBe('Message 200')
    const limit = 'This conversation has reached the limit of 200 messages.'
    expect(() => demoStore.coachSendRequestMessage(request.request_id, 'One more')).toThrow(limit)

    // Older messages beyond the latest 200 are left out of the list.
    const older = demoStore.get()
    older.coachRequestMessages = [...Array.from({ length: 50 }, (_, n) => message(`o${n + 1}`, 1000 - n)),
      ...(older.coachRequestMessages ?? [])]
    demoStore.set(older)
    const listed = demoStore.coachListRequestMessages(request.request_id)
    expect([listed.length, listed[0].body, listed[199].body]).toEqual([200, 'm1', 'Message 200'])

    signIn(coachLogin)
    demoStore.coachRespondToBookingRequest(request.request_id, false)
    expect(() => demoStore.coachSendRequestMessage(request.request_id, 'Sorry'))
      .toThrow('This lesson request is closed, so no new messages can be sent.')
  })

  it('keeps at most 3 requests waiting for an answer per player, and none from an account on hold', () => {
    // Mirrors member_request_coach_slot (20261128100300_coach_request_limits.sql).
    signIn(coachLogin)
    const times = [0, 1, 2, 3, 4].map((hour) => demoStore.coachUpsertBookingSlot({
      coach_id: COACH_ID,
      starts_at: new Date(start.getTime() + hour * 3600000).toISOString(),
      ends_at: new Date(start.getTime() + (hour + 1) * 3600000).toISOString(),
      lesson_type: 'private',
      pricing_model: 'per_session',
      rate: 600,
      max_students: 1,
    }))
    const ask = (index: number) => demoStore.memberRequestCoachSlot({ slot: times[index], student_count: 1, message: '' })
    const limit = 'You have 3 coach requests waiting for an answer. Cancel one, or wait for a coach to answer, before you ask for another time.'

    signIn(memberLogin)
    const [first] = [ask(0), ask(1), ask(2)]
    expect(() => ask(3)).toThrow(limit)
    signIn(secondPlayerLogin)
    expect(ask(3).status).toBe('requested')

    // Cancelling one frees a place; a coach's answer would too.
    signIn(memberLogin)
    demoStore.memberCancelCoachRequest(first.request_id)
    expect(ask(4).status).toBe('requested')
    expect(() => ask(0)).toThrow(limit)

    // current_club_role still says "member" for an account on hold, so it is checked on its own.
    const db = demoStore.get()
    const own = db.members.find((member) => member.user_id === 'user_member' && member.club_id === DEMO_CLUB_ID)
    if (own) own.status = 'suspended'
    db.coachBookingRequests = (db.coachBookingRequests ?? []).filter((row) => row.player_user_id !== 'user_member')
    demoStore.set(db)
    expect(() => ask(0)).toThrow('Your account at this club is on hold. Ask the desk.')
  })

  it('lists active coaches and open future slots across active clubs and hides held, full, closed, and inactive items', () => {
    demoStore.reset()
    demoStore.logout()

    const seeded = demoStore.listPublicCoaches()
    expect(seeded.map((c) => c.club.slug)).toEqual([
      'rally-point-gensan',
      'rally-point-gensan',
      'rally-point-davao',
    ])
    expect(seeded[0].slots.length).toBeGreaterThan(0)
    expect(seeded[1].accepts_requests).toBe(false)
    expect(seeded[1].slots).toEqual([])

    const davaoOnly = demoStore.listPublicCoaches({ clubSlug: 'RALLY-POINT-DAVAO' })
    expect(davaoOnly).toHaveLength(1)
    expect(davaoOnly[0].club.city).toBe('Davao City')

    // Pending request hides slot; inactive coach or suspended club drops out.
    const db = demoStore.get()
    const gensanCoach = db.clubCoaches!.find((c) => c.id === 'coach_gensan_1')!
    const firstSlot = db.coachBookingSlots!.find((s) => s.slot_id === 'slot_gensan_1')!
    const groupSlot = db.coachBookingSlots!.find((s) => s.slot_id === 'slot_gensan_2')!
    db.coachBookingSlots!.push({
      ...firstSlot,
      slot_id: 'slot_closed',
      is_open: false,
    }, {
      ...firstSlot,
      slot_id: 'slot_past',
      starts_at: new Date(Date.now() - 7200000).toISOString(),
      ends_at: new Date(Date.now() - 3600000).toISOString(),
    })
    db.coachBookingRequests = [
      {
        request_id: 'req-hold',
        slot_id: firstSlot.slot_id,
        club_id: DEMO_CLUB_ID,
        coach_id: gensanCoach.id,
        coach_name: gensanCoach.full_name,
        player_user_id: 'user_member',
        starts_at: firstSlot.starts_at,
        ends_at: firstSlot.ends_at,
        lesson_type: firstSlot.lesson_type,
        pricing_model: firstSlot.pricing_model,
        rate: firstSlot.rate,
        student_count: 1,
        quoted_amount: firstSlot.rate,
        message: null,
        status: 'requested',
        created_at: new Date().toISOString(),
      },
      {
        request_id: 'req-full',
        slot_id: groupSlot.slot_id,
        club_id: DEMO_CLUB_ID,
        coach_id: gensanCoach.id,
        coach_name: gensanCoach.full_name,
        player_user_id: 'user_member',
        starts_at: groupSlot.starts_at,
        ends_at: groupSlot.ends_at,
        lesson_type: groupSlot.lesson_type,
        pricing_model: groupSlot.pricing_model,
        rate: groupSlot.rate,
        student_count: 4,
        quoted_amount: groupSlot.rate * 4,
        message: null,
        status: 'accepted',
        created_at: new Date().toISOString(),
      },
    ]
    db.clubCoaches!.find((c) => c.id === 'coach_gensan_2')!.is_active = false
    db.clubAccounts.find((a) => a.club_id === DEMO_DAVAO_CLUB_ID)!.status = 'suspended'
    demoStore.set(db)

    const filtered = demoStore.listPublicCoaches()
    expect(filtered.map((c) => c.id)).toEqual(['coach_gensan_1'])
    expect(filtered[0].slots).toEqual([])

    expect(() =>
      demoStore.listPublicCoaches({ from: '2099-06-02T00:00:00Z', until: '2099-06-01T00:00:00Z' }),
    ).toThrow('Choose a valid date range')
  })
})
