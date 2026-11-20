import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ownerCallDateRange } from '../lib/ownerRequests'
import { OwnersPage } from './Owners'

const requestOwnerCall = vi.hoisted(() => vi.fn())

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: null, loading: false, activeClub: null, clubs: [], switchClub: vi.fn(), signOut: vi.fn() }),
}))

vi.mock('../lib/api', () => ({ api: { requestOwnerCall } }))

function renderPage() {
  return render(
    <MemoryRouter>
      <OwnersPage />
    </MemoryRouter>,
  )
}

async function fillIn(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Your name'), 'Ana Reyes')
  await user.type(screen.getByLabelText('Club or venue name'), 'Lagao Smash Courts')
  await user.type(screen.getByLabelText('City'), 'General Santos City')
  await user.clear(screen.getByLabelText('Number of courts'))
  await user.type(screen.getByLabelText('Number of courts'), '4')
  await user.type(screen.getByLabelText('Mobile number (optional)'), '0917 555 0101')
  await user.click(screen.getByRole('radio', { name: /Afternoon/ }))
}

beforeEach(() => {
  requestOwnerCall.mockReset()
  requestOwnerCall.mockResolvedValue('request-1')
})

describe('OwnersPage', () => {
  it('explains how listing works and offers a call and an owner account', () => {
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: 'List your club' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Put your courts on bRineLy' })).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByRole('link', { name: 'Create my owner account' })).toHaveAttribute('href', '/login')
    expect(screen.getByLabelText('Day for the call')).toHaveAttribute('min', ownerCallDateRange().min)
  })

  it('shows the first problem in plain words before sending anything', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Ask for a call' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Enter your name (2 to 80 characters)')

    await fillIn(user)
    await user.click(screen.getByRole('button', { name: 'Ask for a call' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Tick the box so we may contact you')
    expect(requestOwnerCall).not.toHaveBeenCalled()
  })

  it('sends the request and confirms when we will call', async () => {
    const user = userEvent.setup()
    renderPage()
    await fillIn(user)
    await user.click(screen.getByRole('checkbox', { name: /bRineLy may contact me/ }))
    await user.click(screen.getByRole('button', { name: 'Ask for a call' }))

    expect(requestOwnerCall).toHaveBeenCalledWith({
      full_name: 'Ana Reyes',
      club_name: 'Lagao Smash Courts',
      city: 'General Santos City',
      court_count: 4,
      phone: '0917 555 0101',
      email: '',
      preferred_date: ownerCallDateRange().min,
      preferred_time: 'afternoon',
      message: '',
    })
    const thanks = await screen.findByRole('status')
    expect(thanks).toHaveTextContent('Thank you, Ana')
    expect(thanks).toHaveTextContent('afternoon (12 noon to 5 pm)')
    expect(thanks).toHaveTextContent('Lagao Smash Courts')
    expect(thanks).toHaveTextContent('We will use 0917 555 0101')
    expect(screen.queryByRole('button', { name: 'Ask for a call' })).not.toBeInTheDocument()
  })

  it('shows the database message when a request is refused', async () => {
    requestOwnerCall.mockRejectedValue(new Error('You already asked us to call. We will contact you soon.'))
    const user = userEvent.setup()
    renderPage()
    await fillIn(user)
    await user.click(screen.getByRole('checkbox', { name: /bRineLy may contact me/ }))
    await user.click(screen.getByRole('button', { name: 'Ask for a call' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('You already asked us to call. We will contact you soon.')
    expect(screen.getByRole('button', { name: 'Ask for a call' })).toBeEnabled()
  })

  it('quietly drops a request when the hidden field was filled in by a bot', async () => {
    const user = userEvent.setup()
    const { container } = renderPage()
    await fillIn(user)
    await user.click(screen.getByRole('checkbox', { name: /bRineLy may contact me/ }))
    await user.type(container.querySelector('input[name="website"]')!, 'http://spam.example')
    await user.click(screen.getByRole('button', { name: 'Ask for a call' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Thank you, Ana')
    expect(requestOwnerCall).not.toHaveBeenCalled()
  })
})
