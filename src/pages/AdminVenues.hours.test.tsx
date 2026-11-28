import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Venue } from '../types'
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
  },
}))

import { api } from '../lib/api'

const venue: Venue = {
  id: 'venue-main', club_id: 'club-1', slug: 'main', name: 'Main Venue',
  timezone: 'Asia/Manila', open_hour: 0, close_hour: 24, is_active: true,
}

describe('AdminVenues opening hours', () => {
  beforeEach(() => {
    vi.mocked(api.listAllVenues).mockReset().mockResolvedValue([venue])
    vi.mocked(api.listCourts).mockReset().mockResolvedValue([])
    vi.mocked(api.staffAccounts).mockReset().mockResolvedValue([])
    vi.mocked(api.listCourtPhotos).mockReset().mockResolvedValue([])
    vi.mocked(api.upsertVenue).mockReset().mockResolvedValue({ ...venue, open_hour: 6, close_hour: 22 })
  })

  it('shows each venue’s hours and saves new ones', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><AdminVenues /></MemoryRouter>)
    const card = within((await screen.findByRole('heading', { name: 'Main Venue' })).closest('section')!)
    expect(card.getByText('Open 24 hours, Philippine time')).toBeInTheDocument()

    await user.click(card.getByRole('button', { name: 'Change opening hours' }))
    await user.selectOptions(card.getByLabelText('Opens'), '6')
    await user.selectOptions(card.getByLabelText('Closes'), '22')
    await user.click(card.getByRole('button', { name: 'Save hours' }))

    await waitFor(() => expect(api.upsertVenue).toHaveBeenCalledWith(expect.objectContaining({
      id: 'venue-main', slug: 'main', name: 'Main Venue', open_hour: 6, close_hour: 22, is_active: true,
    })))
  })

  it('moves focus into the hours form, and back to its button on cancel', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><AdminVenues /></MemoryRouter>)
    const card = within((await screen.findByRole('heading', { name: 'Main Venue' })).closest('section')!)

    await user.click(card.getByRole('button', { name: 'Change opening hours' }))
    expect(card.getByLabelText('Opens')).toHaveFocus()
    await user.click(card.getByRole('button', { name: 'Cancel' }))
    expect(card.getByRole('button', { name: 'Change opening hours' })).toHaveFocus()
  })

  it('will not save a closing time before the opening time', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><AdminVenues /></MemoryRouter>)
    const card = within((await screen.findByRole('heading', { name: 'Main Venue' })).closest('section')!)

    await user.click(card.getByRole('button', { name: 'Change opening hours' }))
    await user.selectOptions(card.getByLabelText('Opens'), '20')
    await user.selectOptions(card.getByLabelText('Closes'), '8')
    expect(card.getByRole('alert')).toHaveTextContent('Closing time must be after opening time.')
    expect(card.getByRole('button', { name: 'Save hours' })).toBeDisabled()
    expect(api.upsertVenue).not.toHaveBeenCalled()
  })
})
