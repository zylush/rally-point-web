import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Profile } from '../types'
import { documentTitle } from '../lib/useDocumentTitle'
import { PublicFrame } from './PublicFrame'

const auth = vi.hoisted(() => ({ user: null as Profile | null }))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: auth.user,
    signOut: vi.fn(),
    clubs: [],
    activeClub: null,
    switchClub: vi.fn(),
  }),
}))

function renderFrame(props: Partial<Parameters<typeof PublicFrame>[0]> = {}, path = '/clubs') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PublicFrame title="Find a court" subtitle="Pickleball clubs you can book online." {...props}>
        <p>Page body</p>
      </PublicFrame>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  auth.user = null
  document.title = 'Before'
})

describe('PublicFrame for visitors', () => {
  it('links home and to the two main sections, marking the current one', () => {
    renderFrame()
    expect(screen.getByRole('link', { name: 'bRineLy home' })).toHaveAttribute('href', '/')
    const main = within(screen.getByRole('navigation', { name: 'Main' }))
    expect(main.getByRole('link', { name: 'Find a court' })).toHaveAttribute('aria-current', 'page')
    expect(main.getByRole('link', { name: 'Rent a coach' })).toHaveAttribute('href', '/coaches')
    expect(main.getByRole('link', { name: 'Tournaments' })).toHaveAttribute('href', '/tournaments')
    expect(main.getByRole('link', { name: 'For court owners' })).toHaveAttribute('href', '/owners')
  })

  it('shows the page heading and subtitle in the content, not in the header', () => {
    renderFrame()
    const heading = screen.getByRole('heading', { level: 1, name: 'Find a court' })
    expect(heading.closest('main')).not.toBeNull()
    expect(screen.getByText('Pickleball clubs you can book online.')).toBeInTheDocument()
    expect(screen.getByText('Page body')).toBeInTheDocument()
  })

  it('lets a page draw its own heading', () => {
    renderFrame({ heading: 'none' })
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
  })

  it('offers log in and sign up once each, or only log in, or neither', () => {
    const { unmount } = renderFrame()
    expect(screen.getAllByRole('link', { name: 'Log in' })).toHaveLength(1)
    expect(screen.getAllByRole('link', { name: 'Sign up' })).toHaveLength(1)
    unmount()

    const login = renderFrame({ accountLinks: 'login' })
    expect(screen.getByRole('link', { name: 'Log in' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Sign up' })).not.toBeInTheDocument()
    login.unmount()

    renderFrame({ accountLinks: 'none' })
    expect(screen.queryByRole('navigation', { name: 'Account' })).not.toBeInTheDocument()
  })

  it('ends with a footer of next steps and the photo credits', () => {
    renderFrame()
    const footer = within(screen.getByRole('contentinfo'))
    expect(footer.getByRole('link', { name: 'Find a court' })).toHaveAttribute('href', '/clubs')
    expect(footer.getByRole('link', { name: 'Find a coach' })).toHaveAttribute('href', '/coaches')
    expect(footer.getByRole('link', { name: 'All tournaments' })).toHaveAttribute('href', '/tournaments')
    expect(footer.getByRole('link', { name: 'List your club' })).toHaveAttribute('href', '/owners')
    expect(footer.getByRole('link', { name: 'Club staff sign-in' })).toHaveAttribute('href', '/login')
    expect(footer.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy')
    expect(footer.getByRole('link', { name: 'Photo credits' })).toHaveAttribute('href', '/privacy#photo-credits')
    expect(footer.getByText(/© 2026 bRineLy/)).toBeInTheDocument()
  })

  it('draws the faint symbol field behind the page, hidden from screen readers', () => {
    renderFrame()
    const field = screen.getByTestId('court-symbols')
    expect(field).toHaveAttribute('aria-hidden', 'true')
    // First in the frame, so it paints under the header, content and footer.
    expect(field.parentElement?.firstElementChild).toBe(field)
    expect(field.querySelectorAll('.court-symbol').length).toBeGreaterThan(8)
    expect(within(field).queryByRole('img')).not.toBeInTheDocument()
  })

  it('names the browser tab after the page and restores it afterwards', () => {
    const { unmount } = renderFrame()
    expect(document.title).toBe('Find a court · bRineLy')
    unmount()
    expect(document.title).toBe('Before')
  })
})

describe('PublicFrame for signed-in people', () => {
  it('gives staff and admins their app header and menu instead of the site header and footer', () => {
    auth.user = { id: 'u1', email: 's@example.com', full_name: 'Sam', role: 'staff', created_at: '2026-09-01' }
    renderFrame()
    expect(screen.getByRole('heading', { level: 1, name: 'Find a court' })).toBeInTheDocument()
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Account' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('court-symbols')).not.toBeInTheDocument()
    expect(document.title).toBe('Find a court · bRineLy')
  })

  it('keeps players and members on the public site, with the account menu instead of Log in and Sign up', () => {
    auth.user = { id: 'u1', email: 'p@example.com', full_name: 'Pia Cruz', role: 'member', created_at: '2026-09-01' }
    renderFrame()
    expect(screen.getByRole('heading', { level: 1, name: 'Find a court' })).toBeInTheDocument()
    expect(screen.getByRole('contentinfo')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Log in' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Sign up' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Account menu for Pia Cruz' })).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('documentTitle', () => {
  it('puts the page first and the site name last', () => {
    expect(documentTitle('List your club')).toBe('List your club · bRineLy')
  })

  it('uses the site name alone when there is no page name', () => {
    expect(documentTitle()).toBe('bRineLy')
    expect(documentTitle('  ')).toBe('bRineLy')
    expect(documentTitle('bRineLy')).toBe('bRineLy')
  })
})
