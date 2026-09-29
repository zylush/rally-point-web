import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { Role } from '../types'
import { AppHeader, AppShell, BottomNav } from './Shell'

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: {
      email: 'member@rallypoint.local',
      full_name: 'Demo Member',
    },
    signOut: vi.fn(),
  }),
}))

const roleLinks: Record<Role, Array<[label: string, href: string]>> = {
  member: [
    ['Home', '/member'],
    ['Book', '/member/book'],
    ['Play', '/member/open'],
    ['My QR', '/member/pass'],
    ['Account', '/member/profile'],
    ['Help', '/member/help'],
  ],
  staff: [
    ['Home', '/staff'],
    ['Check in', '/staff/checkin'],
    ['Schedule', '/staff/board'],
    ['Open play', '/staff/open'],
    ['Courts', '/staff/courts'],
    ['Help', '/staff/help'],
  ],
  admin: [
    ['Home', '/admin'],
    ['Floor', '/admin/ops'],
    ['Schedule', '/admin/board'],
    ['Open play', '/admin/open'],
    ['Bookings', '/admin/bookings'],
    ['Help', '/admin/help'],
  ],
}

function renderNav(role: Role, route: string) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <BottomNav role={role} />
    </MemoryRouter>,
  )
}

describe('BottomNav', () => {
  it.each(Object.entries(roleLinks) as Array<[Role, Array<[string, string]>]>)(
    'keeps the %s role navigation labeled and touch friendly',
    (role, expectedLinks) => {
      renderNav(role, expectedLinks[0][1])

      const nav = screen.getByRole('navigation', { name: 'Main menu' })
      const links = within(nav).getAllByRole('link')

      expect(nav).toHaveClass('bottom-nav')
      expect(nav.firstElementChild).toHaveClass('grid-cols-6')
      expect(links).toHaveLength(expectedLinks.length)
      expectedLinks.forEach(([label, href], index) => {
        expect(links[index]).toHaveAccessibleName(label)
        expect(links[index]).toHaveAttribute('href', href)
        expect(links[index]).toHaveClass('min-h-[56px]')
        expect(links[index]).toHaveClass('control-feedback')
      })
    },
  )

  it('preserves exact active-route styling for member routes', () => {
    renderNav('member', '/member/book')

    expect(screen.getByRole('link', { name: 'Book' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('link', { name: 'Book' })).toHaveClass(
      'bg-brand-50',
    )
    expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('uses the end match for the member home route', () => {
    renderNav('member', '/member')

    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(
      screen
        .getAllByRole('link')
        .filter((link) => link.hasAttribute('aria-current')),
    ).toHaveLength(1)
  })
})

describe('AppShell', () => {
  it('shares a centered content rail while preserving both navigation variants', () => {
    const { container } = render(
      <MemoryRouter>
        <AppShell role="member">
          <AppHeader title="Member home" />
          <main className="safe-bottom">Member content</main>
        </AppShell>
      </MemoryRouter>,
    )

    expect(container.querySelector('.app-shell')).toBeInTheDocument()
    expect(container.querySelector('.app-shell-desktop')).toBeInTheDocument()
    expect(
      container.querySelector('header > .app-content-rail'),
    ).toBeInTheDocument()
    expect(
      screen.getAllByRole('navigation', { name: 'Main menu' }),
    ).toHaveLength(2)
    expect(screen.getByText('Member content')).toHaveClass('safe-bottom')
  })
})
