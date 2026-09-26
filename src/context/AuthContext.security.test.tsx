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
        } as { user: typeof authState.sessionUser } | null,
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
    resetPasswordForEmail: vi.fn(),
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
  const { signIn, signUpMember, resetPassword, signOut, user } = useAuth()
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
      <button type="button" onClick={() => void resetPassword('  NEW@EXAMPLE.COM  ').catch((error: Error) => setMessage(error.message))}>Reset password</button>
      <button type="button" onClick={() => void signOut()}>Sign out</button>
      <p>{user ? `Signed in: ${user.role}` : 'Signed out'}</p>
      <p>{message}</p>
    </>
  )
}

function AuthValidationProbe() {
  const { signUpMember } = useAuth()
  const [message, setMessage] = useState('')
  const submit = (input: { email: string; password: string; full_name: string }) => {
    void signUpMember(input).catch((error: Error) => setMessage(error.message))
  }
  return (
    <>
      <button type="button" onClick={() => submit({ email: 'blank@example.com', password: '123456', full_name: ' ' })}>Blank name</button>
      <button type="button" onClick={() => submit({ email: 'short@example.com', password: '123', full_name: 'Valid' })}>Short password</button>
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
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: { user: authState.sessionUser } } })
    supabaseMock.auth.resetPasswordForEmail.mockResolvedValue({ error: null })
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

  it('explains when email confirmation delays a public signup', async () => {
    supabaseMock.auth.signUp.mockResolvedValueOnce({
      data: { user: authState.sessionUser, session: null },
      error: null,
    })
    const user = userEvent.setup()
    render(
      <AuthProvider>
        <AuthActionProbe />
      </AuthProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Join' }))

    expect(
      await screen.findByText(/Check your email to confirm your account/),
    ).toBeInTheDocument()
  })

  it('rejects invalid member signup input before contacting Supabase', async () => {
    const user = userEvent.setup()
    render(
      <AuthProvider>
        <AuthValidationProbe />
      </AuthProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Blank name' }))
    expect(await screen.findByText('Please enter your name')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Short password' }))
    expect(await screen.findByText('Password must be at least 6 characters')).toBeInTheDocument()
  })

  it('does not fetch a profile or sign out when there is no session', async () => {
    supabaseMock.auth.getSession.mockResolvedValueOnce({ data: { session: null } })
    render(<AuthProvider><AuthProbe /></AuthProvider>)

    expect(await screen.findByText('No authorized profile')).toBeInTheDocument()
    expect(supabaseMock.from).not.toHaveBeenCalled()
    expect(supabaseMock.auth.signOut).not.toHaveBeenCalled()
  })

  it('fails closed when the profile lookup returns an error', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    authState.profileResult = { data: null, error: new Error('Profile unavailable') }
    render(<AuthProvider><AuthProbe /></AuthProvider>)

    expect(await screen.findByText('No authorized profile')).toBeInTheDocument()
    expect(supabaseMock.auth.signOut).toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ message: 'Profile unavailable' }))
    log.mockRestore()
  })

  it('signs in with the trusted profile and clears it on sign-out', async () => {
    authState.profileResult = { data: {
      id: authState.sessionUser.id, email: authState.sessionUser.email, full_name: 'Trusted Member',
      role: 'member', created_at: '2026-08-03T00:00:00.000Z',
    }, error: null }
    const user = userEvent.setup()
    render(<AuthProvider><AuthActionProbe /></AuthProvider>)
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Signed in: member')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByText('Signed out')).toBeInTheDocument()
  })

  it('propagates sign-in rejection and missing auth user', async () => {
    const user = userEvent.setup()
    supabaseMock.auth.signInWithPassword.mockResolvedValueOnce({ data: { user: null }, error: new Error('Wrong password') })
      .mockResolvedValueOnce({ data: { user: null }, error: null })
    render(<AuthProvider><AuthActionProbe /></AuthProvider>)
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Wrong password')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('No user returned')).toBeInTheDocument()
  })

  it('rejects public signup if the database profile is privileged', async () => {
    const user = userEvent.setup()
    authState.profileResult = { data: {
      id: authState.sessionUser.id, email: authState.sessionUser.email, full_name: 'Not a Member',
      role: 'admin', created_at: '2026-08-03T00:00:00.000Z',
    }, error: null }
    render(<AuthProvider><AuthActionProbe /></AuthProvider>)
    await user.click(screen.getByRole('button', { name: 'Join' }))

    expect(await screen.findByText('Your club profile is not ready. Please try again or contact staff.')).toBeInTheDocument()
    expect(await screen.findByText('Signed out')).toBeInTheDocument()
    expect(supabaseMock.auth.signOut).toHaveBeenCalled()
  })

  it('reports signup API failures and missing signup users', async () => {
    const user = userEvent.setup()
    supabaseMock.auth.signUp.mockResolvedValueOnce({ data: { user: null, session: null }, error: new Error('Signup unavailable') })
      .mockResolvedValueOnce({ data: { user: null, session: null }, error: null })
    render(<AuthProvider><AuthActionProbe /></AuthProvider>)
    await user.click(screen.getByRole('button', { name: 'Join' }))
    expect(await screen.findByText('Signup unavailable')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Join' }))
    expect(await screen.findByText('Sign-up failed')).toBeInTheDocument()
  })

  it('normalizes reset email and reports reset failures', async () => {
    const user = userEvent.setup()
    supabaseMock.auth.resetPasswordForEmail.mockResolvedValueOnce({ error: new Error('Reset unavailable') })
    render(<AuthProvider><AuthActionProbe /></AuthProvider>)
    await user.click(screen.getByRole('button', { name: 'Reset password' }))

    expect(supabaseMock.auth.resetPasswordForEmail).toHaveBeenCalledWith('new@example.com')
    expect(await screen.findByText('Reset unavailable')).toBeInTheDocument()
  })
})
