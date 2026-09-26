import { describe, expect, it } from 'vitest'
import type { Venue } from '../types'
import {
  DEMO_CLUB_ID,
  RALLY_POINT_CLUB_SLUG,
  chooseVenueId,
  isRallyPointVenue,
} from './tenant'

const venues: Venue[] = [
  {
    id: 'venue-gensan',
    club_id: DEMO_CLUB_ID,
    slug: 'gensan-main',
    name: 'Rally Point Gensan',
    timezone: 'Asia/Manila',
    open_hour: 6,
    close_hour: 22,
    is_active: true,
  },
  {
    id: 'venue-second',
    club_id: DEMO_CLUB_ID,
    slug: 'lagao',
    name: 'Rally Point Lagao',
    timezone: 'Asia/Manila',
    open_hour: 6,
    close_hour: 22,
    is_active: true,
  },
  {
    id: 'venue-other-club',
    club_id: 'other-club',
    slug: 'other',
    name: 'Other Club',
    timezone: 'Asia/Manila',
    open_hour: 6,
    close_hour: 22,
    is_active: true,
  },
]

describe('fixed Rally Point tenant context', () => {
  it('uses the stable club identity rather than a browser-supplied club id', () => {
    expect(RALLY_POINT_CLUB_SLUG).toBe('rally-point-gensan')
    expect(DEMO_CLUB_ID).toBe('club_rally_point')
    expect(isRallyPointVenue(venues[0])).toBe(true)
    expect(isRallyPointVenue(venues[2])).toBe(false)
  })

  it('keeps a requested venue inside the accessible fixed-club list', () => {
    expect(chooseVenueId(venues, 'venue-second')).toBe('venue-second')
    expect(chooseVenueId(venues, 'venue-other-club')).toBe('venue-gensan')
    expect(chooseVenueId(venues, 'forged-venue')).toBe('venue-gensan')
  })

  it('returns no venue when the caller has no active venue access', () => {
    expect(chooseVenueId(venues.map((venue) => ({ ...venue, is_active: false })), 'venue-gensan')).toBeNull()
  })
})
