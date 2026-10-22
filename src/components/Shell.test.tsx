import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MyClub, Role } from '../types'
import { AppHeader, AppShell, BottomNav, ClubSwitcher, SideNav, SignOutButton } from './Shell'

const auth = vi.hoisted(() => ({
  clubs: [] as MyClub[],
  activeClub: null as MyClub | null,
  switchClub: vi.fn(),
  signOut: vi.fn(),
  role: 'member' as Role,
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: {
      email: 'member@rallypoint.local',
      full_name: 'Demo Member',
      role: auth.role,
    },
    signOut: auth.signOut,
    clubs: auth.clubs,
    activeClub: auth.activeClub,
    switchClub: auth.switchClub,
  }),
}))

const gensan: MyClub = { club_id: 'club-gensan', slug: 'rally-point-gensan', name: 'Rally Point Gensan', role: 'member' }
const davao: MyClub = { club_id: 'club-davao', slug: 'rally-point-davao', name: 'Rally Point Davao', role: 'admin' }

beforeEach(() => {
  auth.clubs = []
  auth.activeClub = null
  auth.switchClub.mockClear()
  auth.signOut.mockReset()
  auth.role = 'member'
})

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
  // The platform portal only; superadmins have no club screens.
  superadmin: [
    ['Overview', '/superadmin'],
    ['Clubs', '/superadmin/clubs'],
    ['Ledger', '/superadmin/ledger'],
    ['Help', '/superadmin/help'],
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
      expect(nav.firstElementChild).toHaveClass(`grid-cols-${expectedLinks.length}`)
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

function Where() {
  return <p>At {useLocation().pathname}</p>
}

describe('ClubSwitcher', () => {
  it('stays hidden for someone in one club', () => {
    auth.clubs = [gensan]
    auth.activeClub = gensan
    render(<MemoryRouter><ClubSwitcher /></MemoryRouter>)
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('switches clubs and goes to the home screen for the role in that club', async () => {
    auth.clubs = [davao, gensan]
    auth.activeClub = gensan
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/member/book']}>
        <ClubSwitcher />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    )
    const select = screen.getByRole('combobox', { name: 'Club' })
    expect(select).toHaveValue('club-gensan')
    expect(within(select).getByRole('option', { name: 'Rally Point Davao · Admin' })).toBeInTheDocument()

    await user.selectOptions(select, 'club-davao')
    expect(auth.switchClub).toHaveBeenCalledWith('club-davao')
    expect(screen.getByText('At /admin')).toBeInTheDocument()
  })
})

describe('AppShell', () => {
  it('keeps member logout out of the mobile header but confirms staff logout', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <div className="app-shell">
        <div className="app-shell-desktop">
          <MemoryRouter>
            <AppHeader title="Member home" right={<SignOutButton />} />
          </MemoryRouter>
        </div>
      </div>,
    )
    expect(screen.queryByRole('button', { name: 'Log out' })).not.toBeInTheDocument()

    auth.role = 'staff'
    rerender(
      <div className="app-shell">
        <div className="app-shell-desktop">
          <MemoryRouter>
            <AppHeader title="Staff home" right={<SignOutButton />} />
          </MemoryRouter>
        </div>
      </div>,
    )
    const logout = screen.getByRole('button', { name: 'Log out' })
    await user.click(logout)
    const dialog = screen.getByRole('dialog', { name: 'Log out?' })
    expect(dialog).toBeInTheDocument()
    expect(dialog.parentElement?.parentElement).toBe(document.body)
    expect(document.querySelector('.app-shell')?.contains(dialog)).toBe(false)
    expect(auth.signOut).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(logout).toHaveFocus()

    await user.click(logout)
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Log out' }))
    expect(auth.signOut).toHaveBeenCalledTimes(1)
  })

  it('confirms logout from the desktop sidebar and supports Escape cancellation', async () => {
    const user = userEvent.setup()
    auth.role = 'admin'
    render(
      <div className="app-shell">
        <MemoryRouter>
          <SideNav role="admin" />
        </MemoryRouter>
      </div>,
    )

    const logout = screen.getByRole('button', { name: 'Log out' })
    await user.click(logout)
    const dialog = screen.getByRole('dialog', { name: 'Log out?' })
    expect(dialog.parentElement?.parentElement).toBe(document.body)
    expect(document.querySelector('.app-shell')?.contains(dialog)).toBe(false)
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    expect(auth.signOut).not.toHaveBeenCalled()

    await user.keyboard('{Shift>}{Tab}{/Shift}')
    expect(within(dialog).getByRole('button', { name: 'Log out' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(logout).toHaveFocus()
    expect(auth.signOut).not.toHaveBeenCalled()

    await user.click(logout)
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Log out' }))
    expect(auth.signOut).toHaveBeenCalledTimes(1)
  })

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

  it('shows a neutral badge instead of the Gensan logo for other clubs', () => {
    auth.clubs = [davao]
    auth.activeClub = davao
    const { container } = render(
      <MemoryRouter>
        <AppHeader title="Admin home" />
      </MemoryRouter>,
    )
    expect(screen.getByText('RD')).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
  })

  it('names the active club in the header', () => {
    auth.clubs = [gensan]
    auth.activeClub = gensan
    render(
      <MemoryRouter>
        <AppHeader title="Member home" />
      </MemoryRouter>,
    )
    expect(screen.getByText('Rally Point Gensan')).toBeInTheDocument()
  })
})

describe('Log out confirmation', () => {
  function renderSideNavLogout() {
    auth.role = 'admin'
    render(
      <div className="app-shell">
        <MemoryRouter>
          <SideNav role="admin" />
        </MemoryRouter>
      </div>,
    )
    return screen.getByRole('button', { name: 'Log out' })
  }

  it('shows a message when logging out fails and starts only one log out at a time', async () => {
    const user = userEvent.setup()
    let failSignOut: (error: Error) => void = () => {}
    auth.signOut.mockImplementation(
      () => new Promise<void>((_resolve, reject) => { failSignOut = reject }),
    )
    await user.click(renderSideNavLogout())
    const dialog = screen.getByRole('dialog', { name: 'Log out?' })
    const confirm = within(dialog).getByRole('button', { name: 'Log out' })

    await user.click(confirm)
    expect(within(dialog).getByRole('button', { name: 'Logging out…' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled()
    await user.click(within(dialog).getByRole('button', { name: 'Logging out…' }))
    expect(auth.signOut).toHaveBeenCalledTimes(1)

    await act(async () => failSignOut(new Error('Network down')))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('We could not log you out.')
    expect(within(dialog).getByRole('button', { name: 'Log out' })).toBeEnabled()
  })

  it('cancels on a backdrop tap and keeps Tab inside the dialog', async () => {
    const user = userEvent.setup()
    const logout = renderSideNavLogout()
    await user.click(logout)
    const dialog = screen.getByRole('dialog', { name: 'Log out?' })

    // Focus lands outside the dialog (as after a click on the page); Tab brings it back.
    ;(document.activeElement as HTMLElement | null)?.blur()
    expect(dialog.contains(document.activeElement)).toBe(false)
    await user.keyboard('{Tab}')
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()

    const backdrop = dialog.parentElement
    if (!backdrop) throw new Error('Expected the dialog backdrop')
    await user.click(backdrop)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(logout).toHaveFocus()
    expect(auth.signOut).not.toHaveBeenCalled()
  })
})
