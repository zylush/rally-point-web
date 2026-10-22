import { beforeEach, describe, expect, it } from 'vitest'
import { demoStore, type DemoDB } from './demoStore'
import { getActiveClubId, setActiveClubId } from './clubContext'
import { DEMO_CLUB_ID, DEMO_DAVAO_CLUB_ID, DEMO_DAVAO_VENUE_ID, DEMO_VENUE_ID } from './tenant'

const provisionInput = {
  name: 'Cebu IT Park',
  slug: 'cebu-it-park',
  city: 'Cebu City',
  address: 'Cebu IT Park',
  contact_email: ' Cebu@Example.invalid ',
  contact_phone: '0917 555 6666',
  commission_rate: 7.5,
  court_count: 3,
}

const futureYmd = (days = 2) => {
  const date = new Date()
  date.setDate(date.getDate() + days)
  date.setHours(12, 0, 0, 0)
  return { date, ymd: date.toISOString().slice(0, 10) }
}

function resetAll() {
  localStorage.clear()
  setActiveClubId(null)
  demoStore.reset()
}

function asSuperadmin() {
  return demoStore.login('superadmin@rallypoint.local', 'superadmin123')
}

function updateDb(update: (db: DemoDB) => void) {
  const db = demoStore.get()
  update(db)
  demoStore.set(db)
}

describe('demo platform access', () => {
  beforeEach(resetAll)

  it('gives platform access only to the superadmin, who holds no club role', () => {
    expect(asSuperadmin().role).toBe('superadmin')
    expect(demoStore.platformAccess('user_superadmin')).toBe('superadmin')
    expect(demoStore.platformAccess('user_admin')).toBeNull()
    expect(demoStore.myClubs('user_superadmin')).toEqual([])
    expect(demoStore.platformClubs().map((club) => club.slug)).toEqual(['rally-point-davao', 'rally-point-gensan'])

    for (const [email, password] of [
      ['admin@rallypoint.local', 'admin123'],
      ['staff@rallypoint.local', 'staff123'],
      ['member@rallypoint.local', 'member123'],
      ['davao.admin@rallypoint.local', 'davao123'],
    ]) {
      demoStore.login(email, password)
      expect(() => demoStore.platformClubs()).toThrow('Platform access required')
      expect(() => demoStore.provisionClub(provisionInput)).toThrow('Platform access required')
      expect(() => demoStore.platformLedger()).toThrow('Platform access required')
    }
    demoStore.logout()
    expect(() => demoStore.platformRecentActions()).toThrow('Platform access required')
  })

  it("reports each club's terms and totals without member details", () => {
    asSuperadmin()
    const clubs = demoStore.platformClubs()
    const davao = clubs.find((club) => club.club_id === DEMO_DAVAO_CLUB_ID)!
    expect(davao).toMatchObject({
      status: 'active',
      commission_rate: 6,
      city: 'Davao City',
      venue_count: 1,
      court_count: 2,
      member_count: 3,
      admin_count: 1,
      gross_amount: 1350,
      commission_amount: 81,
      club_net_amount: 1269,
      entry_count: 2,
    })
    expect(JSON.stringify(davao)).not.toMatch(/Rico|Ana Reyes|rico@email/)
    const gensan = clubs.find((club) => club.club_id === DEMO_CLUB_ID)!
    expect(gensan).toMatchObject({ status: 'active', commission_rate: 5, member_count: 40, admin_count: 1 })
    expect(gensan.entry_count).toBeGreaterThan(0)
    expect(gensan.commission_amount).toBeCloseTo(gensan.gross_amount * 0.05, 2)
  })
})

describe('demo club setup', () => {
  beforeEach(resetAll)

  it('sets up a club in setup with a main venue and its courts, hidden from join links', () => {
    asSuperadmin()
    const clubId = demoStore.provisionClub(provisionInput)
    const club = demoStore.platformClubs().find((row) => row.club_id === clubId)!
    expect(club).toMatchObject({
      slug: 'cebu-it-park',
      name: 'Cebu IT Park',
      status: 'provisioning',
      commission_rate: 7.5,
      contact_email: 'cebu@example.invalid',
      venue_count: 1,
      court_count: 3,
      member_count: 0,
      admin_count: 0,
      entry_count: 0,
    })
    expect(demoStore.get().clubs.find((row) => row.id === clubId)?.is_active).toBe(false)
    expect(demoStore.publicClub('cebu-it-park')).toBeNull()
    expect(demoStore.platformRecentActions(1)[0]).toMatchObject({
      action: 'club.provision',
      club_id: clubId,
      club_name: 'Cebu IT Park',
      actor_email: 'superadmin@rallypoint.local',
    })
  })

  it('validates new clubs with the same messages as the database', () => {
    asSuperadmin()
    expect(() => demoStore.provisionClub({ ...provisionInput, name: '   ' })).toThrow('Enter the club name')
    expect(() => demoStore.provisionClub({ ...provisionInput, slug: 'Bad Slug!' })).toThrow('Use 3 to 50 lowercase letters, numbers or dashes for the link name')
    expect(() => demoStore.provisionClub({ ...provisionInput, slug: ' Rally-Point-Davao ' })).toThrow('That link name is already used by another club')
    expect(() => demoStore.provisionClub({ ...provisionInput, commission_rate: 150 })).toThrow('Commission rate must be between 0 and 100')
    expect(() => demoStore.provisionClub({ ...provisionInput, court_count: 0 })).toThrow('Choose between 1 and 12 courts')
    expect(demoStore.platformRecentActions()).toEqual([])
  })

  it('needs an admin before going live and keeps status, access and the audit trail in step', () => {
    demoStore.registerMember({ email: 'cebu.admin@example.invalid', password: 'cebu-pass', full_name: 'Cebu Admin' })
    asSuperadmin()
    const clubId = demoStore.provisionClub(provisionInput)
    expect(() => demoStore.setClubStatus(clubId, 'active')).toThrow('Assign a club admin before activating this club')
    expect(() => demoStore.assignClubAdmin(clubId, 'nobody@example.invalid')).toThrow('No account uses that email yet. Ask them to sign up first.')

    const adminId = demoStore.assignClubAdmin(clubId, ' Cebu.Admin@Example.invalid ')
    expect(demoStore.platformClubAdmins(clubId)).toEqual([{ user_id: adminId, email: 'cebu.admin@example.invalid', full_name: 'Cebu Admin' }])
    demoStore.setClubStatus(clubId, 'active')
    expect(demoStore.get().clubs.find((row) => row.id === clubId)?.is_active).toBe(true)
    expect(demoStore.publicClub(' CEBU-IT-PARK ')).toEqual({ id: clubId, slug: 'cebu-it-park', name: 'Cebu IT Park' })
    expect(demoStore.myClubs(adminId).map((row) => `${row.slug}:${row.role}`)).toEqual(['cebu-it-park:admin', 'rally-point-gensan:member'])

    demoStore.setCommissionRate(clubId, 8.25)
    demoStore.setClubStatus(clubId, 'suspended')
    expect(demoStore.get().clubs.find((row) => row.id === clubId)?.is_active).toBe(false)
    expect(demoStore.myClubs(adminId).map((row) => row.slug)).toEqual(['rally-point-gensan'])
    demoStore.revokeClubAdmin(clubId, adminId)
    expect(() => demoStore.revokeClubAdmin(clubId, adminId)).toThrow('That person is not an active admin of this club')
    expect(demoStore.platformClubAdmins(clubId)).toEqual([])

    const actions = demoStore.platformRecentActions().filter((row) => row.club_id === clubId)
    expect(actions.map((row) => row.action)).toEqual([
      'club.admin_revoke',
      'club.status',
      'club.commission_rate',
      'club.status',
      'club.admin_assign',
      'club.provision',
    ])
    expect(actions.find((row) => row.action === 'club.commission_rate')?.details).toEqual({ from: 7.5, to: 8.25 })
    expect(actions.every((row) => row.actor_email === 'superadmin@rallypoint.local')).toBe(true)
  })

  it('refuses to close the default sign-up club and rejects bad input', () => {
    asSuperadmin()
    expect(() => demoStore.setClubStatus(DEMO_CLUB_ID, 'suspended')).toThrow('The default sign-up club must stay active')
    expect(() => demoStore.setClubStatus(DEMO_CLUB_ID, 'closed' as never)).toThrow('Unknown club status')
    expect(() => demoStore.setClubStatus('missing-club', 'active')).toThrow('Club not found')
    expect(() => demoStore.setCommissionRate(DEMO_CLUB_ID, -1)).toThrow('Commission rate must be between 0 and 100')
    expect(demoStore.platformRecentActions()).toEqual([])
  })
})

describe('demo commission ledger', () => {
  beforeEach(resetAll)

  it('records commission on court time only, at the rate in force when charged', () => {
    const before = demoStore.get().commissions.length
    const rental = demoStore.createRental({ court_id: 'court_2', hours: 1, created_by: 'user_staff' })
    demoStore.extendSession(rental.id, 1, 'user_staff')
    demoStore.createWalkIn({ full_name: 'Guest', purpose: 'Day pass', amount: 350 })
    demoStore.payMembership('mem_003', 2500, 'user_member')

    const lineFor = (description: string) => {
      const db = demoStore.get()
      const tx = db.transactions.find((row) => row.description === description)
      expect(tx).toBeDefined()
      return db.commissions.find((line) => line.transaction_id === tx!.id)
    }
    expect(demoStore.get().commissions).toHaveLength(before + 2)
    expect(lineFor('Court B — 1h rental')).toMatchObject({
      club_id: DEMO_CLUB_ID,
      venue_id: DEMO_VENUE_ID,
      gross_amount: 500,
      commission_rate: 5,
      commission_amount: 25,
      club_net_amount: 475,
      verification_status: 'unverified',
    })
    expect(lineFor('Extend Court B +1h')).toMatchObject({ club_id: DEMO_CLUB_ID, gross_amount: 500, commission_amount: 25 })
    expect(lineFor('Walk-in: Guest — Day pass')).toBeUndefined()
    expect(lineFor('Online membership payment')).toBeUndefined()

    asSuperadmin()
    demoStore.setCommissionRate(DEMO_CLUB_ID, 7)
    demoStore.logout()
    demoStore.createRental({ court_id: 'court_4', hours: 1 })
    expect(lineFor('Court D — 1h rental')).toMatchObject({ gross_amount: 650, commission_rate: 7, commission_amount: 45.5, club_net_amount: 604.5 })
    expect(lineFor('Court B — 1h rental')?.commission_rate).toBe(5)
  })

  it('records commission when an online booking is confirmed, never as settled money', () => {
    const { ymd } = futureYmd()
    const booking = demoStore.createBooking({ court_id: 'court_2', member_id: 'mem_001', dateYmd: ymd, startHour: 12, hours: 2, user_id: 'user_member' })
    demoStore.confirmBookingPayment({ booking_id: booking.id, method: 'gcash', user_id: 'user_member' })
    const db = demoStore.get()
    expect(db.transactions[0].type).toBe('booking')
    expect(db.commissions.find((line) => line.transaction_id === db.transactions[0].id)).toMatchObject({
      club_id: DEMO_CLUB_ID,
      gross_amount: 1000,
      commission_rate: 5,
      commission_amount: 50,
      club_net_amount: 950,
      verification_status: 'unverified',
    })
    expect(JSON.stringify(db.commissions)).not.toContain('settled')
  })

  it('lists ledger lines newest first, for every club or one club', () => {
    asSuperadmin()
    const davao = demoStore.platformLedger(DEMO_DAVAO_CLUB_ID)
    expect(davao.map((line) => line.description)).toEqual(['Extend Davao Court 1 +1 hour', 'Davao Court 1 — 2 hours'])
    expect(davao.every((line) => line.club_name === 'Rally Point Davao')).toBe(true)
    expect(davao.map((line) => line.commission_amount)).toEqual([27, 54])
    const all = demoStore.platformLedger()
    expect(all.length).toBeGreaterThan(davao.length)
    expect(all.some((line) => line.club_id === DEMO_CLUB_ID)).toBe(true)
    expect(demoStore.platformLedger(null, 1)).toHaveLength(1)
  })
})

describe('demo club membership', () => {
  beforeEach(resetAll)

  it('lists every active club a person belongs to, with their role there', () => {
    expect(demoStore.myClubs('user_member')).toEqual([
      { club_id: DEMO_DAVAO_CLUB_ID, slug: 'rally-point-davao', name: 'Rally Point Davao', role: 'member' },
      { club_id: DEMO_CLUB_ID, slug: 'rally-point-gensan', name: 'Rally Point Gensan', role: 'member' },
    ])
    expect(demoStore.myClubs('user_admin').map((row) => `${row.slug}:${row.role}`)).toEqual(['rally-point-gensan:admin'])
    expect(demoStore.myClubs('user_staff').map((row) => `${row.slug}:${row.role}`)).toEqual(['rally-point-gensan:staff'])
    expect(demoStore.myClubs('user_davao_admin').map((row) => `${row.slug}:${row.role}`)).toEqual(['rally-point-davao:admin'])
    expect(demoStore.login('davao.admin@rallypoint.local', 'davao123').role).toBe('admin')
  })

  it('signs up through a join link or the default club, and refuses a bad link', () => {
    const viaLink = demoStore.registerMember({
      email: 'davao.player@example.invalid',
      password: 'davao-pass',
      full_name: 'Davao Player',
      clubSlug: ' Rally-Point-Davao ',
    })
    expect(viaLink.role).toBe('member')
    expect(demoStore.myClubs(viaLink.id).map((row) => row.slug)).toEqual(['rally-point-davao'])
    expect(demoStore.get().notifications.find((row) => row.user_id === viaLink.id)).toMatchObject({
      club_id: DEMO_DAVAO_CLUB_ID,
      title: 'Welcome to Rally Point Davao',
    })

    const plain = demoStore.registerMember({ email: 'gensan.player@example.invalid', password: 'gensan-pass', full_name: 'Gensan Player' })
    expect(demoStore.myClubs(plain.id).map((row) => row.slug)).toEqual(['rally-point-gensan'])

    expect(() => demoStore.registerMember({
      email: 'lost@example.invalid',
      password: 'lost-pass',
      full_name: 'Lost Player',
      clubSlug: 'no-such-club',
    })).toThrow('This club link is not valid')
    expect(demoStore.get().profiles.some((row) => row.email === 'lost@example.invalid')).toBe(false)
    expect(demoStore.publicClub('rally-point-davao')).toEqual({ id: DEMO_DAVAO_CLUB_ID, slug: 'rally-point-davao', name: 'Rally Point Davao' })
    expect(demoStore.publicClub('no-such-club')).toBeNull()
  })

  it('joins another club once, on sign-up terms, and refuses platform accounts and closed clubs', () => {
    const joiner = demoStore.registerMember({ email: 'joiner@example.invalid', password: 'joiner-pass', full_name: 'Joiner' })
    expect(demoStore.joinClub(joiner.id, ' Rally-Point-Davao ')).toBe(DEMO_DAVAO_CLUB_ID)
    expect(demoStore.joinClub(joiner.id, 'rally-point-davao')).toBe(DEMO_DAVAO_CLUB_ID)
    const memberships = demoStore.get().members.filter((row) => row.user_id === joiner.id)
    expect(memberships.map((row) => row.club_id).sort()).toEqual([DEMO_CLUB_ID, DEMO_DAVAO_CLUB_ID].sort())
    const davaoMembership = memberships.find((row) => row.club_id === DEMO_DAVAO_CLUB_ID)!
    expect(davaoMembership).toMatchObject({ status: 'active', membership_type: 'standard' })
    const days = (Date.parse(davaoMembership.expiry_date ?? '') - Date.parse(davaoMembership.join_date)) / 86400000
    expect(Math.round(days)).toBe(30)

    expect(() => demoStore.joinClub(joiner.id, 'no-such-club')).toThrow('This club link is not valid')
    expect(() => demoStore.joinClub('user_superadmin', 'rally-point-davao')).toThrow('Platform accounts cannot join clubs')
    asSuperadmin()
    demoStore.provisionClub(provisionInput)
    expect(() => demoStore.joinClub(joiner.id, 'cebu-it-park')).toThrow('This club link is not valid')
  })
})

describe('demo cross-club isolation', () => {
  beforeEach(resetAll)

  it('scopes every view to the active club', () => {
    demoStore.login('admin@rallypoint.local', 'admin123')
    setActiveClubId(DEMO_DAVAO_CLUB_ID)
    expect(demoStore.members().map((row) => row.member_code).sort()).toEqual(['DV-1001', 'DV-1002', 'DV-1003'])
    expect(demoStore.courts().map((row) => row.id)).toEqual(['court_davao_1', 'court_davao_2'])
    expect(demoStore.allVenues().map((row) => row.id)).toEqual([DEMO_DAVAO_VENUE_ID])
    expect(demoStore.stats().members).toBe(3)
    expect(demoStore.transactions(undefined, 'admin').every((row) => row.club_id === DEMO_DAVAO_CLUB_ID)).toBe(true)
    expect(demoStore.listOpenPlays()).toEqual([])
    expect(demoStore.member('mem_001')).toBeNull()
    expect(demoStore.staffAccounts().map((row) => row.id)).toEqual(['user_davao_admin'])
    expect(() => demoStore.checkInByQr('RP-1001', 'user_staff')).toThrow('QR not recognized')
    expect(() => demoStore.createRental({ court_id: 'court_2', hours: 1 })).toThrow('Court not found')
    expect(() => demoStore.allInquiries()).toThrow('Only admins can view all inquiries')
    expect(demoStore.tenantContext('user_admin').role).toBeNull()

    setActiveClubId(DEMO_CLUB_ID)
    expect(demoStore.members()).toHaveLength(40)
    expect(demoStore.tenantContext('user_admin').role).toBe('admin')
    expect(demoStore.allInquiries()).toEqual([])
  })

  it("keeps a two-club member's memberships, passes and messages apart", () => {
    demoStore.login('member@rallypoint.local', 'member123')
    expect(demoStore.memberByUser('user_member')?.member_code).toBe('RP-1001')
    setActiveClubId(DEMO_DAVAO_CLUB_ID)
    expect(demoStore.memberByUser('user_member')?.member_code).toBe('DV-1001')
    expect(demoStore.notifications('user_member').map((row) => row.title)).toEqual(['Welcome to Rally Point Davao'])
    expect(demoStore.checkInByQr('QR_MIA_DAVAO').member.id).toBe('mem_davao_001')
    expect(() => demoStore.checkInByQr('QR_MIA_DEMO')).toThrow('QR not recognized')
  })

  it('lets a public board read a named club without changing the active club', () => {
    const { date, ymd } = futureYmd()
    updateDb((db) => {
      db.openPlays.push({
        id: 'davao-board-play',
        club_id: DEMO_DAVAO_CLUB_ID,
        venue_id: DEMO_DAVAO_VENUE_ID,
        title: 'Davao Board Play',
        court_id: 'court_davao_1',
        start_at: date.toISOString(),
        end_at: new Date(date.getTime() + 3600000).toISOString(),
        capacity: 8,
        fee: 0,
        skill_level: 'all',
        status: 'open',
        created_at: new Date().toISOString(),
      })
    })
    setActiveClubId(DEMO_CLUB_ID)
    expect(demoStore.daySchedule(ymd, undefined, DEMO_DAVAO_CLUB_ID).map((block) => block.id)).toEqual(['davao-board-play'])
    expect(demoStore.daySchedule(ymd).some((block) => block.id === 'davao-board-play')).toBe(false)
    expect(demoStore.allVenues(DEMO_DAVAO_CLUB_ID).map((row) => row.id)).toEqual([DEMO_DAVAO_VENUE_ID])
    expect(getActiveClubId()).toBe(DEMO_CLUB_ID)
  })
})
