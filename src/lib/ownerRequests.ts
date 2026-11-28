import type { OwnerCallRequestInput, OwnerCallTime } from '../types'
import { ymdLocal } from '../types'

/**
 * Rules for a court owner's "please call me" request. They mirror
 * public.request_owner_call(), so the page, the demo and the database give the
 * same plain messages in the same order.
 */

export const OWNER_CALL_TIMES: { value: OwnerCallTime; label: string; hours: string }[] = [
  { value: 'morning', label: 'Morning', hours: '8 AM to 12 noon' },
  { value: 'afternoon', label: 'Afternoon', hours: '12 noon to 5 PM' },
  { value: 'evening', label: 'Evening', hours: '5 PM to 8 PM' },
]

/** A call can be asked for from today (Philippine time) to this many days ahead. */
export const OWNER_CALL_MAX_DAYS_AHEAD = 60
/** Requests from the same phone or email allowed in one day, and from everyone in one hour. */
export const OWNER_CALL_DAILY_LIMIT = 3
export const OWNER_CALL_HOURLY_LIMIT = 30

const PHONE = /^\+?[0-9 ()-]{7,24}$/
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/** "Morning (8 AM to 12 noon)". */
export function ownerCallTimeLabel(time: OwnerCallTime) {
  const match = OWNER_CALL_TIMES.find((option) => option.value === time)
  return match ? `${match.label} (${match.hours})` : time
}

/** Adds whole days to a YYYY-MM-DD date. */
export function addDaysYmd(ymd: string, days: number) {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/** The first and last day an owner may pick, in Philippine time. */
export function ownerCallDateRange(now = new Date()) {
  const min = ymdLocal(now)
  return { min, max: addDaysYmd(min, OWNER_CALL_MAX_DAYS_AHEAD) }
}

/** "Tuesday, November 17" for a YYYY-MM-DD date. */
export function callDayLabel(ymd: string) {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC',
  })
}

/*
 * Calendar helpers for the call-day picker. Every date is a YYYY-MM-DD string read in UTC,
 * so the grid is the same whatever the device's own timezone (Philippine dates come from
 * ownerCallDateRange). A month is "YYYY-MM".
 */

function utcDate(ymd: string) {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

/** "2026-12" for "2026-12-01". */
export function monthOfYmd(ymd: string) {
  return ymd.slice(0, 7)
}

/** Moves a "YYYY-MM" month by whole months. */
export function addMonthsYm(ym: string, months: number) {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 + months, 1)).toISOString().slice(0, 7)
}

/** "December 2026". */
export function monthLabel(ym: string) {
  return utcDate(`${ym}-01`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/** "Dec" for "2026-12-01". */
export function shortMonthOfYmd(ymd: string) {
  return utcDate(ymd).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
}

/** 0 for Sunday to 6 for Saturday. */
export function weekdayOfYmd(ymd: string) {
  return utcDate(ymd).getUTCDay()
}

/** Short and full weekday names, Sunday first, as Philippine calendars show them. */
export const CALENDAR_WEEKDAYS = [
  { short: 'Sun', long: 'Sunday' },
  { short: 'Mon', long: 'Monday' },
  { short: 'Tue', long: 'Tuesday' },
  { short: 'Wed', long: 'Wednesday' },
  { short: 'Thu', long: 'Thursday' },
  { short: 'Fri', long: 'Friday' },
  { short: 'Sat', long: 'Saturday' },
] as const

/**
 * The weeks of a month, Sunday first. Each week has seven places: a YYYY-MM-DD date, or null
 * for the places before the 1st and after the last day.
 */
export function monthWeeks(ym: string): (string | null)[][] {
  const first = `${ym}-01`
  const lastDay = Number(addDaysYmd(`${addMonthsYm(ym, 1)}-01`, -1).slice(8))
  const places: (string | null)[] = Array.from({ length: weekdayOfYmd(first) }, () => null)
  for (let day = 1; day <= lastDay; day += 1) places.push(`${ym}-${String(day).padStart(2, '0')}`)
  while (places.length % 7) places.push(null)
  const weeks: (string | null)[][] = []
  for (let index = 0; index < places.length; index += 7) weeks.push(places.slice(index, index + 7))
  return weeks
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetweenYmd(from: string, to: string) {
  return Math.round((utcDate(to).getTime() - utcDate(from).getTime()) / 86400000)
}

/**
 * The plain sentence under the picker and on the thank-you card:
 * "We'll call you on Tuesday, December 1, in the morning (8 AM to 12 noon), Philippine time."
 * Today and tomorrow are named as such, so nobody misreads the date.
 */
export function ownerCallSummary(ymd: string, time: OwnerCallTime, now = new Date()) {
  const option = OWNER_CALL_TIMES.find((entry) => entry.value === time)
  const when = option ? `in the ${option.label.toLowerCase()} (${option.hours})` : ''
  const offset = daysBetweenYmd(ymdLocal(now), ymd)
  const day = offset === 0 ? `today, ${callDayLabel(ymd)}` : offset === 1 ? `tomorrow, ${callDayLabel(ymd)}` : `on ${callDayLabel(ymd)}`
  return `We'll call you ${day}, ${when}, Philippine time.`
}

/** The digits of a phone number, so "0917 555 0101" and "(0917) 555-0101" match. */
export function phoneDigits(phone: string | null | undefined) {
  return (phone ?? '').replace(/\D/g, '')
}

/** The request as it is stored: trimmed, the email in lower case, blank fields as null. */
export function cleanOwnerCallRequest(input: OwnerCallRequestInput) {
  const blank = (value: string) => value.trim() || null
  return {
    full_name: input.full_name.trim(),
    club_name: input.club_name.trim(),
    city: input.city.trim(),
    court_count: input.court_count,
    phone: blank(input.phone),
    email: blank(input.email)?.toLowerCase() ?? null,
    preferred_date: input.preferred_date,
    preferred_time: input.preferred_time,
    message: blank(input.message),
  }
}

/** The first problem with a request, or null when it can be sent. */
export function ownerCallProblem(input: OwnerCallRequestInput, now = new Date()): string | null {
  const request = cleanOwnerCallRequest(input)
  const { min, max } = ownerCallDateRange(now)
  if (request.full_name.length < 2 || request.full_name.length > 80) return 'Enter your name (2 to 80 characters)'
  if (request.club_name.length < 2 || request.club_name.length > 120) return 'Enter your club or venue name (2 to 120 characters)'
  if (request.city.length < 2 || request.city.length > 80) return 'Enter the city (2 to 80 characters)'
  if (!Number.isInteger(request.court_count) || request.court_count < 1 || request.court_count > 50) {
    return 'Enter how many courts you have (1 to 50)'
  }
  if (!request.phone && !request.email) return 'Give a mobile number or an email so we can reach you'
  if (request.phone && !PHONE.test(request.phone)) return 'Enter a mobile number like 0917 123 4567'
  if (request.email && (request.email.length > 254 || !EMAIL.test(request.email))) return 'Enter an email like name@example.com'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(request.preferred_date) || request.preferred_date < min || request.preferred_date > max) {
    return `Choose a day from today to ${OWNER_CALL_MAX_DAYS_AHEAD} days ahead`
  }
  if (!OWNER_CALL_TIMES.some((option) => option.value === request.preferred_time)) return 'Choose morning, afternoon or evening'
  if (request.message && request.message.length > 1000) return 'Keep the message under 1,000 characters'
  return null
}
