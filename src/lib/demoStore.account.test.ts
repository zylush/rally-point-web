import { beforeEach, describe, expect, it } from 'vitest'
import { qrPayload } from '../types'
import { setActiveClubId } from './clubContext'
import { demoStore, type DemoDB } from './demoStore'
import { DEMO_CLUB_ID, DEMO_DAVAO_CLUB_ID } from './tenant'

// The demo mirror of the member account: one name everywhere, a QR wallet across clubs,
// and membership requests that only the club's own staff can decide.

const MEMBER = ['member@brinely.info', 'member123'] as const
const STAFF = ['staff@brinely.info', 'staff123'] as const
const DAVAO_ADMIN = ['davao.admin@brinely.info', 'davao123'] as const
const MIA = 'user_member'

function signIn([email, password]: readonly [string, string], clubId: string | null = null) {
  demoStore.logout()
  demoStore.login(email, password)
  setActiveClubId(clubId)
}

function updateDb(update: (db: DemoDB) => void) {
  const db = demoStore.get()
  update(db)
  demoStore.set(db)
}

function ymdIn(days: number) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Makes Mia a player at Gensan: a member card with no plan. */
function miaIsPlayerAtGensan() {
  updateDb((db) => {
    const card = db.members.find((m) => m.id === 'mem_001')!
    card.membership_type = null
    card.expiry_date = null
  })
}

const staffId = () => demoStore.currentUser()!.id

beforeEach(() => {
  localStorage.clear()
  setActiveClubId(null)
  demoStore.reset()
  signIn(MEMBER)
})

describe('QR wallet (mirrors list_my_member_passes)', () => {
  it('holds one pass per club, each with its own code, whatever club is active', () => {
    setActiveClubId(DEMO_DAVAO_CLUB_ID)
    const passes = demoStore.myMemberPasses(MIA)
    expect(passes.map((p) => p.club_id).sort()).toEqual([DEMO_CLUB_ID, DEMO_DAVAO_CLUB_ID].sort())
    const [a, b] = passes
    expect(a.member_code).not.toEqual(b.member_code)
    expect(qrPayload(a.member_code, a.qr_token)).not.toEqual(qrPayload(b.member_code, b.qr_token))
    expect(passes.every((p) => p.is_active_member)).toBe(true)
  })

  it('shows a player card as not an active member, and leaves out clubs that are switched off', () => {
    miaIsPlayerAtGensan()
    updateDb((db) => {
      db.clubs.find((c) => c.id === DEMO_DAVAO_CLUB_ID)!.is_active = false
    })
    const passes = demoStore.myMemberPasses(MIA)
    expect(passes).toHaveLength(1)
    expect(passes[0]).toMatchObject({ club_id: DEMO_CLUB_ID, membership_type: null, is_active_member: false, request: null })
  })
})

describe('account details (mirrors update_my_account and set_my_photo)', () => {
  it('changes the name on the account and on every club card, and keeps the nickname', () => {
    demoStore.updateMyAccount(MIA, { full_name: '  Mia   Santos ', nickname: ' Mimi ' })
    const db = demoStore.get()
    expect(db.profiles.find((p) => p.id === MIA)).toMatchObject({ full_name: 'Mia Santos', nickname: 'Mimi' })
    expect(db.members.filter((m) => m.user_id === MIA).map((m) => m.full_name)).toEqual(['Mia Santos', 'Mia Santos'])

    demoStore.updateMyAccount(MIA, { full_name: 'Mia Santos', nickname: '' })
    expect(demoStore.get().profiles.find((p) => p.id === MIA)?.nickname).toBeNull()
  })

  it('drops hidden control, zero-width and direction characters from names', () => {
    demoStore.updateMyAccount(MIA, { full_name: 'Mia​ ‮Santos', nickname: '⁦Mimi⁩' })
    expect(demoStore.get().profiles.find((p) => p.id === MIA)).toMatchObject({ full_name: 'Mia Santos', nickname: 'Mimi' })
  })

  it('refuses an empty or too-long name and a too-long nickname', () => {
    expect(() => demoStore.updateMyAccount(MIA, { full_name: '   ' })).toThrow('Please enter your name')
    expect(() => demoStore.updateMyAccount(MIA, { full_name: 'x'.repeat(81) })).toThrow('limited to 80')
    expect(() => demoStore.updateMyAccount(MIA, { full_name: 'Mia', nickname: 'n'.repeat(31) })).toThrow('limited to 30')
  })

  it('stores and clears the profile photo', () => {
    expect(demoStore.setMyPhoto(MIA, 'data:image/webp;base64,AAAA')).toBe('data:image/webp;base64,AAAA')
    expect(demoStore.currentUser()?.photo_path).toBe('data:image/webp;base64,AAAA')
    demoStore.setMyPhoto(MIA, null)
    expect(demoStore.currentUser()?.photo_path).toBeNull()
  })
})

describe('membership requests (mirrors the membership_requests functions)', () => {
  it('turns a player into a member once the club staff approve, and records what was paid', () => {
    miaIsPlayerAtGensan()
    const requestId = demoStore.requestMembership(MIA, DEMO_CLUB_ID)
    expect(() => demoStore.requestMembership(MIA, DEMO_CLUB_ID)).toThrow('You already asked this club')
    expect(demoStore.myMemberPasses(MIA).find((p) => p.club_id === DEMO_CLUB_ID)?.request?.status).toBe('pending')

    signIn(STAFF, DEMO_CLUB_ID)
    const pending = demoStore.membershipRequests('pending')
    expect(pending.map((r) => r.id)).toEqual([requestId])
    expect(pending[0]).toMatchObject({ member_code: 'RP-1001', membership_type: null })

    const txBefore = demoStore.get().transactions.length
    demoStore.approveMembershipRequest(requestId, { membership_type: 'standard', amount: 2500 }, staffId())

    const card = demoStore.get().members.find((m) => m.id === 'mem_001')!
    expect(card).toMatchObject({ membership_type: 'standard', status: 'active', expiry_date: ymdIn(30) })
    const tx = demoStore.get().transactions
    expect(tx.length).toBe(txBefore + 1)
    expect(tx.find((t) => t.member_id === 'mem_001' && t.amount === 2500)).toMatchObject({ type: 'membership', club_id: DEMO_CLUB_ID })
    expect(demoStore.membershipRequests('pending')).toEqual([])
    expect(demoStore.membershipRequests('decided')[0]).toMatchObject({ id: requestId, status: 'approved', amount: 2500 })
    expect(demoStore.get().notifications.some((n) => n.user_id === MIA && n.title === 'Membership approved')).toBe(true)
  })

  it('extends a current membership from its expiry, and records nothing when it was free', () => {
    const requestId = demoStore.requestMembership(MIA, DEMO_CLUB_ID)
    const current = demoStore.get().members.find((m) => m.id === 'mem_001')!.expiry_date!
    signIn(STAFF, DEMO_CLUB_ID)
    const txBefore = demoStore.get().transactions.length
    demoStore.approveMembershipRequest(requestId, { membership_type: 'premium', amount: 0 }, staffId())

    const expected = new Date(`${current}T00:00:00`)
    expected.setDate(expected.getDate() + 30)
    const expectedYmd = `${expected.getFullYear()}-${String(expected.getMonth() + 1).padStart(2, '0')}-${String(expected.getDate()).padStart(2, '0')}`
    expect(demoStore.get().members.find((m) => m.id === 'mem_001')?.expiry_date).toBe(expectedYmd)
    expect(demoStore.get().transactions.length).toBe(txBefore)
  })

  it('needs a reason to decline, and the player sees it', () => {
    const requestId = demoStore.requestMembership(MIA, DEMO_CLUB_ID)
    signIn(STAFF, DEMO_CLUB_ID)
    expect(() => demoStore.declineMembershipRequest(requestId, '  ', staffId())).toThrow('Please give a reason')
    demoStore.declineMembershipRequest(requestId, 'We have not received the payment', staffId())
    expect(() => demoStore.approveMembershipRequest(requestId, { membership_type: 'standard', amount: 0 }, staffId())).toThrow('already been decided')

    signIn(MEMBER)
    expect(demoStore.myMemberPasses(MIA).find((p) => p.club_id === DEMO_CLUB_ID)?.request).toMatchObject({
      status: 'declined',
      decline_reason: 'We have not received the payment',
    })
    // A new request can follow a declined one.
    expect(() => demoStore.requestMembership(MIA, DEMO_CLUB_ID)).not.toThrow()
  })

  it('keeps each club’s requests to its own staff', () => {
    const requestId = demoStore.requestMembership(MIA, DEMO_CLUB_ID)

    signIn(DAVAO_ADMIN, DEMO_DAVAO_CLUB_ID)
    expect(demoStore.membershipRequests('pending')).toEqual([])
    expect(() => demoStore.approveMembershipRequest(requestId, { membership_type: 'standard', amount: 0 }, staffId())).toThrow('Membership request not found')
    expect(() => demoStore.declineMembershipRequest(requestId, 'No', staffId())).toThrow('Membership request not found')

    // Naming another club does not help: the Davao admin has no role at Gensan.
    setActiveClubId(DEMO_CLUB_ID)
    expect(() => demoStore.membershipRequests('pending')).toThrow('Only club staff')
  })

  it('does not let staff decide their own request', () => {
    signIn(STAFF, DEMO_CLUB_ID)
    const me = staffId()
    // The demo staff account also plays at Gensan.
    updateDb((db) => {
      if (!db.members.some((m) => m.user_id === me && m.club_id === DEMO_CLUB_ID)) {
        db.members.push({ ...db.members.find((m) => m.id === 'mem_001')!, id: 'mem_staff', user_id: me, member_code: 'RP-9001', qr_token: 'QR_STAFF' })
      }
    })
    const requestId = demoStore.requestMembership(me, DEMO_CLUB_ID)
    expect(() => demoStore.approveMembershipRequest(requestId, { membership_type: 'premium', amount: 0 }, me)).toThrow('You cannot decide your own membership request')
    expect(() => demoStore.declineMembershipRequest(requestId, 'Mine', me)).toThrow('You cannot decide your own membership request')
  })

  it('needs staff to work at one of the club’s venues; admins do not', () => {
    const requestId = demoStore.requestMembership(MIA, DEMO_CLUB_ID)
    signIn(STAFF, DEMO_CLUB_ID)
    const staff = staffId()
    updateDb((db) => { db.staffVenueGrants.forEach((grant) => { if (grant.user_id === staff) grant.is_active = false }) })
    expect(() => demoStore.membershipRequests('pending')).toThrow("Only staff assigned to one of this club's venues")
    expect(() => demoStore.approveMembershipRequest(requestId, { membership_type: 'standard', amount: 0 }, staff)).toThrow("Only staff assigned to one of this club's venues")
    signIn(['admin@brinely.info', 'admin123'], DEMO_CLUB_ID)
    expect(demoStore.membershipRequests('pending').map((r) => r.id)).toEqual([requestId])
  })

  it('does not let a player list or decide requests', () => {
    const requestId = demoStore.requestMembership(MIA, DEMO_CLUB_ID)
    setActiveClubId(DEMO_CLUB_ID)
    expect(() => demoStore.membershipRequests('pending')).toThrow('Only club staff')
    expect(() => demoStore.approveMembershipRequest(requestId, { membership_type: 'premium', amount: 0 }, MIA)).toThrow('Only club staff')
  })

  it('lets the player withdraw only their own pending request', () => {
    const requestId = demoStore.requestMembership(MIA, DEMO_CLUB_ID)
    expect(() => demoStore.cancelMembershipRequest('someone-else', requestId)).toThrow('Membership request not found')
    demoStore.cancelMembershipRequest(MIA, requestId)
    expect(demoStore.myMemberPasses(MIA).find((p) => p.club_id === DEMO_CLUB_ID)?.request?.status).toBe('cancelled')
    expect(() => demoStore.cancelMembershipRequest(MIA, requestId)).toThrow('already been decided')
  })

  it('stops a sixth request within a day, as the database does', () => {
    for (let i = 0; i < 5; i += 1) {
      const id = demoStore.requestMembership(MIA, DEMO_CLUB_ID)
      demoStore.cancelMembershipRequest(MIA, id)
    }
    expect(() => demoStore.requestMembership(MIA, DEMO_CLUB_ID)).toThrow('many times today')
  })

  it('does not let a suspension be lifted by asking or by approving', () => {
    const requestId = demoStore.requestMembership(MIA, DEMO_CLUB_ID)
    updateDb((db) => { db.members.find((m) => m.id === 'mem_001')!.status = 'suspended' })
    signIn(STAFF, DEMO_CLUB_ID)
    expect(() => demoStore.approveMembershipRequest(requestId, { membership_type: 'standard', amount: 0 }, staffId())).toThrow('This member is suspended')
    signIn(MEMBER)
    demoStore.cancelMembershipRequest(MIA, requestId)
    expect(() => demoStore.requestMembership(MIA, DEMO_CLUB_ID)).toThrow('on hold')
  })

  it('asks only at a club the person already belongs to', () => {
    expect(() => demoStore.requestMembership(MIA, 'club_unknown')).toThrow('Join this club before asking for a membership')
  })
})

describe('QR check-in shows the desk who it is', () => {
  it('returns the nickname, photo and whether the member rate applies', () => {
    demoStore.updateMyAccount(MIA, { full_name: 'Mia Member', nickname: 'Mimi' })
    demoStore.setMyPhoto(MIA, 'data:image/webp;base64,AAAA')
    signIn(STAFF, DEMO_CLUB_ID)
    const result = demoStore.checkInByQr(qrPayload('RP-1001', 'QR_MIA_DEMO'), staffId())
    expect(result.member).toMatchObject({ member_code: 'RP-1001', nickname: 'Mimi', photo_url: 'data:image/webp;base64,AAAA', is_active_member: true })
  })
})
