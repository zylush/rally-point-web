import { beforeEach, describe, expect, it } from 'vitest'
import { demoStore } from './demoStore'
import { setActiveClubId } from './clubContext'
import { emptyClubProfile } from './clubProfile'
import { DEMO_CLUB_ID, DEMO_DAVAO_CLUB_ID, DEMO_VENUE_ID } from './tenant'
import { ymdLocal } from '../types'

const pic = (n: number) => `data:image/jpeg;base64,${n}`

function signInGensanAdmin() {
  setActiveClubId(DEMO_CLUB_ID)
  demoStore.login('admin@brinely.info', 'admin123')
}

describe('demo club business profile (mirrors the club_business_profile functions)', () => {
  beforeEach(() => {
    localStorage.clear()
    setActiveClubId(null)
    demoStore.reset()
  })

  it('lets only the club admin change the profile', () => {
    setActiveClubId(DEMO_CLUB_ID)
    demoStore.login('staff@brinely.info', 'staff123')
    expect(() => demoStore.clubProfile()).toThrow('admin access required')
    expect(() => demoStore.updateClubProfile(emptyClubProfile())).toThrow('admin access required')

    signInGensanAdmin()
    expect(() => demoStore.clubProfile()).not.toThrow()
  })

  it('saves the profile and shows it on the public club page', () => {
    signInGensanAdmin()
    demoStore.updateClubProfile({
      ...emptyClubProfile(),
      about: '  Six indoor courts.  ',
      email: 'Hello@RallyPoint.ph',
      facebook_url: 'https://facebook.com/rallypointgensan',
      amenities: ['parking', 'night_lights', 'parking'],
      terms: '   ',
    })
    expect(demoStore.clubProfile().profile).toMatchObject({
      about: 'Six indoor courts.', email: 'hello@rallypoint.ph', amenities: ['night_lights', 'parking'], terms: null,
    })
    expect(demoStore.publicClubProfile('rally-point-gensan')).toMatchObject({
      about: 'Six indoor courts.', facebook_url: 'https://facebook.com/rallypointgensan',
    })
    expect(() => demoStore.updateClubProfile({ ...emptyClubProfile(), website_url: 'http://rallypoint.ph' }))
      .toThrow('The website link must start with https://')
    expect(demoStore.publicClubProfile('no-such-club')).toBeNull()
  })

  it('keeps add-ons unique, hides inactive ones from players, and removes them', () => {
    signInGensanAdmin()
    const paddles = demoStore.upsertClubAddon({ name: ' Paddle rental ', description: null, price: 100, unit: 'per_hour', is_active: true })
    expect(paddles.name).toBe('Paddle rental')
    expect(() => demoStore.upsertClubAddon({ name: 'PADDLE RENTAL', description: null, price: 1, unit: 'per_hour', is_active: true }))
      .toThrow('This club already has an add-on with that name')
    demoStore.upsertClubAddon({ name: 'Ball rental', description: null, price: 50, unit: 'per_item', is_active: false })

    expect(demoStore.clubProfile().addons.map((addon) => addon.name)).toEqual(['Paddle rental', 'Ball rental'])
    expect(demoStore.publicClubProfile('rally-point-gensan')?.addons.map((addon) => addon.name)).toEqual(['Paddle rental'])

    demoStore.removeClubAddon(paddles.id)
    expect(() => demoStore.removeClubAddon(paddles.id)).toThrow('add-on not found')
  })

  it('stores coach photos and payment QR codes, and lists only shown items publicly', () => {
    signInGensanAdmin()
    const ana = demoStore.upsertClubCoach({
      full_name: 'Coach Ana', headline: 'Beginners', bio: null, hourly_rate: 500,
      contact_phone: null, contact_url: 'https://m.me/coachana', is_active: true,
    })
    demoStore.upsertClubCoach({
      full_name: 'Coach Ben', headline: null, bio: null, hourly_rate: null, contact_phone: null, contact_url: null, is_active: false,
    })
    demoStore.setClubCoachPhoto(ana.id, pic(1))
    const gcash = demoStore.upsertClubPaymentMethod({ label: 'GCash', account_name: 'Rally Point', account_number: null, is_active: true })
    demoStore.setClubPaymentQr(gcash.id, pic(2))

    const shown = demoStore.publicClubProfile('rally-point-gensan')
    expect(shown?.coaches).toEqual([expect.objectContaining({ full_name: 'Coach Ana', photo_url: pic(1) })])
    expect(shown?.payment_methods).toEqual([expect.objectContaining({ label: 'GCash', qr_url: pic(2) })])

    demoStore.setClubPaymentQr(gcash.id, null)
    expect(demoStore.publicClubProfile('rally-point-gensan')?.payment_methods[0].qr_url).toBeNull()
  })

  it('limits the gallery to 12 photos and keeps captions', () => {
    signInGensanAdmin()
    demoStore.addClubPhoto(pic(0), ' Our courts ')
    for (let n = 1; n < 12; n += 1) demoStore.addClubPhoto(pic(n), null)
    expect(() => demoStore.addClubPhoto(pic(12), null)).toThrow('The gallery holds up to 12 photos')
    const gallery = demoStore.publicClubProfile('rally-point-gensan')?.gallery ?? []
    expect(gallery).toHaveLength(12)
    expect(gallery[0]).toMatchObject({ url: pic(0), caption: 'Our courts' })
  })

  it('keeps each club’s profile to itself', () => {
    signInGensanAdmin()
    const paddles = demoStore.upsertClubAddon({ name: 'Paddle rental', description: null, price: 100, unit: 'per_hour', is_active: true })

    demoStore.logout()
    setActiveClubId(DEMO_DAVAO_CLUB_ID)
    demoStore.login('davao.admin@brinely.info', 'davao123')
    expect(demoStore.clubProfile().addons).toEqual([])
    expect(() => demoStore.removeClubAddon(paddles.id)).toThrow('add-on not found')
    expect(demoStore.publicClubProfile('rally-point-davao')?.addons).toEqual([])
  })
})

describe('demo opening hours', () => {
  beforeEach(() => {
    localStorage.clear()
    setActiveClubId(null)
    demoStore.reset()
  })

  it('offers and books only the hours a venue is open', () => {
    signInGensanAdmin()
    const venue = demoStore.allVenues().find((row) => row.id === DEMO_VENUE_ID)
    if (!venue) throw new Error('Expected the seeded Gensan venue')
    demoStore.upsertVenue({ ...venue, open_hour: 6, close_hour: 22 })

    const tomorrow = ymdLocal(new Date(Date.now() + 24 * 3600000))
    const courts = demoStore.availability(tomorrow, DEMO_VENUE_ID)
    expect(courts.length).toBeGreaterThan(0)
    expect(courts.every((row) => row.slots[0].startHour === 6 && row.slots.at(-1)?.startHour === 21)).toBe(true)

    const member = demoStore.members().find((row) => row.club_id === DEMO_CLUB_ID)
    if (!member) throw new Error('Expected a seeded Gensan member')
    const base = { court_id: courts[0].court.id, member_id: member.id, dateYmd: tomorrow, hours: 1, user_id: 'user_admin' }
    expect(() => demoStore.createBooking({ ...base, startHour: 5 })).toThrow('Outside club hours')
    expect(() => demoStore.createBooking({ ...base, startHour: 21, hours: 2 })).toThrow('Outside club hours')
  })
})
