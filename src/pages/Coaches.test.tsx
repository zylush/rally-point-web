import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CoachBookingRequest, MyClub, Profile, PublicCoachListing } from '../types'
import { PublicCoachesPage } from './Coaches'
import { api } from '../lib/api'

const auth = vi.hoisted(() => ({
  user: null as Profile | null,
  clubs: [] as MyClub[],
  activeClub: null as MyClub | null,
  joinClub: vi.fn(),
  switchClub: vi.fn(),
  signOut: vi.fn(),
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: auth.user,
    loading: false,
    demo: true,
    clubs: auth.clubs,
    activeClub: auth.activeClub,
    joinClub: auth.joinClub,
    switchClub: auth.switchClub,
    signOut: auth.signOut,
  }),
}))

vi.mock('../lib/api', () => ({
  api: {
    listPublicCoaches: vi.fn(),
    memberRequestCoachSlot: vi.fn(),
  },
}))

const sampleCoaches: PublicCoachListing[] = [
  {
    id: 'coach-gensan-1',
    full_name: 'Coach Marco Santos',
    headline: 'DUPR 4.5+ · Doubles strategy',
    bio: 'Soft-game resets and third-shot drops.',
    hourly_rate: 700,
    contact_phone: '0917 555 0141',
    contact_url: 'https://m.me/coachmarco',
    photo_url: null,
    booking_policy: 'Arrive 10 minutes early.',
    accepts_requests: true,
    club: {
      id: 'club-gensan',
      slug: 'rally-point-gensan',
      name: 'Rally Point Gensan',
      city: 'General Santos City',
    },
    slots: [
      {
        slot_id: 'slot-private-1',
        starts_at: '2099-06-01T01:00:00.000Z',
        ends_at: '2099-06-01T02:00:00.000Z',
        lesson_type: 'private',
        pricing_model: 'per_session',
        rate: 700,
        max_students: 1,
        remaining_students: 1,
      },
    ],
  },
  {
    id: 'coach-gensan-2',
    full_name: 'Coach Rica Villanueva',
    headline: 'Beginner foundations',
    bio: null,
    hourly_rate: 500,
    contact_phone: null,
    contact_url: null,
    photo_url: null,
    booking_policy: null,
    accepts_requests: false,
    club: {
      id: 'club-gensan',
      slug: 'rally-point-gensan',
      name: 'Rally Point Gensan',
      city: 'General Santos City',
    },
    slots: [],
  },
  {
    id: 'coach-davao-1',
    full_name: 'Coach Noel Ramos',
    headline: 'Footwork & tournament prep',
    bio: null,
    hourly_rate: 650,
    contact_phone: null,
    contact_url: 'https://m.me/coachnoel',
    photo_url: 'https://example.test/noel.webp',
    booking_policy: null,
    accepts_requests: true,
    club: {
      id: 'club-davao',
      slug: 'rally-point-davao',
      name: 'Rally Point Davao',
      city: 'Davao City',
    },
    slots: [
      {
        slot_id: 'slot-group-1',
        starts_at: '2099-06-02T07:00:00.000Z',
        ends_at: '2099-06-02T09:00:00.000Z',
        lesson_type: 'group',
        pricing_model: 'per_student',
        rate: 400,
        max_students: 4,
        remaining_students: 3,
      },
    ],
  },
]

const sampleRequest: CoachBookingRequest = {
  request_id: 'req-1',
  slot_id: 'slot-group-1',
  club_id: 'club-davao',
  coach_id: 'coach-davao-1',
  coach_name: 'Coach Noel Ramos',
  starts_at: '2099-06-02T07:00:00.000Z',
  ends_at: '2099-06-02T09:00:00.000Z',
  lesson_type: 'group',
  pricing_model: 'per_student',
  rate: 400,
  student_count: 2,
  quoted_amount: 1600,
  message: 'Working on returns',
  status: 'requested',
  created_at: '2026-11-27T00:00:00.000Z',
}

function Where() {
  const loc = useLocation()
  return (
    <p data-testid="where">
      {`${loc.pathname}${loc.search} ${JSON.stringify(loc.state)}`}
    </p>
  )
}

function renderCoaches(initialPath = '/coaches') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/coaches" element={<PublicCoachesPage />} />
        <Route path="/login" element={<Where />} />
        <Route path="/clubs/:slug" element={<Where />} />
        <Route path="/member/coaches" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  auth.user = null
  auth.clubs = []
  auth.activeClub = null
  auth.joinClub.mockResolvedValue({
    club_id: 'club-davao',
    slug: 'rally-point-davao',
    name: 'Rally Point Davao',
    role: 'member',
  })
  vi.mocked(api.listPublicCoaches).mockResolvedValue(sampleCoaches)
  vi.mocked(api.memberRequestCoachSlot).mockResolvedValue(sampleRequest)
})

describe('PublicCoachesPage (Rent a coach)', () => {
  it('lists coaches and open lesson times across active clubs with club links and contacts', async () => {
    renderCoaches()

    expect(await screen.findByRole('heading', { level: 1, name: 'Rent a coach' })).toBeInTheDocument()
    expect(screen.getByText('3 coaches')).toBeInTheDocument()
    expect(screen.getByText('Coach Marco Santos')).toBeInTheDocument()
    expect(screen.getByText('Coach Rica Villanueva')).toBeInTheDocument()
    expect(screen.getByText('Coach Noel Ramos')).toBeInTheDocument()

    expect(screen.getAllByRole('link', { name: 'Rally Point Gensan' })[0]).toHaveAttribute(
      'href',
      '/clubs/rally-point-gensan',
    )
    expect(screen.getByRole('link', { name: 'Rally Point Davao' })).toHaveAttribute('href', '/clubs/rally-point-davao')
    expect(screen.getByRole('link', { name: 'Call Marco' })).toHaveAttribute('href', 'tel:09175550141')
    expect(screen.getAllByRole('link', { name: /Contact Marco/ })[0]).toHaveAttribute('href', 'https://m.me/coachmarco')
    expect(screen.getByText('Private lesson')).toBeInTheDocument()
    expect(screen.getByText('Group lesson · 3 places left')).toBeInTheDocument()
    expect(screen.getByText('Contact the coach or club directly to arrange a lesson.')).toBeInTheDocument()
  })

  it('filters by search, city, club, and lesson type chips, and clears filters cleanly', async () => {
    const user = userEvent.setup()
    renderCoaches()
    await screen.findByText('Coach Marco Santos')

    await user.click(screen.getByRole('button', { name: 'Group' }))
    expect(screen.getByText('1 coach')).toBeInTheDocument()
    expect(screen.getByText('Coach Noel Ramos')).toBeInTheDocument()
    expect(screen.queryByText('Coach Marco Santos')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'All coaches' }))
    await user.selectOptions(screen.getByLabelText('City'), 'General Santos City')
    expect(screen.getByText('2 coaches')).toBeInTheDocument()
    expect(screen.queryByText('Coach Noel Ramos')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'With open times' }))
    expect(screen.getByText('1 coach')).toBeInTheDocument()
    expect(screen.getByText('Coach Marco Santos')).toBeInTheDocument()
    expect(screen.queryByText('Coach Rica Villanueva')).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('Search'), 'nonexistent')
    expect(screen.getByText('No coaches match. Try another name, club, or lesson filter.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByText('3 coaches')).toBeInTheDocument()
  })

  it('honors ?club= query parameter when linked from a club page', async () => {
    renderCoaches('/coaches?club=rally-point-davao')
    await screen.findByText('Coach Noel Ramos')
    expect(screen.getByLabelText('Club')).toHaveValue('rally-point-davao')
    expect(screen.getByText('1 coach')).toBeInTheDocument()
    expect(screen.queryByText('Coach Marco Santos')).not.toBeInTheDocument()
  })

  it('sends signed-out visitors to login with the current page preserved', async () => {
    const user = userEvent.setup()
    renderCoaches('/coaches?type=group')

    const signInLinks = await screen.findAllByRole('link', { name: 'Sign in to request' })
    await user.click(signInLinks[0])
    expect(await screen.findByTestId('where')).toHaveTextContent('/login {"from":"/coaches?type=group"}')
  })

  it('lets a signed-in player request a coach time at another club by joining as player first', async () => {
    const user = userEvent.setup()
    auth.user = {
      id: 'user-member',
      email: 'mia@example.invalid',
      full_name: 'Mia Member',
      role: 'member',
      created_at: '2026-11-01',
    }
    auth.clubs = [
      { club_id: 'club-gensan', slug: 'rally-point-gensan', name: 'Rally Point Gensan', role: 'member' },
    ]
    auth.activeClub = auth.clubs[0]

    renderCoaches()
    await screen.findByText('Coach Noel Ramos')

    const noelCard = screen.getByText('Coach Noel Ramos').closest('li')!
    await user.click(within(noelCard).getByText('Request this time'))
    await user.selectOptions(within(noelCard).getByLabelText('Number of players'), '2')
    expect(within(noelCard).getByText(/Php 1,600\.00/)).toBeInTheDocument()
    await user.type(within(noelCard).getByLabelText('Note to the coach (optional)'), 'Working on returns')
    await user.click(within(noelCard).getByRole('button', { name: 'Request coach time' }))

    await waitFor(() => {
      expect(auth.joinClub).toHaveBeenCalledWith('rally-point-davao', { asPlayer: true })
      expect(api.memberRequestCoachSlot).toHaveBeenCalledWith({
        slot: expect.objectContaining({
          slot_id: 'slot-group-1',
          coach_id: 'coach-davao-1',
          club_id: 'club-davao',
          coach_name: 'Coach Noel Ramos',
        }),
        student_count: 2,
        message: 'Working on returns',
      })
    })

    expect(await screen.findByText(/Lesson request sent to Coach Noel Ramos/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open your lesson requests/ })).toHaveAttribute('href', '/member/coaches')
  })

  it('switches active club before requesting when player already belongs to that club', async () => {
    const user = userEvent.setup()
    auth.user = {
      id: 'user-member',
      email: 'mia@example.invalid',
      full_name: 'Mia Member',
      role: 'member',
      created_at: '2026-11-01',
    }
    auth.clubs = [
      { club_id: 'club-gensan', slug: 'rally-point-gensan', name: 'Rally Point Gensan', role: 'member' },
      { club_id: 'club-davao', slug: 'rally-point-davao', name: 'Rally Point Davao', role: 'member' },
    ]
    auth.activeClub = auth.clubs[0]

    renderCoaches()
    await screen.findByText('Coach Noel Ramos')

    const noelCard = screen.getByText('Coach Noel Ramos').closest('li')!
    await user.click(within(noelCard).getByText('Request this time'))
    await user.click(within(noelCard).getByRole('button', { name: 'Request coach time' }))

    await waitFor(() => {
      expect(auth.joinClub).not.toHaveBeenCalled()
      expect(auth.switchClub).toHaveBeenCalledWith('club-davao')
      expect(api.memberRequestCoachSlot).toHaveBeenCalledTimes(1)
    })
  })

  it('shows read-only role notices to staff, admins, and superadmins without request forms', async () => {
    auth.user = {
      id: 'user-staff',
      email: 'staff@example.invalid',
      full_name: 'Sam Staff',
      role: 'staff',
      created_at: '2026-11-01',
    }
    const staffView = renderCoaches()
    expect(
      await screen.findByText('Staff and admin accounts cannot request lessons here. Sign in with a player account to book a coach.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Request this time')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Sign in to request' })).not.toBeInTheDocument()
    staffView.unmount()

    auth.user = {
      id: 'user-super',
      email: 'super@example.invalid',
      full_name: 'Morgan Super',
      role: 'superadmin',
      created_at: '2026-11-01',
    }
    renderCoaches()
    expect(await screen.findByText('Platform accounts can look but cannot book.')).toBeInTheDocument()
    expect(screen.queryByText('Request this time')).not.toBeInTheDocument()
  })

  it('blocks lesson requests for a club where the member holds a staff or admin role', async () => {
    auth.user = {
      id: 'user-multi',
      email: 'multi@example.invalid',
      full_name: 'Multi User',
      role: 'member',
      created_at: '2026-11-01',
    }
    auth.clubs = [
      { club_id: 'club-davao', slug: 'rally-point-davao', name: 'Rally Point Davao', role: 'member' },
      { club_id: 'club-gensan', slug: 'rally-point-gensan', name: 'Rally Point Gensan', role: 'staff' },
    ]
    auth.activeClub = auth.clubs[0]

    renderCoaches()
    await screen.findByText('Coach Marco Santos')
    const marcoCard = screen.getByText('Coach Marco Santos').closest('li')!
    expect(within(marcoCard).getByText('Only player accounts at this club can request lessons.')).toBeInTheDocument()
    expect(within(marcoCard).queryByText('Request this time')).not.toBeInTheDocument()
  })

  it('recovers from load failure on Try again and surfaces request errors', async () => {
    const user = userEvent.setup()
    vi.mocked(api.listPublicCoaches).mockRejectedValueOnce(new Error('Coach list offline'))
    const first = renderCoaches()

    expect(await screen.findByRole('alert')).toHaveTextContent('Coach list offline')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Coach Marco Santos')).toBeInTheDocument()
    first.unmount()

    auth.user = {
      id: 'user-member',
      email: 'mia@example.invalid',
      full_name: 'Mia Member',
      role: 'member',
      created_at: '2026-11-01',
    }
    auth.clubs = [
      { club_id: 'club-gensan', slug: 'rally-point-gensan', name: 'Rally Point Gensan', role: 'member' },
    ]
    auth.activeClub = auth.clubs[0]
    vi.mocked(api.memberRequestCoachSlot).mockRejectedValueOnce(new Error('Slot was just taken'))

    renderCoaches()
    const marcoCard = (await screen.findByText('Coach Marco Santos')).closest('li')!
    await user.click(within(marcoCard).getByText('Request this time'))
    await user.click(within(marcoCard).getByRole('button', { name: 'Request coach time' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Slot was just taken')
  })
})
