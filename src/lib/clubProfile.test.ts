import { describe, expect, it } from 'vitest'
import {
  addonPriceLabel,
  addonProblem,
  coachProblem,
  emptyClubProfile,
  isSafeLink,
  normalizeProfile,
  paymentMethodProblem,
  profileProblem,
} from './clubProfile'
import type { Amenity, ClubProfileFields } from '../types'

const profile = (fields: Partial<ClubProfileFields>): ClubProfileFields => ({ ...emptyClubProfile(), ...fields })

describe('club profile rules (mirror the club_business_profile checks)', () => {
  it('accepts a full, valid profile', () => {
    expect(profileProblem(profile({
      about: 'Six indoor courts.',
      phone: '+63 917 123 4567',
      email: 'hello@rallypoint.ph',
      facebook_url: 'https://www.facebook.com/rallypointgensan',
      messenger_url: 'https://m.me/rallypointgensan',
      instagram_url: 'https://instagram.com/rallypoint',
      website_url: 'https://rallypoint.ph/courts?city=gensan',
      amenities: ['parking', 'night_lights'],
    }))).toBeNull()
  })

  it('keeps each link pointing where its label says, over https only', () => {
    expect(profileProblem(profile({ facebook_url: 'https://facebook.com.evil.example/page' })))
      .toBe('The Facebook link must start with https://facebook.com/ or https://fb.com/')
    expect(profileProblem(profile({ facebook_url: 'https://evilfacebook.com/page' })))
      .toBe('The Facebook link must start with https://facebook.com/ or https://fb.com/')
    expect(profileProblem(profile({ messenger_url: 'javascript:alert(1)' }))).toBe('The Messenger link must start with https://m.me/')
    expect(profileProblem(profile({ instagram_url: 'https://instagram.com@evil.example' })))
      .toBe('The Instagram link must start with https://instagram.com/')
    const website = 'The website link must start with https:// and name a web address, like https://yourclub.ph'
    expect(profileProblem(profile({ website_url: 'http://rallypoint.ph' }))).toBe(website)
  })

  it('takes a website only as a named web address, like the database', () => {
    const website = 'The website link must start with https:// and name a web address, like https://yourclub.ph'
    for (const bad of ['https://192.168.0.1/', 'https://rallypoint.ph:8443/', 'https://-club.ph', 'https://club-.ph', 'https://club.p4', 'https://localhost']) {
      expect(profileProblem(profile({ website_url: bad })), bad).toBe(website)
    }
    for (const good of ['https://rallypoint.ph', 'https://www.rally-point.com.ph/about?x=1#map', 'HTTPS://RallyPoint.PH', 'https://xn--bcher-kva.example']) {
      expect(profileProblem(profile({ website_url: good })), good).toBeNull()
    }
    expect(coachProblem({ full_name: 'Ana', headline: null, bio: null, hourly_rate: null, contact_phone: null, contact_url: 'https://10.0.0.1', is_active: true }))
      .toBe('The coach\'s link must start with https:// and name a web address, like https://m.me/coachana')
  })

  it('checks phone, email, amenities and lengths with the database messages', () => {
    expect(profileProblem(profile({ phone: 'call me' }))).toBe('Enter a phone number using digits, spaces, +, ( ) and -')
    expect(profileProblem(profile({ email: 'not-an-email' }))).toBe('Enter a valid email address')
    expect(profileProblem(profile({ amenities: ['helipad' as Amenity] }))).toBe('Pick amenities from the list')
    expect(profileProblem(profile({ about: 'x'.repeat(1501) }))).toBe('About the club is limited to 1,500 characters')
    expect(profileProblem(profile({ terms: 'x'.repeat(6001) }))).toBe('Terms and conditions are limited to 6,000 characters')
  })

  it('stores blank text as empty, email in lower case, and amenities once each in order', () => {
    expect(normalizeProfile(profile({ about: '   ', email: ' Hello@RallyPoint.PH ', amenities: ['parking', 'night_lights', 'parking'] })))
      .toMatchObject({ about: null, email: 'hello@rallypoint.ph', amenities: ['night_lights', 'parking'] })
  })

  it('only opens https links', () => {
    expect(isSafeLink('https://m.me/coach')).toBe(true)
    expect(isSafeLink('http://m.me/coach')).toBe(false)
    expect(isSafeLink('javascript:alert(1)')).toBe(false)
    expect(isSafeLink('https://127.0.0.1/admin')).toBe(false)
    expect(isSafeLink(null)).toBe(false)
  })

  it('checks add-ons, coaches and payment methods', () => {
    const addon = { name: 'Paddle rental', description: null, price: 100, unit: 'per_hour' as const, is_active: true }
    expect(addonProblem(addon)).toBeNull()
    expect(addonProblem({ ...addon, price: 10.555 })).toBe('Price must be between 0 and 100,000 pesos')
    expect(addonProblem({ ...addon, price: Number.NaN })).toBe('Price must be between 0 and 100,000 pesos')
    expect(addonProblem({ ...addon, name: '  ' })).toBe('Add-on name must be 1 to 60 characters')

    const coach = { full_name: 'Coach Ana', headline: null, bio: null, hourly_rate: null, contact_phone: null, contact_url: null, is_active: true }
    expect(coachProblem(coach)).toBeNull()
    expect(coachProblem({ ...coach, contact_url: 'http://coach.example' }))
      .toBe('The coach\'s link must start with https:// and name a web address, like https://m.me/coachana')
    expect(coachProblem({ ...coach, hourly_rate: -1 })).toBe('Coach rate must be between 0 and 100,000 pesos')

    expect(paymentMethodProblem({ label: 'GCash', account_name: null, account_number: null, is_active: true })).toBeNull()
    expect(paymentMethodProblem({ label: '', account_name: null, account_number: null, is_active: true }))
      .toBe('Payment method name must be 1 to 40 characters')
  })

  it('labels add-on prices in plain words', () => {
    expect(addonPriceLabel(100, 'per_hour')).toBe('Php 100.00 per hour')
    expect(addonPriceLabel(50, 'per_item')).toBe('Php 50.00 each')
    expect(addonPriceLabel(0, 'per_booking')).toBe('Free')
  })
})
