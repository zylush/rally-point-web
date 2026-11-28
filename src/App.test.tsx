import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
    notifications: vi.fn(),
    listPublicClubs: vi.fn().mockResolvedValue([]),
  },
  summarizePlatform: () => ({ totalGrossVolume: 0, totalCommissionsEarned: 0, activeClubsCount: 0, totalEntriesCount: 0 }),
}))

import { api } from './lib/api'

beforeEach(() => {
  auth.user = null
})

describe('public routes', () => {
  it('renders the privacy notice without an authenticated user', () => {
    render(
      <MemoryRouter initialEntries={['/privacy']}>
        <App />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { level: 1, name: 'Privacy Notice' })).toBeInTheDocument()
  })

  it('renders the court-first landing page prioritizing courts while keeping owner onboarding reachable', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { level: 1, name: 'Book a pickleball court near you.' })).toBeInTheDocument()
    expect(api.listPublicClubs).toHaveBeenCalled()
    expect(screen.getByLabelText('Search')).toBeInTheDocument()
    const ownerLinks = screen.getAllByRole('link', { name: /I own a court/ })
    expect(ownerLinks).toHaveLength(1)
    expect(ownerLinks[0]).toHaveAttribute('href', '/owners')
    expect(screen.getByRole('link', { name: 'Log in' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign up' })).toBeInTheDocument()
  })

  it('opens Find a court from the player choice', async () => {
    render(
      <MemoryRouter initialEntries={['/clubs']}>
        <App />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { level: 1, name: 'Find a court' })).toBeInTheDocument()
    expect(api.listPublicClubs).toHaveBeenCalled()
  })

  it('opens the court-owner page without an account', () => {
    render(
      <MemoryRouter initialEntries={['/owners']}>
        <App />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { level: 1, name: 'Take court bookings online, paid straight to your GCash' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ask for a call' })).toBeInTheDocument()
  })

  it('still sends signed-in people to their own home', () => {
    auth.user = {
      id: 'superadmin-1',
      email: 'superadmin@example.com',
      full_name: 'Alex Superadmin',
      role: 'superadmin',
      created_at: '2026-09-01T00:00:00.000Z',
    }
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )

    expect(screen.queryByRole('heading', { name: 'Book a pickleball court near you.' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Platform overview' })).toBeInTheDocument()
  })
})

describe('superadmin routes', () => {
  it('opens platform Help without loading any club inquiries', () => {
    auth.user = {
      id: 'superadmin-1',
      email: 'superadmin@example.com',
      full_name: 'Alex Superadmin',
      role: 'superadmin',
      created_at: '2026-09-01T00:00:00.000Z',
    }
    render(
      <MemoryRouter initialEntries={['/superadmin/help']}>
        <App />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'Quick answers' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Platform operations' })).toBeInTheDocument()
    expect(api.inquiries).not.toHaveBeenCalled()
    expect(api.notifications).not.toHaveBeenCalled()
  })
})
