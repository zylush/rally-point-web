import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublicClubListing } from '../types'
import { WelcomePage } from './Welcome'

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: null,
    demo: false,
    activeClub: null,
    clubs: [],
    switchClub: vi.fn(),
    signOut: vi.fn(),
  }),
}))

vi.mock('../lib/api', () => ({
  api: {
    listPublicClubs: vi.fn(),
  },
}))

import { api } from '../lib/api'
import { HERO_PHOTO } from '../lib/stockPhotos'

function club(slug: string, name: string, city: string): PublicClubListing {
  return { slug, name, city, address: null, cities: [city], venue_count: 1, court_count: 2, min_rate: 450, min_member_rate: null, indoor_courts: 0, outdoor_courts: 0 }
}

const clubs: PublicClubListing[] = [
  club('zamboanga-smash', 'Zamboanga Smash', 'Zamboanga City'),
  club('baguio-dinks', 'Baguio Dinks', 'Baguio City'),
  club('rally-point-gensan', 'Rally Point Gensan', 'General Santos City'),
  club('cebu-courts', 'Cebu Courts', 'Cebu City'),
  club('davao-paddle', 'Davao Paddle', 'Davao City'),
]

function Where() {
  const location = useLocation()
  return <p>At {location.pathname}{location.search}</p>
}

function renderWelcome() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<WelcomePage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Landing page', () => {
  beforeEach(() => {
    vi.mocked(api.listPublicClubs).mockReset()
    vi.mocked(api.listPublicClubs).mockResolvedValue(clubs)
  })

  it('shows the hero heading and photo', async () => {
    renderWelcome()

    expect(screen.getByRole('heading', { level: 1, name: 'Book a pickleball court near you.' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: HERO_PHOTO.alt })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'I own a court' })).toHaveAttribute('href', '/owners')
    // The moving B mark sits above the heading as decoration, so screen readers skip it.
    const mark = document.querySelector('img[src$="logo-mark-animated.svg"]')
    expect(mark).toHaveAttribute('alt', '')
    await screen.findByText('Rally Point Gensan')
  })

  it('searches Find a court for what was typed', async () => {
    const user = userEvent.setup()
    renderWelcome()

    await user.type(screen.getByLabelText('Search'), '  davao ')
    await user.click(screen.getByRole('button', { name: 'Find a court' }))

    expect(await screen.findByText('At /clubs?q=davao')).toBeInTheDocument()
  })

  it('opens Find a court when the search is empty', async () => {
    const user = userEvent.setup()
    renderWelcome()

    await user.click(screen.getByRole('button', { name: 'Find a court' }))

    expect(await screen.findByText('At /clubs')).toBeInTheDocument()
  })

  it('explains booking in 3 steps', async () => {
    renderWelcome()

    const steps = screen.getByRole('heading', { level: 2, name: 'How booking works' }).closest('section')!
    const items = within(steps).getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(items[0]).toHaveTextContent('Pick a club and a time')
    expect(items[1]).toHaveTextContent('Your hours are held for 15 minutes.')
    expect(items[2]).toHaveTextContent('The club confirms')
    await screen.findByText('Rally Point Gensan')
  })

  it('shows at most 3 clubs, the default club first', async () => {
    renderWelcome()

    const section = screen.getByRole('heading', { level: 2, name: 'Clubs on bRineLy' }).closest('section')!
    await within(section).findByText('Rally Point Gensan')
    const cards = within(section).getAllByRole('link').filter((link) => link.getAttribute('href')?.startsWith('/clubs/'))
    expect(cards.map((card) => card.getAttribute('href'))).toEqual([
      '/clubs/rally-point-gensan',
      '/clubs/baguio-dinks',
      '/clubs/cebu-courts',
    ])
    expect(within(section).getByRole('link', { name: 'See all clubs' })).toHaveAttribute('href', '/clubs')
  })

  it('shows a loading status while clubs load', () => {
    vi.mocked(api.listPublicClubs).mockReturnValue(new Promise(() => {}))
    renderWelcome()

    expect(screen.getByRole('status')).toHaveTextContent('Loading clubs…')
  })

  it('says so when clubs fail to load, and tries again', async () => {
    const user = userEvent.setup()
    vi.mocked(api.listPublicClubs).mockRejectedValueOnce(new Error('offline'))
    renderWelcome()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Could not load clubs')

    await user.click(within(alert).getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('Rally Point Gensan')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(api.listPublicClubs).toHaveBeenCalledTimes(2)
  })

  it('says when no clubs are listed', async () => {
    vi.mocked(api.listPublicClubs).mockResolvedValue([])
    renderWelcome()

    expect(await screen.findByText('No clubs are listed yet.')).toBeInTheDocument()
  })
})
