import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MyClub, Profile } from '../types'
import { AccountMenu } from './AccountMenu'

const auth = vi.hoisted(() => ({
  user: null as Profile | null,
  clubs: [] as MyClub[],
  activeClub: null as MyClub | null,
  signOut: vi.fn(),
  switchClub: vi.fn(),
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ ...auth, loading: false, demo: true }),
}))

const pia: Profile = {
  id: 'u1',
  email: 'pia@example.invalid',
  full_name: 'Pia Cruz',
  nickname: 'Pi',
  photo_path: null,
  role: 'member',
  created_at: '2026-09-01',
}

beforeEach(() => {
  auth.user = { ...pia }
  auth.clubs = []
  auth.activeClub = null
  auth.signOut.mockReset()
})

function renderMenu() {
  return render(
    <MemoryRouter initialEntries={['/clubs']}>
      <AccountMenu />
      <p>Outside</p>
    </MemoryRouter>,
  )
}

describe('AccountMenu', () => {
  it('shows who is signed in and opens a list of their pages', async () => {
    const user = userEvent.setup()
    renderMenu()
    const button = screen.getByRole('button', { name: 'Account menu for Pia Cruz' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).toHaveTextContent('Pi')
    expect(screen.queryByRole('navigation', { name: 'Your account' })).not.toBeInTheDocument()

    await user.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    const menu = within(screen.getByRole('navigation', { name: 'Your account' }))
    expect(menu.getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['My QR codes', '/member/pass'],
      ['My bookings', '/member/book'],
      ['Account & memberships', '/member'],
      ['Open play', '/member/open'],
      ['Rent a coach', '/member/coaches'],
      ['Messages', '/member/notifications'],
      ['Payments', '/member/transactions'],
      ['Help', '/member/help'],
    ])
    expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument()
  })

  it('closes with Escape and gives focus back to the button', async () => {
    const user = userEvent.setup()
    renderMenu()
    const button = screen.getByRole('button', { name: /Account menu/ })
    await user.click(button)
    await user.keyboard('{Escape}')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).toHaveFocus()
  })

  it('closes when tapping elsewhere on the page', async () => {
    const user = userEvent.setup()
    renderMenu()
    const button = screen.getByRole('button', { name: /Account menu/ })
    await user.click(button)
    await user.click(screen.getByText('Outside'))
    expect(button).toHaveAttribute('aria-expanded', 'false')
  })

  it('keeps the Log out confirmation open, and signs out only when confirmed', async () => {
    const user = userEvent.setup()
    renderMenu()
    await user.click(screen.getByRole('button', { name: /Account menu/ }))
    await user.click(screen.getByRole('button', { name: 'Log out' }))
    const dialog = screen.getByRole('dialog', { name: 'Log out?' })
    expect(auth.signOut).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Log out' }))
    expect(auth.signOut).toHaveBeenCalledTimes(1)
  })

  it('offers the club switcher only to someone in more than one club', async () => {
    const user = userEvent.setup()
    auth.clubs = [
      { club_id: 'c1', slug: 'gensan', name: 'Rally Point Gensan', role: 'member' },
      { club_id: 'c2', slug: 'davao', name: 'Rally Point Davao', role: 'member' },
    ]
    auth.activeClub = auth.clubs[0]
    renderMenu()
    await user.click(screen.getByRole('button', { name: /Account menu/ }))
    expect(screen.getByRole('combobox', { name: 'Club' })).toHaveValue('c1')
  })

  it('shows nothing to someone signed out', () => {
    auth.user = null
    renderMenu()
    expect(screen.queryByRole('button', { name: /Account menu/ })).not.toBeInTheDocument()
  })
})
