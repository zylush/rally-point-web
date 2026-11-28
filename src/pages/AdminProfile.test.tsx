import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminClubProfile, ClubAddon } from '../types'
import { emptyClubProfile } from '../lib/clubProfile'
import { AdminProfile } from './AdminProfile'

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
    adminClubProfile: vi.fn(),
    updateClubProfile: vi.fn(),
    upsertClubAddon: vi.fn(),
    removeClubAddon: vi.fn(),
    upsertClubCoach: vi.fn(),
    setClubCoachPhoto: vi.fn(),
    removeClubCoach: vi.fn(),
    upsertClubPaymentMethod: vi.fn(),
    setClubPaymentQr: vi.fn(),
    removeClubPaymentMethod: vi.fn(),
    addClubPhoto: vi.fn(),
    removeClubPhoto: vi.fn(),
    unusedClubPictures: vi.fn(),
    deleteUnusedClubPictures: vi.fn(),
  },
}))

import { api } from '../lib/api'

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

const paddles: ClubAddon = {
  id: 'addon-1', club_id: 'club-1', name: 'Paddle rental', description: null, price: 100,
  unit: 'per_hour', is_active: true, position: 0, created_at: '2026-11-15T00:00:00.000Z',
}

const loaded: AdminClubProfile = {
  profile: { ...emptyClubProfile(), about: 'Six indoor courts.', amenities: ['parking'] },
  addons: [paddles, { ...paddles, id: 'addon-2', name: 'Ball rental', price: 50, unit: 'per_item', is_active: false, position: 1 }],
  coaches: [],
  payment_methods: [],
  gallery: [],
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminProfile />
    </MemoryRouter>,
  )
}

describe('AdminProfile', () => {
  afterEach(() => {
    if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard)
    else Reflect.deleteProperty(navigator, 'clipboard')
  })

  beforeEach(() => {
    vi.mocked(api.adminClubProfile).mockReset().mockResolvedValue(loaded)
    vi.mocked(api.updateClubProfile).mockReset().mockResolvedValue(undefined)
    vi.mocked(api.upsertClubAddon).mockReset()
    vi.mocked(api.removeClubAddon).mockReset().mockResolvedValue(undefined)
    vi.mocked(api.addClubPhoto).mockReset()
    vi.mocked(api.unusedClubPictures).mockReset().mockResolvedValue([])
    vi.mocked(api.deleteUnusedClubPictures).mockReset()
  })

  it('moves focus into a form when it opens, and back to its button when it closes', async () => {
    const user = userEvent.setup()
    renderPage()
    const addons = within(await screen.findByRole('region', { name: 'Add-ons' }))

    await user.click(addons.getByRole('button', { name: 'Add an add-on' }))
    expect(within(addons.getByRole('form', { name: 'Add an add-on' })).getByLabelText('Name')).toHaveFocus()
    await user.click(addons.getByRole('button', { name: 'Cancel' }))
    expect(addons.getByRole('button', { name: 'Add an add-on' })).toHaveFocus()

    await user.click(addons.getByRole('button', { name: 'Edit Paddle rental' }))
    expect(within(addons.getByRole('form', { name: 'Edit Paddle rental' })).getByLabelText('Name')).toHaveFocus()
    await user.click(addons.getByRole('button', { name: 'Cancel' }))
    expect(addons.getByRole('button', { name: 'Edit Paddle rental' })).toHaveFocus()
  })

  it('moves focus to the section heading after a removal, since the row is gone', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderPage()
    const addons = within(await screen.findByRole('region', { name: 'Add-ons' }))

    await user.click(addons.getByRole('button', { name: 'Remove Paddle rental' }))
    await waitFor(() => expect(addons.getByRole('heading', { name: 'Add-ons' })).toHaveFocus())
    expect(api.removeClubAddon).toHaveBeenCalledWith('addon-1')
    confirm.mockRestore()
  })

  it('offers to delete picture files nothing uses any more', async () => {
    const user = userEvent.setup()
    vi.mocked(api.unusedClubPictures).mockResolvedValueOnce(['club-1/gallery/a.webp', 'club-1/payment/b.webp']).mockResolvedValue([])
    vi.mocked(api.deleteUnusedClubPictures).mockResolvedValue({ deleted: 2, left: 0, more: false })
    renderPage()

    const card = within(await screen.findByRole('region', { name: 'Old picture files' }))
    expect(card.getByText(/2 old picture files are no longer used/)).toBeInTheDocument()
    await user.click(card.getByRole('button', { name: 'Delete old picture files' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Old picture files deleted')
    expect(api.deleteUnusedClubPictures).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('region', { name: 'Old picture files' })).not.toBeInTheDocument()
  })

  it('keeps the old-files card, and focus on its button, when a file could not be deleted', async () => {
    const user = userEvent.setup()
    vi.mocked(api.unusedClubPictures).mockResolvedValueOnce(['club-1/gallery/a.webp', 'club-1/payment/b.webp'])
      .mockResolvedValue(['club-1/payment/b.webp'])
    vi.mocked(api.deleteUnusedClubPictures).mockResolvedValue({ deleted: 1, left: 1, more: false })
    renderPage()

    const card = within(await screen.findByRole('region', { name: 'Old picture files' }))
    await user.click(card.getByRole('button', { name: 'Delete old picture files' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('1 file could not be deleted. Try again later.')
    expect(card.getByText(/1 old picture file is no longer used/)).toBeInTheDocument()
    await waitFor(() => expect(card.getByRole('button', { name: 'Delete old picture files' })).toHaveFocus())
  })

  it('keeps a problem on screen until it is closed', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.type(await screen.findByLabelText('Website (optional)'), 'https://192.168.0.1/')
    await user.click(screen.getByRole('button', { name: 'Save business details' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('The website link must start with https:// and name a web address')
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('clears a done message by itself after a few seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      renderPage()
      await user.click(await screen.findByRole('button', { name: 'Save business details' }))
      expect(await screen.findByRole('status')).toHaveTextContent('Saved. Players see it on your club page now.')
      act(() => { vi.advanceTimersByTime(4000) })
      expect(screen.queryByText('Saved. Players see it on your club page now.')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows no old-files card when every picture is in use', async () => {
    renderPage()
    await screen.findByLabelText('About your club')
    await waitFor(() => expect(api.unusedClubPictures).toHaveBeenCalled())
    expect(screen.queryByRole('region', { name: 'Old picture files' })).not.toBeInTheDocument()
  })

  it('loads the saved profile and lists add-ons, marking hidden ones', async () => {
    renderPage()
    expect(await screen.findByLabelText('About your club')).toHaveValue('Six indoor courts.')
    expect(screen.getByRole('checkbox', { name: 'Parking' })).toBeChecked()
    expect(screen.getByRole('link', { name: /See your club page/ })).toHaveAttribute('href', '/clubs/club-one')

    const addons = within(screen.getByRole('region', { name: 'Add-ons' }))
    expect(addons.getByText('Paddle rental')).toBeInTheDocument()
    expect(addons.getByText('Php 100.00 per hour')).toBeInTheDocument()
    expect(addons.getAllByText('Hidden')).toHaveLength(1)
  })

  it('shows and copies a direct public booking link for the active club', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    renderPage()

    const link = 'https://brinely.info/#/clubs/club-one/book'
    expect(await screen.findByLabelText('Booking link')).toHaveValue(link)
    expect(screen.getByRole('link', { name: /Open booking page/ })).toHaveAttribute('href', '/clubs/club-one/book')

    await user.click(screen.getByRole('button', { name: 'Copy link' }))
    expect(writeText).toHaveBeenCalledWith(link)
    expect(await screen.findByRole('status')).toHaveTextContent('Booking link copied.')
  })

  it('shows a useful error when copying the booking link fails', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockRejectedValue(new Error('Permission denied'))
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Copy link' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not copy the booking link. Permission denied')
    expect(screen.getByLabelText('Booking link')).toHaveValue('https://brinely.info/#/clubs/club-one/book')
  })

  it('saves business details, and refuses a Facebook link to another site before sending it', async () => {
    const user = userEvent.setup()
    renderPage()
    const facebook = await screen.findByLabelText('Facebook page link (optional)')

    await user.type(facebook, 'https://facebook.com.evil.example/page')
    await user.click(screen.getByRole('button', { name: 'Save business details' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The Facebook link must start with https://facebook.com/ or https://fb.com/')
    expect(api.updateClubProfile).not.toHaveBeenCalled()

    await user.clear(facebook)
    await user.type(facebook, 'https://facebook.com/clubone   ')
    await user.click(screen.getByRole('checkbox', { name: 'Lights for night play' }))
    await user.click(screen.getByRole('button', { name: 'Save business details' }))
    // The tidied text is what gets sent.
    await waitFor(() => expect(api.updateClubProfile).toHaveBeenCalledWith(expect.objectContaining({
      about: 'Six indoor courts.',
      facebook_url: 'https://facebook.com/clubone',
      amenities: ['night_lights', 'parking'],
    })))
    expect(await screen.findByRole('status')).toHaveTextContent('Saved. Players see it on your club page now.')
  })

  it('keeps the form when a save works but the lists cannot be refreshed', async () => {
    const user = userEvent.setup()
    vi.mocked(api.adminClubProfile).mockReset()
      .mockResolvedValueOnce(loaded)
      .mockRejectedValueOnce(new Error('Network error'))
    renderPage()
    const about = await screen.findByLabelText('About your club')
    await user.click(screen.getByRole('button', { name: 'Save business details' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Saved. Players see it on your club page now. The lists could not be refreshed, so reload the page to see the latest.',
    )
    expect(about).toHaveValue('Six indoor courts.')
    expect(screen.queryByText(/could not be loaded/)).not.toBeInTheDocument()
  })

  it('makes the other save buttons wait while one save is running', async () => {
    const user = userEvent.setup()
    let finish = () => {}
    vi.mocked(api.updateClubProfile).mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve }))
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Save business details' }))

    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save rules and terms' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save payment note' })).toBeDisabled()

    finish()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save rules and terms' })).toBeEnabled())
  })

  it('refreshes the gallery when one of several photos fails, and keeps the caption', async () => {
    const user = userEvent.setup()
    const stored = {
      id: 'g-1', club_id: 'club-1', path: 'club-1/gallery/a.webp', url: 'https://example.test/a.webp',
      caption: 'Opening night', position: 0, created_at: '2026-11-15T00:00:00.000Z',
    }
    vi.mocked(api.adminClubProfile).mockReset()
      .mockResolvedValueOnce(loaded)
      .mockResolvedValue({ ...loaded, gallery: [stored] })
    vi.mocked(api.addClubPhoto).mockReset()
      .mockResolvedValueOnce(stored)
      .mockRejectedValueOnce(new Error('The upload failed'))
    renderPage()

    const gallery = within(await screen.findByRole('region', { name: 'Photo gallery' }))
    await user.type(gallery.getByLabelText(/Caption/), 'Opening night')
    const files = ['a', 'b', 'c'].map((name) => new File(['x'], `${name}.jpg`, { type: 'image/jpeg' }))
    await user.upload(gallery.getByLabelText('Add photos'), files)

    expect(await screen.findByRole('alert')).toHaveTextContent('1 added, then: The upload failed')
    expect(api.addClubPhoto).toHaveBeenCalledTimes(2)
    // The list was refreshed after the failure, so the photo that did save shows.
    expect(await gallery.findByText('1 of 12 photos.', { exact: false })).toBeInTheDocument()
    expect(gallery.getByLabelText(/Caption/)).toHaveValue('Opening night')
  })

  it('adds an add-on with its price and unit', async () => {
    const user = userEvent.setup()
    vi.mocked(api.upsertClubAddon).mockResolvedValue({ ...paddles, id: 'addon-3', name: 'Towels' })
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Add an add-on' }))

    const form = within(screen.getByRole('form', { name: 'Add an add-on' }))
    await user.type(form.getByLabelText('Name'), 'Towels')
    await user.type(form.getByLabelText('Price (Php)'), '20')
    await user.selectOptions(form.getByLabelText('Charged'), 'per_item')
    await user.click(form.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(api.upsertClubAddon).toHaveBeenCalledWith({
      id: undefined, name: 'Towels', description: null, price: 20, unit: 'per_item', is_active: true,
    }))
  })

  it('says so when the profile cannot be loaded, and can try again', async () => {
    vi.mocked(api.adminClubProfile).mockRejectedValueOnce(new Error('admin access required'))
    renderPage()
    expect(await screen.findByText(/The business profile could not be loaded/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByLabelText('About your club')).toHaveValue('Six indoor courts.')
  })
})
