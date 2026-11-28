import type {
  AddonUnit,
  Amenity,
  ClubAddonInput,
  ClubCoachInput,
  ClubPaymentMethodInput,
  ClubProfileFields,
} from '../types'
import { peso } from '../types'

/**
 * Rules for the club business profile. They mirror the checks and messages in the
 * club_business_profile migration, so the demo and the admin form say the same
 * thing the database would.
 */

export const MAX_CLUB_ADDONS = 30
export const MAX_CLUB_COACHES = 30
export const MAX_CLUB_PAYMENT_METHODS = 6
export const MAX_CLUB_GALLERY_PHOTOS = 12

export const AMENITIES: { value: Amenity; label: string }[] = [
  { value: 'parking', label: 'Parking' },
  { value: 'restrooms', label: 'Restrooms' },
  { value: 'showers', label: 'Showers' },
  { value: 'lockers', label: 'Lockers' },
  { value: 'drinking_water', label: 'Drinking water' },
  { value: 'wifi', label: 'Wi-Fi' },
  { value: 'seating', label: 'Seating for guests' },
  { value: 'canteen', label: 'Food and drinks' },
  { value: 'pro_shop', label: 'Pro shop' },
  { value: 'covered_courts', label: 'Covered courts' },
  { value: 'night_lights', label: 'Lights for night play' },
  { value: 'air_conditioning', label: 'Air-conditioned' },
  { value: 'first_aid', label: 'First aid kit' },
]

export function amenityLabel(value: Amenity) {
  return AMENITIES.find((amenity) => amenity.value === value)?.label ?? value
}

export const ADDON_UNITS: { value: AddonUnit; label: string }[] = [
  { value: 'per_hour', label: 'per hour' },
  { value: 'per_booking', label: 'per booking' },
  { value: 'per_item', label: 'each' },
  { value: 'per_person', label: 'per person' },
]

/** "₱100 per hour". A free add-on reads "Free". */
export function addonPriceLabel(price: number, unit: AddonUnit) {
  if (price === 0) return 'Free'
  return `${peso(price)} ${ADDON_UNITS.find((row) => row.value === unit)?.label ?? ''}`.trim()
}

export function emptyClubProfile(): ClubProfileFields {
  return {
    about: null,
    phone: null,
    email: null,
    facebook_url: null,
    messenger_url: null,
    instagram_url: null,
    website_url: null,
    amenities: [],
    payment_note: null,
    house_rules: null,
    cancellation_policy: null,
    terms: null,
  }
}

/** Trimmed text, or null when empty: how the database stores an optional field. */
export function cleanText(value: string | null | undefined) {
  const trimmed = (value ?? '').trim()
  return trimmed === '' ? null : trimmed
}

const PHONE = /^\+?[0-9 ()-]{7,24}$/
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const TAIL = '([/?#]\\S*)?$'
const FACEBOOK = new RegExp(`^https://([a-z0-9-]+\\.)?(facebook\\.com|fb\\.com|fb\\.me)${TAIL}`, 'i')
const MESSENGER = new RegExp(`^https://([a-z0-9-]+\\.)?(m\\.me|messenger\\.com)${TAIL}`, 'i')
const INSTAGRAM = new RegExp(`^https://([a-z0-9-]+\\.)?instagram\\.com${TAIL}`, 'i')
// A web address by name, as the database checks it: labels of letters, digits and inner
// hyphens, ending in a letter domain (or an xn-- one). No IP addresses and no port numbers.
const WEB = new RegExp(`^https://([a-z0-9]([a-z0-9-]*[a-z0-9])?\\.)+([a-z]{2,63}|xn--[a-z0-9-]{1,59})${TAIL}`, 'i')
const WEBSITE_PROBLEM = 'The website link must start with https:// and name a web address, like https://yourclub.ph'
const COACH_LINK_PROBLEM = 'The coach\'s link must start with https:// and name a web address, like https://m.me/coachana'

/** True for a link this app will open: https only, so nothing like javascript: ever reaches an href. */
export function isSafeLink(url: string | null | undefined) {
  return !!url && WEB.test(url)
}

function tooLong(value: string | null, max: number) {
  return value != null && value.length > max
}

function badLink(value: string | null, pattern: RegExp) {
  return value != null && (value.length > 300 || !pattern.test(value))
}

/** The first problem with a profile, in the database's words, or null when it can be saved. */
export function profileProblem(fields: ClubProfileFields): string | null {
  const f = normalizeProfile(fields)
  if (tooLong(f.about, 1500)) return 'About the club is limited to 1,500 characters'
  if (f.phone != null && !PHONE.test(f.phone)) return 'Enter a phone number using digits, spaces, +, ( ) and -'
  if (f.email != null && (f.email.length > 254 || !EMAIL.test(f.email))) return 'Enter a valid email address'
  if (badLink(f.facebook_url, FACEBOOK)) return 'The Facebook link must start with https://facebook.com/ or https://fb.com/'
  if (badLink(f.messenger_url, MESSENGER)) return 'The Messenger link must start with https://m.me/'
  if (badLink(f.instagram_url, INSTAGRAM)) return 'The Instagram link must start with https://instagram.com/'
  if (badLink(f.website_url, WEB)) return WEBSITE_PROBLEM
  if (f.amenities.some((value) => !AMENITIES.some((amenity) => amenity.value === value))) return 'Pick amenities from the list'
  if (tooLong(f.payment_note, 600)) return 'The payment note is limited to 600 characters'
  if (tooLong(f.house_rules, 3000)) return 'House rules are limited to 3,000 characters'
  if (tooLong(f.cancellation_policy, 2000)) return 'The cancellation policy is limited to 2,000 characters'
  if (tooLong(f.terms, 6000)) return 'Terms and conditions are limited to 6,000 characters'
  return null
}

/** The profile as the database stores it: trimmed, empty fields null, email in lower case, amenities sorted once each. */
export function normalizeProfile(fields: ClubProfileFields): ClubProfileFields {
  return {
    about: cleanText(fields.about),
    phone: cleanText(fields.phone),
    email: cleanText(fields.email)?.toLowerCase() ?? null,
    facebook_url: cleanText(fields.facebook_url),
    messenger_url: cleanText(fields.messenger_url),
    instagram_url: cleanText(fields.instagram_url),
    website_url: cleanText(fields.website_url),
    amenities: [...new Set(fields.amenities ?? [])].sort(),
    payment_note: cleanText(fields.payment_note),
    house_rules: cleanText(fields.house_rules),
    cancellation_policy: cleanText(fields.cancellation_policy),
    terms: cleanText(fields.terms),
  }
}

function hasCents(value: number) {
  // A tolerance, because 100.1 * 100 is not exactly 10010 in floating point.
  return Math.abs(Math.round(value * 100) - value * 100) > 1e-6
}

function badPrice(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) || value < 0 || value > 100000 || hasCents(value)
}

export function addonProblem(input: ClubAddonInput): string | null {
  if (badPrice(input.price)) return 'Price must be between 0 and 100,000 pesos'
  if (!ADDON_UNITS.some((unit) => unit.value === input.unit)) return 'Choose how the price is charged'
  const name = input.name.trim()
  if (name.length < 1 || name.length > 60) return 'Add-on name must be 1 to 60 characters'
  if (tooLong(cleanText(input.description), 200)) return 'Add-on description is limited to 200 characters'
  return null
}

export function coachProblem(input: ClubCoachInput): string | null {
  if (input.hourly_rate != null && badPrice(input.hourly_rate)) return 'Coach rate must be between 0 and 100,000 pesos'
  const name = input.full_name.trim()
  if (name.length < 1 || name.length > 80) return 'Coach name must be 1 to 80 characters'
  if (tooLong(cleanText(input.headline), 120)) return 'The coach\'s short line is limited to 120 characters'
  if (tooLong(cleanText(input.bio), 1000)) return 'The coach\'s bio is limited to 1,000 characters'
  const phone = cleanText(input.contact_phone)
  if (phone != null && !PHONE.test(phone)) return 'Enter the coach\'s phone number using digits, spaces, +, ( ) and -'
  if (badLink(cleanText(input.contact_url), WEB)) return COACH_LINK_PROBLEM
  return null
}

export function paymentMethodProblem(input: ClubPaymentMethodInput): string | null {
  const label = input.label.trim()
  if (label.length < 1 || label.length > 40) return 'Payment method name must be 1 to 40 characters'
  if (tooLong(cleanText(input.account_name), 80)) return 'Account name is limited to 80 characters'
  if (tooLong(cleanText(input.account_number), 60)) return 'Account number is limited to 60 characters'
  return null
}

export function captionProblem(caption: string | null): string | null {
  return tooLong(cleanText(caption), 120) ? 'Photo caption is limited to 120 characters' : null
}
