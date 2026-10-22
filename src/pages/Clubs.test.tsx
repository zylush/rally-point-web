import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Profile, PublicClubDetail, PublicClubListing } from '../types'
import { ClubDetailPage, ClubDirectory } from './Clubs'

const auth = vi.hoisted(() => ({
  user: null as Profile | null,
  joinClub: vi.fn(),
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: auth.user,
    joinClub: auth.joinClub,
    activeClub: null,
    clubs: [],
    switchClub: vi.fn(),
    signOut: vi.fn(),
  }),
}))

vi.mock('../lib/api', () => ({
  api: { listPublicClubs: vi.fn(), publicClubDetail: vi.fn() },
}))

import { api } from '../lib/api'

const clubs: PublicClubListing[] = [
  { slug: 'rally-point-davao', name: 'Rally Point Davao', city: 'Davao City', address: 'Lanang', venue_count: 1, court_count: 2, min_rate: 450, min_member_rate: 400 },
  { slug: 'rally-point-gensan', name: 'Rally Point Gensan', city: 'General Santos City', address: null, venue_count: 2, court_count: 4, min_rate: 500, min_member_rate: 500 },
]

const davao: PublicClubDetail = {
  slug: 'rally-point-davao', name: 'Rally Point Davao', city: 'Davao City', address: 'Lanang',
  venues: [{
    id: 'venue-davao', name: 'Davao Main', open_hour: 6, close_hour: 22,
    courts: [
      { id: 'c1', name: 'Davao Court 1', hourly_rate: 450, member_rate: 400, in_service: true },
      { id: 'c2', name: 'Davao Court 2', hourly_rate: 450, member_rate: null, in_service: false },
    ],
  }],
}

const player: Profile = {
  id: 'player-1', email: 'player@example.com', full_name: 'Pia Player', role: 'member', created_at: '2026-09-01T00:00:00.000Z',
}

function Where() {
  const location = useLocation()
  return <p>At {location.pathname} {JSON.stringify(location.state)}</p>
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/clubs" element={<ClubDirectory />} />
        <Route path="/clubs/:slug" element={<ClubDetailPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Find a court', () => {
  beforeEach(() => {
    auth.user = null
    auth.joinClub.mockReset()
    vi.mocked(api.listPublicClubs).mockReset().mockResolvedValue(clubs)
    vi.mocked(api.publicClubDetail).mockReset().mockResolvedValue(davao)
  })

  it('lists clubs with location, size and rates, and filters by city and search', async () => {
    const user = userEvent.setup()
    renderAt('/clubs')

    const davaoLink = await screen.findByRole('link', { name: /Rally Point Davao/ })
    expect(davaoLink).toHaveAttribute('href', '/clubs/rally-point-davao')
    expect(davaoLink).toHaveTextContent('Lanang, Davao City')
    expect(davaoLink).toHaveTextContent('1 location · 2 courts')
    expect(davaoLink).toHaveTextContent('From Php 450.00 per hour · Members from Php 400.00')
    expect(screen.getByRole('link', { name: /Rally Point Gensan/ })).toHaveTextContent('From Php 500.00 per hour')

    await user.selectOptions(screen.getByLabelText('City'), 'General Santos City')
    expect(screen.queryByRole('link', { name: /Rally Point Davao/ })).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('City'), '')
    await user.type(screen.getByLabelText('Search'), 'lanang')
    expect(screen.getByRole('link', { name: /Rally Point Davao/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Rally Point Gensan/ })).not.toBeInTheDocument()
    await user.clear(screen.getByLabelText('Search'))
    await user.type(screen.getByLabelText('Search'), 'cebu')
    expect(screen.getByText('No clubs match. Try another name or city.')).toBeInTheDocument()
  })

  it("shows a club's venues and courts with member rates and out-of-service courts", async () => {
    renderAt('/clubs/rally-point-davao')

    const venue = within((await screen.findByRole('heading', { name: 'Davao Main' })).closest('section')!)
    expect(venue.getByText('Open 6:00 AM to 10:00 PM')).toBeInTheDocument()
    expect(venue.getByText(/Php 450.00 per hour · Members Php 400.00/)).toBeInTheDocument()
    expect(venue.getByText('Out of service')).toBeInTheDocument()
    expect(api.publicClubDetail).toHaveBeenCalledWith('rally-point-davao')
  })

  it('sends a visitor to log in and back to the club page before booking', async () => {
    const user = userEvent.setup()
    renderAt('/clubs/rally-point-davao')

    await user.click(await screen.findByRole('button', { name: 'Book a court at Davao Main' }))
    expect(await screen.findByText('At /login {"returnTo":"/clubs/rally-point-davao"}')).toBeInTheDocument()
    expect(auth.joinClub).not.toHaveBeenCalled()
  })

  it('joins a signed-in player to the club and opens booking at that venue', async () => {
    const user = userEvent.setup()
    auth.user = player
    auth.joinClub.mockResolvedValue({ club_id: 'club-davao', slug: 'rally-point-davao', name: 'Rally Point Davao', role: 'member' })
    renderAt('/clubs/rally-point-davao')

    await user.click(await screen.findByRole('button', { name: 'Book a court at Davao Main' }))
    await waitFor(() => expect(auth.joinClub).toHaveBeenCalledWith('rally-point-davao', { asPlayer: true }))
    expect(await screen.findByText('At /member/book {"venueId":"venue-davao"}')).toBeInTheDocument()
  })

  it('shows why booking could not start', async () => {
    const user = userEvent.setup()
    auth.user = player
    auth.joinClub.mockRejectedValue(new Error('This club is not taking bookings'))
    renderAt('/clubs/rally-point-davao')

    await user.click(await screen.findByRole('button', { name: 'Book a court at Davao Main' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This club is not taking bookings')
  })

  it('explains an unknown club', async () => {
    vi.mocked(api.publicClubDetail).mockResolvedValue(null)
    renderAt('/clubs/nowhere')
    expect(await screen.findByRole('heading', { name: 'This club is not taking bookings' })).toBeInTheDocument()
  })
})
