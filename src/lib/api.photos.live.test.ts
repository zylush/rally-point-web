import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { setActiveClubId } from './clubContext'

const live = vi.hoisted(() => {
  const clubId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const courtId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad'
  const venueId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac'
  const rpcResults = new Map<string, { data: unknown; error: unknown }>()
  const upload = vi.fn(async (_path: string, _blob: Blob, _options: unknown) => ({ data: {}, error: null as unknown }))
  const remove = vi.fn(async (_paths: string[]) => ({ data: [], error: null }))
  const getPublicUrl = vi.fn((path: string) => ({ data: { publicUrl: `https://cdn.example/court-photos/${path}` } }))
  const storageFrom = vi.fn(() => ({ upload, remove, getPublicUrl }))
  const rpc = vi.fn(async (name: string) => rpcResults.get(name) ?? { data: null, error: null })
  const queryCalls: unknown[][] = []
  const from = vi.fn((table: string) => {
    const query = {
      select: (...args: unknown[]) => { queryCalls.push([table, 'select', ...args]); return query },
      eq: (...args: unknown[]) => { queryCalls.push([table, 'eq', ...args]); return query },
      order: (...args: unknown[]) => { queryCalls.push([table, 'order', ...args]); return query },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({
        data: [{ id: 'photo-1', club_id: clubId, venue_id: venueId, court_id: courtId, path: `${clubId}/courts/${courtId}/x.webp`, position: 0, created_at: '2026-10-23T00:00:00Z' }],
        error: null,
      }).then(resolve),
    }
    return query
  })
  return { clubId, courtId, venueId, rpcResults, upload, remove, getPublicUrl, storageFrom, rpc, from, queryCalls }
})

vi.mock('./supabase', () => ({
  isDemoMode: false,
  supabase: { rpc: live.rpc, from: live.from, storage: { from: live.storageFrom } },
}))

// jsdom cannot draw images, so the shrinking step is replaced; its checks are tested separately.
vi.mock('./photos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./photos')>()),
  shrinkPhoto: vi.fn(async () => ({ blob: new Blob(['x'], { type: 'image/webp' }), type: 'image/webp', ext: 'webp' })),
}))

const file = new File(['raw'], 'court.jpg', { type: 'image/jpeg' })
const uuidPath = (kind: string, id: string) =>
  new RegExp(`^${live.clubId}/${kind}/${id}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.webp$`)

beforeEach(() => {
  vi.clearAllMocks()
  live.rpcResults.clear()
  live.queryCalls.length = 0
  setActiveClubId(live.clubId)
})

describe('court photos (live)', () => {
  it("uploads into the court's folder without overwriting, then records the photo", async () => {
    live.rpcResults.set('admin_add_court_photo', {
      data: { id: 'photo-new', club_id: live.clubId, venue_id: live.venueId, court_id: live.courtId, path: 'stored/path.webp', position: 0, created_at: 'now' },
      error: null,
    })
    const photo = await api.addCourtPhoto(live.courtId, file)

    expect(live.storageFrom).toHaveBeenCalledWith('court-photos')
    const [path, , options] = live.upload.mock.calls[0]
    expect(path).toMatch(uuidPath('courts', live.courtId))
    expect(options).toEqual({ contentType: 'image/webp', cacheControl: '31536000', upsert: false })
    expect(live.rpc).toHaveBeenCalledWith('admin_add_court_photo', { p_court_id: live.courtId, p_path: path })
    expect(photo.url).toBe('https://cdn.example/court-photos/stored/path.webp')
  })

  it('deletes the uploaded file again when the database refuses the photo', async () => {
    live.rpcResults.set('admin_add_court_photo', { data: null, error: new Error('A court can have up to 8 photos') })
    await expect(api.addCourtPhoto(live.courtId, file)).rejects.toThrow('A court can have up to 8 photos')
    const [path] = live.upload.mock.calls[0]
    expect(live.remove).toHaveBeenCalledWith([path])
  })

  it('reports a failed upload and does not record anything', async () => {
    live.upload.mockResolvedValueOnce({ data: {}, error: { message: 'new row violates row-level security policy' } })
    await expect(api.addCourtPhoto(live.courtId, file)).rejects.toThrow('The photo could not be uploaded: new row violates row-level security policy')
    expect(live.rpc).not.toHaveBeenCalled()
  })

  it('removes a photo record, then its file', async () => {
    live.rpcResults.set('admin_remove_court_photo', { data: 'old/path.webp', error: null })
    await api.removeCourtPhoto('photo-1')
    expect(live.rpc).toHaveBeenCalledWith('admin_remove_court_photo', { p_photo_id: 'photo-1' })
    expect(live.remove).toHaveBeenCalledWith(['old/path.webp'])
  })

  it('replaces a location cover and deletes the old file; null clears it', async () => {
    live.rpcResults.set('admin_set_venue_cover', { data: 'old/cover.webp', error: null })
    await api.setVenueCover(live.venueId, file)
    const [path] = live.upload.mock.calls[0]
    expect(path).toMatch(uuidPath('venues', live.venueId))
    expect(live.rpc).toHaveBeenCalledWith('admin_set_venue_cover', { p_venue_id: live.venueId, p_path: path })
    expect(live.remove).toHaveBeenCalledWith(['old/cover.webp'])

    vi.clearAllMocks()
    await api.setVenueCover(live.venueId, null)
    expect(live.upload).not.toHaveBeenCalled()
    expect(live.rpc).toHaveBeenCalledWith('admin_set_venue_cover', { p_venue_id: live.venueId, p_path: null })
  })

  it("lists only the active club's photos, with public links", async () => {
    const [photo] = await api.listCourtPhotos()
    expect(live.queryCalls).toContainEqual(['court_photos', 'eq', 'club_id', live.clubId])
    expect(photo.url).toBe(`https://cdn.example/court-photos/${live.clubId}/courts/${live.courtId}/x.webp`)
  })
})

describe('public pages with photos (live)', () => {
  const listing = { slug: 'rally-point-gensan', name: 'Rally Point Gensan', city: null, address: null, cities: [], venue_count: '1', court_count: '1', min_rate: '500', min_member_rate: null }

  it('adds each club cover to the list', async () => {
    live.rpcResults.set('list_public_clubs', { data: [listing], error: null })
    live.rpcResults.set('list_public_club_covers', { data: [{ slug: 'rally-point-gensan', cover_photo: 'g/cover.webp' }], error: null })
    const [club] = await api.listPublicClubs()
    expect(club).toMatchObject({ slug: 'rally-point-gensan', court_count: 1, min_rate: 500, cover_photo: 'https://cdn.example/court-photos/g/cover.webp' })
  })

  it('still lists clubs, with sample pictures, when covers cannot load', async () => {
    live.rpcResults.set('list_public_clubs', { data: [listing], error: null })
    live.rpcResults.set('list_public_club_covers', { data: null, error: new Error('function does not exist') })
    const [club] = await api.listPublicClubs()
    expect(club.cover_photo).toBeNull()
  })

  it('turns stored photo paths on the club page into public links', async () => {
    live.rpcResults.set('get_public_club_detail', {
      data: {
        slug: 'rally-point-gensan', name: 'Rally Point Gensan', city: null, address: null,
        venues: [{
          id: live.venueId, name: 'Main', open_hour: 0, close_hour: 24, address: null, city: null, latitude: null, longitude: null,
          cover_photo: 'v/cover.webp',
          courts: [
            { id: live.courtId, name: 'Court A', hourly_rate: '500', member_rate: null, in_service: true, photos: ['c/1.webp', 'c/2.webp'] },
            // A database without the photo update sends no photo fields at all.
            { id: 'court-b', name: 'Court B', hourly_rate: '500', member_rate: null, in_service: true },
          ],
        }],
      },
      error: null,
    })
    const detail = await api.publicClubDetail('rally-point-gensan')
    const venue = detail!.venues[0]
    expect(venue.cover_photo).toBe('https://cdn.example/court-photos/v/cover.webp')
    expect(venue.courts[0].photos).toEqual(['https://cdn.example/court-photos/c/1.webp', 'https://cdn.example/court-photos/c/2.webp'])
    expect(venue.courts[1].photos).toEqual([])
  })
})
