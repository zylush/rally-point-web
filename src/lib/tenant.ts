import type { Venue } from '../types'

/** The first release is intentionally pinned to one server-owned club. */
export const RALLY_POINT_CLUB_SLUG = 'rally-point-gensan'
export const DEMO_CLUB_ID = 'club_rally_point'
export const DEMO_VENUE_ID = 'venue_gensan_main'
// Stable database identity for the first live club. The browser never chooses
// this value; it is only used to scope fixed-club API queries and RPC inputs.
export const RALLY_POINT_CLUB_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

export const demoClub = {
  id: DEMO_CLUB_ID,
  slug: RALLY_POINT_CLUB_SLUG,
  name: 'Rally Point Club',
  default_timezone: 'Asia/Manila',
  is_active: true,
} as const

export function isRallyPointVenue(venue: Pick<Venue, 'club_id'>) {
  return venue.club_id === DEMO_CLUB_ID
}

/**
 * Pick a venue only from the already-authorized, fixed-club list. A forged id
 * therefore falls back to the first active venue rather than widening scope.
 */
export function chooseVenueId(venues: Venue[], requestedId?: string | null) {
  const active = venues.filter((venue) => venue.is_active && isRallyPointVenue(venue))
  if (!active.length) return null
  if (requestedId && active.some((venue) => venue.id === requestedId)) return requestedId
  return active[0].id
}

export function venueLabel(venues: Venue[], venueId?: string | null) {
  return venues.find((venue) => venue.id === venueId)?.name ?? 'All venues'
}
