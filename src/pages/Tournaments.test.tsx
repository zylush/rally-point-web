import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ClubLeaderboardSnapshot,
  Court,
  Member,
  MyClub,
  Profile,
  PublicClub,
  PublicClubDetail,
  TournamentDetail,
  TournamentSummary,
  Venue,
} from '../types'
import { ClubDetailPage } from './Clubs'
import { TvBoard } from './ScheduleBoard'
import {
  AdminTournamentDetailPage,
  AdminTournamentsPage,
  MemberTournamentDetailPage,
  MemberTournamentsPage,
  PublicClubTournamentsPage,
  PublicTournamentDetailPage,
  PublicTournamentsPage,
  StaffTournamentDetailPage,
  StaffTournamentsPage,
} from './Tournaments'
import { api } from '../lib/api'

const auth = vi.hoisted(() => ({
  user: null as Profile | null,
  activeClub: { club_id: 'club-gensan', slug: 'rally-point-gensan', name: 'Rally Point Gensan', role: 'member' } as MyClub | null,
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: auth.user,
    loading: false,
    activeClub: auth.activeClub,
    clubs: auth.activeClub ? [auth.activeClub] : [],
    switchClub: vi.fn(),
    signOut: vi.fn(),
  }),
}))

vi.mock('../lib/api', () => ({
  api: {
    publicClub: vi.fn(),
    publicClubDetail: vi.fn(),
    publicClubProfile: vi.fn(),
    publicClubLeaderboard: vi.fn(),
    publicDaySchedule: vi.fn(),
    listPublicClubTournaments: vi.fn(),
    listPublicTournaments: vi.fn(),
    publicTournament: vi.fn(),
    listClubTournaments: vi.fn(),
    clubTournament: vi.fn(),
    createTournament: vi.fn(),
    setTournamentPlayers: vi.fn(),
    generateTournamentDraw: vi.fn(),
    startTournament: vi.fn(),
    setTournamentScorer: vi.fn(),
    completeTournament: vi.fn(),
    cancelTournament: vi.fn(),
    drawTournamentQueueMatch: vi.fn(),
    assignTournamentMatchCourt: vi.fn(),
    undoTournamentMatch: vi.fn(),
    cancelTournamentQueueMatch: vi.fn(),
    scoreTournamentMatch: vi.fn(),
    memberRoster: vi.fn(),
    listCourts: vi.fn(),
    listVenues: vi.fn(),
  },
}))

const publicClub: PublicClub = { id: 'club-gensan', slug: 'rally-point-gensan', name: 'Rally Point Gensan' }
const courts: Court[] = [{ id: 'c-1', venue_id: 'v-1', name: 'Court A', status: 'available', hourly_rate: 500 }]
const venues: Venue[] = [{ id: 'v-1', club_id: 'club-gensan', slug: 'main', name: 'Main Hall', timezone: 'Asia/Manila', open_hour: 6, close_hour: 22, is_active: true }]
const roster: Member[] = [
  { id: 'mem-1', member_code: 'RP-1001', full_name: 'Mia Member', membership_type: 'premium', status: 'active', join_date: '2026-01-01', expiry_date: '2026-12-31', created_at: '2026-01-01' },
  { id: 'mem-2', member_code: 'RP-1002', full_name: 'Jonah Cruz', membership_type: 'standard', status: 'active', join_date: '2026-01-01', expiry_date: '2026-12-31', created_at: '2026-01-01' },
  { id: 'mem-3', member_code: 'RP-1003', full_name: 'Kyla Tan', membership_type: 'basic', status: 'active', join_date: '2026-01-01', expiry_date: '2026-12-31', created_at: '2026-01-01' },
  { id: 'mem-4', member_code: 'RP-1004', full_name: 'Marco Reyes', membership_type: 'basic', status: 'active', join_date: '2026-01-01', expiry_date: '2026-12-31', created_at: '2026-01-01' },
  { id: 'mem-5', member_code: 'RP-1005', full_name: 'Paolo Lim', membership_type: 'basic', status: 'active', join_date: '2026-01-01', expiry_date: '2026-12-31', created_at: '2026-01-01' },
]

const bracketSummary: TournamentSummary = {
  id: 't-bracket',
  club_id: 'club-gensan',
  venue_id: 'v-1',
  venue_name: 'Main Hall',
  title: 'Sunday Bracket',
  format: 'single_elimination',
  team_size: 2,
  status: 'live',
  counts_for_leaderboard: true,
  scheduled_at: null,
  notes: 'Rally to 11',
  started_at: '2026-11-26T00:00:00Z',
  completed_at: null,
  created_at: '2026-11-26T00:00:00Z',
  player_count: 4,
  team_count: 2,
  active_matches: 1,
  completed_matches: 0,
  total_matches: 1,
  champion_label: null,
}

const bracketDetail: TournamentDetail = {
  club: publicClub,
  tournament: bracketSummary,
  players: [
    { member_id: 'mem-1', full_name: 'Mia Member', nickname: null, photo_url: null },
    { member_id: 'mem-2', full_name: 'Jonah Cruz', nickname: null, photo_url: null },
    { member_id: 'mem-3', full_name: 'Kyla Tan', nickname: null, photo_url: null },
    { member_id: 'mem-4', full_name: 'Marco Reyes', nickname: null, photo_url: null },
  ],
  teams: [
    {
      id: 'team-1',
      seed: 1,
      name: 'Mia Member / Jonah Cruz',
      players: [
        { member_id: 'mem-1', full_name: 'Mia Member', nickname: null, photo_url: null },
        { member_id: 'mem-2', full_name: 'Jonah Cruz', nickname: null, photo_url: null },
      ],
    },
    {
      id: 'team-2',
      seed: 2,
      name: 'Kyla Tan / Marco Reyes',
      players: [
        { member_id: 'mem-3', full_name: 'Kyla Tan', nickname: null, photo_url: null },
        { member_id: 'mem-4', full_name: 'Marco Reyes', nickname: null, photo_url: null },
      ],
    },
  ],
  matches: [{
    id: 'tm-finals',
    tournament_id: 't-bracket',
    round_number: 1,
    match_order: 1,
    round_label: 'Finals',
    court_id: 'c-1',
    court_name: 'Court A',
    team_a_id: 'team-1',
    team_b_id: 'team-2',
    team_a_name: 'Mia Member / Jonah Cruz',
    team_b_name: 'Kyla Tan / Marco Reyes',
    team_a_seed: 1,
    team_b_seed: 2,
    team_a_players: [
      { member_id: 'mem-1', full_name: 'Mia Member', nickname: null, photo_url: null },
      { member_id: 'mem-2', full_name: 'Jonah Cruz', nickname: null, photo_url: null },
    ],
    team_b_players: [
      { member_id: 'mem-3', full_name: 'Kyla Tan', nickname: null, photo_url: null },
      { member_id: 'mem-4', full_name: 'Marco Reyes', nickname: null, photo_url: null },
    ],
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
    rank: 1,
    member_id: 'mem-1',
    full_name: 'Mia Member',
    nickname: null,
    photo_url: null,
    points: 0,
    wins: 0,
    losses: 0,
    games_played: 0,
    win_pct: 0,
    score_diff: 0,
    streak: 0,
  }],
  scorers: [{ user_id: 'u-staff', full_name: 'Sam Staff', email: 'staff@brinely.info', is_club_scorer: false, can_score: false }],
  my_member_id: 'mem-1',
  can_score: true,
  can_manage: true,
}

const queueDetail: TournamentDetail = {
  club: publicClub,
  tournament: {
    ...bracketSummary,
    id: 't-queue',
    title: 'Queue Night',
    format: 'random_queue',
  },
  players: bracketDetail.players,
  teams: [],
  matches: [{
    ...bracketDetail.matches[0],
    id: 'tm-q1',
    tournament_id: 't-queue',
    round_label: 'Game 1',
    team_a_id: null,
    team_b_id: null,
    team_a_name: null,
    team_b_name: null,
    team_a_seed: null,
    team_b_seed: null,
  }],
  standings: bracketDetail.standings,
  scorers: [],
  my_member_id: 'mem-1',
  can_score: true,
  can_manage: false,
}

const clubDetail: PublicClubDetail = {
  slug: 'rally-point-gensan',
  name: 'Rally Point Gensan',
  city: 'General Santos City',
  address: null,
  venues: [{
    id: 'v-1',
    name: 'Main Hall',
    open_hour: 0,
    close_hour: 24,
    address: null,
    city: null,
    latitude: null,
    longitude: null,
    courts: [{ id: 'c-1', name: 'Court A', hourly_rate: 500, member_rate: null, in_service: true }],
  }],
}

const emptyLeaderboard: ClubLeaderboardSnapshot = {
  club: publicClub,
  period: 'month',
  format: 'all',
  entries: [],
  recent_matches: [],
  total_players: 0,
  total_matches: 0,
}

function Where() {
  return <p data-testid="where">{`${useLocation().pathname}${useLocation().search}`}</p>
}

beforeEach(() => {
  vi.clearAllMocks()
  auth.user = null
  auth.activeClub = { club_id: 'club-gensan', slug: 'rally-point-gensan', name: 'Rally Point Gensan', role: 'member' }
  vi.mocked(api.publicClub).mockResolvedValue(publicClub)
  vi.mocked(api.publicClubDetail).mockResolvedValue(clubDetail)
  vi.mocked(api.publicClubProfile).mockResolvedValue(null)
  vi.mocked(api.publicClubLeaderboard).mockResolvedValue(emptyLeaderboard)
  vi.mocked(api.publicDaySchedule).mockResolvedValue([])
  vi.mocked(api.listPublicClubTournaments).mockResolvedValue([bracketSummary])
  vi.mocked(api.listPublicTournaments).mockResolvedValue([])
  vi.mocked(api.publicTournament).mockResolvedValue({ ...bracketDetail, can_score: false, can_manage: false })
  vi.mocked(api.listClubTournaments).mockResolvedValue([bracketSummary])
  vi.mocked(api.clubTournament).mockResolvedValue(bracketDetail)
  vi.mocked(api.createTournament).mockResolvedValue(bracketDetail)
  vi.mocked(api.setTournamentPlayers).mockResolvedValue(bracketDetail)
  vi.mocked(api.generateTournamentDraw).mockResolvedValue(bracketDetail)
  vi.mocked(api.startTournament).mockResolvedValue(bracketDetail)
  vi.mocked(api.setTournamentScorer).mockResolvedValue(undefined)
  vi.mocked(api.completeTournament).mockResolvedValue({ ...queueDetail, tournament: { ...queueDetail.tournament, status: 'completed', champion_label: 'Mia Member' } })
  vi.mocked(api.cancelTournament).mockResolvedValue({ ...bracketDetail, tournament: { ...bracketDetail.tournament, status: 'cancelled' } })
  vi.mocked(api.drawTournamentQueueMatch).mockResolvedValue(queueDetail)
  vi.mocked(api.assignTournamentMatchCourt).mockResolvedValue(bracketDetail)
  vi.mocked(api.cancelTournamentQueueMatch).mockResolvedValue(queueDetail)
  vi.mocked(api.scoreTournamentMatch).mockResolvedValue({
    ...bracketDetail,
    tournament: { ...bracketSummary, status: 'completed', champion_label: 'Mia Member / Jonah Cruz', completed_matches: 1, active_matches: 0 },
  })
  vi.mocked(api.memberRoster).mockResolvedValue(roster)
  vi.mocked(api.listCourts).mockResolvedValue(courts)
  vi.mocked(api.listVenues).mockResolvedValue(venues)
})

describe('Tournaments pages & TV views (Phase 2)', () => {
  it('renders public club tournaments preview on ClubDetailPage and public list/detail views', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/clubs/rally-point-gensan']}>
        <Routes>
          <Route path="/clubs/:slug" element={<ClubDetailPage />} />
          <Route path="/clubs/:slug/tournaments" element={<PublicClubTournamentsPage />} />
          <Route path="/clubs/:slug/tournaments/:tournamentId" element={<PublicTournamentDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('Sunday Bracket')).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: /See all tournaments/i }))

    expect(await screen.findByRole('heading', { name: 'Rally Point Gensan tournaments' })).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: /Sunday Bracket/i }))

    expect(await screen.findByRole('heading', { name: 'Finals' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Score match/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /Players \(4\)/i }))
    expect(await screen.findByText(/Seed #1/i)).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: /Standings/i }))
    expect(await screen.findByText(/0 pts/i)).toBeInTheDocument()
  })

  it('switches TV board to Tournament view while preserving venue query parameter', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/board/tv/rally-point-gensan?venue=v-1']}>
        <Routes>
          <Route path="/board/tv/:slug" element={<><TvBoard /><Where /></>} />
        </Routes>
      </MemoryRouter>,
    )

    const trBtn = await screen.findByRole('button', { name: 'Tournament' })
    await user.click(trBtn)

    await waitFor(() => {
      expect(api.listPublicClubTournaments).toHaveBeenCalledWith('rally-point-gensan', 20)
      expect(api.publicTournament).toHaveBeenCalledWith('rally-point-gensan', 't-bracket')
    })
    expect(screen.getByTestId('where')).toHaveTextContent('venue=v-1')
    expect(screen.getByTestId('where')).toHaveTextContent('view=tournament')
    expect(await screen.findByRole('heading', { name: 'Finals' })).toBeInTheDocument()
  })

  it('shows You are up notice for signed-in member playing an active match', async () => {
    auth.user = { id: 'u-member', email: 'member@brinely.info', full_name: 'Mia Member', role: 'member', created_at: '2026-01-01' }
    vi.mocked(api.clubTournament).mockResolvedValueOnce({ ...bracketDetail, can_score: false, can_manage: false })
    render(
      <MemoryRouter initialEntries={['/member/tournaments/t-bracket']}>
        <Routes>
          <Route path="/member/tournaments/:tournamentId" element={<MemberTournamentDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText(/You're up next/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Score match/i })).not.toBeInTheDocument()
  })

  it('lets designated scorer draw random queue match and submit winner in 1 tap', async () => {
    const user = userEvent.setup()
    auth.user = { id: 'u-staff', email: 'staff@brinely.info', full_name: 'Sam Staff', role: 'staff', created_at: '2026-01-01' }
    auth.activeClub = { club_id: 'club-gensan', slug: 'rally-point-gensan', name: 'Rally Point Gensan', role: 'staff' }
    vi.mocked(api.clubTournament).mockResolvedValue(queueDetail)

    render(
      <MemoryRouter initialEntries={['/staff/tournaments/t-queue']}>
        <Routes>
          <Route path="/staff/tournaments/:tournamentId" element={<StaffTournamentDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )

    const drawBtn = await screen.findByRole('button', { name: /Draw next random match/i })
    await user.click(drawBtn)
    await waitFor(() => expect(api.drawTournamentQueueMatch).toHaveBeenCalledWith('t-queue', null, 'rally-point-gensan'))

    await user.click(screen.getByRole('button', { name: /Score match/i }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/Team A score/i), '11')
    await user.type(within(dialog).getByLabelText(/Team B score/i), '7')
    await user.click(within(dialog).getByRole('button', { name: /Mia Member \/ Jonah Cruz won/i }))

    await waitFor(() => {
      expect(api.scoreTournamentMatch).toHaveBeenCalledWith({
        tournament_id: 't-queue',
        match_id: 'tm-q1',
        winner_side: 'a',
        score_a: 11,
        score_b: 7,
        court_id: 'c-1',
      }, 'rally-point-gensan')
    })
    expect(await screen.findByText(/Champion/i)).toBeInTheDocument()
  })

  it('lets club admin create tournament, randomize bracket, start tournament, and toggle tournament scorer', async () => {
    const user = userEvent.setup()
    auth.user = { id: 'u-admin', email: 'admin@brinely.info', full_name: 'Alex Admin', role: 'admin', created_at: '2026-01-01' }
    auth.activeClub = { club_id: 'club-gensan', slug: 'rally-point-gensan', name: 'Rally Point Gensan', role: 'admin' }

    const setupBracket: TournamentDetail = {
      ...bracketDetail,
      tournament: { ...bracketSummary, status: 'setup', active_matches: 0 },
    }
    vi.mocked(api.createTournament).mockResolvedValue(setupBracket)
    vi.mocked(api.clubTournament).mockResolvedValue(setupBracket)

    render(
      <MemoryRouter initialEntries={['/admin/tournaments']}>
        <Routes>
          <Route path="/admin/tournaments" element={<AdminTournamentsPage />} />
          <Route path="/admin/tournaments/:tournamentId" element={<AdminTournamentDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )

    await user.click(await screen.findByRole('button', { name: /New tournament/i }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/Tournament title/i), 'Saturday Cup')
    await user.click(within(dialog).getByRole('button', { name: /Pick 4/i }))
    await user.click(within(dialog).getByRole('button', { name: /Create tournament/i }))

    await waitFor(() => expect(api.createTournament).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Saturday Cup',
      format: 'single_elimination',
      team_size: 2,
      counts_for_leaderboard: true,
      player_ids: ['mem-1', 'mem-2', 'mem-3', 'mem-4'],
    }), 'rally-point-gensan'))

    const randomizeBtn = await screen.findByRole('button', { name: /Randomize teams & bracket/i })
    await user.click(randomizeBtn)
    await waitFor(() => expect(api.generateTournamentDraw).toHaveBeenCalledWith('t-bracket', 'rally-point-gensan'))

    await user.click(screen.getByRole('button', { name: /Allow scoring/i }))
    await waitFor(() => expect(api.setTournamentScorer).toHaveBeenCalledWith('t-bracket', 'u-staff', true, 'rally-point-gensan'))

    await user.click(screen.getByRole('button', { name: /Start tournament/i }))
    await waitFor(() => expect(api.startTournament).toHaveBeenCalledWith('t-bracket', 'rally-point-gensan'))
  })

  it('exercises admin roster edit, cancel flow, queue late player add, score validation, and error states', async () => {
    const user = userEvent.setup()
    auth.user = { id: 'u-admin', email: 'admin@brinely.info', full_name: 'Alex Admin', role: 'admin', created_at: '2026-01-01' }
    auth.activeClub = { club_id: 'club-gensan', slug: 'rally-point-gensan', name: 'Rally Point Gensan', role: 'admin' }

    // 1) Setup tournament: Edit players -> search -> save -> Keep/Confirm cancel
    const oddSetup: TournamentDetail = {
      ...bracketDetail,
      tournament: { ...bracketSummary, status: 'setup', active_matches: 0 },
      players: bracketDetail.players.slice(0, 3),
    }
    vi.mocked(api.clubTournament).mockResolvedValueOnce(oddSetup)
    vi.mocked(api.setTournamentPlayers).mockResolvedValueOnce({ ...oddSetup, players: bracketDetail.players })
    const unmounted = render(
      <MemoryRouter initialEntries={['/admin/tournaments/t-bracket']}>
        <Routes>
          <Route path="/admin/tournaments/:tournamentId" element={<AdminTournamentDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText(/even number of players/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Edit players/i }))
    await user.type(screen.getByLabelText(/Filter club players/i), 'Marco')
    await user.click(screen.getByRole('button', { name: /Save roster/i }))
    await waitFor(() => expect(api.setTournamentPlayers).toHaveBeenCalled())

    await user.click(screen.getByRole('button', { name: /Cancel tournament/i }))
    await user.click(screen.getByRole('button', { name: /Keep/i }))
    await user.click(screen.getByRole('button', { name: /Cancel tournament/i }))
    await user.click(screen.getByRole('button', { name: /Confirm cancel/i }))
    await waitFor(() => expect(api.cancelTournament).toHaveBeenCalledWith('t-bracket', 'rally-point-gensan'))
    unmounted.unmount()

    // 2) Live random queue admin controls: late player add, court assign, cancel queue match, finish tournament
    const liveQueue: TournamentDetail = { ...queueDetail, can_manage: true, can_score: true }
    vi.mocked(api.clubTournament).mockResolvedValueOnce(liveQueue)
    vi.mocked(api.setTournamentPlayers).mockResolvedValueOnce(liveQueue)
    vi.mocked(api.assignTournamentMatchCourt).mockResolvedValueOnce(liveQueue)
    vi.mocked(api.cancelTournamentQueueMatch).mockResolvedValueOnce(liveQueue)
    const liveQueueView = render(
      <MemoryRouter initialEntries={['/admin/tournaments/t-queue']}>
        <Routes>
          <Route path="/admin/tournaments/:tournamentId" element={<AdminTournamentDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByRole('link', { name: /TV view/i })).toHaveAttribute(
      'href',
      '/board/tv/rally-point-gensan?view=tournament&tournament=t-queue',
    )
    await user.selectOptions(screen.getByLabelText(/Add player to queue/i), 'mem-5')
    await user.click(screen.getByRole('button', { name: /^Add$/i }))
    await waitFor(() => expect(api.setTournamentPlayers).toHaveBeenCalledWith(
      't-queue',
      ['mem-1', 'mem-2', 'mem-3', 'mem-4', 'mem-5'],
      'rally-point-gensan',
    ))
    await user.selectOptions(screen.getByLabelText(/Court for Game 1/i), 'c-1')
    await waitFor(() => expect(api.assignTournamentMatchCourt).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: /Cancel game/i }))
    await waitFor(() => expect(api.cancelTournamentQueueMatch).toHaveBeenCalledWith('t-queue', 'tm-q1', 'rally-point-gensan'))
    await user.click(screen.getByRole('button', { name: /Finish tournament/i }))
    await waitFor(() => expect(api.completeTournament).toHaveBeenCalledWith('t-queue', 'rally-point-gensan'))
    liveQueueView.unmount()

    // 3) CreateTournamentModal format switches, validation error, and ScoreTournamentMatchModal validation
    vi.mocked(api.listClubTournaments).mockResolvedValue([])
    const modalView = render(
      <MemoryRouter initialEntries={['/admin/tournaments']}>
        <Routes>
          <Route path="/admin/tournaments" element={<AdminTournamentsPage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByText(/No tournaments yet/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /New tournament/i }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /Create tournament/i }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/Enter a tournament title/i)

    await user.click(within(dialog).getByRole('button', { name: /Random queue mixer/i }))
    await user.click(within(dialog).getByRole('button', { name: /Singles \(1v1\)/i }))
    await user.click(within(dialog).getByRole('button', { name: /Pick 8/i }))
    await user.click(within(dialog).getByRole('button', { name: /Clear/i }))
    await user.type(within(dialog).getByLabelText(/Search club players/i), 'Kyla')
    await user.click(within(dialog).getByRole('checkbox', { name: /Kyla Tan/i }))
    await user.click(within(dialog).getByRole('checkbox', { name: /Count matches toward/i }))
    await user.click(within(dialog).getByRole('button', { name: /Close new tournament form/i }))
    modalView.unmount()

    // 4) Member & Staff list + view-only staff notice + score validation + unavailable public club
    auth.user = { id: 'u-staff', email: 'staff@brinely.info', full_name: 'Sam Staff', role: 'staff', created_at: '2026-01-01' }
    auth.activeClub = { club_id: 'club-gensan', slug: 'rally-point-gensan', name: 'Rally Point Gensan', role: 'staff' }
    vi.mocked(api.listClubTournaments).mockResolvedValue([bracketSummary])
    const staffListView = render(
      <MemoryRouter initialEntries={['/staff/tournaments']}>
        <Routes>
          <Route path="/staff/tournaments" element={<StaffTournamentsPage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByText('Sunday Bracket')).toBeInTheDocument()
    staffListView.unmount()

    vi.mocked(api.clubTournament).mockResolvedValueOnce({ ...bracketDetail, can_score: false, can_manage: false })
    const staffViewOnly = render(
      <MemoryRouter initialEntries={['/staff/tournaments/t-bracket']}>
        <Routes>
          <Route path="/staff/tournaments/:tournamentId" element={<StaffTournamentDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByText(/View only\./i)).toBeInTheDocument()
    staffViewOnly.unmount()

    vi.mocked(api.clubTournament).mockResolvedValueOnce({ ...queueDetail, can_score: true, can_manage: false })
    const scoreErrView = render(
      <MemoryRouter initialEntries={['/staff/tournaments/t-queue']}>
        <Routes>
          <Route path="/staff/tournaments/:tournamentId" element={<StaffTournamentDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )
    await user.click(await screen.findByRole('button', { name: /Score match/i }))
    const sDialog = await screen.findByRole('dialog')
    await user.type(within(sDialog).getByLabelText(/Team A score/i), '5')
    await user.click(within(sDialog).getByRole('button', { name: /Mia Member \/ Jonah Cruz won/i }))
    expect(await within(sDialog).findByRole('alert')).toHaveTextContent(/both teams/i)
    await user.type(within(sDialog).getByLabelText(/Team B score/i), '11')
    await user.click(within(sDialog).getByRole('button', { name: /Mia Member \/ Jonah Cruz won/i }))
    expect(await within(sDialog).findByRole('alert')).toHaveTextContent(/higher than the losing team/i)
    await user.click(within(sDialog).getByRole('button', { name: /Close score dialog/i }))
    scoreErrView.unmount()

    vi.mocked(api.publicClub).mockResolvedValueOnce(null)
    const missingClubView = render(
      <MemoryRouter initialEntries={['/clubs/unknown-club/tournaments']}>
        <Routes>
          <Route path="/clubs/:slug/tournaments" element={<PublicClubTournamentsPage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByText(/Tournaments not available/i)).toBeInTheDocument()
    missingClubView.unmount()

    auth.user = { id: 'u-member', email: 'member@brinely.info', full_name: 'Mia Member', role: 'member', created_at: '2026-01-01' }
    auth.activeClub = { club_id: 'club-gensan', slug: 'rally-point-gensan', name: 'Rally Point Gensan', role: 'member' }
    vi.mocked(api.listClubTournaments).mockRejectedValueOnce(new Error('Network down'))
    const memberRetryView = render(
      <MemoryRouter initialEntries={['/member/tournaments']}>
        <Routes>
          <Route path="/member/tournaments" element={<MemberTournamentsPage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('Network down')
    await user.click(screen.getByRole('button', { name: /Try again/i }))
    expect(await screen.findByText('Sunday Bracket')).toBeInTheDocument()
    memberRetryView.unmount()
  })

  it('covers dark TV queue view, completed Team B win display, setup draw empty state, and CreateTournamentModal options', async () => {
    const user = userEvent.setup()

    // 1) Dark TV view on completed/live queue with completed game won by Team B and no-active case
    const completedQueueDetail: TournamentDetail = {
      ...queueDetail,
      tournament: { ...queueDetail.tournament, status: 'completed', champion_label: 'Jonah Cruz', active_matches: 0, completed_matches: 1 },
      matches: [
        {
          ...queueDetail.matches[0],
          id: 'tm-q-done',
          status: 'completed',
          winner_side: 'b',
          score_a: 8,
          score_b: 11,
          completed_at: '2026-11-26T02:00:00Z',
        },
      ],
      standings: [
        {
          rank: 1,
          member_id: 'mem-2',
          full_name: 'Jonah Cruz',
          nickname: 'JC',
          photo_url: null,
          points: 3,
          wins: 1,
          losses: 0,
          games_played: 1,
          win_pct: 100,
          score_diff: 3,
          streak: 2,
        },
      ],
    }
    vi.mocked(api.listPublicClubTournaments).mockResolvedValueOnce([completedQueueDetail.tournament, bracketSummary])
    vi.mocked(api.publicTournament).mockResolvedValueOnce(completedQueueDetail)
    const tvDark = render(
      <MemoryRouter initialEntries={['/board/tv/rally-point-gensan?view=tournament']}>
        <Routes>
          <Route path="/board/tv/:slug" element={<TvBoard />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByText(/Completed games \(1\)/i)).toBeInTheDocument()
    expect(screen.getByText(/Champion/i)).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: /Standings/i }))
    expect(screen.getByText('W2')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: /Players/i }))
    expect(screen.getByText(/Participating players/i)).toBeInTheDocument()
    tvDark.unmount()

    // 2) Dark TV error + retry & empty tournament list
    vi.mocked(api.listPublicClubTournaments).mockRejectedValueOnce(new Error('TV offline'))
    vi.mocked(api.listPublicClubTournaments).mockResolvedValueOnce([])
    const tvRetry = render(
      <MemoryRouter initialEntries={['/board/tv/rally-point-gensan?view=tournament']}>
        <Routes>
          <Route path="/board/tv/:slug" element={<TvBoard />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByText('TV offline')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Try again/i }))
    expect(await screen.findByText(/No live tournament on this board yet/i)).toBeInTheDocument()
    tvRetry.unmount()

    // 3) CreateTournamentModal with notes, venue selector, empty search, and submission error
    auth.user = { id: 'u-admin', email: 'admin@brinely.info', full_name: 'Alex Admin', role: 'admin', created_at: '2026-01-01' }
    auth.activeClub = { club_id: 'club-gensan', slug: 'rally-point-gensan', name: 'Rally Point Gensan', role: 'admin' }
    vi.mocked(api.createTournament).mockRejectedValueOnce(new Error('Server busy'))
    const createErrView = render(
      <MemoryRouter initialEntries={['/admin/tournaments']}>
        <Routes>
          <Route path="/admin/tournaments" element={<AdminTournamentsPage />} />
        </Routes>
      </MemoryRouter>,
    )
    await user.click(await screen.findByRole('button', { name: /New tournament/i }))
    const dlg = await screen.findByRole('dialog')
    await user.type(within(dlg).getByLabelText(/Tournament title/i), 'Club Classic')
    await user.selectOptions(within(dlg).getByLabelText(/Location/i), 'v-1')
    await user.type(within(dlg).getByLabelText(/Notes/i), 'Win by 2')
    await user.click(within(dlg).getByRole('button', { name: /Create tournament/i }))
    expect(await within(dlg).findByRole('alert')).toHaveTextContent('Server busy')
    await user.click(within(dlg).getByRole('button', { name: /Close new tournament form/i }))
    createErrView.unmount()

    // 4) Staff scoring Team B won without score + draw error handling + empty setup bracket
    auth.user = { id: 'u-staff', email: 'staff@brinely.info', full_name: 'Sam Staff', role: 'staff', created_at: '2026-01-01' }
    auth.activeClub = { club_id: 'club-gensan', slug: 'rally-point-gensan', name: 'Rally Point Gensan', role: 'staff' }
    vi.mocked(api.clubTournament).mockResolvedValueOnce({ ...queueDetail, can_score: true, can_manage: false })
    vi.mocked(api.drawTournamentQueueMatch).mockRejectedValueOnce(new Error('All players busy'))
    const staffTeamB = render(
      <MemoryRouter initialEntries={['/staff/tournaments/t-queue']}>
        <Routes>
          <Route path="/staff/tournaments/:tournamentId" element={<StaffTournamentDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )
    await user.selectOptions(await screen.findByLabelText(/Court \(optional\)/i), 'c-1')
    await user.click(screen.getByRole('button', { name: /Draw next random match/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('All players busy')
    await user.click(screen.getByRole('button', { name: /Score match/i }))
    const sd = await screen.findByRole('dialog')
    await user.click(within(sd).getByRole('button', { name: /Kyla Tan \/ Marco Reyes won/i }))
    await waitFor(() => expect(api.scoreTournamentMatch).toHaveBeenCalledWith({
      tournament_id: 't-queue',
      match_id: 'tm-q1',
      winner_side: 'b',
      score_a: null,
      score_b: null,
      court_id: 'c-1',
    }, 'rally-point-gensan'))
    staffTeamB.unmount()

    // 5) Public empty/error states, BYE bracket card, null detail, Score modal out-of-range + submit error, Create modal switches
    vi.mocked(api.listPublicClubTournaments).mockRejectedValueOnce(new Error('Feed unavailable'))
    vi.mocked(api.listPublicClubTournaments).mockResolvedValueOnce([])
    const pubErr = render(
      <MemoryRouter initialEntries={['/clubs/rally-point-gensan/tournaments']}>
        <Routes>
          <Route path="/clubs/:slug/tournaments" element={<PublicClubTournamentsPage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByText('Feed unavailable')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Try again/i }))
    expect(await screen.findByText(/No tournaments listed yet/i)).toBeInTheDocument()
    pubErr.unmount()

    vi.mocked(api.publicTournament).mockResolvedValueOnce(null)
    const missingDetail = render(
      <MemoryRouter initialEntries={['/clubs/rally-point-gensan/tournaments/t-missing']}>
        <Routes>
          <Route path="/clubs/:slug/tournaments/:tournamentId" element={<PublicTournamentDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByText(/Tournament not found/i)).toBeInTheDocument()
    missingDetail.unmount()

    const byeBracketDetail: TournamentDetail = {
      ...bracketDetail,
      tournament: { ...bracketSummary, status: 'setup', venue_name: null, notes: null },
      players: [{ member_id: 'mem-1', full_name: 'Mia Member', nickname: 'Mimi', photo_url: null }],
      matches: [
        {
          ...bracketDetail.matches[0],
          status: 'bye',
          winner_side: 'a',
          court_id: null,
          court_name: null,
          team_b_id: null,
          team_b_name: null,
          team_b_seed: null,
          team_b_players: [],
        },
      ],
      standings: [],
      scorers: [{ user_id: 'u-staff', full_name: 'Sam Staff', email: 'staff@brinely.info', is_club_scorer: true, can_score: true }],
      can_score: false,
      can_manage: false,
    }
    vi.mocked(api.publicTournament).mockResolvedValueOnce(byeBracketDetail)
    const byeView = render(
      <MemoryRouter initialEntries={['/clubs/rally-point-gensan/tournaments/t-bracket']}>
        <Routes>
          <Route path="/clubs/:slug/tournaments/:tournamentId" element={<PublicTournamentDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByText(/Auto advance/i)).toBeInTheDocument()
    expect(screen.getByText(/BYE \(advances\)/i)).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: /Standings/i }))
    expect(screen.getByText(/No players in this tournament yet/i)).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: /Players/i }))
    expect(screen.getByText('Mimi')).toBeInTheDocument()
    byeView.unmount()

    // Admin setup error + club-wide scorer pill + toggles in CreateTournamentModal
    auth.user = { id: 'u-admin', email: 'admin@brinely.info', full_name: 'Alex Admin', role: 'admin', created_at: '2026-01-01' }
    auth.activeClub = { club_id: 'club-gensan', slug: 'rally-point-gensan', name: 'Rally Point Gensan', role: 'admin' }
    vi.mocked(api.clubTournament).mockResolvedValueOnce({ ...byeBracketDetail, can_manage: true })
    vi.mocked(api.startTournament).mockRejectedValueOnce(new Error('Need more players'))
    const adminErr = render(
      <MemoryRouter initialEntries={['/admin/tournaments/t-bracket']}>
        <Routes>
          <Route path="/admin/tournaments/:tournamentId" element={<AdminTournamentDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByText('Club-wide scorer')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Start tournament/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Need more players')
    adminErr.unmount()

    vi.mocked(api.memberRoster).mockRejectedValueOnce(new Error('Roster failed'))
    const rosterFail = render(
      <MemoryRouter initialEntries={['/admin/tournaments']}>
        <Routes>
          <Route path="/admin/tournaments" element={<AdminTournamentsPage />} />
        </Routes>
      </MemoryRouter>,
    )
    await user.click(await screen.findByRole('button', { name: /New tournament/i }))
    const fd = await screen.findByRole('dialog')
    expect(await within(fd).findByRole('alert')).toHaveTextContent('Roster failed')
    await user.click(within(fd).getByRole('button', { name: /Random queue mixer/i }))
    await user.click(within(fd).getByRole('button', { name: /Single-elimination bracket/i }))
    await user.click(within(fd).getByRole('button', { name: /Singles \(1v1\)/i }))
    await user.click(within(fd).getByRole('button', { name: /Doubles \(2v2\)/i }))
    await user.keyboard('{Escape}')
    rosterFail.unmount()

    // Score modal range validation (score > 99) and rejected submit
    vi.mocked(api.clubTournament).mockResolvedValueOnce({ ...queueDetail, can_score: true })
    vi.mocked(api.scoreTournamentMatch).mockRejectedValueOnce(new Error('Score failed'))
    const scoreFailView = render(
      <MemoryRouter initialEntries={['/staff/tournaments/t-queue']}>
        <Routes>
          <Route path="/staff/tournaments/:tournamentId" element={<StaffTournamentDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )
    await user.click(await screen.findByRole('button', { name: /Score match/i }))
    const sf = await screen.findByRole('dialog')
    await user.type(within(sf).getByLabelText(/Team A score/i), '120')
    await user.type(within(sf).getByLabelText(/Team B score/i), '10')
    await user.click(within(sf).getByRole('button', { name: /Mia Member \/ Jonah Cruz won/i }))
    expect(await within(sf).findByRole('alert')).toHaveTextContent(/0 and 99/i)
    await user.clear(within(sf).getByLabelText(/Team A score/i))
    await user.clear(within(sf).getByLabelText(/Team B score/i))
    await user.click(within(sf).getByRole('button', { name: /Mia Member \/ Jonah Cruz won/i }))
    expect(await within(sf).findByRole('alert')).toHaveTextContent('Score failed')
    await user.click(within(sf).getByRole('button', { name: /Close score dialog/i }))
    scoreFailView.unmount()

    // 6) PublicTournamentDetailPage error + retry, negative diff/streak display, and scorer removal error
    vi.mocked(api.publicTournament).mockRejectedValueOnce(new Error('Tournament feed error'))
    vi.mocked(api.publicTournament).mockResolvedValueOnce({
      ...bracketDetail,
      can_score: false,
      can_manage: false,
      standings: [
        {
          rank: 1,
          member_id: 'mem-1',
          full_name: 'Mia Member',
          nickname: null,
          photo_url: null,
          points: 2,
          wins: 0,
          losses: 2,
          games_played: 2,
          win_pct: 0,
          score_diff: -4,
          streak: -2,
        },
      ],
    })
    const pubDetailErr = render(
      <MemoryRouter initialEntries={['/clubs/rally-point-gensan/tournaments/t-bracket']}>
        <Routes>
          <Route path="/clubs/:slug/tournaments/:tournamentId" element={<PublicTournamentDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByText('Tournament feed error')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Try again/i }))
    await user.click(await screen.findByRole('tab', { name: /Standings/i }))
    expect(screen.getByText('L2')).toBeInTheDocument()
    expect(screen.getByText(/Diff -4/i)).toBeInTheDocument()
    pubDetailErr.unmount()

    auth.user = { id: 'u-admin', email: 'admin@brinely.info', full_name: 'Alex Admin', role: 'admin', created_at: '2026-01-01' }
    auth.activeClub = { club_id: 'club-gensan', slug: 'rally-point-gensan', name: 'Rally Point Gensan', role: 'admin' }
    vi.mocked(api.clubTournament).mockResolvedValueOnce({
      ...bracketDetail,
      can_manage: true,
      scorers: [{ user_id: 'u-staff', full_name: 'Sam Staff', email: 'staff@brinely.info', is_club_scorer: false, can_score: true }],
    })
    vi.mocked(api.setTournamentScorer).mockRejectedValueOnce(new Error('Permission update failed'))
    const removeScorerView = render(
      <MemoryRouter initialEntries={['/admin/tournaments/t-bracket']}>
        <Routes>
          <Route path="/admin/tournaments/:tournamentId" element={<AdminTournamentDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )
    await user.click(await screen.findByRole('button', { name: /Can score — remove/i }))
    expect(await screen.findByText('Permission update failed')).toBeInTheDocument()
    removeScorerView.unmount()
  })

  it('covers error fallbacks, setup singles/queue hints, roster checkbox toggles, null club detail, and member empty list', async () => {
    const user = userEvent.setup()

    auth.user = { id: 'u-admin', email: 'admin@brinely.info', full_name: 'Alex Admin', role: 'admin', created_at: '2026-01-01' }
    auth.activeClub = { club_id: 'club-gensan', slug: 'rally-point-gensan', name: 'Rally Point Gensan', role: 'admin' }

    const singlesSetup: TournamentDetail = {
      ...bracketDetail,
      tournament: {
        ...bracketSummary,
        title: 'Singles Open',
        format: 'single_elimination',
        team_size: 1,
        status: 'setup',
        venue_id: 'v-other',
        active_matches: 0,
      },
      players: bracketDetail.players.slice(0, 2),
      scorers: [],
    }
    vi.mocked(api.clubTournament).mockRejectedValueOnce({ message: 'Plain object error' })
    vi.mocked(api.clubTournament).mockRejectedValueOnce(null)
    vi.mocked(api.clubTournament).mockResolvedValueOnce(singlesSetup)

    const singlesView = render(
      <MemoryRouter initialEntries={['/admin/tournaments/t-singles']}>
        <Routes>
          <Route path="/admin/tournaments/:tournamentId" element={<AdminTournamentDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('Plain object error')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Try again/i }))
    expect(await screen.findByText('Could not load tournament.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Try again/i }))

    expect(await screen.findByText(/2 players ready for randomized seeding\./i)).toBeInTheDocument()
    expect(screen.getByText(/No active staff accounts in this club yet\./i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Edit players/i }))
    await user.click(screen.getByRole('checkbox', { name: /Mia Member/i }))
    await user.click(screen.getByRole('checkbox', { name: /Kyla Tan/i }))
    expect(screen.getByText('Select players (2)')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Close$/i }))
    singlesView.unmount()

    const queueSetup: TournamentDetail = {
      ...queueDetail,
      tournament: {
        ...queueDetail.tournament,
        status: 'setup',
        venue_id: null,
        active_matches: 0,
      },
      can_manage: true,
    }
    vi.mocked(api.clubTournament).mockResolvedValueOnce(queueSetup)
    const queueSetupView = render(
      <MemoryRouter initialEntries={['/admin/tournaments/t-queue-setup']}>
        <Routes>
          <Route path="/admin/tournaments/:tournamentId" element={<AdminTournamentDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByText(/4 players ready to rotate\./i)).toBeInTheDocument()
    queueSetupView.unmount()

    vi.mocked(api.publicClub).mockResolvedValueOnce(null)
    const nullClubDetailView = render(
      <MemoryRouter initialEntries={['/clubs/unknown-club/tournaments/t-1']}>
        <Routes>
          <Route path="/clubs/:slug/tournaments/:tournamentId" element={<PublicTournamentDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByRole('heading', { name: 'Tournament' })).toBeInTheDocument()
    expect(screen.getByText(/Tournament not found/i)).toBeInTheDocument()
    nullClubDetailView.unmount()

    auth.user = { id: 'u-member', email: 'member@brinely.info', full_name: 'Mia Member', role: 'member', created_at: '2026-01-01' }
    auth.activeClub = null
    vi.mocked(api.listClubTournaments).mockResolvedValueOnce([])
    const memberEmptyView = render(
      <MemoryRouter initialEntries={['/member/tournaments']}>
        <Routes>
          <Route path="/member/tournaments" element={<MemberTournamentsPage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByText('Club tournaments')).toBeInTheDocument()
    expect(screen.getByText(/Brackets and queue mixers created by your club appear here\./i)).toBeInTheDocument()
    memberEmptyView.unmount()
  })
})

describe('PublicTournamentsPage (all clubs)', () => {
  const gensanLive = { ...bracketSummary, id: 't-live', title: 'Sunday Bracket', status: 'live' as const,
    club: { slug: 'rally-point-gensan', name: 'Rally Point Gensan', city: 'General Santos' } }
  const otherFinished = { ...bracketSummary, id: 't-done', club_id: 'club-two', title: 'Second Club Cup', status: 'completed' as const,
    champion_label: 'Kyla Tan / Marco Reyes', club: { slug: 'second-club', name: 'Second Club', city: null } }

  it('lists tournaments from every club, each naming its club and linking to the bracket at that club', async () => {
    vi.mocked(api.listPublicTournaments).mockResolvedValue([gensanLive, otherFinished])
    render(
      <MemoryRouter initialEntries={['/tournaments']}>
        <Routes>
          <Route path="/tournaments" element={<PublicTournamentsPage />} />
          <Route path="/clubs/:slug/tournaments/:tournamentId" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { level: 1, name: 'Tournaments' })).toBeInTheDocument()
    const live = screen.getByRole('region', { name: 'Live now' })
    expect(within(live).getByText('Sunday Bracket')).toBeInTheDocument()
    expect(within(live).getByText('Rally Point Gensan')).toBeInTheDocument()
    expect(within(live).getByText(/General Santos/)).toBeInTheDocument()
    const finished = screen.getByRole('region', { name: 'Finished' })
    expect(within(finished).getByText('Second Club')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Coming up' })).not.toBeInTheDocument()
    expect(api.listPublicTournaments).toHaveBeenCalledWith(null, 60)

    await userEvent.setup().click(within(finished).getByRole('link', { name: /Second Club Cup/ }))
    expect(await screen.findByTestId('where')).toHaveTextContent('/clubs/second-club/tournaments/t-done')
  })

  it('filters by status and explains an empty result', async () => {
    const user = userEvent.setup()
    vi.mocked(api.listPublicTournaments).mockResolvedValue([gensanLive, otherFinished])
    render(<MemoryRouter><PublicTournamentsPage /></MemoryRouter>)

    const all = await screen.findByRole('button', { name: 'All' })
    expect(all).toHaveAttribute('aria-pressed', 'true')
    vi.mocked(api.listPublicTournaments).mockResolvedValue([])
    await user.click(screen.getByRole('button', { name: 'Coming up' }))
    expect(api.listPublicTournaments).toHaveBeenLastCalledWith('setup', 60)
    expect(screen.getByRole('button', { name: 'Coming up' })).toHaveAttribute('aria-pressed', 'true')
    expect(await screen.findByText('No tournament is coming up yet.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See all clubs' })).toHaveAttribute('href', '/clubs')
  })

  it('shows a retry when the list cannot load', async () => {
    vi.mocked(api.listPublicTournaments).mockRejectedValueOnce(new Error('Network down')).mockResolvedValue([gensanLive])
    render(<MemoryRouter><PublicTournamentsPage /></MemoryRouter>)
    expect(await screen.findByRole('alert')).toHaveTextContent('Network down')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Sunday Bracket')).toBeInTheDocument()
  })
})

describe('tournament result corrections and court choices', () => {
  const finishedBracket: TournamentDetail = {
    ...bracketDetail,
    tournament: { ...bracketSummary, status: 'completed', counts_for_leaderboard: false, champion_label: 'Mia Member / Jonah Cruz' },
    matches: [{
      ...bracketDetail.matches[0],
      status: 'completed',
      winner_side: 'a',
      score_a: 11,
      score_b: 7,
      completed_at: '2026-11-26T02:00:00Z',
    }],
  }

  function renderStaffDetail() {
    auth.user = { id: 'u-staff', email: 'staff@brinely.info', full_name: 'Sam Staff', role: 'staff', created_at: '2026-01-01' }
    auth.activeClub = { club_id: 'club-gensan', slug: 'rally-point-gensan', name: 'Rally Point Gensan', role: 'staff' }
    render(
      <MemoryRouter initialEntries={['/staff/tournaments/t-bracket']}>
        <Routes>
          <Route path="/staff/tournaments/:tournamentId" element={<StaffTournamentDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )
  }

  it('lets a scorer undo a finished result after confirming', async () => {
    const user = userEvent.setup()
    vi.mocked(api.clubTournament).mockResolvedValue(finishedBracket)
    vi.mocked(api.undoTournamentMatch).mockResolvedValue(bracketDetail)
    renderStaffDetail()

    await user.click(await screen.findByRole('button', { name: 'Undo result' }))
    expect(screen.getByText(/Undo this result\?/)).toBeInTheDocument()
    expect(api.undoTournamentMatch).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Yes, undo it' }))

    await waitFor(() => expect(api.undoTournamentMatch).toHaveBeenCalledWith('t-bracket', 'tm-finals', undefined, 'rally-point-gensan'))
    expect(await screen.findByText('Result undone. The match can be scored again.')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /Score match/i })).toBeInTheDocument()
  })

  it('shows why an undo was refused, and Keep result leaves it alone', async () => {
    const user = userEvent.setup()
    vi.mocked(api.clubTournament).mockResolvedValue(finishedBracket)
    vi.mocked(api.undoTournamentMatch).mockRejectedValue({ message: 'Cannot void a bracket match after the next round has been played' })
    renderStaffDetail()

    await user.click(await screen.findByRole('button', { name: 'Undo result' }))
    await user.click(screen.getByRole('button', { name: 'Yes, undo it' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot void a bracket match after the next round has been played')

    await user.click(screen.getByRole('button', { name: 'Keep result' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Undo result' })).toBeInTheDocument()
  })

  it('marks out-of-service courts and shows a refused court change', async () => {
    const user = userEvent.setup()
    vi.mocked(api.clubTournament).mockResolvedValue(bracketDetail)
    vi.mocked(api.listCourts).mockResolvedValue([
      ...courts,
      { id: 'c-2', venue_id: 'v-1', name: 'Court B', status: 'available', hourly_rate: 500 },
      { id: 'c-3', venue_id: 'v-1', name: 'Court C', status: 'maintenance', hourly_rate: 500 },
    ])
    vi.mocked(api.assignTournamentMatchCourt).mockRejectedValue({ message: 'That court already has a match on it' })
    renderStaffDetail()

    const select = await screen.findByLabelText('Court for Finals')
    expect(within(select).getByRole('option', { name: 'Court C (out of service)' })).toBeDisabled()
    await user.selectOptions(select, 'c-2')
    await waitFor(() => expect(api.assignTournamentMatchCourt).toHaveBeenCalledWith('t-bracket', 'tm-finals', 'c-2', 'rally-point-gensan'))
    expect(await screen.findByRole('alert')).toHaveTextContent('That court already has a match on it')
  })

  it('never offers Undo result to visitors', async () => {
    vi.mocked(api.publicTournament).mockResolvedValue({ ...finishedBracket, can_score: false, can_manage: false })
    render(
      <MemoryRouter initialEntries={['/clubs/rally-point-gensan/tournaments/t-bracket']}>
        <Routes>
          <Route path="/clubs/:slug/tournaments/:tournamentId" element={<PublicTournamentDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByRole('heading', { name: 'Finals' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Undo result' })).not.toBeInTheDocument()
  })
})
