import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'

const live = vi.hoisted(() => {
  const rpcResults = new Map<string, { data: unknown; error: unknown }>()
  const rpc = vi.fn(async (name: string, _args?: unknown) => rpcResults.get(name) ?? { data: null, error: null })
  return { rpcResults, rpc }
})

vi.mock('./supabase', () => ({
  isDemoMode: false,
  supabase: { rpc: live.rpc },
}))

beforeEach(() => {
  vi.clearAllMocks()
  live.rpcResults.clear()
})

describe('court owner calls (live)', () => {
  it('sends an owner request with the database parameter names', async () => {
    live.rpcResults.set('request_owner_call', { data: 'request-1', error: null })
    await expect(api.requestOwnerCall({
      full_name: 'Ana Reyes', club_name: 'Lagao Smash Courts', city: 'General Santos City', court_count: 4,
      phone: '0917 555 0101', email: '', preferred_date: '2026-11-17', preferred_time: 'morning', message: '',
    })).resolves.toBe('request-1')
    expect(live.rpc).toHaveBeenCalledWith('request_owner_call', {
      p_full_name: 'Ana Reyes', p_club_name: 'Lagao Smash Courts', p_city: 'General Santos City', p_court_count: 4,
      p_phone: '0917 555 0101', p_email: '', p_preferred_date: '2026-11-17', p_preferred_time: 'morning', p_message: '',
    })
  })

  it('passes the database message through when a request is refused', async () => {
    live.rpcResults.set('request_owner_call', { data: null, error: new Error('You already asked us to call. We will contact you soon.') })
    await expect(api.requestOwnerCall({
      full_name: 'Ana Reyes', club_name: 'Lagao Smash Courts', city: 'General Santos City', court_count: 4,
      phone: '0917 555 0101', email: '', preferred_date: '2026-11-17', preferred_time: 'morning', message: '',
    })).rejects.toThrow('You already asked us to call. We will contact you soon.')
  })

  it('reads requests and changes their status through the platform functions', async () => {
    live.rpcResults.set('platform_owner_call_requests', { data: [{ id: 'r1', court_count: '4', status: 'new' }], error: null })
    const rows = await api.platformOwnerCallRequests()
    expect(rows[0].court_count).toBe(4)
    expect(live.rpc).toHaveBeenCalledWith('platform_owner_call_requests', { p_status: null, p_limit: 200 })
    await api.setOwnerCallStatus('r1', 'called')
    expect(live.rpc).toHaveBeenCalledWith('platform_set_owner_call_status', { p_request_id: 'r1', p_status: 'called' })
  })
})

describe('club owner invites (live)', () => {
  it('reports whether the owner became an admin now or was invited', async () => {
    live.rpcResults.set('platform_invite_club_owner', { data: 'assigned', error: null })
    await expect(api.inviteClubOwner('club-1', 'owner@example.com')).resolves.toBe('assigned')
    live.rpcResults.set('platform_invite_club_owner', { data: 'invited', error: null })
    await expect(api.inviteClubOwner('club-1', 'owner@example.com')).resolves.toBe('invited')
    expect(live.rpc).toHaveBeenCalledWith('platform_invite_club_owner', { p_club_id: 'club-1', p_email: 'owner@example.com' })
    await api.cancelClubOwnerInvite('invite-1')
    expect(live.rpc).toHaveBeenCalledWith('platform_cancel_club_owner_invite', { p_invite_id: 'invite-1' })
  })

  it('never fails a sign-in when the owner check cannot answer', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    live.rpcResults.set('claim_my_owner_clubs', { data: null, error: new Error('function public.claim_my_owner_clubs() does not exist') })
    await expect(api.claimOwnerClubs()).resolves.toEqual([])
    expect(warn).toHaveBeenCalled()
    live.rpcResults.set('claim_my_owner_clubs', { data: [{ club_id: 'club-1', name: 'Cebu Hub', status: 'provisioning' }], error: null })
    await expect(api.claimOwnerClubs()).resolves.toEqual([{ club_id: 'club-1', name: 'Cebu Hub', status: 'provisioning' }])
    warn.mockRestore()
  })
})

describe('before the owner migrations reach a database (live)', () => {
  const missing = { code: 'PGRST202', message: 'Could not find the function' }

  it('keeps "Add admin" working through the older step', async () => {
    live.rpcResults.set('platform_invite_club_owner', { data: null, error: missing })
    live.rpcResults.set('platform_assign_club_admin', { data: 'user-1', error: null })
    await expect(api.inviteClubOwner('club-1', 'owner@example.com')).resolves.toBe('assigned')
    expect(live.rpc).toHaveBeenCalledWith('platform_assign_club_admin', { p_club_id: 'club-1', p_email: 'owner@example.com' })
  })

  it('shows no invites and a plain message on the owner form', async () => {
    live.rpcResults.set('platform_club_owner_invites', { data: null, error: missing })
    await expect(api.clubOwnerInvites('club-1')).resolves.toEqual([])
    live.rpcResults.set('request_owner_call', { data: null, error: missing })
    await expect(api.requestOwnerCall({
      full_name: 'Ana Reyes', club_name: 'Lagao Smash Courts', city: 'General Santos City', court_count: 4,
      phone: '0917 555 0101', email: '', preferred_date: '2026-11-17', preferred_time: 'morning', message: '',
    })).rejects.toThrow('We cannot take requests yet. Please try again later.')
  })
})
