import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { setActiveClubId } from './clubContext'
import { emptyClubProfile } from './clubProfile'

// The live branch of the club profile methods, with Supabase replaced by a small fake.
const live = vi.hoisted(() => {
  const clubId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const tables = new Map<string, unknown[]>()
  const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({ data: null as unknown, error: null as unknown }))
  const upload = vi.fn(async (_path: string, _blob: Blob, _options: unknown) => ({ data: {}, error: null as unknown }))
  // Like Storage: a delete answers with the files it deleted (an empty list when refused).
  const remove = vi.fn(async (paths: string[]) => ({ data: paths.map((name) => ({ name })) as { name: string }[], error: null as unknown }))
  const exists = vi.fn(async (_path: string) => ({ data: false, error: null as unknown }))
  const getPublicUrl = vi.fn((path: string) => ({ data: { publicUrl: `https://cdn.example/court-photos/${path}` } }))
  const from = vi.fn((table: string) => {
    const query: Record<string, unknown> = {
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: tables.get(table) ?? [], error: null }).then(resolve),
    }
    for (const method of ['select', 'eq', 'in', 'lt', 'gt', 'order']) query[method] = () => query
    return query
  })
  return { clubId, tables, rpc, upload, remove, exists, getPublicUrl, from }
})

vi.mock('./supabase', () => ({
  isDemoMode: false,
  supabase: {
    rpc: live.rpc,
    from: live.from,
    storage: { from: () => ({ upload: live.upload, remove: live.remove, exists: live.exists, getPublicUrl: live.getPublicUrl }) },
  },
}))

// jsdom cannot draw images, so the shrinking step is replaced; its checks are tested separately.
vi.mock('./photos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./photos')>()),
  shrinkPhoto: vi.fn(async () => ({ blob: new Blob(['x'], { type: 'image/webp' }), type: 'image/webp', ext: 'webp' })),
}))

const qr = new File(['raw'], 'qr.png', { type: 'image/png' })
const oldPath = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/payment/eeeeeeee-eeee-4eee-8eee-000000000001.webp'

beforeEach(() => {
  vi.clearAllMocks()
  live.tables.clear()
  live.rpc.mockImplementation(async () => ({ data: null, error: null }))
  live.remove.mockImplementation(async (paths) => ({ data: paths.map((name) => ({ name })), error: null }))
  live.exists.mockImplementation(async () => ({ data: false, error: null }))
  setActiveClubId(live.clubId)
})

describe('club profile (live)', () => {
  it('sends tidied text, since the database trims spaces only', async () => {
    await api.updateClubProfile({
      ...emptyClubProfile(),
      website_url: 'https://brinely.info\n',
      house_rules: '\n\t',
      amenities: ['parking', 'night_lights', 'parking'],
    })
    expect(live.rpc).toHaveBeenCalledWith('admin_update_club_profile', expect.objectContaining({
      p_website_url: 'https://brinely.info',
      p_house_rules: null,
      p_amenities: ['night_lights', 'parking'],
    }))
  })

  it('trims add-on, coach and payment method names', async () => {
    live.rpc.mockImplementation(async () => ({ data: { id: 'x', price: 0, hourly_rate: null, qr_path: null, photo_path: null }, error: null }))
    await api.upsertClubAddon({ name: ' Paddle rental\t', description: null, price: 100, unit: 'per_hour', is_active: true })
    await api.upsertClubCoach({ full_name: ' Ana ', headline: null, bio: null, hourly_rate: null, contact_phone: null, contact_url: null, is_active: true })
    await api.upsertClubPaymentMethod({ label: 'GCash ', account_name: null, account_number: null, is_active: true })
    expect(live.rpc).toHaveBeenCalledWith('admin_upsert_club_addon', expect.objectContaining({ p_name: 'Paddle rental' }))
    expect(live.rpc).toHaveBeenCalledWith('admin_upsert_club_coach', expect.objectContaining({ p_full_name: 'Ana' }))
    expect(live.rpc).toHaveBeenCalledWith('admin_upsert_club_payment_method', expect.objectContaining({ p_label: 'GCash' }))
  })

  it('deletes the replaced QR code file', async () => {
    live.rpc.mockImplementation(async () => ({ data: oldPath, error: null }))
    await expect(api.setClubPaymentQr('method-1', qr)).resolves.toEqual({ fileLeftBehind: false })
    const [, args] = live.rpc.mock.calls[0]
    expect(args.p_path).toMatch(new RegExp(`^${live.clubId}/payment/[0-9a-f-]{36}\\.webp$`))
    expect(live.remove).toHaveBeenCalledWith([oldPath])
  })

  it('never deletes the picture now in use, even if the database hands it back', async () => {
    live.rpc.mockImplementation(async (_name, args) => ({ data: args.p_path, error: null }))
    await expect(api.setClubPaymentQr('method-1', qr)).resolves.toEqual({ fileLeftBehind: false })
    expect(live.remove).not.toHaveBeenCalled()
  })

  it('says so when an old picture file could not be deleted', async () => {
    live.rpc.mockImplementation(async () => ({ data: oldPath, error: null }))
    live.exists.mockImplementation(async () => ({ data: true, error: null }))
    // A refused delete: Storage answers with an empty list and no error.
    live.remove.mockImplementation(async () => ({ data: [], error: null }))
    await expect(api.removeClubPhoto('photo-1')).resolves.toEqual({ fileLeftBehind: true })
    // A failed delete, reported in the result rather than thrown.
    live.remove.mockImplementation(async () => ({ data: [], error: { message: 'Internal error' } }))
    await expect(api.removeClubPaymentMethod('method-1')).resolves.toEqual({ fileLeftBehind: true })
    await expect(api.removeClubCoach('coach-1')).resolves.toEqual({ fileLeftBehind: true })
    expect(live.exists).toHaveBeenCalledWith(oldPath)
  })

  it('does not raise a false alarm when the old file was already gone', async () => {
    live.rpc.mockImplementation(async () => ({ data: oldPath, error: null }))
    live.remove.mockImplementation(async () => ({ data: [], error: null }))
    await expect(api.removeClubPhoto('photo-1')).resolves.toEqual({ fileLeftBehind: false })
  })

  it('deletes only the unused files the database lists, and counts any left', async () => {
    const unused = [`${live.clubId}/gallery/a.webp`, `${live.clubId}/payment/b.webp`]
    live.rpc.mockImplementation(async (name) => ({ data: name === 'admin_unused_club_pictures' ? unused : null, error: null }))
    live.remove.mockImplementation(async () => ({ data: [{ name: unused[0] }], error: null }))
    live.exists.mockImplementation(async (path) => ({ data: path === unused[1], error: null }))

    await expect(api.unusedClubPictures()).resolves.toEqual(unused)
    await expect(api.deleteUnusedClubPictures()).resolves.toEqual({ deleted: 1, left: 1, more: false })
    expect(live.remove).toHaveBeenCalledWith(unused)
  })

  it('removes the new upload when the save is refused', async () => {
    live.rpc.mockImplementation(async () => ({ data: null, error: { message: 'payment method not found' } }))
    await expect(api.setClubPaymentQr('method-1', qr)).rejects.toMatchObject({ message: 'payment method not found' })
    const uploaded = live.upload.mock.calls[0][0]
    expect(live.remove).toHaveBeenCalledWith([uploaded])
  })
})

describe('court availability (live)', () => {
  const court = (id: string, venueId: string) => ({ id, club_id: live.clubId, venue_id: venueId, name: id, status: 'available', hourly_rate: 500 })

  it("follows each venue's hours, and offers nothing for a venue it cannot read", async () => {
    live.tables.set('courts', [court('court-a', 'venue-open'), court('court-b', 'venue-hidden')])
    live.tables.set('venues', [{ id: 'venue-open', open_hour: 6, close_hour: 22 }])
    live.tables.set('public_schedule', [])

    const days = await api.availability('2099-01-01')
    const byCourt = new Map(days.map((day) => [day.court.id, day.slots]))
    expect(byCourt.get('court-a')?.map((slot) => slot.startHour)).toEqual(Array.from({ length: 16 }, (_, i) => i + 6))
    expect(byCourt.get('court-b')).toEqual([])
  })

  it('says why an hour cannot be booked: taken, out of service, or already over', async () => {
    live.tables.set('courts', [court('court-a', 'venue-open'), { ...court('court-m', 'venue-open'), status: 'maintenance' }])
    live.tables.set('venues', [{ id: 'venue-open', open_hour: 6, close_hour: 22 }])
    // 10 AM to noon, Philippine time, on court A.
    live.tables.set('public_schedule', [{ court_id: 'court-a', start_at: '2099-01-01T02:00:00.000Z', end_at: '2099-01-01T04:00:00.000Z' }])

    const byCourt = new Map((await api.availability('2099-01-01')).map((day) => [day.court.id, day.slots]))
    const courtA = byCourt.get('court-a') ?? []
    expect(courtA.filter((slot) => slot.blocked === 'booked').map((slot) => slot.startHour)).toEqual([10, 11])
    expect(courtA.find((slot) => slot.startHour === 12)).toEqual({ startHour: 12, label: '12:00 PM', available: true })
    expect(byCourt.get('court-m')?.every((slot) => !slot.available && slot.blocked === 'out_of_service')).toBe(true)

    live.tables.set('public_schedule', [])
    const pastA = (await api.availability('2000-01-01')).find((day) => day.court.id === 'court-a')
    expect(pastA?.slots.length).toBe(16)
    expect(pastA?.slots.every((slot) => !slot.available && slot.blocked === 'passed')).toBe(true)
  })
})
