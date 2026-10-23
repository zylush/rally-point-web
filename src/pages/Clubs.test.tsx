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
  { slug: 'rally-point-davao', name: 'Rally Point Davao', city: 'Davao City', address: 'Lanang', cities: ['Davao City'], venue_count: 1, court_count: 2, min_rate: 450, min_member_rate: 400 },
  { slug: 'rally-point-gensan', name: 'Rally Point Gensan', city: 'General Santos City', address: null, cities: ['General Santos City', 'Koronadal City'], venue_count: 2, court_count: 4, min_rate: 500, min_member_rate: 500 },
]

const davao: PublicClubDetail = {
  slug: 'rally-point-davao', name: 'Rally Point Davao', city: 'Davao City', address: 'Lanang',
  venues: [{
    id: 'venue-davao', name: 'Davao Main', open_hour: 6, close_hour: 22,
    address: '1 Sample Road, Lanang', city: 'Davao City', latitude: 7.103, longitude: 125.631,
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
    expect(davaoLink).toHaveTextContent('Davao City')
    expect(davaoLink).toHaveTextContent('1 location')
    expect(davaoLink).toHaveTextContent('2 courts')
    expect(davaoLink).toHaveTextContent('From Php 450.00 per hour · Members from Php 400.00')
    // Clubs have no photos yet, so each card shows a drawn court marked as a sample.
    expect(within(davaoLink).getByText('Sample')).toBeInTheDocument()
    const gensanLink = screen.getByRole('link', { name: /Rally Point Gensan/ })
    expect(gensanLink).toHaveTextContent('From Php 500.00 per hour')
    expect(gensanLink).not.toHaveTextContent('Members from')
    expect(screen.getByText('2 clubs')).toBeInTheDocument()

    // A club appears under each of its locations' cities.
    await user.selectOptions(screen.getByLabelText('City'), 'Koronadal City')
    expect(screen.getByRole('link', { name: /Rally Point Gensan/ })).toBeInTheDocument()
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
    expect(venue.getByText('1 Sample Road, Lanang, Davao City')).toBeInTheDocument()
    expect(venue.getByRole('link', { name: 'Get directions' }))
      .toHaveAttribute('href', 'https://www.google.com/maps/dir/?api=1&destination=7.103,125.631')
    expect(venue.getByTitle('Map of Davao Main').getAttribute('src')).toContain('openstreetmap.org/export/embed.html')
    const court1 = within(venue.getByText('Davao Court 1').closest('li')!)
    expect(court1.getByText('Php 450.00 per hour')).toBeInTheDocument()
    expect(court1.getByText('Members Php 400.00')).toBeInTheDocument()
    expect(court1.getByText('Available')).toBeInTheDocument()
    expect(court1.getByText('Sample')).toBeInTheDocument()
    const court2 = within(venue.getByText('Davao Court 2').closest('li')!)
    expect(court2.getByText('Out of service')).toBeInTheDocument()
    expect(court2.queryByText(/per hour/)).not.toBeInTheDocument()
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

  it('gives visitors log in and sign up, with sign up opening the sign-up tab', async () => {
    renderAt('/clubs')
    await screen.findByRole('link', { name: /Rally Point Davao/ })
    const account = within(screen.getByRole('navigation', { name: 'Account' }))
    expect(account.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login')
    await userEvent.setup().click(account.getByRole('link', { name: 'Sign up' }))
    expect(await screen.findByText('At /login {"mode":"join"}')).toBeInTheDocument()
  })

  it('shows real photos instead of the sample drawing once a club adds them', async () => {
    vi.mocked(api.listPublicClubs).mockResolvedValue([{ ...clubs[0], cover_photo: 'https://example.test/cover.webp' }])
    vi.mocked(api.publicClubDetail).mockResolvedValue({
      ...davao,
      venues: [{
        ...davao.venues[0],
        cover_photo: 'https://example.test/cover.webp',
        courts: [
          { ...davao.venues[0].courts[0], photos: ['https://example.test/c1-a.webp', 'https://example.test/c1-b.webp'] },
          davao.venues[0].courts[1],
        ],
      }],
    })
    const { unmount } = renderAt('/clubs')
    const card = await screen.findByRole('link', { name: /Rally Point Davao/ })
    expect(within(card).getByRole('img', { name: 'Photo of Rally Point Davao' })).toHaveAttribute('src', 'https://example.test/cover.webp')
    expect(within(card).queryByText('Sample')).not.toBeInTheDocument()
    unmount()

    renderAt('/clubs/rally-point-davao')
    const venue = within((await screen.findByRole('heading', { name: 'Davao Main' })).closest('section')!)
    expect(venue.getByRole('img', { name: 'Cover photo of Davao Main' })).toBeInTheDocument()
    const court1 = within(venue.getByText('Davao Court 1').closest('li')!)
    expect(court1.getByRole('region', { name: /Photos of Davao Court 1/ })).toHaveAttribute('tabindex', '0')
    expect(court1.getByRole('img', { name: 'Davao Court 1, photo 2 of 2' })).toHaveAttribute('src', 'https://example.test/c1-b.webp')
    expect(court1.getByText('2 photos')).toBeInTheDocument()
    expect(court1.queryByText('Sample')).not.toBeInTheDocument()
    // A court without photos keeps the labelled sample drawing.
    expect(within(venue.getByText('Davao Court 2').closest('li')!).getByText('Sample')).toBeInTheDocument()
    // The club picture at the top uses the cover photo, not the drawing.
    expect(screen.getByRole('img', { name: 'Photo of Rally Point Davao' })).toHaveAttribute('src', 'https://example.test/cover.webp')
  })

  it('explains an unknown club', async () => {
    vi.mocked(api.publicClubDetail).mockResolvedValue(null)
    renderAt('/clubs/nowhere')
    expect(await screen.findByRole('heading', { name: 'This club is not taking bookings' })).toBeInTheDocument()
  })
})
