import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, MemoryRouter, useLocation } from 'react-router-dom'
import { MemberBook } from './MemberBook'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Profile, PublicClubDetail, PublicClubListing } from '../types'
import { ClubDetailPage, ClubDirectory } from './Clubs'

const auth = vi.hoisted(() => ({
  user: null as Profile | null,
  listeners: new Set<() => void>(),
  joinClub: vi.fn(),
  signIn: vi.fn(),
  signUpMember: vi.fn(),
}))

vi.mock('../context/AuthContext', async () => {
  const { useSyncExternalStore } = await import('react')
  return {
    useAuth: () => ({
      user: useSyncExternalStore(
        (listener) => {
          auth.listeners.add(listener)
          return () => auth.listeners.delete(listener)
        },
        () => auth.user,
        () => auth.user,
      ),
      joinClub: auth.joinClub,
      signIn: auth.signIn,
      signUpMember: auth.signUpMember,
      verifySignupCode: vi.fn(),
      resendSignupCode: vi.fn(),
      resetPassword: vi.fn(),
      demo: false,
      activeClub: null,
      clubs: [],
      switchClub: vi.fn(),
      signOut: vi.fn(),
    }),
  }
})

vi.mock('../lib/api', () => ({
  api: {
    listPublicClubs: vi.fn(),
    publicClubDetail: vi.fn(),
    publicClubProfile: vi.fn(),
    publicClubAvailability: vi.fn(),
    memberForUser: vi.fn(),
    listVenues: vi.fn(),
    availability: vi.fn(),
    myBookings: vi.fn(),
    createBooking: vi.fn(),
    checkoutPaymentMethods: vi.fn(),
    releaseBookingHold: vi.fn(),
    submitBookingPayment: vi.fn(),
    myBooking: vi.fn(),
    sendBookingConfirmationEmail: vi.fn(),
  },
}))

import { api } from '../lib/api'
import { stockPhotoFor } from '../lib/stockPhotos'

const clubs: PublicClubListing[] = [
  { slug: 'rally-point-davao', name: 'Rally Point Davao', city: 'Davao City', address: 'Lanang', cities: ['Davao City'], venue_count: 1, court_count: 2, min_rate: 450, min_member_rate: 400, indoor_courts: 0, outdoor_courts: 0 },
  { slug: 'rally-point-gensan', name: 'Rally Point Gensan', city: 'General Santos City', address: null, cities: ['General Santos City', 'Koronadal City'], venue_count: 2, court_count: 4, min_rate: 500, min_member_rate: 500, indoor_courts: 0, outdoor_courts: 0 },
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
  return <p>At {location.pathname}{location.search} {JSON.stringify(location.state)}</p>
}

function renderAt(path: string, withBookingScreen = false) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/clubs" element={<ClubDirectory />} />
        <Route path="/clubs/:slug" element={<ClubDetailPage />} />
        {withBookingScreen ? <Route path="/clubs/:slug/book" element={<MemberBook />} /> : null}
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Find a court', () => {
  beforeEach(() => {
    auth.user = null
    auth.listeners.clear()
    auth.joinClub.mockReset()
    auth.signIn.mockReset()
    auth.signUpMember.mockReset()
    vi.mocked(api.listPublicClubs).mockReset().mockResolvedValue(clubs)
    vi.mocked(api.publicClubDetail).mockReset().mockResolvedValue(davao)
    vi.mocked(api.publicClubProfile).mockReset().mockResolvedValue(null)
  })

  it('lists clubs with location, size and rates, and filters by city and search', async () => {
    const user = userEvent.setup()
    renderAt('/clubs')

    const davaoLink = await screen.findByRole('link', { name: /Rally Point Davao/ })
    expect(davaoLink).toHaveAttribute('href', '/clubs/rally-point-davao')
    expect(davaoLink).toHaveTextContent('Davao City')
    expect(davaoLink).toHaveTextContent('1 location')
    expect(davaoLink).toHaveTextContent('2 courts')
    // The members' price gets its own line, and "Php" never parts from the amount.
    expect(within(davaoLink).getByText('From Php 450.00 per hour')).toBeInTheDocument()
    expect(within(davaoLink).getByText('Members from Php 400.00')).toBeInTheDocument()
    expect(within(davaoLink).getByText('From Php 450.00 per hour').textContent).toBe('From Php 450.00 per hour')
    // Clubs have no photos yet, so each card shows a real stock photo marked as a sample.
    expect(within(davaoLink).getByText('Sample photo')).toBeInTheDocument()
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
    // An open court shows its price and Book button; only a closed court gets a status label.
    expect(court1.queryByText('Available')).not.toBeInTheDocument()
    expect(court1.getByText('Sample')).toBeInTheDocument()
    expect(court1.getByRole('link', { name: /Book Davao Court 1/ })).toHaveAttribute(
      'href',
      '/clubs/rally-point-davao/book?venue=venue-davao&court=c1',
    )
    const court2 = within(venue.getByText('Davao Court 2').closest('li')!)
    expect(court2.getByText('Out of service')).toBeInTheDocument()
    expect(court2.queryByText(/per hour/)).not.toBeInTheDocument()
    expect(court2.queryByRole('link')).not.toBeInTheDocument()
    expect(api.publicClubDetail).toHaveBeenCalledWith('rally-point-davao')
  })

  it('lists Rally Point Gensan first and recovers when loading fails', async () => {
    const user = userEvent.setup()
    vi.mocked(api.listPublicClubs).mockRejectedValueOnce(new Error('Could not load clubs'))
    vi.mocked(api.publicClubDetail).mockResolvedValue({
      ...davao,
      slug: 'rally-point-gensan',
      name: 'Rally Point Gensan',
      city: 'General Santos City',
      venues: [
        {
          ...davao.venues[0],
          id: 'venue-gensan',
          name: 'Gensan Main',
          courts: [
            {
              ...davao.venues[0].courts[0],
              id: 'cg1',
              name: 'Gensan Court 1',
            },
          ],
        },
      ],
    })
    renderAt('/clubs')

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load clubs')
    expect(await screen.findByRole('link', { name: /Book Gensan Court 1/i })).toHaveAttribute(
      'href',
      '/clubs/rally-point-gensan/book?venue=venue-gensan&court=cg1',
    )
    vi.mocked(api.listPublicClubs).mockResolvedValueOnce(clubs)

    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('2 clubs')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    const clubLinks = screen.getAllByRole('link', { name: /Rally Point (Gensan|Davao)/ })
    expect(clubLinks[0]).toHaveTextContent('Rally Point Gensan')
    expect(clubLinks[1]).toHaveTextContent('Rally Point Davao')
    expect(api.publicClubDetail).toHaveBeenCalledWith('rally-point-gensan')
    expect(screen.getByRole('link', { name: /Book Gensan Court 1/i })).toHaveAttribute(
      'href',
      '/clubs/rally-point-gensan/book?venue=venue-gensan&court=cg1',
    )
  })

  it('reads the search and city from the link and keeps them there', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/clubs?q=lanang']}>
        <Routes>
          <Route path="/clubs" element={<ClubDirectory />} />
        </Routes>
        <Where />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('link', { name: /Rally Point Davao/ })).toBeInTheDocument()
    expect(screen.getByLabelText('Search')).toHaveValue('lanang')
    expect(screen.getByLabelText('Search')).toHaveAttribute('placeholder', 'Club name or city')
    expect(screen.queryByRole('link', { name: /Rally Point Gensan/ })).not.toBeInTheDocument()
    expect(screen.getByText('1 club')).toBeInTheDocument()

    await user.clear(screen.getByLabelText('Search'))
    await user.selectOptions(screen.getByLabelText('City'), 'Koronadal City')
    expect(screen.getByText(/At \/clubs\?city=Koronadal\+City/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Rally Point Gensan/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Rally Point Davao/ })).not.toBeInTheDocument()
  })

  it('clears the search and city when nothing matches', async () => {
    const user = userEvent.setup()
    renderAt('/clubs?q=cebu&city=Davao+City')

    expect(await screen.findByText('No clubs match. Try another name or city.')).toBeInTheDocument()
    expect(screen.getByLabelText('City')).toHaveValue('Davao City')
    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(screen.getByText('2 clubs')).toBeInTheDocument()
    expect(screen.getByLabelText('Search')).toHaveValue('')
    expect(screen.getByLabelText('City')).toHaveValue('')
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument()
  })

  it('lets a visitor browse courts, open the court booking screen, pick date/time, sign in at payment, and checkout', async () => {
    const user = userEvent.setup()
    const slots = Array.from({ length: 16 }, (_, index) => ({ startHour: index + 6, label: `${index + 6}:00`, available: true }))
    const bookingCourt = { id: 'c1', club_id: 'club-davao', venue_id: 'venue-davao', name: 'Davao Court 1', status: 'available' as const, hourly_rate: 450, member_rate: 400 }
    vi.mocked(api.publicClubAvailability).mockResolvedValue([{ court: bookingCourt, slots }])
    vi.mocked(api.availability).mockResolvedValue([{ court: bookingCourt, slots }])
    vi.mocked(api.memberForUser).mockResolvedValue({
      id: 'mem-p', user_id: player.id, member_code: 'RP-900', full_name: player.full_name,
      email: player.email, membership_type: null, status: 'active', join_date: '2026-10-01', expiry_date: null, created_at: '2026-10-01',
    })
    vi.mocked(api.listVenues).mockResolvedValue([{
      id: 'venue-davao', club_id: 'club-davao', slug: 'davao-main', name: 'Davao Main',
      timezone: 'Asia/Manila', open_hour: 6, close_hour: 22, is_active: true,
    }])
    vi.mocked(api.myBookings).mockResolvedValue([])
    vi.mocked(api.checkoutPaymentMethods).mockResolvedValue([
      { id: 'pay-davao', label: 'GCash', account_name: 'Rally Point Davao', account_number: '0917 000 0000', qr_url: null },
    ])
    vi.mocked(api.createBooking).mockResolvedValue({
      id: 'bk-new', club_id: 'club-davao', venue_id: 'venue-davao', court_id: 'c1', member_id: 'mem-p',
      start_at: '2099-09-20T04:00:00.000Z', end_at: '2099-09-20T05:00:00.000Z',
      hours: 1, amount: 450, status: 'pending_payment', payment_method: null, payment_ref: null, created_at: '2099-09-19T00:00:00.000Z', court: bookingCourt,
    })

    auth.joinClub.mockResolvedValue({ club_id: 'club-davao', slug: 'rally-point-davao', name: 'Rally Point Davao', role: 'member' })
    auth.signIn.mockImplementation(async () => {
      auth.user = player
      auth.listeners.forEach((listener) => listener())
      return player
    })

    renderAt('/clubs/rally-point-davao', true)
    await user.click(await screen.findByRole('link', { name: /Book Davao Court 1/ }))

    expect(await screen.findByText(/Available times/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Tomorrow' }))
    await user.click(screen.getByRole('button', { name: /12:00 PM/ }))
    await user.click(screen.getByRole('button', { name: /Continue/ }))

    const dialog = await screen.findByRole('dialog', { name: 'Log in to book at Rally Point Davao' })
    expect(within(dialog).getByText('By continuing, you confirm you are booking under your account.')).toBeInTheDocument()
    expect(auth.joinClub).not.toHaveBeenCalled()
    // The 15-minute hold starts only once the visitor has signed in.
    expect(api.createBooking).not.toHaveBeenCalled()

    await user.type(within(dialog).getByLabelText('Email'), player.email)
    await user.type(within(dialog).getByLabelText('Password'), 'secret123')
    const submit = within(dialog).getAllByRole('button', { name: 'Log in' })
      .find((button) => button.getAttribute('type') === 'submit')
    if (!submit) throw new Error('Could not find login submit button')
    await user.click(submit)

    await waitFor(() => expect(auth.joinClub).toHaveBeenCalledWith('rally-point-davao', { asPlayer: true }))
    expect(await screen.findByText('Checkout')).toBeInTheDocument()
    expect(api.createBooking).toHaveBeenCalledWith(expect.objectContaining({ court_id: 'c1', startHour: 12, hours: 1, member_id: 'mem-p', user_id: player.id }))
    expect(screen.getByText('Time left to pay')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /I.ve paid/ })).toBeInTheDocument()
  })

  it('opens the booking environment when clicking the venue CTA', async () => {
    const user = userEvent.setup()
    vi.mocked(api.publicClubAvailability).mockResolvedValue([])
    renderAt('/clubs/rally-point-davao', true)

    await user.click(await screen.findByRole('button', { name: 'Book a court here at Davao Main' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Book at Rally Point Davao' })).toBeInTheDocument()
  })

  it('gives visitors log in and sign up, with sign up opening the sign-up tab', async () => {
    renderAt('/clubs')
    await screen.findByRole('link', { name: /Rally Point Davao/ })
    const account = within(screen.getByRole('navigation', { name: 'Account' }))
    expect(account.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login')
    await userEvent.setup().click(account.getByRole('link', { name: 'Sign up' }))
    // Sign up remembers this page, so signing up comes straight back to it.
    expect(await screen.findByText('At /login {"mode":"join","from":"/clubs"}')).toBeInTheDocument()
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

  it('holds the club grid with card-shaped placeholders while clubs load', async () => {
    let finish: (rows: PublicClubListing[]) => void = () => {}
    vi.mocked(api.listPublicClubs).mockReturnValue(new Promise((resolve) => { finish = resolve }))
    renderAt('/clubs')

    const status = screen.getByText('Loading clubs…')
    expect(status).toHaveAttribute('role', 'status')

    finish(clubs)
    expect(await screen.findByRole('link', { name: /Rally Point Davao/ })).toBeInTheDocument()
    expect(screen.queryByText('Loading clubs…')).not.toBeInTheDocument()
  })

  it('holds the club page with page-shaped placeholders while it loads', async () => {
    let finish: (detail: PublicClubDetail) => void = () => {}
    vi.mocked(api.publicClubDetail).mockReturnValue(new Promise((resolve) => { finish = resolve }))
    renderAt('/clubs/rally-point-davao')

    expect(screen.getByRole('link', { name: 'All clubs' })).toHaveAttribute('href', '/clubs')
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Loading club…')

    finish(davao)
    expect(await screen.findByRole('heading', { name: 'Davao Main' })).toBeInTheDocument()
    expect(screen.queryByText('Loading club…')).not.toBeInTheDocument()
  })

  it('fades a photo in once it loads, and shows a labelled sample photo if it fails', async () => {
    vi.mocked(api.listPublicClubs).mockResolvedValue([
      { ...clubs[0], cover_photo: 'https://example.test/cover.webp' },
      { ...clubs[1], cover_photo: 'https://example.test/broken.webp' },
    ])
    renderAt('/clubs')

    const davaoPhoto = within(await screen.findByRole('link', { name: /Rally Point Davao/ }))
      .getByRole('img', { name: 'Photo of Rally Point Davao' })
    expect(davaoPhoto.parentElement).toHaveAttribute('data-state', 'loading')
    fireEvent.load(davaoPhoto)
    expect(davaoPhoto.parentElement).toHaveAttribute('data-state', 'loaded')

    const gensanCard = within(screen.getByRole('link', { name: /Rally Point Gensan/ }))
    const gensanPhoto = gensanCard.getByRole('img', { name: 'Photo of Rally Point Gensan' })
    expect(gensanPhoto.tagName).toBe('IMG')
    fireEvent.error(gensanPhoto)
    // A sample never borrows the club's name: it says what it shows and is labelled as a sample.
    expect(gensanCard.queryByRole('img', { name: 'Photo of Rally Point Gensan' })).not.toBeInTheDocument()
    expect(gensanCard.getByRole('img', { name: stockPhotoFor('rally-point-gensan').alt })).toBeInTheDocument()
    expect(gensanCard.getByText('Sample photo')).toBeInTheDocument()
    expect(document.querySelector('img[src="https://example.test/broken.webp"]')).toBeNull()
  })

  it('explains an unknown club', async () => {
    vi.mocked(api.publicClubDetail).mockResolvedValue(null)
    renderAt('/clubs/nowhere')
    expect(await screen.findByRole('heading', { name: 'This club is not taking bookings' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See all clubs' })).toHaveAttribute('href', '/clubs')
  })

  it('says when a club could not load, and tries again', async () => {
    const user = userEvent.setup()
    vi.mocked(api.publicClubDetail).mockRejectedValueOnce(new Error('Network request failed'))
    renderAt('/clubs/rally-point-davao')

    expect(await screen.findByRole('heading', { level: 1, name: 'We could not load this club' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Network request failed')
    expect(screen.queryByText('This club is not taking bookings')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: 'Davao Main' })).toBeInTheDocument()
    expect(api.publicClubDetail).toHaveBeenCalledTimes(2)
  })

  it('tells players when a club has not listed its courts, with no booking buttons', async () => {
    vi.mocked(api.publicClubDetail).mockResolvedValue({
      ...davao,
      venues: [{ ...davao.venues[0], courts: [] }],
    })
    vi.mocked(api.publicClubProfile).mockResolvedValue({
      about: null, phone: '0917 123 4567', email: 'hello@davao.example', facebook_url: null, messenger_url: null,
      instagram_url: null, website_url: null, amenities: [], payment_note: null, house_rules: null,
      cancellation_policy: null, terms: null, payment_methods: [], addons: [], coaches: [], gallery: [],
    })
    renderAt('/clubs/rally-point-davao')

    const notice = within(await screen.findByRole('region', { name: 'No courts listed' }))
    expect(notice.getByText('This club has not listed its courts yet.')).toBeInTheDocument()
    expect(await notice.findByRole('link', { name: 'Call 0917 123 4567' })).toHaveAttribute('href', 'tel:09171234567')
    expect(notice.getByRole('link', { name: 'Email the club' })).toHaveAttribute('href', 'mailto:hello@davao.example')
    expect(notice.getByRole('link', { name: 'Find another club' })).toHaveAttribute('href', '/clubs')
    expect(screen.queryByRole('button', { name: /Book a court here/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^Book/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Book|No courts open/ })).not.toBeInTheDocument()
  })

  it("shows a booking summary with the club's hours, price and booking link", async () => {
    renderAt('/clubs/rally-point-davao')

    const summary = within(await screen.findByRole('complementary', { name: 'Booking summary' }))
    expect(summary.getByText('Open 6:00 AM to 10:00 PM')).toBeInTheDocument()
    expect(summary.getByText('From Php 450.00 per hour')).toBeInTheDocument()
    expect(summary.getByRole('link', { name: 'Book a court' }))
      .toHaveAttribute('href', '/clubs/rally-point-davao/book?venue=venue-davao')
    expect(summary.getByText('You pay the club by GCash. Staff confirm your booking.')).toBeInTheDocument()
  })

  it('tells signed-in club staff to book with a player account, with no booking links', async () => {
    auth.user = { ...player, id: 'staff-1', role: 'staff' }
    renderAt('/clubs/rally-point-davao')

    expect(await screen.findByText('Staff accounts cannot book online. Log in with a player account to book.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Davao Main' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^Book/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Book/ })).not.toBeInTheDocument()
  })

  it('lets a signed-in club admin book, since admins book as players', async () => {
    auth.user = { ...player, id: 'admin-1', role: 'admin' }
    renderAt('/clubs/rally-point-davao')

    const summary = within(await screen.findByRole('complementary', { name: 'Booking summary' }))
    expect(summary.getByRole('link', { name: 'Book a court' }))
      .toHaveAttribute('href', '/clubs/rally-point-davao/book?venue=venue-davao')
    expect(screen.queryByText(/Staff accounts cannot book online/)).not.toBeInTheDocument()
  })
})

describe('Indoor and outdoor courts', () => {
  const typedClubs: PublicClubListing[] = [
    { ...clubs[0], indoor_courts: 2, outdoor_courts: 0 },
    { ...clubs[1], indoor_courts: 4, outdoor_courts: 2 },
  ]
  const slots = Array.from({ length: 16 }, (_, index) => ({ startHour: index + 6, label: `${index + 6}:00`, available: true }))

  beforeEach(() => {
    auth.user = null
    auth.listeners.clear()
    vi.mocked(api.listPublicClubs).mockReset().mockResolvedValue(typedClubs)
    vi.mocked(api.publicClubDetail).mockReset().mockResolvedValue(davao)
    vi.mocked(api.publicClubProfile).mockReset().mockResolvedValue(null)
    vi.mocked(api.checkoutPaymentMethods).mockReset().mockResolvedValue([
      { id: 'pay-davao', label: 'GCash', account_name: 'Rally Point Davao', account_number: '0917 000 0000', qr_url: null },
    ])
  })

  function renderDirectory(path: string) {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/clubs" element={<ClubDirectory />} />
        </Routes>
        <Where />
      </MemoryRouter>,
    )
  }

  it('counts indoor and outdoor courts on club cards, and filters clubs by court type', async () => {
    const user = userEvent.setup()
    renderDirectory('/clubs')

    const gensan = await screen.findByRole('link', { name: /Rally Point Gensan/ })
    expect(within(gensan).getByText('4 indoor · 2 outdoor')).toBeInTheDocument()
    // The court count wording stays as it was.
    expect(gensan).toHaveTextContent('2 locations · 4 courts')
    expect(within(screen.getByRole('link', { name: /Rally Point Davao/ })).getByText('2 indoor')).toBeInTheDocument()

    const types = within(screen.getByRole('group', { name: 'Indoor or outdoor' }))
    expect(types.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(types.getByRole('button', { name: 'Outdoor' }))
    expect(types.getByRole('button', { name: 'Outdoor' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('link', { name: /Rally Point Gensan/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Rally Point Davao/ })).not.toBeInTheDocument()
    expect(screen.getByText('1 club')).toBeInTheDocument()
    expect(screen.getByText(/At \/clubs\?type=outdoor/)).toBeInTheDocument()

    await user.click(types.getByRole('button', { name: 'Indoor' }))
    expect(screen.getByText('2 clubs')).toBeInTheDocument()

    await user.click(types.getByRole('button', { name: 'All' }))
    expect(screen.getByText('2 clubs')).toBeInTheDocument()
    expect(screen.queryByText(/type=/)).not.toBeInTheDocument()
  })

  it('reads the court type from the link and clears it with the search', async () => {
    const user = userEvent.setup()
    renderDirectory('/clubs?q=lanang&type=outdoor')

    expect(await screen.findByText('No clubs with outdoor courts match. Try another name, city or court type.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(screen.getByText('2 clubs')).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Indoor or outdoor' })).getByRole('button', { name: 'All' }))
      .toHaveAttribute('aria-pressed', 'true')
  })

  it('hides the court type choice and counts while no club has set its courts', async () => {
    vi.mocked(api.listPublicClubs).mockResolvedValue(clubs)
    renderDirectory('/clubs')

    const gensan = await screen.findByRole('link', { name: /Rally Point Gensan/ })
    expect(gensan).not.toHaveTextContent(/indoor|outdoor/)
    expect(screen.queryByRole('group', { name: 'Indoor or outdoor' })).not.toBeInTheDocument()
  })

  it("labels each court on a club's page, and nothing for a court that is not set", async () => {
    vi.mocked(api.publicClubDetail).mockResolvedValue({
      ...davao,
      venues: [{
        ...davao.venues[0],
        courts: [
          { ...davao.venues[0].courts[0], court_type: 'indoor' },
          { ...davao.venues[0].courts[1], court_type: null },
        ],
      }],
    })
    renderAt('/clubs/rally-point-davao')

    const venue = within((await screen.findByRole('heading', { name: 'Davao Main' })).closest('section')!)
    expect(within(venue.getByText('Davao Court 1').closest('li')!).getByText('Indoor')).toBeInTheDocument()
    expect(venue.getByText('Davao Court 2').closest('li')!).not.toHaveTextContent(/Indoor|Outdoor/)
  })

  it('filters the booking screen to indoor or outdoor courts', async () => {
    const user = userEvent.setup()
    const court = (id: string, name: string, court_type: 'indoor' | 'outdoor' | null) => ({
      id, club_id: 'club-davao', venue_id: 'venue-davao', name, status: 'available' as const, hourly_rate: 450, member_rate: 400, court_type,
    })
    vi.mocked(api.publicClubAvailability).mockResolvedValue([
      { court: court('c1', 'Davao Court 1', 'indoor'), slots },
      { court: court('c2', 'Davao Court 2', 'outdoor'), slots },
      { court: court('c3', 'Davao Court 3', null), slots },
    ])
    renderAt('/clubs/rally-point-davao/book?venue=venue-davao&court=c1', true)

    expect(await screen.findByText(/Available times/)).toBeInTheDocument()
    const courtOne = screen.getByRole('button', { name: /Davao Court 1/ })
    expect(courtOne).toHaveTextContent('Indoor')
    expect(courtOne).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Davao Court 3/ })).not.toHaveTextContent(/Indoor|Outdoor/)

    const types = within(screen.getByRole('group', { name: 'Indoor or outdoor courts' }))
    expect(types.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(types.getByRole('button', { name: 'Outdoor' }))
    // Only outdoor courts are shown, and the pick moves to the first of them.
    expect(screen.queryByRole('button', { name: /Davao Court 1/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Davao Court 3/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Davao Court 2/ })).toHaveAttribute('aria-pressed', 'true')

    await user.click(types.getByRole('button', { name: 'All' }))
    expect(screen.getByRole('button', { name: /Davao Court 1/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Davao Court 3/ })).toBeInTheDocument()
    // Going back to all keeps the court the player had.
    expect(screen.getByRole('button', { name: /Davao Court 2/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('says when no court of the chosen type is open on the booking screen', async () => {
    const user = userEvent.setup()
    vi.mocked(api.publicClubAvailability).mockResolvedValue([
      { court: { id: 'c1', club_id: 'club-davao', venue_id: 'venue-davao', name: 'Davao Court 1', status: 'available', hourly_rate: 450, court_type: 'indoor' }, slots },
      { court: { id: 'c2', club_id: 'club-davao', venue_id: 'venue-davao', name: 'Davao Court 2', status: 'maintenance', hourly_rate: 450, court_type: 'outdoor' }, slots },
    ])
    renderAt('/clubs/rally-point-davao/book?venue=venue-davao', true)

    expect(await screen.findByText(/Available times/)).toBeInTheDocument()
    await user.click(within(screen.getByRole('group', { name: 'Indoor or outdoor courts' })).getByRole('button', { name: 'Outdoor' }))
    expect(screen.getByText(/Every outdoor court here is out of service\. Pick All to see every court\./)).toBeInTheDocument()
  })

  it('shows no court type choice on the booking screen when no court has a type', async () => {
    vi.mocked(api.publicClubAvailability).mockResolvedValue([
      { court: { id: 'c1', club_id: 'club-davao', venue_id: 'venue-davao', name: 'Davao Court 1', status: 'available', hourly_rate: 450 }, slots },
    ])
    renderAt('/clubs/rally-point-davao/book?venue=venue-davao', true)

    expect(await screen.findByText(/Available times/)).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Indoor or outdoor courts' })).not.toBeInTheDocument()
  })
})
