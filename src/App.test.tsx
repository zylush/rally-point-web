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
  },
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
