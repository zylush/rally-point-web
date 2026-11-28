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

const sampleSummary = {
  id: 'tour-1',
  club_id: 'club-1',
  venue_id: 'v-1',
  venue_name: 'Main Hall',
  title: 'Sunday Doubles',
  format: 'single_elimination',
  team_size: '2',
  status: 'live',
  counts_for_leaderboard: true,
  scheduled_at: null,
  notes: null,
  started_at: '2026-11-26T00:00:00Z',
  completed_at: null,
  created_at: '2026-11-26T00:00:00Z',
  player_count: '4',
  team_count: '2',
  active_matches: '1',
  completed_matches: '0',
  total_matches: '1',
  champion_label: null,
}

const sampleDetail = {
  club: { id: 'club-1', slug: 'rally-point-gensan', name: 'Rally Point Gensan' },
  tournament: sampleSummary,
  players: [{ member_id: 'm1', full_name: 'Mia Member', nickname: 'Mia', photo_path: 'u1/a.webp' }],
  teams: [{
    id: 'team-1',
    seed: '1',
    name: 'Mia / Jonah',
    players: [{ member_id: 'm1', full_name: 'Mia Member', nickname: 'Mia', photo_path: 'u1/a.webp' }],
  }],
  matches: [{
    id: 'tm-1',
    tournament_id: 'tour-1',
    round_number: '1',
    match_order: '1',
    round_label: 'Finals',
    court_id: 'c-1',
    court_name: 'Court A',
    team_a_id: 'team-1',
    team_b_id: 'team-2',
    team_a_name: 'Mia / Jonah',
    team_b_name: 'Kyla / Paolo',
    team_a_seed: '1',
    team_b_seed: '2',
    team_a_players: [{ member_id: 'm1', full_name: 'Mia Member', nickname: 'Mia', photo_path: 'u1/a.webp' }],
    team_b_players: [{ member_id: 'm2', full_name: 'Jonah Cruz', nickname: null, photo_path: null }],
    status: 'ready',
    winner_side: null,
    score_a: null,
    score_b: null,
    next_match_id: null,
    next_match_side: null,
    club_match_id: null,
    completed_at: null,
    created_at: '2026-11-26T00:00:00Z',
  }],
  standings: [{
    rank: '1',
    member_id: 'm1',
    full_name: 'Mia Member',
    nickname: 'Mia',
    photo_path: 'u1/a.webp',
    points: '0',
    wins: '0',
    losses: '0',
    games_played: '0',
    win_pct: '0',
    score_diff: '0',
    streak: '0',
  }],
  scorers: [],
  can_score: true,
  can_manage: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  setActiveClubId('club-1')
})

describe('club tournaments (live adapter)', () => {
  it('fetches public tournament list & detail and normalizes photo_url and numbers', async () => {
    live.rpc.mockResolvedValueOnce({ data: [sampleSummary], error: null })
    const list = await api.listPublicClubTournaments('rally-point-gensan', 10)
    expect(live.rpc).toHaveBeenCalledWith('list_public_club_tournaments', { p_slug: 'rally-point-gensan', p_limit: 10 })
    expect(list?.[0]).toMatchObject({ team_size: 2, player_count: 4, team_count: 2 })

    live.rpc.mockResolvedValueOnce({ data: sampleDetail, error: null })
    const detail = await api.publicTournament('rally-point-gensan', 'tour-1')
    expect(live.rpc).toHaveBeenCalledWith('get_public_tournament', { p_slug: 'rally-point-gensan', p_tournament_id: 'tour-1' })
    expect(detail?.players[0].photo_url).toBe('https://cdn.example/member-photos/u1/a.webp')
    expect(detail?.matches[0].round_number).toBe(1)

    // Missing function degrades gracefully
    live.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'not found' } })
    await expect(api.listPublicClubTournaments('rally-point-gensan')).resolves.toEqual([])
    live.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'not found' } })
    await expect(api.publicTournament('rally-point-gensan', 'tour-1')).resolves.toBeNull()
  })

  it('calls admin & scorer tournament RPCs with exact parameter names and emits live pulse', async () => {
    live.rpc.mockResolvedValue({ data: sampleDetail, error: null })

    await api.createTournament({
      title: 'Sunday Doubles',
      format: 'single_elimination',
      team_size: 2,
      player_ids: ['m1', 'm2', 'm3', 'm4'],
    }, 'rally-point-gensan')
    expect(live.rpc).toHaveBeenCalledWith('admin_create_tournament', expect.objectContaining({
      p_title: 'Sunday Doubles',
      p_format: 'single_elimination',
      p_team_size: 2,
      p_counts_for_leaderboard: true,
      p_player_ids: ['m1', 'm2', 'm3', 'm4'],
    }))

    await api.setTournamentPlayers('tour-1', ['m1', 'm2'], 'rally-point-gensan')
    expect(live.rpc).toHaveBeenCalledWith('admin_set_tournament_players', { p_tournament_id: 'tour-1', p_player_ids: ['m1', 'm2'] })

    await api.generateTournamentDraw('tour-1', 'rally-point-gensan')
    expect(live.rpc).toHaveBeenCalledWith('admin_generate_tournament_draw', { p_tournament_id: 'tour-1' })

    await api.startTournament('tour-1', 'rally-point-gensan')
    expect(live.rpc).toHaveBeenCalledWith('admin_start_tournament', { p_tournament_id: 'tour-1' })

    live.rpc.mockResolvedValueOnce({ data: null, error: null })
    await api.setTournamentScorer('tour-1', 'u-staff', true, 'rally-point-gensan')
    expect(live.rpc).toHaveBeenCalledWith('admin_set_tournament_scorer', {
      p_tournament_id: 'tour-1',
      p_user_id: 'u-staff',
      p_can_score: true,
    })

    await api.drawTournamentQueueMatch('tour-1', 'c-1', 'rally-point-gensan')
    expect(live.rpc).toHaveBeenCalledWith('staff_draw_tournament_queue_match', { p_tournament_id: 'tour-1', p_court_id: 'c-1' })

    await api.assignTournamentMatchCourt('tour-1', 'tm-1', 'c-1', 'rally-point-gensan')
    expect(live.rpc).toHaveBeenCalledWith('staff_assign_tournament_match_court', {
      p_tournament_id: 'tour-1',
      p_match_id: 'tm-1',
      p_court_id: 'c-1',
    })

    await api.cancelTournamentQueueMatch('tour-1', 'tm-1', 'rally-point-gensan')
    expect(live.rpc).toHaveBeenCalledWith('staff_cancel_tournament_queue_match', { p_tournament_id: 'tour-1', p_match_id: 'tm-1' })

    await api.scoreTournamentMatch({
      tournament_id: 'tour-1',
      match_id: 'tm-1',
      winner_side: 'a',
      score_a: 11,
      score_b: 7,
      court_id: 'c-1',
    }, 'rally-point-gensan')
    expect(live.rpc).toHaveBeenCalledWith('staff_score_tournament_match', {
      p_tournament_id: 'tour-1',
      p_match_id: 'tm-1',
      p_winner_side: 'a',
      p_score_a: 11,
      p_score_b: 7,
      p_court_id: 'c-1',
    })

    await api.completeTournament('tour-1', 'rally-point-gensan')
    expect(live.rpc).toHaveBeenCalledWith('admin_complete_tournament', { p_tournament_id: 'tour-1' })

    await api.cancelTournament('tour-1', 'rally-point-gensan')
    expect(live.rpc).toHaveBeenCalledWith('admin_cancel_tournament', { p_tournament_id: 'tour-1' })

    expect(live.channel).toHaveBeenCalledWith('club-live:club-1')
    expect(live.channel).toHaveBeenCalledWith('club-live:rally-point-gensan')
  })
})

describe('tournaments across clubs (live adapter)', () => {
  beforeEach(() => {
    live.rpc.mockReset()
  })

  it('asks list_public_tournaments for every club and keeps each club', async () => {
    live.rpc.mockResolvedValueOnce({
      data: [
        { ...sampleSummary, club: { slug: 'rally-point-gensan', name: 'Rally Point Gensan', city: 'General Santos' } },
        { ...sampleSummary, id: 'tour-2', club: { slug: 'second-club', name: 'Second Club' } },
        { ...sampleSummary, id: 'tour-broken', club: null },
      ],
      error: null,
    })
    const rows = await api.listPublicTournaments('live', 12)
    expect(live.rpc).toHaveBeenCalledWith('list_public_tournaments', { p_status: 'live', p_limit: 12 })
    expect(rows.map((row) => row.id)).toEqual(['tour-1', 'tour-2'])
    expect(rows[0].club).toEqual({ slug: 'rally-point-gensan', name: 'Rally Point Gensan', city: 'General Santos' })
    expect(rows[1].club).toEqual({ slug: 'second-club', name: 'Second Club', city: null })
    expect(rows[0].team_size).toBe(2)
    expect(rows[0].player_count).toBe(4)
  })

  it('returns an empty list until the function is on the server, and raises other errors', async () => {
    live.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'not found' } })
    await expect(api.listPublicTournaments()).resolves.toEqual([])
    expect(live.rpc).toHaveBeenLastCalledWith('list_public_tournaments', { p_status: null, p_limit: 30 })
    live.rpc.mockResolvedValueOnce({ data: null, error: { code: '22023', message: 'Unknown tournament status' } })
    await expect(api.listPublicTournaments('live')).rejects.toMatchObject({ code: '22023' })
  })
})

describe('tournament result corrections (live adapter)', () => {
  beforeEach(() => {
    live.rpc.mockReset()
  })

  it('calls staff_void_tournament_match and returns the updated tournament', async () => {
    live.rpc.mockResolvedValueOnce({ data: { ...sampleDetail }, error: null })
    const detail = await api.undoTournamentMatch('tour-1', 'm-1', 'Wrong winner')
    expect(live.rpc).toHaveBeenCalledWith('staff_void_tournament_match', {
      p_tournament_id: 'tour-1',
      p_match_id: 'm-1',
      p_reason: 'Wrong winner',
    })
    expect(detail.tournament.id).toBe('tour-1')
  })

  it('passes refusals through', async () => {
    live.rpc.mockResolvedValueOnce({ data: null, error: { code: '22023', message: 'Only a finished match can be undone' } })
    await expect(api.undoTournamentMatch('tour-1', 'm-1')).rejects.toMatchObject({ code: '22023' })
    expect(live.rpc).toHaveBeenLastCalledWith('staff_void_tournament_match', { p_tournament_id: 'tour-1', p_match_id: 'm-1', p_reason: null })
  })
})
