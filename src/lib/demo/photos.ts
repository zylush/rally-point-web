import type { CourtPhoto } from '../../types'
import { MAX_COURT_PHOTOS } from '../../types'
import { activeClubId } from './access'
import { uid } from './common'
import type { DemoDB, DemoPhoto } from './model'
import { load, save } from './persistence'

/** Browser storage is small; a full demo gets a clear message instead of a crash. */
function saveWithPhotos(db: DemoDB) {
  try {
    save(db)
  } catch {
    throw new Error('The demo has no room for more photos. Remove some photos first.')
  }
}

function toPhoto(row: DemoPhoto): CourtPhoto {
  return { ...row, path: `demo/${row.id}` }
}

/** Mirrors the court_photos functions: same rules and messages. Photos are data links. */
export const photoOperations = {
  listCourtPhotos(): CourtPhoto[] {
    const db = load()
    const clubId = activeClubId(db)
    return (db.photos ?? [])
      .filter((photo) => photo.club_id === clubId)
      .sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at))
      .map(toPhoto)
  },

  addCourtPhoto(courtId: string, url: string): CourtPhoto {
    const db = load()
    const clubId = activeClubId(db)
    const court = db.courts.find((row) => row.id === courtId && row.club_id === clubId)
    if (!court?.venue_id) throw new Error('court not found')
    const photos = (db.photos ??= [])
    const mine = photos.filter((photo) => photo.court_id === courtId)
    if (mine.length >= MAX_COURT_PHOTOS) throw new Error(`A court can have up to ${MAX_COURT_PHOTOS} photos`)
    const row: DemoPhoto = {
      id: uid('photo'),
      club_id: clubId,
      venue_id: court.venue_id,
      court_id: courtId,
      url,
      position: mine.length ? Math.max(...mine.map((photo) => photo.position)) + 1 : 0,
      created_at: new Date().toISOString(),
    }
    photos.push(row)
    saveWithPhotos(db)
    return toPhoto(row)
  },

  makeMainCourtPhoto(photoId: string): void {
    const db = load()
    const clubId = activeClubId(db)
    const photos = db.photos ?? []
    const photo = photos.find((row) => row.id === photoId && row.club_id === clubId && row.court_id)
    if (!photo) throw new Error('photo not found')
    photo.position = Math.min(...photos.filter((row) => row.court_id === photo.court_id).map((row) => row.position)) - 1
    saveWithPhotos(db)
  },

  removeCourtPhoto(photoId: string): void {
    const db = load()
    const clubId = activeClubId(db)
    const before = db.photos?.length ?? 0
    db.photos = (db.photos ?? []).filter((row) => !(row.id === photoId && row.club_id === clubId && row.court_id))
    if (db.photos.length === before) throw new Error('photo not found')
    save(db)
  },

  /** A null url clears the cover. */
  setVenueCover(venueId: string, url: string | null): void {
    const db = load()
    const clubId = activeClubId(db)
    if (!db.venues.some((venue) => venue.id === venueId && venue.club_id === clubId)) throw new Error('venue not found')
    db.photos = (db.photos ?? []).filter((row) => !(row.venue_id === venueId && row.club_id === clubId && !row.court_id))
    if (url) {
      db.photos.push({
        id: uid('photo'), club_id: clubId, venue_id: venueId, court_id: null, url, position: 0, created_at: new Date().toISOString(),
      })
    }
    saveWithPhotos(db)
  },
}

/** Public page helpers: a location's cover and a court's photos, main photo first. */
export function demoVenueCover(db: DemoDB, venueId: string): string | null {
  return (db.photos ?? []).find((row) => row.venue_id === venueId && !row.court_id)?.url ?? null
}

export function demoCourtPhotos(db: DemoDB, courtId: string): string[] {
  return (db.photos ?? [])
    .filter((row) => row.court_id === courtId)
    .sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at))
    .map((row) => row.url)
}
