import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MyClub, Profile, PublicClub } from '../types'
import { getActiveClubId, setActiveClubId } from '../lib/clubContext'
import { useAuth } from './AuthContext'
import { AuthProvider } from './AuthProvider'

const gensanMember: MyClub = { club_id: 'club-gensan', slug: 'rally-point-gensan', name: 'Rally Point Gensan', role: 'member' }

const authState = vi.hoisted(() => ({
  profileResult: { data: null, error: null } as {
    data: Profile | null
    error: Error | null
  },
  // Trusted access records returned by list_my_clubs / get_platform_access.
  clubs: [] as MyClub[],
  platform: null as string | null,
  publicClub: null as PublicClub | null,
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
  rpc: vi.fn(async (name: string) => {
    if (name === 'list_my_clubs') return { data: authState.clubs, error: null }
    if (name === 'get_platform_access') return { data: authState.platform, error: null }
    if (name === 'get_public_club') return { data: authState.publicClub ? [authState.publicClub] : [], error: null }
    return { data: null, error: null }
  }),
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
    verifyOtp: vi.fn(),
    resend: vi.fn(),
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
          })
            .then((result) => {
              if (result.status === 'needs_code') setMessage(`Code needed for ${result.email}`)
            })
            .catch((error: Error) => {
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

function SignupCodeProbe() {
  const { verifySignupCode, resendSignupCode, user } = useAuth()
  const [message, setMessage] = useState('')
  return (
    <>
      <button
        type="button"
        onClick={() => {
          void verifySignupCode(' New@Example.com ', '123 456')
            .then((profile) => setMessage(`Confirmed: ${profile.role}`))
            .catch((error: Error) => setMessage(error.message))
        }}
      >
        Confirm code
      </button>
      <button
        type="button"
        onClick={() => {
          void resendSignupCode('New@Example.com')
            .then(() => setMessage('Code sent'))
            .catch((error: Error) => setMessage(error.message))
        }}
      >
        Resend code
      </button>
      <p>{user ? `Signed in: ${user.role}` : 'Signed out'}</p>
      <p>{message}</p>
    </>
  )
}

function ClubProbe() {
  const { loading, activeClub, clubs, switchClub } = useAuth()
  if (loading) return <p>Loading auth</p>
  return (
    <>
      <p>{activeClub ? `${activeClub.name} as ${activeClub.role}` : 'No club'}</p>
      {clubs.filter((club) => club.club_id !== activeClub?.club_id).map((club) => (
        <button key={club.club_id} type="button" onClick={() => switchClub(club.club_id)}>
          Switch to {club.name}
        </button>
      ))}
    </>
  )
}

function JoinLinkProbe() {
  const { signUpMember } = useAuth()
  const [message, setMessage] = useState('')
  return (
    <>
      <button
        type="button"
        onClick={() => {
          void signUpMember({ email: 'link@example.com', password: 'test-only-passphrase', full_name: 'New Member', clubSlug: 'rally-point-davao' })
            .then(() => setMessage('Joined rally-point-davao'))
            .catch((error: Error) => setMessage(error.message))
        }}
      >
        Join through link
      </button>
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
    authState.clubs = [gensanMember]
    authState.platform = null
    authState.publicClub = null
    setActiveClubId(null)
    localStorage.clear()
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

  it('asks for the emailed code when email confirmation delays a public signup', async () => {
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
    await screen.findByText('Signed out')
    vi.mocked(supabaseMock.from).mockClear()
    vi.mocked(supabaseMock.auth.signOut).mockClear()

    await user.click(screen.getByRole('button', { name: 'Join' }))

    expect(await screen.findByText('Code needed for new@example.com')).toBeInTheDocument()
    // No session yet: nothing is loaded, nobody is signed in, and nothing is signed out.
    expect(screen.getByText('Signed out')).toBeInTheDocument()
    expect(supabaseMock.from).not.toHaveBeenCalled()
    expect(supabaseMock.auth.signOut).not.toHaveBeenCalled()
  })

  it('confirms a sign-up code, then signs in only through trusted member access', async () => {
    authState.profileResult = { data: {
      id: authState.sessionUser.id, email: authState.sessionUser.email, full_name: 'New Member',
      role: 'member', created_at: '2026-08-03T00:00:00.000Z',
    }, error: null }
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: null } })
    supabaseMock.auth.verifyOtp.mockResolvedValueOnce({
      data: { user: authState.sessionUser, session: { user: authState.sessionUser } },
      error: null,
    })
    const user = userEvent.setup()
    render(<AuthProvider><SignupCodeProbe /></AuthProvider>)
    await screen.findByText('Signed out')

    await user.click(screen.getByRole('button', { name: 'Confirm code' }))

    expect(await screen.findByText('Confirmed: member')).toBeInTheDocument()
    expect(screen.getByText('Signed in: member')).toBeInTheDocument()
    expect(supabaseMock.auth.verifyOtp).toHaveBeenCalledWith({
      email: 'new@example.com',
      token: '123456',
      type: 'signup',
    })
  })

  it('rejects a confirmed sign-up whose trusted records give a staff role, and signs out', async () => {
    authState.profileResult = { data: {
      id: authState.sessionUser.id, email: authState.sessionUser.email, full_name: 'Not a Member',
      role: 'member', created_at: '2026-08-03T00:00:00.000Z',
    }, error: null }
    authState.clubs = [{ ...gensanMember, role: 'admin' }]
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: null } })
    supabaseMock.auth.verifyOtp.mockResolvedValueOnce({
      data: { user: authState.sessionUser, session: { user: authState.sessionUser } },
      error: null,
    })
    const user = userEvent.setup()
    render(<AuthProvider><SignupCodeProbe /></AuthProvider>)
    await screen.findByText('Signed out')

    await user.click(screen.getByRole('button', { name: 'Confirm code' }))

    expect(await screen.findByText('Your club profile is not ready. Please try again or contact staff.')).toBeInTheDocument()
    expect(screen.getByText('Signed out')).toBeInTheDocument()
    expect(supabaseMock.auth.signOut).toHaveBeenCalled()
  })

  it('passes a wrong or expired code error through without signing in', async () => {
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: null } })
    supabaseMock.auth.verifyOtp.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: Object.assign(new Error('Token has expired or is invalid'), { code: 'otp_expired', status: 403 }),
    })
    const user = userEvent.setup()
    render(<AuthProvider><SignupCodeProbe /></AuthProvider>)
    await screen.findByText('Signed out')

    await user.click(screen.getByRole('button', { name: 'Confirm code' }))

    expect(await screen.findByText('Token has expired or is invalid')).toBeInTheDocument()
    expect(screen.getByText('Signed out')).toBeInTheDocument()
    expect(supabaseMock.from).not.toHaveBeenCalled()
  })

  it('sends a new sign-up code for the email', async () => {
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: null } })
    supabaseMock.auth.resend.mockResolvedValueOnce({ data: {}, error: null })
    const user = userEvent.setup()
    render(<AuthProvider><SignupCodeProbe /></AuthProvider>)

    await user.click(screen.getByRole('button', { name: 'Resend code' }))

    expect(await screen.findByText('Code sent')).toBeInTheDocument()
    expect(supabaseMock.auth.resend).toHaveBeenCalledWith({ type: 'signup', email: 'new@example.com' })
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

  it('rejects public signup if trusted records give the new account a staff role', async () => {
    const user = userEvent.setup()
    authState.profileResult = { data: {
      id: authState.sessionUser.id, email: authState.sessionUser.email, full_name: 'Not a Member',
      role: 'member', created_at: '2026-08-03T00:00:00.000Z',
    }, error: null }
    authState.clubs = [{ ...gensanMember, role: 'admin' }]
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

  it('ignores profiles.role and takes the role from trusted club records', async () => {
    authState.profileResult = { data: {
      id: authState.sessionUser.id, email: authState.sessionUser.email, full_name: 'Says Admin',
      role: 'admin', created_at: '2026-08-03T00:00:00.000Z',
    }, error: null }
    render(<AuthProvider><AuthProbe /></AuthProvider>)
    expect(await screen.findByText('Role: member')).toBeInTheDocument()
  })

  it('signs out when the person belongs to no active club', async () => {
    authState.profileResult = { data: {
      id: authState.sessionUser.id, email: authState.sessionUser.email, full_name: 'No Club',
      role: 'member', created_at: '2026-08-03T00:00:00.000Z',
    }, error: null }
    authState.clubs = []
    render(<AuthProvider><AuthProbe /></AuthProvider>)
    expect(await screen.findByText('No authorized profile')).toBeInTheDocument()
    expect(supabaseMock.auth.signOut).toHaveBeenCalled()
    expect(getActiveClubId()).toBeNull()
  })

  it('gives a platform account the superadmin role and no club context', async () => {
    authState.profileResult = { data: {
      id: authState.sessionUser.id, email: authState.sessionUser.email, full_name: 'Platform Person',
      role: 'member', created_at: '2026-08-03T00:00:00.000Z',
    }, error: null }
    authState.platform = 'superadmin'
    render(<AuthProvider><AuthProbe /></AuthProvider>)
    expect(await screen.findByText('Role: superadmin')).toBeInTheDocument()
    expect(getActiveClubId()).toBeNull()
  })

  it('starts in the default club, then remembers a switch to another club', async () => {
    authState.profileResult = { data: {
      id: authState.sessionUser.id, email: authState.sessionUser.email, full_name: 'Two Clubs',
      role: 'member', created_at: '2026-08-03T00:00:00.000Z',
    }, error: null }
    // Listed by name, so the other club comes first; the default club should still win.
    authState.clubs = [
      { club_id: 'club-davao', slug: 'rally-point-davao', name: 'Rally Point Davao', role: 'admin' },
      gensanMember,
    ]
    const user = userEvent.setup()
    render(<AuthProvider><ClubProbe /></AuthProvider>)
    expect(await screen.findByText('Rally Point Gensan as member')).toBeInTheDocument()
    expect(getActiveClubId()).toBe('club-gensan')

    await user.click(screen.getByRole('button', { name: 'Switch to Rally Point Davao' }))
    expect(await screen.findByText('Rally Point Davao as admin')).toBeInTheDocument()
    expect(getActiveClubId()).toBe('club-davao')
    expect(localStorage.getItem(`rally_point_last_club:${authState.sessionUser.id}`)).toBe('club-davao')
  })

  it('sends the club link with a join-link signup, and refuses an invalid link before signing up', async () => {
    authState.profileResult = { data: {
      id: authState.sessionUser.id, email: authState.sessionUser.email, full_name: 'New Member',
      role: 'member', created_at: '2026-08-03T00:00:00.000Z',
    }, error: null }
    authState.publicClub = { id: 'club-davao', slug: 'rally-point-davao', name: 'Rally Point Davao' }
    authState.clubs = [{ club_id: 'club-davao', slug: 'rally-point-davao', name: 'Rally Point Davao', role: 'member' }]
    const user = userEvent.setup()
    render(<AuthProvider><JoinLinkProbe /></AuthProvider>)

    await user.click(screen.getByRole('button', { name: 'Join through link' }))
    expect(await screen.findByText('Joined rally-point-davao')).toBeInTheDocument()
    expect(supabaseMock.auth.signUp.mock.calls[0][0].options.data).toEqual({
      full_name: 'New Member',
      phone: null,
      club_slug: 'rally-point-davao',
    })

    authState.publicClub = null
    supabaseMock.auth.signUp.mockClear()
    await user.click(screen.getByRole('button', { name: 'Join through link' }))
    expect(await screen.findByText('This club link is not valid. Ask the club for a new link.')).toBeInTheDocument()
    expect(supabaseMock.auth.signUp).not.toHaveBeenCalled()
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
