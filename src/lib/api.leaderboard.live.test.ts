import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { setActiveClubId } from './clubContext'

const live = vi.hoisted(() => {
  const rpc = vi.fn(async (_name: string, _args?: Record<string, unknown>) => ({
    data: null as unknown,
    error: null as unknown,
  }))
  const getPublicUrl = vi.fn((path: string) => ({
    data: { publicUrl: `https://cdn.example/member-photos/${path}` },
  }))
  const channel = vi.fn((_name: string) => ({
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn((cb?: (status: string) => void) => {
      cb?.('SUBSCRIBED')
      return {}
    }),
    send: vi.fn().mockResolvedValue('ok'),
  }))
  const removeChannel = vi.fn().mockResolvedValue('ok')
  return { rpc, getPublicUrl, channel, removeChannel }
})

vi.mock('./supabase', () => ({
  isDemoMode: false,
  supabase: {
    rpc: live.rpc,
    channel: live.channel,
    removeChannel: live.removeChannel,
    storage: {
      from: () => ({
        getPublicUrl: live.getPublicUrl,
      }),
    },
  },
}))

const sampleMatch = {
  id: 'match-1',
  club_id: 'club-1',
  venue_id: 'venue-1',
  venue_name: 'Main Hall',
  court_id: 'court-1',
  court_name: 'Court A',
  tournament_id: null,
  format: 'singles',
  winner_side: 'a',
  score_a: '11',
  score_b: '7',
  notes: null,
  status: 'completed',
  void_reason: null,
  played_at: '2026-11-25T10:00:00Z',
  created_at: '2026-11-25T10:00:00Z',
  team_a: [{ member_id: 'm1', full_name: 'Mia Member', nickname: 'Mia', photo_path: 'u1/avatar.webp' }],
  team_b: [{ member_id: 'm2', full_name: 'Jonah Cruz', nickname: null, photo_path: null }],
}

beforeEach(() => {
  vi.clearAllMocks()
  setActiveClubId('club-1')
})

describe('club leaderboard (live adapter)', () => {
  it('fetches public leaderboard and converts photo_path to photo_url', async () => {
    live.rpc.mockResolvedValueOnce({
      data: {
        club: { id: 'club-1', slug: 'rally-point-gensan', name: 'Rally Point Gensan' },
        period: 'month',
        format: 'all',
        entries: [{
          rank: '1',
          member_id: 'm1',
          full_name: 'Mia Member',
          nickname: 'Mia',
          photo_path: 'u1/avatar.webp',
          points: '3',
          wins: '1',
          losses: '0',
          games_played: '1',
          win_pct: '100',
          score_diff: '4',
          streak: '1',
        }],
        recent_matches: [sampleMatch],
        total_players: '1',
        total_matches: '1',
      },
      error: null,
    })

    const res = await api.publicClubLeaderboard('rally-point-gensan', 'month', 'all', 20)
    expect(live.rpc).toHaveBeenCalledWith('get_public_club_leaderboard', {
      p_slug: 'rally-point-gensan',
      p_period: 'month',
      p_format: 'all',
      p_limit: 20,
    })
    expect(res?.entries[0]).toMatchObject({
      rank: 1,
      points: 3,
      photo_url: 'https://cdn.example/member-photos/u1/avatar.webp',
    })
    expect(res?.recent_matches[0].team_a[0].photo_url).toBe('https://cdn.example/member-photos/u1/avatar.webp')
    expect(res?.recent_matches[0].score_a).toBe(11)
  })

  it('degrades gracefully when public leaderboard RPC is not deployed yet and throws on real failures', async () => {
    live.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'not found' } })
    await expect(api.publicClubLeaderboard('rally-point-gensan')).resolves.toBeNull()

    live.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'not found' } })
    await expect(api.publicPlayerMatches('rally-point-gensan', 'm1')).resolves.toEqual([])

    live.rpc.mockResolvedValueOnce({ data: null, error: { code: '50000', message: 'db down' } })
    await expect(api.publicClubLeaderboard('rally-point-gensan')).rejects.toMatchObject({ message: 'db down' })
  })

  it('fetches signed-in leaderboard, records/voids matches, and manages scorers', async () => {
    live.rpc.mockResolvedValueOnce({
      data: {
        club: { id: 'club-1', slug: 'rally-point-gensan', name: 'Rally Point Gensan' },
        period: 'all',
        format: 'doubles',
        entries: [],
        recent_matches: [],
        total_players: 0,
        total_matches: 0,
        my_member_id: 'm1',
        my_entry: null,
        can_score: true,
      },
      error: null,
    })
    const board = await api.clubLeaderboard('all', 'doubles', 50)
    expect(board.can_score).toBe(true)
    expect(live.rpc).toHaveBeenCalledWith('get_club_leaderboard', {
      p_period: 'all',
      p_format: 'doubles',
      p_limit: 50,
    })

    live.rpc.mockResolvedValueOnce({ data: sampleMatch, error: null })
    const saved = await api.recordClubMatch({
      format: 'singles',
      team_a: ['m1'],
      team_b: ['m2'],
      winner_side: 'a',
      score_a: 11,
      score_b: 7,
      court_id: 'court-1',
    }, 'rally-point-gensan')
    expect(saved.id).toBe('match-1')
    expect(live.rpc).toHaveBeenCalledWith('staff_record_club_match', {
      p_format: 'singles',
      p_team_a: ['m1'],
      p_team_b: ['m2'],
      p_winner_side: 'a',
      p_score_a: 11,
      p_score_b: 7,
      p_venue_id: null,
      p_court_id: 'court-1',
      p_notes: null,
    })

    live.rpc.mockResolvedValueOnce({ data: null, error: null })
    await api.voidClubMatch('match-1', 'Score typo', 'rally-point-gensan')
    expect(live.rpc).toHaveBeenCalledWith('staff_void_club_match', {
      p_match_id: 'match-1',
      p_reason: 'Score typo',
    })

    live.rpc.mockResolvedValueOnce({
      data: [{ user_id: 'u-staff', full_name: 'Sam Staff', email: 'staff@brinely.info', can_score: true }],
      error: null,
    })
    await expect(api.listLeaderboardScorers()).resolves.toEqual([
      { user_id: 'u-staff', full_name: 'Sam Staff', email: 'staff@brinely.info', can_score: true },
    ])

    live.rpc.mockResolvedValueOnce({ data: null, error: null })
    await api.setLeaderboardScorer('u-staff', false)
    expect(live.rpc).toHaveBeenCalledWith('admin_set_leaderboard_scorer', {
      p_user_id: 'u-staff',
      p_can_score: false,
    })
  })
})
