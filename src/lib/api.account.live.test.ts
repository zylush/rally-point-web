import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { setActiveClubId } from './clubContext'

const live = vi.hoisted(() => {
  const userId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  const clubId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const rpcResults = new Map<string, { data: unknown; error: unknown }>()
  const upload = vi.fn(async (_path: string, _blob: Blob, _options: unknown) => ({ data: {}, error: null as unknown }))
  const remove = vi.fn(async (paths: string[]) => ({ data: paths.map((name) => ({ name })), error: null }))
  const getPublicUrl = vi.fn((path: string) => ({ data: { publicUrl: `https://cdn.example/member-photos/${path}` } }))
  // What is in the person's folder before an upload: by default only their current photo.
  const list = vi.fn(async (_folder: string, _options?: unknown) => ({ data: [{ name: 'old.webp' }] as { name: string }[], error: null }))
  const storageFrom = vi.fn(() => ({ upload, remove, getPublicUrl, list }))
  const rpc = vi.fn(async (name: string, _args?: unknown) => rpcResults.get(name) ?? { data: null, error: null })
  return { userId, clubId, rpcResults, upload, remove, getPublicUrl, list, storageFrom, rpc }
})

vi.mock('./supabase', () => ({
  isDemoMode: false,
  supabase: { rpc: live.rpc, storage: { from: live.storageFrom } },
}))

// jsdom cannot draw images, so the shrinking step is replaced; its checks are tested separately.
vi.mock('./photos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./photos')>()),
  shrinkPhoto: vi.fn(async () => ({ blob: new Blob(['x'], { type: 'image/webp' }), type: 'image/webp', ext: 'webp' })),
}))

const file = new File(['raw'], 'me.jpg', { type: 'image/jpeg' })
const ownPath = new RegExp(`^${live.userId}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.webp$`)

beforeEach(() => {
  vi.clearAllMocks()
  live.rpcResults.clear()
  setActiveClubId(live.clubId)
})

describe('member account (live)', () => {
  it('saves the name through update_my_account, sending an empty nickname as none', async () => {
    await api.updateMyAccount(live.userId, { full_name: 'Mia Santos', nickname: '  ' })
    expect(live.rpc).toHaveBeenCalledWith('update_my_account', { p_full_name: 'Mia Santos', p_nickname: null })
  })

  it("uploads the photo into the person's own folder, records it, then deletes the photo it replaced", async () => {
    const url = await api.setMyPhoto(live.userId, file, `${live.userId}/old.webp`)

    expect(live.storageFrom).toHaveBeenCalledWith('member-photos')
    const [path, , options] = live.upload.mock.calls[0]
    expect(path).toMatch(ownPath)
    expect(options).toEqual({ contentType: 'image/webp', cacheControl: '86400', upsert: false })
    expect(live.rpc).toHaveBeenCalledWith('set_my_photo', { p_path: path })
    expect(live.remove).toHaveBeenCalledWith([`${live.userId}/old.webp`])
    expect(url).toBe(`https://cdn.example/member-photos/${path}`)
  })

  it('clears leftover files in the folder before uploading, keeping the current photo', async () => {
    live.list.mockResolvedValueOnce({ data: [{ name: 'old.webp' }, { name: 'stray-1.webp' }, { name: 'stray-2.jpg' }], error: null })
    await api.setMyPhoto(live.userId, file, `${live.userId}/old.webp`)
    expect(live.list).toHaveBeenCalledWith(live.userId, { limit: 100 })
    expect(live.remove.mock.calls[0]).toEqual([[`${live.userId}/stray-1.webp`, `${live.userId}/stray-2.jpg`]])
    expect(live.remove.mock.invocationCallOrder[0]).toBeLessThan(live.upload.mock.invocationCallOrder[0])
  })

  it('says plainly when the folder is full', async () => {
    live.upload.mockResolvedValueOnce({ data: {}, error: { message: 'new row violates row-level security policy' } })
    await expect(api.setMyPhoto(live.userId, file, null)).rejects.toThrow('You have too many photo files saved')
    expect(live.rpc).not.toHaveBeenCalledWith('set_my_photo', expect.anything())
  })

  it('removes the new file again when the database refuses it, and keeps the old one', async () => {
    live.rpcResults.set('set_my_photo', { data: null, error: new Error('This photo is not in your folder') })
    await expect(api.setMyPhoto(live.userId, file, `${live.userId}/old.webp`)).rejects.toThrow('This photo is not in your folder')
    const [path] = live.upload.mock.calls[0]
    expect(live.remove).toHaveBeenCalledTimes(1)
    expect(live.remove).toHaveBeenCalledWith([path])
  })

  it('removes the photo without uploading anything', async () => {
    expect(await api.setMyPhoto(live.userId, null, `${live.userId}/old.webp`)).toBeNull()
    expect(live.upload).not.toHaveBeenCalled()
    expect(live.rpc).toHaveBeenCalledWith('set_my_photo', { p_path: null })
    expect(live.remove).toHaveBeenCalledWith([`${live.userId}/old.webp`])
  })
})

describe('QR wallet and membership requests (live)', () => {
  it('reads one pass per club and folds the latest request into it', async () => {
    live.rpcResults.set('list_my_member_passes', {
      data: [
        {
          club_id: 'c1', club_slug: 'one', club_name: 'One', member_id: 'm1', member_code: 'BR-1', full_name: 'Mia',
          membership_type: null, status: 'active', expiry_date: null, is_active_member: false, qr_token: 't1',
          request_id: 'r1', request_status: 'pending', request_decline_reason: null, request_requested_at: '2026-11-24T00:00:00Z', request_decided_at: null,
        },
        {
          club_id: 'c2', club_slug: 'two', club_name: 'Two', member_id: 'm2', member_code: 'BR-2', full_name: 'Mia',
          membership_type: 'standard', status: 'active', expiry_date: '2026-12-24', is_active_member: true, qr_token: 't2',
          request_id: null, request_status: null, request_decline_reason: null, request_requested_at: null, request_decided_at: null,
        },
      ],
      error: null,
    })
    const passes = await api.myMemberPasses(live.userId)
    expect(live.rpc).toHaveBeenCalledWith('list_my_member_passes')
    expect(passes[0]).toMatchObject({ club_id: 'c1', qr_token: 't1', request: { id: 'r1', status: 'pending', decided_at: null } })
    expect(passes[0]).not.toHaveProperty('request_id')
    expect(passes[1].request).toBeNull()
  })

  it('sends requests and decisions to the checked functions', async () => {
    live.rpcResults.set('request_club_membership', { data: 'r9', error: null })
    expect(await api.requestMembership(live.userId, 'c1')).toBe('r9')
    expect(live.rpc).toHaveBeenCalledWith('request_club_membership', { p_club_id: 'c1' })

    await api.cancelMembershipRequest(live.userId, 'r9')
    expect(live.rpc).toHaveBeenCalledWith('cancel_my_membership_request', { p_request_id: 'r9' })

    await api.approveMembershipRequest('r9', { membership_type: 'premium', amount: 2500 }, 'staff-1')
    expect(live.rpc).toHaveBeenCalledWith('staff_approve_membership_request', { p_request_id: 'r9', p_membership_type: 'premium', p_amount: 2500 })

    await api.declineMembershipRequest('r9', 'Not paid', 'staff-1')
    expect(live.rpc).toHaveBeenCalledWith('staff_decline_membership_request', { p_request_id: 'r9', p_reason: 'Not paid' })
  })

  it('turns stored photo paths into links on the staff request list', async () => {
    live.rpcResults.set('staff_list_membership_requests', {
      data: [{ id: 'r1', member_id: 'm1', member_code: 'BR-1', full_name: 'Mia', nickname: 'Mimi', photo_path: `${live.userId}/p.webp`, membership_type: null, member_status: 'active', expiry_date: null, status: 'pending', requested_at: 'now', decided_at: null, decline_reason: null, amount: null }],
      error: null,
    })
    const rows = await api.membershipRequests('pending')
    expect(live.rpc).toHaveBeenCalledWith('staff_list_membership_requests', { p_which: 'pending' })
    expect(rows[0]).toMatchObject({ nickname: 'Mimi', photo_url: `https://cdn.example/member-photos/${live.userId}/p.webp`, amount: null })
    expect(rows[0]).not.toHaveProperty('photo_path')
  })

  it('shows the desk the scanned member’s photo link', async () => {
    live.rpcResults.set('check_in_qr', {
      data: { checkin: { id: 'ci', member_id: 'm1', checked_in_at: 'now' }, member: { id: 'm1', member_code: 'BR-1', full_name: 'Mia', nickname: 'Mimi', photo_path: `${live.userId}/p.webp`, is_active_member: true } },
      error: null,
    })
    const result = await api.checkInByQr('RP1|BR-1|t1', 'staff-1', 'venue-1')
    expect(live.rpc).toHaveBeenCalledWith('check_in_qr', { p_payload: 'RP1|BR-1|t1', p_venue_id: 'venue-1' })
    expect(result.member).toMatchObject({ nickname: 'Mimi', is_active_member: true, photo_url: `https://cdn.example/member-photos/${live.userId}/p.webp` })
    expect(result.member).not.toHaveProperty('photo_path')
  })
})
