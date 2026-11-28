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
