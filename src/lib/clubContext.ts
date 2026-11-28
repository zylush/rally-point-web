/**
 * The club this browser tab is working in.
 *
 * It only chooses which club's records the app asks for. The database still
 * checks the caller's role in that club on every request, so a forged or stale
 * value can narrow what someone sees but never widen it.
 */
import type { MyClub } from '../types'
import { DEFAULT_CLUB_SLUG } from './tenant'

export const CLUB_HEADER = 'x-club-id'

/** Fired when the active club stops being available (for example, suspended). */
export const CLUB_UNAVAILABLE_EVENT = 'brinely:club-unavailable'

export function notifyClubUnavailable() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CLUB_UNAVAILABLE_EVENT))
}

let activeClubId: string | null = null

export function getActiveClubId(): string | null {
  return activeClubId
}

export function setActiveClubId(clubId: string | null) {
  activeClubId = clubId
}

export function requireActiveClubId(): string {
  if (!activeClubId) throw new Error('No club is selected. Please sign in again.')
  return activeClubId
}

const memoryKey = (userId: string) => `brinely_last_club:${userId}`

/** Remembers the last club a person used on this device (a convenience only). */
export function rememberClub(userId: string, clubId: string) {
  try {
    localStorage.setItem(memoryKey(userId), clubId)
  } catch {
    // Storage can be unavailable (private mode, blocked site data). Ignore.
  }
}

export function rememberedClub(userId: string): string | null {
  try {
    return localStorage.getItem(memoryKey(userId))
  } catch {
    return null
  }
}

/**
 * The club to show: the one asked for, else the last one used on this device,
 * else the default sign-up club, else the first in the list.
 */
export function chooseActiveClub(clubs: MyClub[], userId: string, preferredId?: string | null): MyClub | null {
  if (!clubs.length) return null
  return (
    clubs.find((club) => club.club_id === preferredId) ??
    clubs.find((club) => club.club_id === rememberedClub(userId)) ??
    clubs.find((club) => club.slug === DEFAULT_CLUB_SLUG) ??
    clubs[0]
  )
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

/** Only PostgREST (database) calls carry the club header; auth calls never do. */
export function isDatabaseRequest(input: RequestInfo | URL): boolean {
  const url = requestUrl(input)
  try {
    return new URL(url).pathname.includes('/rest/v1/')
  } catch {
    return url.includes('/rest/v1/')
  }
}

/**
 * Fetch used by the Supabase client. Adds the active club to database requests
 * unless the request already names a club (public pages set it per request).
 */
export const clubAwareFetch: typeof fetch = (input, init) => {
  const clubId = activeClubId
  if (!clubId || !isDatabaseRequest(input)) return globalThis.fetch(input, init)
  const headers = new Headers(input instanceof Request ? input.headers : undefined)
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value))
  if (!headers.has(CLUB_HEADER)) headers.set(CLUB_HEADER, clubId)
  return globalThis.fetch(input, { ...init, headers })
}
