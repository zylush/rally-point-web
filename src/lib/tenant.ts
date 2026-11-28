import type { Club, Venue } from '../types'

/** The club that sign-ups without a club link join (also used by the live app). */
export const DEFAULT_CLUB_SLUG = 'rally-point-gensan'

// Browser-local demo identities. They never grant access; they only label demo rows.
export const DEMO_CLUB_ID = 'club_rally_point'
export const DEMO_DAVAO_CLUB_ID = 'club_rally_davao'
export const DEMO_VENUE_ID = 'venue_gensan_main'
export const DEMO_DAVAO_VENUE_ID = 'venue_davao_main'

export const demoClub: Club = {
  id: DEMO_CLUB_ID,
  slug: DEFAULT_CLUB_SLUG,
  name: 'Rally Point Gensan',
  default_timezone: 'Asia/Manila',
  is_active: true,
}

export const demoDavaoClub: Club = {
  id: DEMO_DAVAO_CLUB_ID,
  slug: 'rally-point-davao',
  name: 'Rally Point Davao',
  default_timezone: 'Asia/Manila',
  is_active: true,
}

/**
 * Pick a venue only from the already-authorized list (optionally limited to one
 * club). A forged id falls back to the first active venue instead of widening scope.
 */
export function chooseVenueId(venues: Venue[], requestedId?: string | null, clubId?: string | null) {
  const active = venues.filter((venue) => venue.is_active && (!clubId || venue.club_id === clubId))
  if (!active.length) return null
  if (requestedId && active.some((venue) => venue.id === requestedId)) return requestedId
  return active[0].id
}
