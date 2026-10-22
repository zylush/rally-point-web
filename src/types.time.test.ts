import { describe, expect, it } from 'vitest'
import { appHour, fmtDateTime, hourLabel, localRangeISO, openingHoursLabel, ymdLocal } from './types'

// These hold whatever timezone the test machine uses: the app always means Philippine time (UTC+8).
describe('Philippine time helpers', () => {
  it('turns a date and hour into the right instant, including just before midnight', () => {
    expect(localRangeISO('2026-10-22', 9, 1)).toEqual({
      start_at: '2026-10-22T01:00:00.000Z',
      end_at: '2026-10-22T02:00:00.000Z',
    })
    expect(localRangeISO('2026-10-22', 0, 1).start_at).toBe('2026-10-21T16:00:00.000Z')
    expect(localRangeISO('2026-10-22', 23, 1).end_at).toBe('2026-10-22T16:00:00.000Z')
  })

  it('reads the Philippine date and hour of an instant', () => {
    expect(ymdLocal(new Date('2026-10-21T16:30:00.000Z'))).toBe('2026-10-22')
    expect(ymdLocal(new Date('2026-10-21T15:59:00.000Z'))).toBe('2026-10-21')
    expect(appHour('2026-10-21T16:30:00.000Z')).toBe(0)
    expect(appHour('2026-10-22T15:00:00.000Z')).toBe(23)
  })

  it('labels every hour of the day', () => {
    expect([0, 6, 12, 13, 23, 24].map(hourLabel)).toEqual([
      '12:00 AM', '6:00 AM', '12:00 PM', '1:00 PM', '11:00 PM', '12:00 AM',
    ])
    expect(openingHoursLabel(0, 24)).toBe('Open 24 hours')
    expect(openingHoursLabel(6, 22)).toBe('Open 6:00 AM to 10:00 PM')
  })

  it('formats instants in Philippine time', () => {
    expect(fmtDateTime('2026-10-21T16:30:00.000Z')).toBe('Oct 22, 2026 · 12:30 AM')
  })
})
