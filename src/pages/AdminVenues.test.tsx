import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Court, CourtPhoto, Venue } from '../types'
import { AdminVenues } from './AdminVenues'

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'admin-1', email: 'admin@example.com', full_name: 'Ada Admin', role: 'admin', created_at: '2026-09-01T00:00:00.000Z' },
    activeClub: { club_id: 'club-1', slug: 'club-one', name: 'Club One', role: 'admin' },
    clubs: [],
    switchClub: vi.fn(),
    signOut: vi.fn(),
  }),
}))

vi.mock('../lib/api', () => ({
  api: {
    listAllVenues: vi.fn(),
    listCourts: vi.fn(),
    staffAccounts: vi.fn(),
    upsertVenue: vi.fn(),
    upsertCourt: vi.fn(),
    updateVenueLocation: vi.fn(),
    setStaffVenueGrant: vi.fn(),
    listCourtPhotos: vi.fn(),
    addCourtPhoto: vi.fn(),
    makeMainCourtPhoto: vi.fn(),
    removeCourtPhoto: vi.fn(),
    setVenueCover: vi.fn(),
  },
}))

import { api } from '../lib/api'

const mainVenue: Venue = {
  id: 'venue-main', club_id: 'club-1', slug: 'main', name: 'Main Venue',
  timezone: 'Asia/Manila', open_hour: 6, close_hour: 22, is_active: true,
}
const eastVenue: Venue = { ...mainVenue, id: 'venue-east', slug: 'east', name: 'East Venue' }
const courtA: Court = { id: 'court-a', club_id: 'club-1', venue_id: 'venue-main', name: 'Court A', status: 'available', hourly_rate: 500 }
const courtB: Court = { id: 'court-b', club_id: 'club-1', venue_id: 'venue-main', name: 'Court B', status: 'maintenance', hourly_rate: 650 }

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminVenues />
    </MemoryRouter>,
  )
}

function venueCard(name: string) {
  const card = screen.getByRole('heading', { name }).closest('section')
  if (!card) throw new Error(`Expected a card for ${name}`)
  return within(card)
}

describe('AdminVenues courts', () => {
  beforeEach(() => {
    vi.mocked(api.listAllVenues).mockReset().mockResolvedValue([mainVenue, eastVenue])
    vi.mocked(api.listCourts).mockReset().mockResolvedValue([courtA, courtB])
    vi.mocked(api.staffAccounts).mockReset().mockResolvedValue([])
    vi.mocked(api.upsertCourt).mockReset()
    vi.mocked(api.listCourtPhotos).mockReset().mockResolvedValue([])
  })

  it("lists each venue's courts with rate and status, and warns when a venue has none", async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Main Venue' })

    const main = venueCard('Main Venue')
    expect(main.getByText('Court A')).toBeInTheDocument()
    expect(main.getByText('Php 500.00 per hour')).toBeInTheDocument()
    expect(main.getByText('In service')).toBeInTheDocument()
    expect(main.getByText('Out of service')).toBeInTheDocument()
    expect(main.queryByRole('note')).not.toBeInTheDocument()

    const east = venueCard('East Venue')
    expect(east.getByRole('note')).toHaveTextContent('No courts yet. Players cannot book this venue until you add one.')
    expect(api.listCourts).toHaveBeenCalledWith()
  })

  it('adds a court to the chosen venue', async () => {
    const user = userEvent.setup()
    vi.mocked(api.upsertCourt).mockResolvedValue({ ...courtA, id: 'court-new', venue_id: 'venue-east', name: 'East 1', hourly_rate: 450 })
    renderPage()
    await screen.findByRole('heading', { name: 'East Venue' })

    await user.click(screen.getByRole('button', { name: 'Add a court to East Venue' }))
    const form = within(screen.getByRole('form', { name: 'Add a court to East Venue' }))
    await user.type(form.getByLabelText('Court name'), 'East 1')
    await user.clear(form.getByLabelText('Hourly rate (Php)'))
    await user.type(form.getByLabelText('Hourly rate (Php)'), '450')
    await user.click(form.getByRole('button', { name: 'Add court' }))

    expect(api.upsertCourt).toHaveBeenCalledWith({
      id: undefined, venue_id: 'venue-east', name: 'East 1', hourly_rate: 450, member_rate: null, in_service: true,
    })
    expect(await screen.findByRole('status')).toHaveTextContent('East 1 added')
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Add a court to East Venue' })).not.toBeInTheDocument())
  })

  it('takes a court out of service from its edit form', async () => {
    const user = userEvent.setup()
    vi.mocked(api.upsertCourt).mockResolvedValue({ ...courtA, status: 'maintenance' })
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Edit Court A' }))
    const form = within(screen.getByRole('form', { name: 'Edit Court A' }))
    expect(form.getByLabelText('Court name')).toHaveValue('Court A')
    expect(form.getByLabelText('Hourly rate (Php)')).toHaveValue(500)
    await user.click(form.getByRole('checkbox', { name: /In service/ }))
    await user.click(form.getByRole('button', { name: 'Save court' }))

    expect(api.upsertCourt).toHaveBeenCalledWith({
      id: 'court-a', venue_id: 'venue-main', name: 'Court A', hourly_rate: 500, member_rate: null, in_service: false,
    })
  })

  it("saves a location's address and map pin", async () => {
    const user = userEvent.setup()
    vi.mocked(api.updateVenueLocation).mockResolvedValue({ ...eastVenue, address: '9 Sample Ave', city: 'Davao City', latitude: 7.1, longitude: 125.6 })
    renderPage()
    await screen.findByRole('heading', { name: 'East Venue' })

    const east = venueCard('East Venue')
    expect(east.getByText(/No address yet/)).toBeInTheDocument()
    await user.click(east.getByRole('button', { name: 'Add address and map pin' }))
    const form = within(screen.getByRole('form', { name: 'Location of East Venue' }))
    await user.type(form.getByLabelText('Street address'), '9 Sample Ave')
    await user.type(form.getByLabelText('City'), 'Davao City')
    await user.type(form.getByLabelText('Latitude'), '7.1')
    await user.type(form.getByLabelText('Longitude'), '125.6')
    await user.click(form.getByRole('button', { name: 'Save location' }))

    expect(api.updateVenueLocation).toHaveBeenCalledWith({
      venue_id: 'venue-east', address: '9 Sample Ave', city: 'Davao City', latitude: 7.1, longitude: 125.6,
    })
    expect(await screen.findByRole('status')).toHaveTextContent('Location saved')
  })

  it('sets a member rate, and shows it on the court', async () => {
    const user = userEvent.setup()
    vi.mocked(api.upsertCourt).mockResolvedValue({ ...courtA, member_rate: 400 })
    vi.mocked(api.listCourts).mockResolvedValueOnce([courtA, courtB]).mockResolvedValue([{ ...courtA, member_rate: 400 }, courtB])
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Edit Court A' }))
    const form = within(screen.getByRole('form', { name: 'Edit Court A' }))
    await user.type(form.getByLabelText('Member rate (Php, optional)'), '400')
    await user.click(form.getByRole('button', { name: 'Save court' }))

    expect(api.upsertCourt).toHaveBeenCalledWith(expect.objectContaining({ id: 'court-a', hourly_rate: 500, member_rate: 400 }))
    expect(await screen.findByText('Members Php 400.00 per hour')).toBeInTheDocument()
  })

  it('keeps the form open and shows the reason when saving fails', async () => {
    const user = userEvent.setup()
    vi.mocked(api.upsertCourt).mockRejectedValue(new Error('This venue already has a court with that name'))
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Add a court to Main Venue' }))
    const form = within(screen.getByRole('form', { name: 'Add a court to Main Venue' }))
    await user.type(form.getByLabelText('Court name'), 'court a')
    await user.click(form.getByRole('button', { name: 'Add court' }))

    expect(await screen.findByRole('status')).toHaveTextContent('This venue already has a court with that name')
    expect(screen.getByRole('form', { name: 'Add a court to Main Venue' })).toBeInTheDocument()
  })
})

const photoOf = (id: string, courtId: string | null, position = 0): CourtPhoto => ({
  id, club_id: 'club-1', venue_id: 'venue-main', court_id: courtId, path: `p/${id}.webp`,
  url: `https://example.test/${id}.webp`, position, created_at: '2026-10-23T00:00:00.000Z',
})

describe('AdminVenues photos', () => {
  beforeEach(() => {
    vi.mocked(api.listAllVenues).mockReset().mockResolvedValue([mainVenue, eastVenue])
    vi.mocked(api.listCourts).mockReset().mockResolvedValue([courtA, courtB])
    vi.mocked(api.staffAccounts).mockReset().mockResolvedValue([])
    vi.mocked(api.listCourtPhotos).mockReset().mockResolvedValue([])
    vi.mocked(api.addCourtPhoto).mockReset()
    vi.mocked(api.removeCourtPhoto).mockReset().mockResolvedValue()
    vi.mocked(api.makeMainCourtPhoto).mockReset().mockResolvedValue()
    vi.mocked(api.setVenueCover).mockReset().mockResolvedValue()
  })

  it('uploads several photos to a court, one at a time', async () => {
    const user = userEvent.setup()
    vi.mocked(api.addCourtPhoto).mockImplementation(async (courtId) => photoOf('new', courtId))
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Photos of Court A (0)' }))
    const editor = within(screen.getByRole('group', { name: 'Photos of Court A' }))
    expect(editor.getByText('No photos yet. Players see a sample picture until you add one.')).toBeInTheDocument()
    const files = [new File(['a'], 'a.jpg', { type: 'image/jpeg' }), new File(['b'], 'b.png', { type: 'image/png' })]
    await user.upload(editor.getByLabelText('Add photos'), files)

    await waitFor(() => expect(api.addCourtPhoto).toHaveBeenCalledTimes(2))
    expect(api.addCourtPhoto).toHaveBeenNthCalledWith(1, 'court-a', files[0])
    expect(api.addCourtPhoto).toHaveBeenNthCalledWith(2, 'court-a', files[1])
    expect(await screen.findByText('2 photos added to Court A')).toBeInTheDocument()
  })

  it('marks the main photo, changes it, and removes a photo only after confirming', async () => {
    const user = userEvent.setup()
    vi.mocked(api.listCourtPhotos).mockResolvedValue([photoOf('one', 'court-a', 0), photoOf('two', 'court-a', 1)])
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Photos of Court A (2)' }))
    const editor = within(screen.getByRole('group', { name: 'Photos of Court A' }))
    expect(editor.getByRole('img', { name: 'Court A photo 1' })).toHaveAttribute('src', 'https://example.test/one.webp')
    expect(editor.getByText('Main photo')).toBeInTheDocument()
    expect(editor.queryByRole('button', { name: 'Make photo 1 the main photo of Court A' })).not.toBeInTheDocument()

    await user.click(editor.getByRole('button', { name: 'Make photo 2 the main photo of Court A' }))
    expect(api.makeMainCourtPhoto).toHaveBeenCalledWith('two')

    await user.click(await screen.findByRole('button', { name: 'Remove photo 2 of Court A' }))
    expect(api.removeCourtPhoto).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Remove photo 2 of Court A' }))
    expect(api.removeCourtPhoto).toHaveBeenCalledWith('two')
    expect(confirm).toHaveBeenCalledTimes(2)
    confirm.mockRestore()
  })

  it("sets a location's cover photo", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('heading', { name: 'East Venue' })

    const file = new File(['c'], 'cover.jpg', { type: 'image/jpeg' })
    await user.upload(venueCard('East Venue').getByLabelText('Add cover photo'), file)
    expect(api.setVenueCover).toHaveBeenCalledWith('venue-east', file)
    expect(await screen.findByText('Cover photo saved')).toBeInTheDocument()
  })

  it('still manages courts when photos cannot load', async () => {
    vi.mocked(api.listCourtPhotos).mockRejectedValue(new Error('relation "court_photos" does not exist'))
    renderPage()
    await screen.findByRole('heading', { name: 'Main Venue' })

    expect(venueCard('Main Venue').getByText('Court A')).toBeInTheDocument()
    expect(venueCard('Main Venue').getByText('Photos are not available yet on this system.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Photos of Court A/ })).not.toBeInTheDocument()
  })
})
