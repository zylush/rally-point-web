import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ClubLeaderboardSnapshot,
  ClubMatch,
  Court,
  LeaderboardScorerStaff,
  Member,
  MyClub,
  Profile,
  PublicClub,
  PublicClubDetail,
} from '../types'
import { ClubDetailPage } from './Clubs'
import {
  AdminLeaderboardPage,
  MemberLeaderboardPage,
  PublicClubLeaderboardPage,
  StaffLeaderboardPage,
} from './Leaderboard'
import { TvBoard } from './ScheduleBoard'
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
    publicPlayerMatches: vi.fn(),
    publicDaySchedule: vi.fn(),
    clubLeaderboard: vi.fn(),
    memberRoster: vi.fn(),
    listCourts: vi.fn(),
    recordClubMatch: vi.fn(),
    voidClubMatch: vi.fn(),
    listLeaderboardScorers: vi.fn(),
    setLeaderboardScorer: vi.fn(),
  },
}))

const publicClub: PublicClub = {
  id: 'club-gensan',
  slug: 'rally-point-gensan',
  name: 'Rally Point Gensan',
}

const sampleMatch: ClubMatch = {
  id: 'm-1',
  club_id: 'club-gensan',
  venue_id: 'v-1',
  venue_name: 'Main Hall',
  court_id: 'c-1',
  court_name: 'Court A',
  tournament_id: null,
  format: 'singles',
  winner_side: 'a',
  score_a: 11,
  score_b: 7,
  notes: 'Open play final',
  status: 'completed',
  void_reason: null,
  played_at: '2026-11-25T10:00:00Z',
  created_at: '2026-11-25T10:00:00Z',
  team_a: [{ member_id: 'mem-1', full_name: 'Mia Member', nickname: null, photo_url: null }],
  team_b: [{ member_id: 'mem-2', full_name: 'Jonah Cruz', nickname: null, photo_url: null }],
}

const snapshot: ClubLeaderboardSnapshot = {
  club: publicClub,
  period: 'month',
  format: 'all',
  entries: [
    {
      rank: 1,
      member_id: 'mem-1',
      full_name: 'Mia Member',
      nickname: null,
      photo_url: null,
      points: 6,
      wins: 2,
      losses: 0,
      games_played: 2,
      win_pct: 100,
      score_diff: 8,
      streak: 2,
    },
    {
      rank: 2,
      member_id: 'mem-2',
      full_name: 'Jonah Cruz',
      nickname: null,
      photo_url: null,
      points: 4,
      wins: 1,
      losses: 1,
      games_played: 2,
      win_pct: 50,
      score_diff: 1,
      streak: -1,
    },
  ],
  recent_matches: [sampleMatch],
  total_players: 2,
  total_matches: 2,
  my_member_id: 'mem-1',
  my_entry: {
    rank: 1,
    member_id: 'mem-1',
    full_name: 'Mia Member',
    nickname: null,
    photo_url: null,
    points: 6,
    wins: 2,
    losses: 0,
    games_played: 2,
    win_pct: 100,
    score_diff: 8,
    streak: 2,
  },
  can_score: false,
}

const roster: Member[] = [
  { id: 'mem-1', member_code: 'RP-1001', full_name: 'Mia Member', membership_type: 'premium', status: 'active', join_date: '2026-01-01', expiry_date: '2026-12-31', created_at: '2026-01-01' },
  { id: 'mem-2', member_code: 'RP-1002', full_name: 'Jonah Cruz', membership_type: 'standard', status: 'active', join_date: '2026-01-01', expiry_date: '2026-12-31', created_at: '2026-01-01' },
  { id: 'mem-3', member_code: 'RP-1003', full_name: 'Kyla Tan', membership_type: 'basic', status: 'active', join_date: '2026-01-01', expiry_date: '2026-12-31', created_at: '2026-01-01' },
  { id: 'mem-4', member_code: 'RP-1004', full_name: 'Marco Reyes', membership_type: 'basic', status: 'active', join_date: '2026-01-01', expiry_date: '2026-12-31', created_at: '2026-01-01' },
]

const courts: Court[] = [{ id: 'c-1', name: 'Court A', status: 'available', hourly_rate: 500 }]
const scorers: LeaderboardScorerStaff[] = [{ user_id: 'u-staff', full_name: 'Sam Staff', email: 'staff@brinely.info', can_score: false }]

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

function Where() {
  return <p data-testid="where">{useLocation().search}</p>
}

beforeEach(() => {
  vi.clearAllMocks()
  auth.user = null
  auth.activeClub = { club_id: 'club-gensan', slug: 'rally-point-gensan', name: 'Rally Point Gensan', role: 'member' }
  vi.mocked(api.publicClub).mockResolvedValue(publicClub)
  vi.mocked(api.publicClubDetail).mockResolvedValue(clubDetail)
  vi.mocked(api.publicClubProfile).mockResolvedValue(null)
  vi.mocked(api.publicClubLeaderboard).mockResolvedValue(snapshot)
  vi.mocked(api.publicPlayerMatches).mockResolvedValue([sampleMatch])
  vi.mocked(api.publicDaySchedule).mockResolvedValue([])
  vi.mocked(api.clubLeaderboard).mockResolvedValue(snapshot)
  vi.mocked(api.memberRoster).mockResolvedValue(roster)
  vi.mocked(api.listCourts).mockResolvedValue(courts)
  vi.mocked(api.recordClubMatch).mockResolvedValue(sampleMatch)
  vi.mocked(api.voidClubMatch).mockResolvedValue(undefined)
  vi.mocked(api.listLeaderboardScorers).mockResolvedValue(scorers)
  vi.mocked(api.setLeaderboardScorer).mockResolvedValue(undefined)
})

describe('Leaderboard pages & public views', () => {
  it('renders public club leaderboard, changes filters, and opens player match history dialog', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/clubs/rally-point-gensan/leaderboard']}>
        <Routes>
          <Route path="/clubs/:slug/leaderboard" element={<PublicClubLeaderboardPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: 'Rally Point Gensan leaderboard' })).toBeInTheDocument()
    expect(screen.getAllByText('Mia Member').length).toBeGreaterThan(0)
    expect(screen.getAllByText('6 pts').length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: 'All time' }))
    await waitFor(() => expect(api.publicClubLeaderboard).toHaveBeenCalledWith('rally-point-gensan', 'all', 'all', 50))

    await user.click(screen.getByRole('button', { name: 'Singles' }))
    await waitFor(() => expect(api.publicClubLeaderboard).toHaveBeenCalledWith('rally-point-gensan', 'all', 'singles', 50))

    const standingsSection = screen.getByRole('region', { name: 'Player rankings' })
    await user.click(within(standingsSection).getByRole('button', { name: /Mia Member/i }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Recent matches')).toBeInTheDocument()
    expect(within(dialog).getByText('Open play final')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('shows leaderboard preview card on public club detail page', async () => {
    render(
      <MemoryRouter initialEntries={['/clubs/rally-point-gensan']}>
        <Routes>
          <Route path="/clubs/:slug" element={<ClubDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: 'Leaderboard' })).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /See full leaderboard/i })
    expect(link).toHaveAttribute('href', '/clubs/rally-point-gensan/leaderboard')
  })

  it('renders member standing summary and personal match history', async () => {
    const user = userEvent.setup()
    auth.user = { id: 'u-mem', email: 'member@brinely.info', full_name: 'Mia Member', role: 'member', created_at: '2026-01-01' }
    render(
      <MemoryRouter initialEntries={['/member/leaderboard']}>
        <MemberLeaderboardPage />
      </MemoryRouter>,
    )

    const standing = await screen.findByRole('region', { name: 'Your standing' })
    expect(within(standing).getByText('Rank #1 · 6 pts')).toBeInTheDocument()
    await user.click(within(standing).getByRole('button', { name: 'My games' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('shows view-only notice to non-designated staff, and lets designated staff record & void matches', async () => {
    const user = userEvent.setup()
    auth.user = { id: 'u-staff', email: 'staff@brinely.info', full_name: 'Sam Staff', role: 'staff', created_at: '2026-01-01' }

    const { rerender } = render(
      <MemoryRouter initialEntries={['/staff/leaderboard']}>
        <StaffLeaderboardPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText(/View only\. Ask a club admin to add you as a scorer/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Record match' })).not.toBeInTheDocument()

    vi.mocked(api.clubLeaderboard).mockResolvedValue({ ...snapshot, can_score: true })
    rerender(
      <MemoryRouter initialEntries={['/staff/leaderboard']}>
        <StaffLeaderboardPage />
      </MemoryRouter>,
    )

    // Trigger reload after mock update by clicking All time
    await user.click(screen.getByRole('button', { name: 'All time' }))
    const recordBtn = await screen.findByRole('button', { name: 'Record match' })
    await user.click(recordBtn)

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Singles (1 vs 1)' }))
    await user.selectOptions(within(dialog).getByLabelText('Team A · Player'), 'mem-1')
    await user.selectOptions(within(dialog).getByLabelText('Team B · Player'), 'mem-2')
    await user.click(within(dialog).getByRole('button', { name: 'Team A won' }))

    await waitFor(() =>
      expect(api.recordClubMatch).toHaveBeenCalledWith(
        {
          format: 'singles',
          team_a: ['mem-1'],
          team_b: ['mem-2'],
          winner_side: 'a',
          score_a: null,
          score_b: null,
          court_id: null,
          notes: null,
        },
        'rally-point-gensan',
      ),
    )

    // Void match from Recent games tab
    await user.click(screen.getByRole('tab', { name: /Recent games/i }))
    await user.click(screen.getByRole('button', { name: 'Void match' }))
    const voidDialog = await screen.findByRole('dialog')
    await user.type(within(voidDialog).getByLabelText('Reason (optional)'), 'Wrong court')
    await user.click(within(voidDialog).getByRole('button', { name: 'Confirm void' }))
    await waitFor(() => expect(api.voidClubMatch).toHaveBeenCalledWith('m-1', 'Wrong court', 'rally-point-gensan'))
  })

  it('lets admins toggle designated staff scorers', async () => {
    const user = userEvent.setup()
    auth.user = { id: 'u-admin', email: 'admin@brinely.info', full_name: 'Alex Admin', role: 'admin', created_at: '2026-01-01' }
    vi.mocked(api.clubLeaderboard).mockResolvedValue({ ...snapshot, can_score: true })

    render(
      <MemoryRouter initialEntries={['/admin/leaderboard']}>
        <AdminLeaderboardPage />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: 'Designated scorers' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Allow scoring' }))
    await waitFor(() => expect(api.setLeaderboardScorer).toHaveBeenCalledWith('u-staff', true))
  })

  it('supports live leaderboard mode on TV board without breaking schedule URLs', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/board/tv/rally-point-gensan?view=leaderboard']}>
        <Routes>
          <Route path="/board/tv/:slug" element={<><TvBoard /><Where /></>} />
        </Routes>
      </MemoryRouter>,
    )

    expect((await screen.findAllByText('Mia Member')).length).toBeGreaterThan(0)
    expect(screen.getByText('Recent games')).toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent('?view=leaderboard')

    await user.click(screen.getByRole('button', { name: 'Court schedule' }))
    expect(screen.getByTestId('where')).toHaveTextContent('')
  })

  it('handles unavailable clubs, empty standings, error retries, and RecordMatchModal validation', async () => {
    const user = userEvent.setup()

    // Unavailable public club
    vi.mocked(api.publicClub).mockResolvedValueOnce(null)
    render(
      <MemoryRouter initialEntries={['/clubs/no-such-club/leaderboard']}>
        <Routes>
          <Route path="/clubs/:slug/leaderboard" element={<PublicClubLeaderboardPage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByRole('heading', { name: 'Leaderboard not available' })).toBeInTheDocument()

    // Error + Try again recovery on signed-in page, then empty standings + RecordMatchModal validation
    auth.user = { id: 'u-admin', email: 'admin@brinely.info', full_name: 'Alex Admin', role: 'admin', created_at: '2026-01-01' }
    vi.mocked(api.clubLeaderboard)
      .mockRejectedValueOnce(new Error('Connection interrupted'))
      .mockResolvedValue({
        club: publicClub,
        period: 'month',
        format: 'all',
        entries: [],
        recent_matches: [],
        total_players: 0,
        total_matches: 0,
        my_member_id: null,
        my_entry: null,
        can_score: true,
      })

    render(
      <MemoryRouter initialEntries={['/admin/leaderboard']}>
        <AdminLeaderboardPage />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('Connection interrupted')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('No ranked matches yet')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Record match' }))
    const dialog = await screen.findByRole('dialog')

    // Missing players validation
    await user.click(within(dialog).getByRole('button', { name: 'Team A won' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Choose 2 players for each team.')

    // Search + fill doubles players + mismatched single score validation + valid scored doubles submit
    await user.type(within(dialog).getByLabelText('Search club players'), 'Mia')
    expect(within(dialog).getByLabelText('Team A · Player 1')).toBeInTheDocument()
    await user.clear(within(dialog).getByLabelText('Search club players'))

    await user.selectOptions(within(dialog).getByLabelText('Team A · Player 1'), 'mem-1')
    await user.selectOptions(within(dialog).getByLabelText('Team A · Player 2'), 'mem-2')
    await user.selectOptions(within(dialog).getByLabelText('Team B · Player 1'), 'mem-3')
    await user.selectOptions(within(dialog).getByLabelText('Team B · Player 2'), 'mem-4')

    await user.type(within(dialog).getByLabelText('Team A score (optional)'), '11')
    await user.click(within(dialog).getByRole('button', { name: 'Team A won' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Enter scores for both teams, or leave both blank.')

    await user.type(within(dialog).getByLabelText('Team B score (optional)'), '15')
    await user.click(within(dialog).getByRole('button', { name: 'Team A won' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Winning team score must be higher than the losing team score.')

    await user.selectOptions(within(dialog).getByLabelText('Court (optional)'), 'c-1')
    await user.type(within(dialog).getByLabelText('Note (optional)'), 'Doubles league')
    await user.click(within(dialog).getByRole('button', { name: 'Team B won' }))

    await waitFor(() =>
      expect(api.recordClubMatch).toHaveBeenCalledWith(
        {
          format: 'doubles',
          team_a: ['mem-1', 'mem-2'],
          team_b: ['mem-3', 'mem-4'],
          winner_side: 'b',
          score_a: 11,
          score_b: 15,
          court_id: 'c-1',
          notes: 'Doubles league',
        },
        'rally-point-gensan',
      ),
    )
  })

  it('covers empty member standing, voided/nickname/streak UI, admin scorer removal errors, and TV leaderboard errors', async () => {
    const user = userEvent.setup()

    auth.user = { id: 'u-mem', email: 'member@brinely.info', full_name: 'New Player', role: 'member', created_at: '2026-01-01' }
    vi.mocked(api.clubLeaderboard).mockResolvedValueOnce({
      club: publicClub,
      period: 'month',
      format: 'all',
      entries: [
        {
          rank: 1,
          member_id: 'mem-2',
          full_name: 'Jonah Cruz',
          nickname: 'Chef J',
          photo_url: null,
          points: 2,
          wins: 0,
          losses: 2,
          games_played: 2,
          win_pct: 0,
          score_diff: -3,
          streak: -2,
        },
      ],
      recent_matches: [
        {
          ...sampleMatch,
          id: 'm-void',
          winner_side: 'b',
          status: 'voided',
          void_reason: 'Duplicate entry',
          score_a: null,
          score_b: null,
        },
      ],
      total_players: 1,
      total_matches: 1,
      my_member_id: 'mem-99',
      my_entry: null,
      can_score: false,
    })

    const { unmount } = render(
      <MemoryRouter initialEntries={['/member/leaderboard']}>
        <MemberLeaderboardPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText(/You have no completed matches in this view yet/i)).toBeInTheDocument()
    expect(screen.getAllByText('Chef J').length).toBeGreaterThan(0)
    expect(screen.getAllByText('L2').length).toBeGreaterThan(0)
    await user.click(screen.getByRole('tab', { name: /Recent games/i }))
    expect(screen.getByText('Voided')).toBeInTheDocument()
    expect(screen.getByText(/Void reason: Duplicate entry/i)).toBeInTheDocument()
    unmount()

    // Admin with empty scorers, then with removable scorer that fails update
    auth.user = { id: 'u-admin', email: 'admin@brinely.info', full_name: 'Alex Admin', role: 'admin', created_at: '2026-01-01' }
    vi.mocked(api.clubLeaderboard).mockResolvedValue({ ...snapshot, can_score: true })
    vi.mocked(api.listLeaderboardScorers)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ user_id: 'u-staff', full_name: 'Sam Staff', email: 'staff@brinely.info', can_score: true }])
    vi.mocked(api.setLeaderboardScorer).mockRejectedValueOnce(new Error('Scorer update refused'))

    const adminRender = render(
      <MemoryRouter initialEntries={['/admin/leaderboard']}>
        <AdminLeaderboardPage />
      </MemoryRouter>,
    )
    expect(await screen.findByText('No active staff accounts in this club yet.')).toBeInTheDocument()
    adminRender.unmount()

    const adminRender2 = render(
      <MemoryRouter initialEntries={['/admin/leaderboard']}>
        <AdminLeaderboardPage />
      </MemoryRouter>,
    )
    const removeBtn = await screen.findByRole('button', { name: 'Can score — remove' })
    await user.click(removeBtn)
    expect(await screen.findByRole('alert')).toHaveTextContent('Scorer update refused')
    adminRender2.unmount()

    // TV board error + Try again recovery to empty leaderboard
    vi.mocked(api.publicClubLeaderboard)
      .mockRejectedValueOnce(new Error('TV load failed'))
      .mockResolvedValueOnce({ ...snapshot, entries: [], recent_matches: [], total_players: 0, total_matches: 0 })

    const tvRender = render(
      <MemoryRouter initialEntries={['/board/tv/rally-point-gensan?view=leaderboard']}>
        <Routes>
          <Route path="/board/tv/:slug" element={<TvBoard />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('TV load failed')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('No ranked matches yet')).toBeInTheDocument()
    tvRender.unmount()

    // Public club leaderboard error + Try again, and fallback player matches when publicPlayerMatches fails
    vi.mocked(api.publicClubLeaderboard)
      .mockRejectedValueOnce(new Error('Public feed down'))
      .mockResolvedValueOnce(snapshot)

    const pubRender = render(
      <MemoryRouter initialEntries={['/clubs/rally-point-gensan/leaderboard']}>
        <Routes>
          <Route path="/clubs/:slug/leaderboard" element={<PublicClubLeaderboardPage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('Public feed down')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect((await screen.findAllByText('Mia Member')).length).toBeGreaterThan(0)
    pubRender.unmount()

    // Member fallback to loaded recent_matches when publicPlayerMatches rejects
    auth.user = { id: 'u-mem', email: 'member@brinely.info', full_name: 'Mia Member', role: 'member', created_at: '2026-01-01' }
    vi.mocked(api.clubLeaderboard).mockResolvedValueOnce(snapshot)
    vi.mocked(api.publicPlayerMatches).mockRejectedValueOnce(new Error('Offline'))
    render(
      <MemoryRouter initialEntries={['/member/leaderboard']}>
        <MemberLeaderboardPage />
      </MemoryRouter>,
    )
    await user.click(await screen.findByRole('button', { name: 'My games' }))
    const fallbackDialog = await screen.findByRole('dialog')
    expect(within(fallbackDialog).getByText('Open play final')).toBeInTheDocument()
    await user.click(within(fallbackDialog).getByRole('button', { name: 'Close player match history' }))
  })
})
