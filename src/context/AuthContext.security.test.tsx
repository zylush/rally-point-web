import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Profile } from '../types'
import { useAuth } from './AuthContext'
import { AuthProvider } from './AuthProvider'

const authState = vi.hoisted(() => ({
  profileResult: { data: null, error: null } as {
    data: Profile | null
    error: Error | null
  },
  sessionUser: {
    id: 'auth-user-1',
    email: 'member@example.com',
    user_metadata: {
      full_name: 'Metadata User',
      role: 'admin',
    },
  },
}))

const unsubscribe = vi.hoisted(() => vi.fn())

const supabaseMock = vi.hoisted(() => ({
  from: vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn(async () => authState.profileResult),
      })),
    })),
  })),
  auth: {
    getSession: vi.fn(async () => ({
      data: {
        session: {
          user: authState.sessionUser,
        },
      },
    })),
    onAuthStateChange: vi.fn(() => ({
      data: {
        subscription: {
          unsubscribe,
        },
      },
    })),
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
  },
}))

vi.mock('../lib/supabase', () => ({
  isDemoMode: false,
  supabase: supabaseMock,
}))

vi.mock('../lib/demoStore', () => ({
  demoStore: {},
}))

function AuthProbe() {
  const { loading, user } = useAuth()
  if (loading) return <p>Loading auth</p>
  return <p>{user ? `Role: ${user.role}` : 'No authorized profile'}</p>
}

function AuthActionProbe() {
  const { signIn, signUpMember } = useAuth()
  const [message, setMessage] = useState('')
  const testPassphrase = 'test-only-passphrase'

  return (
    <>
      <button
        type={'button'}
        onClick={() => {
          void signIn('member@example.com', 'password').catch((error: Error) => {
            setMessage(error.message)
          })
        }}
      >
        Sign in
      </button>
      <button
        type={'button'}
        onClick={() => {
          void signUpMember({
            email: 'new@example.com',
            password: testPassphrase,
            full_name: 'New Member',
          }).catch((error: Error) => {
            setMessage(error.message)
          })
        }}
      >
        Join
      </button>
      <p>{message}</p>
    </>
  )
}

describe('AuthProvider trusted role boundary', () => {
  beforeEach(() => {
    authState.profileResult = { data: null, error: null }
    vi.clearAllMocks()
    supabaseMock.auth.signInWithPassword.mockResolvedValue({
      data: { user: authState.sessionUser },
      error: null,
    })
    supabaseMock.auth.signUp.mockResolvedValue({
      data: {
        user: authState.sessionUser,
        session: { user: authState.sessionUser },
      },
      error: null,
    })
    supabaseMock.auth.signOut.mockResolvedValue({ error: null })
  })

  it('fails closed when an authenticated session has no authoritative profile', async () => {
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    )

    expect(await screen.findByText('No authorized profile')).toBeInTheDocument()
    expect(screen.queryByText('Role: admin')).not.toBeInTheDocument()
    expect(supabaseMock.auth.signOut).toHaveBeenCalled()
  })

  it('uses the database profile instead of forged user metadata', async () => {
    authState.profileResult = {
      data: {
        id: authState.sessionUser.id,
        email: authState.sessionUser.email,
        full_name: 'Trusted Member',
        role: 'member',
        phone: null,
        created_at: '2026-08-03T00:00:00.000Z',
      },
      error: null,
    }

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    )

    expect(await screen.findByText('Role: member')).toBeInTheDocument()
    expect(screen.queryByText('Role: admin')).not.toBeInTheDocument()
  })

  it('signs out and rejects sign-in when the authoritative profile is missing', async () => {
    const user = userEvent.setup()
    render(
      <AuthProvider>
        <AuthActionProbe />
      </AuthProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(
      await screen.findByText(
        'Your club profile is not ready. Please try again or contact staff.',
      ),
    ).toBeInTheDocument()
    expect(supabaseMock.auth.signOut).toHaveBeenCalled()
  })

  it('does not send an authorization role in public signup metadata', async () => {
    authState.profileResult = {
      data: {
        id: authState.sessionUser.id,
        email: authState.sessionUser.email,
        full_name: 'New Member',
        role: 'member',
        phone: null,
        created_at: '2026-08-03T00:00:00.000Z',
      },
      error: null,
    }
    const user = userEvent.setup()
    render(
      <AuthProvider>
        <AuthActionProbe />
      </AuthProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Join' }))

    expect(supabaseMock.auth.signUp).toHaveBeenCalled()
    const signupInput = supabaseMock.auth.signUp.mock.calls[0][0]
    expect(signupInput.options.data).toEqual({
      full_name: 'New Member',
      phone: null,
    })
    expect(signupInput.options.data).not.toHaveProperty('role')
  })
})
