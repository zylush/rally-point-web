import { beforeEach, describe, expect, it } from 'vitest'
import type { OwnerCallRequestInput } from '../types'
import { ymdLocal } from '../types'
import { demoStore } from './demoStore'
import { setActiveClubId } from './clubContext'
import { DEFAULT_CLUB_SLUG } from './tenant'

function request(overrides: Partial<OwnerCallRequestInput> = {}): OwnerCallRequestInput {
  return {
    full_name: 'Ana Reyes',
    club_name: 'Lagao Smash Courts',
    city: 'General Santos City',
    court_count: 4,
    phone: '0917 555 0101',
    email: '',
    preferred_date: ymdLocal(new Date()),
    preferred_time: 'morning',
    message: '',
    ...overrides,
  }
}

const setupInput = {
  name: 'Owner Club',
  slug: 'owner-club',
  city: 'Davao City',
  address: '',
  contact_email: '',
  contact_phone: '',
  commission_rate: 5,
  court_count: 2,
}

beforeEach(() => {
  localStorage.clear()
  setActiveClubId(null)
  demoStore.reset()
})

function asSuperadmin() {
  demoStore.login('superadmin@brinely.info', 'superadmin123')
}

describe('demo owner call requests', () => {
  it('lets a visitor ask for a call, and only the superadmin read and follow it up', () => {
    demoStore.logout()
    const id = demoStore.requestOwnerCall(request({ email: ' Ana@Example.invalid ' }))
    expect(() => demoStore.platformOwnerCallRequests()).toThrow('Platform access required')

    demoStore.login('admin@brinely.info', 'admin123')
    expect(() => demoStore.setOwnerCallStatus(id, 'called')).toThrow('Platform access required')

    asSuperadmin()
    const [row] = demoStore.platformOwnerCallRequests('new')
    expect(row).toMatchObject({ id, full_name: 'Ana Reyes', email: 'ana@example.invalid', status: 'new', handled_by_email: null })

    demoStore.setOwnerCallStatus(id, 'called')
    expect(demoStore.platformOwnerCallRequests('called')[0]).toMatchObject({ status: 'called', handled_by_email: 'superadmin@brinely.info' })
    // The audit keeps the request id only, never the owner's contact details.
    expect(demoStore.platformRecentActions(1)[0]).toMatchObject({ action: 'owner_request.status', details: { request_id: id, from: 'new', to: 'called' } })

    demoStore.setOwnerCallStatus(id, 'new')
    expect(demoStore.platformOwnerCallRequests('new')[0]).toMatchObject({ handled_at: null, handled_by_email: null })
  })

  it('checks requests with the same messages as the database', () => {
    expect(() => demoStore.requestOwnerCall(request({ phone: '', email: '' }))).toThrow('Give a mobile number or an email so we can reach you')
    expect(() => demoStore.requestOwnerCall(request({ preferred_date: '2020-01-01' }))).toThrow('Choose a day from today to 60 days ahead')
  })

  it('refuses a fourth request in a day from the same phone, however it is written', () => {
    demoStore.requestOwnerCall(request({ phone: '0917 555 0101' }))
    demoStore.requestOwnerCall(request({ phone: '(0917) 555-0101' }))
    demoStore.requestOwnerCall(request({ phone: '09175550101' }))
    expect(() => demoStore.requestOwnerCall(request({ phone: '0917 555 0101' }))).toThrow('You already asked us to call. We will contact you soon.')
    expect(() => demoStore.requestOwnerCall(request({ phone: '0918 000 0001' }))).not.toThrow()
  })

  it('refuses more than 30 requests in an hour from everyone', () => {
    for (let n = 0; n < 30; n++) demoStore.requestOwnerCall(request({ phone: `0918 000 ${String(n).padStart(4, '0')}` }))
    expect(() => demoStore.requestOwnerCall(request({ phone: '0919 555 0199' }))).toThrow('We are getting many requests right now. Please try again in an hour.')
  })
})

describe('demo owner invites', () => {
  it('makes an existing account the admin at once, and invites anyone else', () => {
    asSuperadmin()
    const clubId = demoStore.provisionClub(setupInput)
    expect(demoStore.inviteClubOwner(clubId, ' Member@Brinely.info ')).toBe('assigned')
    expect(demoStore.platformClubAdmins(clubId).map((admin) => admin.email)).toEqual(['member@brinely.info'])

    expect(demoStore.inviteClubOwner(clubId, 'new.owner@example.invalid')).toBe('invited')
    expect(demoStore.inviteClubOwner(clubId, 'NEW.OWNER@example.invalid')).toBe('invited')
    expect(demoStore.clubOwnerInvites(clubId).map((invite) => invite.email)).toEqual(['new.owner@example.invalid'])
    expect(() => demoStore.inviteClubOwner(clubId, 'not an email')).toThrow('Enter an email like name@example.com')
  })

  it('gives an invited owner no Gensan membership, then makes them the admin when they sign in', () => {
    asSuperadmin()
    const clubId = demoStore.provisionClub(setupInput)
    demoStore.inviteClubOwner(clubId, 'new.owner@example.invalid')
    demoStore.logout()

    const owner = demoStore.registerMember({ email: 'new.owner@example.invalid', password: 'owner-pass', full_name: 'New Owner' })
    expect(demoStore.get().members.filter((member) => member.user_id === owner.id)).toHaveLength(0)

    expect(demoStore.claimOwnerClubs()).toEqual([{ club_id: clubId, name: 'Owner Club', status: 'provisioning' }])
    expect(demoStore.get().clubRoles).toContainEqual({ club_id: clubId, user_id: owner.id, role: 'admin', is_active: true })
    // Asking again changes nothing.
    expect(demoStore.claimOwnerClubs()).toHaveLength(1)
    expect(demoStore.get().auditLog.filter((entry) => entry.action === 'club.owner_claim')).toHaveLength(1)

    asSuperadmin()
    expect(demoStore.clubOwnerInvites(clubId)).toEqual([])
    demoStore.setClubStatus(clubId, 'active')
    demoStore.login('new.owner@example.invalid', 'owner-pass')
    expect(demoStore.claimOwnerClubs()[0].status).toBe('active')
    expect(demoStore.myClubs(owner.id).map((club) => [club.slug, club.role])).toEqual([['owner-club', 'admin']])
  })

  it('keeps the free membership for ordinary sign-ups and for invited owners using a club link', () => {
    asSuperadmin()
    const clubId = demoStore.provisionClub(setupInput)
    demoStore.inviteClubOwner(clubId, 'linked.owner@example.invalid')
    demoStore.logout()
    const plain = demoStore.registerMember({ email: 'plain@example.invalid', password: 'plain-pass', full_name: 'Plain Player' })
    expect(demoStore.myClubs(plain.id).map((club) => club.slug)).toEqual([DEFAULT_CLUB_SLUG])
    const linked = demoStore.registerMember({
      email: 'linked.owner@example.invalid', password: 'linked-pass', full_name: 'Linked Owner', clubSlug: DEFAULT_CLUB_SLUG,
    })
    expect(demoStore.get().members.some((member) => member.user_id === linked.id)).toBe(true)
  })

  it('does not hand an invite to an account made before it', () => {
    demoStore.logout()
    const early = demoStore.registerMember({ email: 'early@example.invalid', password: 'early-pass', full_name: 'Early' })
    asSuperadmin()
    const clubId = demoStore.provisionClub(setupInput)
    // The account exists, so the demo (which has no email confirmation step) assigns it directly.
    expect(demoStore.inviteClubOwner(clubId, 'early@example.invalid')).toBe('assigned')
    const db = demoStore.get()
    db.ownerInvites = [{
      id: 'invite-late', club_id: clubId, email: 'early@example.invalid', invited_by: null,
      created_at: new Date(Date.now() + 60000).toISOString(), claimed_at: null, claimed_by: null, cancelled_at: null,
    }]
    db.clubRoles = db.clubRoles.filter((row) => row.user_id !== early.id)
    demoStore.set(db)
    demoStore.login('early@example.invalid', 'early-pass')
    expect(demoStore.claimOwnerClubs()).toEqual([])
  })

  it('lets the superadmin cancel an open invite, once', () => {
    asSuperadmin()
    const clubId = demoStore.provisionClub(setupInput)
    demoStore.inviteClubOwner(clubId, 'gone@example.invalid')
    const [invite] = demoStore.clubOwnerInvites(clubId)
    demoStore.cancelClubOwnerInvite(invite.id)
    expect(demoStore.clubOwnerInvites(clubId)).toEqual([])
    expect(() => demoStore.cancelClubOwnerInvite(invite.id)).toThrow('That invite is no longer open')
    demoStore.logout()
    demoStore.registerMember({ email: 'gone@example.invalid', password: 'gone-pass', full_name: 'Gone' })
    expect(demoStore.claimOwnerClubs()).toEqual([])
  })
})
