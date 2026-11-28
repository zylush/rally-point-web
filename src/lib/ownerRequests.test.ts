import { describe, expect, it } from 'vitest'
import type { OwnerCallRequestInput } from '../types'
import {
  addDaysYmd,
  addMonthsYm,
  callDayLabel,
  cleanOwnerCallRequest,
  daysBetweenYmd,
  monthLabel,
  monthOfYmd,
  monthWeeks,
  ownerCallDateRange,
  ownerCallProblem,
  ownerCallSummary,
  ownerCallTimeLabel,
  phoneDigits,
  shortMonthOfYmd,
  weekdayOfYmd,
} from './ownerRequests'

// 9:00 AM on 16 Nov 2026 in the Philippines (01:00 UTC).
const now = new Date('2026-11-16T01:00:00.000Z')

function request(overrides: Partial<OwnerCallRequestInput> = {}): OwnerCallRequestInput {
  return {
    full_name: 'Ana Reyes',
    club_name: 'Lagao Smash Courts',
    city: 'General Santos City',
    court_count: 4,
    phone: '0917 555 0101',
    email: '',
    preferred_date: '2026-11-17',
    preferred_time: 'morning',
    message: '',
    ...overrides,
  }
}

describe('owner call request rules', () => {
  it('accepts a complete request with a phone or an email', () => {
    expect(ownerCallProblem(request(), now)).toBeNull()
    expect(ownerCallProblem(request({ phone: '', email: 'ana@example.com' }), now)).toBeNull()
  })

  it('gives the same plain messages as the database, in the same order', () => {
    expect(ownerCallProblem(request({ full_name: ' A ' }), now)).toBe('Enter your name (2 to 80 characters)')
    expect(ownerCallProblem(request({ club_name: '' }), now)).toBe('Enter your club or venue name (2 to 120 characters)')
    expect(ownerCallProblem(request({ city: 'x' }), now)).toBe('Enter the city (2 to 80 characters)')
    expect(ownerCallProblem(request({ court_count: 0 }), now)).toBe('Enter how many courts you have (1 to 50)')
    expect(ownerCallProblem(request({ court_count: Number.NaN }), now)).toBe('Enter how many courts you have (1 to 50)')
    expect(ownerCallProblem(request({ phone: ' ', email: ' ' }), now)).toBe('Give a mobile number or an email so we can reach you')
    expect(ownerCallProblem(request({ phone: 'call me' }), now)).toBe('Enter a mobile number like 0917 123 4567')
    expect(ownerCallProblem(request({ phone: '', email: 'not-an-email' }), now)).toBe('Enter an email like name@example.com')
    expect(ownerCallProblem(request({ message: 'x'.repeat(1001) }), now)).toBe('Keep the message under 1,000 characters')
  })

  it('takes a day from today to 60 days ahead, in Philippine time', () => {
    expect(ownerCallDateRange(now)).toEqual({ min: '2026-11-16', max: '2027-01-15' })
    expect(ownerCallProblem(request({ preferred_date: '2026-11-16' }), now)).toBeNull()
    expect(ownerCallProblem(request({ preferred_date: '2027-01-15' }), now)).toBeNull()
    expect(ownerCallProblem(request({ preferred_date: '2026-11-15' }), now)).toBe('Choose a day from today to 60 days ahead')
    expect(ownerCallProblem(request({ preferred_date: '2027-01-16' }), now)).toBe('Choose a day from today to 60 days ahead')
    expect(ownerCallProblem(request({ preferred_date: '' }), now)).toBe('Choose a day from today to 60 days ahead')
    // Late evening of 15 Nov in UTC is already 16 Nov in the Philippines.
    expect(ownerCallDateRange(new Date('2026-11-15T20:00:00.000Z')).min).toBe('2026-11-16')
  })

  it('only offers morning, afternoon or evening', () => {
    expect(ownerCallProblem(request({ preferred_time: 'midnight' as never }), now)).toBe('Choose morning, afternoon or evening')
    expect(ownerCallTimeLabel('afternoon')).toBe('Afternoon (12 noon to 5 PM)')
  })

  it('stores requests trimmed, with the email in lower case and blanks as null', () => {
    expect(cleanOwnerCallRequest(request({ full_name: ' Ana ', email: ' Ana@Example.COM ', message: '  ' }))).toMatchObject({
      full_name: 'Ana',
      email: 'ana@example.com',
      message: null,
    })
  })

  it('builds month grids Sunday first, the same in any device timezone', () => {
    // November 2026 starts on a Sunday and has 30 days: five full weeks.
    const november = monthWeeks('2026-11')
    expect(november).toHaveLength(5)
    expect(november[0][0]).toBe('2026-11-01')
    expect(november[4]).toEqual(['2026-11-29', '2026-11-30', null, null, null, null, null])
    // December 2026 starts on a Tuesday.
    const december = monthWeeks('2026-12')
    expect(december[0]).toEqual([null, null, '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05'])
    expect(december.flat().filter(Boolean)).toHaveLength(31)
    expect(december.every((week) => week.length === 7)).toBe(true)
    // February in a leap year.
    expect(monthWeeks('2028-02').flat().filter(Boolean)).toHaveLength(29)
    expect(weekdayOfYmd('2026-12-01')).toBe(2)
  })

  it('moves between months and names them', () => {
    expect(monthOfYmd('2026-12-31')).toBe('2026-12')
    expect(addMonthsYm('2026-12', 1)).toBe('2027-01')
    expect(addMonthsYm('2027-01', -1)).toBe('2026-12')
    expect(monthLabel('2027-01')).toBe('January 2027')
    expect(shortMonthOfYmd('2026-12-01')).toBe('Dec')
    expect(daysBetweenYmd('2026-12-31', '2027-01-02')).toBe(2)
    expect(daysBetweenYmd('2026-11-17', '2026-11-16')).toBe(-1)
  })

  it('sums up the chosen call in one plain sentence', () => {
    expect(ownerCallSummary('2026-12-01', 'morning', now)).toBe(
      "We'll call you on Tuesday, December 1, in the morning (8 AM to 12 noon), Philippine time.",
    )
    expect(ownerCallSummary('2026-11-16', 'evening', now)).toBe(
      "We'll call you today, Monday, November 16, in the evening (5 PM to 8 PM), Philippine time.",
    )
    expect(ownerCallSummary('2026-11-17', 'afternoon', now)).toBe(
      "We'll call you tomorrow, Tuesday, November 17, in the afternoon (12 noon to 5 PM), Philippine time.",
    )
  })

  it('matches phone numbers by their digits and labels days plainly', () => {
    expect(phoneDigits('(0917) 555-0101')).toBe(phoneDigits('0917 555 0101'))
    expect(addDaysYmd('2026-12-31', 1)).toBe('2027-01-01')
    expect(callDayLabel('2026-11-17')).toBe('Tuesday, November 17')
  })
})
