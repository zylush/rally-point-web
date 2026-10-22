import { beforeEach, describe, expect, it } from 'vitest'
import { demoStore } from './demoStore'
import { setActiveClubId } from './clubContext'
import { DEMO_CLUB_ID, DEMO_DAVAO_CLUB_ID, DEMO_DAVAO_VENUE_ID } from './tenant'

const futureYmd = () => {
  const date = new Date()
  date.setDate(date.getDate() + 3)
  return date.toISOString().slice(0, 10)
}

function newPlayer() {
  return demoStore.registerMember({
    email: 'new.player@example.invalid',
    password: 'secret123',
    full_name: 'New Player',
  })
}

describe('demo player marketplace (mirrors the public directory and join_club_as_player)', () => {
  beforeEach(() => {
    localStorage.clear()
    setActiveClubId(null)
    demoStore.reset()
  })

  it('lists every club taking bookings with city, size and lowest rates', () => {
    const clubs = demoStore.publicClubs()
    expect(clubs.map((club) => club.slug)).toEqual(['rally-point-davao', 'rally-point-gensan'])
    expect(clubs.find((club) => club.slug === 'rally-point-davao')).toMatchObject({
      city: 'Davao City', venue_count: 1, court_count: 2, min_rate: 450, min_member_rate: 400,
    })
    expect(clubs.find((club) => club.slug === 'rally-point-gensan')).toMatchObject({
      city: 'General Santos City', venue_count: 2, min_rate: 500,
    })
  })

  it('leaves out a club that is still being set up', () => {
    demoStore.login('superadmin@rallypoint.local', 'superadmin123')
    demoStore.provisionClub({
      name: 'Cebu IT Park', slug: 'cebu-it-park', city: 'Cebu City', address: 'Cebu IT Park',
      contact_email: 'cebu@example.invalid', contact_phone: '0917 555 6666', commission_rate: 5, court_count: 2,
    })
    expect(demoStore.publicClubs().map((club) => club.slug)).not.toContain('cebu-it-park')
    expect(demoStore.publicClubDetail('cebu-it-park')).toBeNull()
  })

  it("shows a club page with venues, courts and member rates, and no member details", () => {
    const detail = demoStore.publicClubDetail(' Rally-Point-Davao ')
    expect(detail?.venues).toHaveLength(1)
    expect(detail?.venues[0].courts.map((court) => `${court.name}:${court.hourly_rate}:${court.member_rate}:${court.in_service}`))
      .toEqual(['Davao Court 1:450:400:true', 'Davao Court 2:450:400:true'])
    expect(JSON.stringify(detail)).not.toMatch(/member_code|email|phone|full_name/)
    expect(demoStore.publicClubDetail('no-such-club')).toBeNull()
  })

  it('joins a club as a player with no membership, once', () => {
    const player = newPlayer()
    expect(demoStore.joinClubAsPlayer(player.id, 'rally-point-davao')).toBe(DEMO_DAVAO_CLUB_ID)
    expect(demoStore.joinClubAsPlayer(player.id, 'rally-point-davao')).toBe(DEMO_DAVAO_CLUB_ID)
    const rows = demoStore.get().members.filter((row) => row.user_id === player.id && row.club_id === DEMO_DAVAO_CLUB_ID)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ membership_type: null, expiry_date: null, status: 'active' })
  })

  it('keeps an existing membership when a member uses the same path', () => {
    expect(demoStore.joinClubAsPlayer('user_member', 'rally-point-davao')).toBe(DEMO_DAVAO_CLUB_ID)
    expect(demoStore.get().members.find((row) => row.id === 'mem_davao_001')?.membership_type).toBe('standard')
  })

  it('refuses platform accounts and clubs that are not taking bookings', () => {
    expect(() => demoStore.joinClubAsPlayer('user_superadmin', 'rally-point-davao')).toThrow('Platform accounts cannot book courts')
    expect(() => demoStore.joinClubAsPlayer(newPlayer().id, 'no-such-club')).toThrow('This club is not taking bookings')
  })

  it('charges players the regular rate and active members the member rate', () => {
    const player = newPlayer()
    demoStore.joinClubAsPlayer(player.id, 'rally-point-davao')
    setActiveClubId(DEMO_DAVAO_CLUB_ID)
    const playerRow = demoStore.get().members.find((row) => row.user_id === player.id && row.club_id === DEMO_DAVAO_CLUB_ID)!
    const base = { court_id: 'court_davao_1', venue_id: DEMO_DAVAO_VENUE_ID, dateYmd: futureYmd(), hours: 1 }

    expect(demoStore.createBooking({ ...base, startHour: 9, member_id: playerRow.id, user_id: player.id }).amount).toBe(450)
    expect(demoStore.createBooking({ ...base, startHour: 11, member_id: 'mem_davao_001', user_id: 'user_member' }).amount).toBe(400)
  })

  it('starts a standard membership when a player pays, after which the member rate applies', () => {
    const player = newPlayer()
    demoStore.joinClubAsPlayer(player.id, 'rally-point-davao')
    const playerRow = demoStore.get().members.find((row) => row.user_id === player.id && row.club_id === DEMO_DAVAO_CLUB_ID)!

    demoStore.payMembership(playerRow.id, 2500, player.id)
    const after = demoStore.get().members.find((row) => row.id === playerRow.id)!
    expect(after.membership_type).toBe('standard')
    expect(after.expiry_date).toBeTruthy()

    setActiveClubId(DEMO_DAVAO_CLUB_ID)
    expect(demoStore.createBooking({
      court_id: 'court_davao_2', venue_id: DEMO_DAVAO_VENUE_ID, dateYmd: futureYmd(), startHour: 14, hours: 1,
      member_id: playerRow.id, user_id: player.id,
    }).amount).toBe(400)
  })

  it('still gives the free 30-day membership through sign-up and join links', () => {
    const player = newPlayer()
    const gensanRow = demoStore.get().members.find((row) => row.user_id === player.id && row.club_id === DEMO_CLUB_ID)
    expect(gensanRow?.membership_type).toBe('standard')
  })
})
