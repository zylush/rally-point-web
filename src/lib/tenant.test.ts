import { describe, expect, it } from 'vitest'
import type { Venue } from '../types'
import {
  DEFAULT_CLUB_SLUG,
  DEMO_CLUB_ID,
  DEMO_DAVAO_CLUB_ID,
  chooseVenueId,
  demoClub,
  demoDavaoClub,
} from './tenant'

const venue = (id: string, club_id: string, is_active = true): Venue => ({
  id,
  club_id,
  slug: id,
  name: id,
  timezone: 'Asia/Manila',
  open_hour: 6,
  close_hour: 22,
  is_active,
})

const venues: Venue[] = [
  venue('venue-gensan', DEMO_CLUB_ID),
  venue('venue-second', DEMO_CLUB_ID),
  venue('venue-davao', DEMO_DAVAO_CLUB_ID),
]

describe('tenant identities', () => {
  it('names the default sign-up club and two separate demo clubs', () => {
    expect(DEFAULT_CLUB_SLUG).toBe('rally-point-gensan')
    expect(demoClub).toMatchObject({ id: DEMO_CLUB_ID, slug: DEFAULT_CLUB_SLUG, name: 'Rally Point Gensan', is_active: true })
    expect(demoDavaoClub).toMatchObject({ id: DEMO_DAVAO_CLUB_ID, slug: 'rally-point-davao', name: 'Rally Point Davao', is_active: true })
    expect(DEMO_DAVAO_CLUB_ID).not.toBe(DEMO_CLUB_ID)
  })
})

describe('venue choice', () => {
  it('keeps a requested venue inside the accessible list', () => {
    expect(chooseVenueId(venues, 'venue-second')).toBe('venue-second')
    expect(chooseVenueId(venues, 'forged-venue')).toBe('venue-gensan')
  })

  it('limits the choice to one club when a club is named', () => {
    expect(chooseVenueId(venues, 'venue-davao', DEMO_CLUB_ID)).toBe('venue-gensan')
    expect(chooseVenueId(venues, 'venue-davao', DEMO_DAVAO_CLUB_ID)).toBe('venue-davao')
    expect(chooseVenueId(venues, 'venue-gensan', DEMO_DAVAO_CLUB_ID)).toBe('venue-davao')
  })

  it('returns no venue when the caller has no active venue access', () => {
    expect(chooseVenueId(venues.map((row) => ({ ...row, is_active: false })), 'venue-gensan')).toBeNull()
    expect(chooseVenueId(venues, null, 'club-without-venues')).toBeNull()
  })
})
