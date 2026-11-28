import type { ReactNode } from 'react'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Profile } from './types'
import App from './App'

const auth = vi.hoisted(() => ({ user: null as Profile | null }))

vi.mock('./context/AuthProvider', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}))

vi.mock('./context/AuthContext', () => ({
  useAuth: () => ({
    user: auth.user,
    loading: false,
    activeClub: null,
    clubs: [],
    switchClub: vi.fn(),
    signOut: vi.fn(),
  }),
}))

vi.mock('./lib/api', () => ({
  api: {
    processDueReminders: vi.fn().mockResolvedValue(undefined),
    inquiries: vi.fn(),
    notifications: vi.fn().mockResolvedValue([]),
    listPublicClubs: vi.fn().mockResolvedValue([]),
  },
  summarizePlatform: () => ({ totalGrossVolume: 0, totalCommissionsEarned: 0, activeClubsCount: 0, totalEntriesCount: 0 }),
}))

// The owners page stands in for any screen that crashes while drawing.
vi.mock('./pages/Owners', () => ({
  OwnersPage: () => {
    throw new Error('Owners page broke')
  },
}))

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  auth.user = null
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('unknown addresses', () => {
  it('tell visitors the page was not found and offer home and Find a court', () => {
    renderAt('/no-such-page')
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to the home page' })).toHaveAttribute('href', '/')
    const findLinks = screen.getAllByRole('link', { name: 'Find a court' })
    expect(findLinks.some((link) => link.getAttribute('href') === '/clubs')).toBe(true)
  })

  it('send signed-in people back to their own home', () => {
    auth.user = { id: 'm1', email: 'm@example.com', full_name: 'Mia', role: 'member', created_at: '2026-09-01' }
    renderAt('/member/nowhere')
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument()
    // Players and members have no home screen of their own: they carry on from the public site.
    const page = within(screen.getByRole('main'))
    expect(page.getByRole('link', { name: 'Go to the home page' })).toHaveAttribute('href', '/')
    expect(page.getByRole('link', { name: 'Find a court' })).toHaveAttribute('href', '/clubs')
  })
})

describe('a screen that crashes', () => {
  it('shows a way out instead of a blank page', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    renderAt('/owners')
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong')
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to the home page' })).toHaveAttribute('href', expect.stringMatching(/#\/$/))
  })
})
