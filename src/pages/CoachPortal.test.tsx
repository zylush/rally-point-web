import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CoachBookingRequest, CoachProfileAccess, Profile } from '../types'
import { CoachPortal } from './CoachPortal'
import { api } from '../lib/api'

const auth = vi.hoisted(() => ({
  user: {
    id: 'coach-user', email: 'coach.ana@example.com', full_name: 'Ana Reyes', role: 'member',
    created_at: '2026-11-01T00:00:00.000Z',
  } as Profile,
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: auth.user,
    loading: false,
    demo: true,
    clubs: [],
    activeClub: { club_id: 'club-1', slug: 'club-one', name: 'Club One', role: 'member' },
    joinClub: vi.fn(),
    switchClub: vi.fn(),
    signOut: vi.fn(),
  }),
}))

vi.mock('../lib/api', () => ({
  api: {
    coachMyProfiles: vi.fn(),
    coachListMySlots: vi.fn(),
    coachListMyRequests: vi.fn(),
  },
}))

const profile: CoachProfileAccess = {
  coach_id: 'coach-1', club_id: 'club-1', club_slug: 'club-one', club_name: 'Club One', full_name: 'Ana Reyes',
  headline: null, bio: null, hourly_rate: 500, photo_path: null, is_active: true, booking_policy: null,
}

const request: CoachBookingRequest = {
  request_id: 'request-1', slot_id: 'slot-1', club_id: 'club-1', club_name: 'Club One', coach_id: 'coach-1',
  coach_name: 'Ana Reyes', player_user_id: 'player-1', player_name: 'Mia Member', player_email: null,
  starts_at: '2099-01-10T01:00:00.000Z', ends_at: '2099-01-10T02:00:00.000Z', lesson_type: 'private',
  pricing_model: 'per_session', rate: 500, student_count: 1, quoted_amount: 500, message: 'First lesson, please.',
  status: 'requested', created_at: '2099-01-01T00:00:00.000Z',
}

describe('CoachPortal', () => {
  beforeEach(() => {
    vi.mocked(api.coachMyProfiles).mockReset().mockResolvedValue([profile])
    vi.mocked(api.coachListMySlots).mockReset().mockResolvedValue([])
    vi.mocked(api.coachListMyRequests).mockReset()
  })

  it('shows a lesson request with the player’s name but never their email', async () => {
    // Owner decision (2026-11-28): coaches talk to players in the request's conversation.
    // coach_list_my_requests now returns null; a database that still sent an email shows none either.
    vi.mocked(api.coachListMyRequests).mockResolvedValue([
      request,
      { ...request, request_id: 'request-2', player_user_id: 'player-2', player_name: 'Ben Player',
        player_email: 'ben.player@players.invalid' },
    ])
    render(
      <MemoryRouter>
        <CoachPortal />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Mia Member · Club One')).toBeInTheDocument()
    expect(screen.getByText('Ben Player · Club One')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Message Mia' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Message Ben' })).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('ben.player@players.invalid')
  })
})
