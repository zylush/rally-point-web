import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../context/AuthProvider'
import { setActiveClubId } from '../lib/clubContext'
import type { MyClub, Profile } from '../types'
import LoginPage from './LoginPage'

interface FakeAuthUser {
  id: string
  email: string
  password: string
  full_name: string
  confirmed: boolean
  otp: string
}

const sim = vi.hoisted(() => {
  const users = new Map<string, FakeAuthUser>()
  const mailbox: { to: string; token: string; kind: 'signup' | 'resend' }[] = []
  let sessionUserId: string | null = null
  let otpSeq = 482910
  let authListener: (() => void) | null = null

  const gensanClub: MyClub = {
    club_id: 'club-gensan',
    slug: 'rally-point-gensan',
    name: 'Rally Point Gensan',
    role: 'member',
  }

  const nextOtp = () => {
    otpSeq += 111
    return String(otpSeq).slice(-6).padStart(6, '0')
  }

  return {
    users,
    mailbox,
    gensanClub,
    reset() {
      users.clear()
      mailbox.length = 0
      sessionUserId = null
      otpSeq = 482910
      authListener = null
    },
    seedUnconfirmed(email: string, password: string, full_name: string, otp = '482910') {
      const normalized = email.trim().toLowerCase()
      users.set(normalized, {
        id: `user-${normalized}`,
        email: normalized,
        password,
        full_name,
        confirmed: false,
        otp,
      })
      mailbox.push({ to: normalized, token: otp, kind: 'signup' })
    },
    currentUser() {
      if (!sessionUserId) return null
      for (const u of users.values()) {
        if (u.id === sessionUserId) return u
      }
      return null
    },
    async getSession() {
      const current = this.currentUser()
      return {
        data: {
          session: current ? { user: { id: current.id, email: current.email } } : null,
        },
      }
    },
    onAuthStateChange(callback: () => void) {
      authListener = callback
      return {
        data: {
          subscription: {
            unsubscribe: vi.fn(() => {
              authListener = null
            }),
          },
        },
      }
    },
    async signUp(args: { email: string; password: string; options?: { data?: Record<string, unknown> } }) {
      const email = args.email.trim().toLowerCase()
      const existing = users.get(email)
      if (existing?.confirmed) {
        // Real Supabase anti-enumeration: confirmed accounts return identities: [] with no session.
        return {
          data: { user: { id: existing.id, email, identities: [] }, session: null },
          error: null,
        }
      }
      const otp = nextOtp()
      const full_name = String(args.options?.data?.full_name ?? 'Player')
      const record: FakeAuthUser = {
        id: existing?.id ?? `user-${users.size + 1}`,
        email,
        password: args.password,
        full_name,
        confirmed: false,
        otp,
      }
      users.set(email, record)
      mailbox.push({ to: email, token: otp, kind: 'signup' })
      return {
        data: {
          user: { id: record.id, email, identities: [{ id: 'ident-1' }] },
          session: null,
        },
        error: null,
      }
    },
    async signInWithPassword(args: { email: string; password: string }) {
      const email = args.email.trim().toLowerCase()
      const record = users.get(email)
      if (!record || record.password !== args.password) {
        return {
          data: { user: null, session: null },
          error: Object.assign(new Error('Invalid login credentials'), {
            code: 'invalid_credentials',
            status: 400,
          }),
        }
      }
      if (!record.confirmed) {
        return {
          data: { user: null, session: null },
          error: Object.assign(new Error('Email not confirmed'), {
            code: 'email_not_confirmed',
            status: 400,
          }),
        }
      }
      sessionUserId = record.id
      authListener?.()
      return {
        data: {
          user: { id: record.id, email: record.email },
          session: { user: { id: record.id, email: record.email } },
        },
        error: null,
      }
    },
    async verifyOtp(args: { email: string; token: string; type: string }) {
      const email = args.email.trim().toLowerCase()
      const record = users.get(email)
      if (!record || args.token !== record.otp) {
        return {
          data: { user: null, session: null },
          error: Object.assign(new Error('Token has expired or is invalid'), {
            code: 'otp_expired',
            status: 403,
          }),
        }
      }
      record.confirmed = true
      sessionUserId = record.id
      authListener?.()
      return {
        data: {
          user: { id: record.id, email: record.email },
          session: { user: { id: record.id, email: record.email } },
        },
        error: null,
      }
    },
    async resend(args: { type: string; email: string }) {
      const email = args.email.trim().toLowerCase()
      const record = users.get(email)
      if (record) {
        const otp = nextOtp()
        record.otp = otp
        mailbox.push({ to: email, token: otp, kind: 'resend' })
      }
      return { data: {}, error: null }
    },
    async signOut() {
      sessionUserId = null
      return { error: null }
    },
  }
})

vi.mock('../lib/supabase', () => ({
  isDemoMode: false,
  supabase: {
    auth: {
      getSession: () => sim.getSession(),
      onAuthStateChange: (cb: () => void) => sim.onAuthStateChange(cb),
      signUp: (args: { email: string; password: string; options?: { data?: Record<string, unknown> } }) => sim.signUp(args),
      signInWithPassword: (args: { email: string; password: string }) => sim.signInWithPassword(args),
      verifyOtp: (args: { email: string; token: string; type: string }) => sim.verifyOtp(args),
      resend: (args: { type: string; email: string }) => sim.resend(args),
      signOut: () => sim.signOut(),
      resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }),
    },
    from: () => ({
      select: () => ({
        eq: (_col: string, userId: string) => ({
          maybeSingle: async () => {
            for (const u of sim.users.values()) {
              if (u.id === userId) {
                const profile: Profile = {
                  id: u.id,
                  email: u.email,
                  full_name: u.full_name,
                  role: 'member',
                  phone: null,
                  created_at: '2026-11-19T00:00:00.000Z',
                }
                return { data: profile, error: null }
              }
            }
            return { data: null, error: null }
          },
        }),
      }),
    }),
    rpc: async (name: string) => {
      if (name === 'list_my_clubs') return { data: [sim.gensanClub], error: null }
      if (name === 'get_platform_access') return { data: null, error: null }
      if (name === 'claim_my_owner_clubs') return { data: [], error: null }
      return { data: null, error: null }
    },
  },
}))

vi.mock('../components/BrinelyLogo', () => ({
  BrinelyLogo: () => <div aria-label="bRineLy logo" />,
}))

function Destination() {
  return <p>Landed at {useLocation().pathname}</p>
}

describe('End-to-end user email verification & login journey (AuthProvider + LoginPage)', () => {
  beforeEach(() => {
    sim.reset()
    setActiveClubId(null)
    localStorage.clear()
    sessionStorage.clear()
  })

  it('registers a new player, rejects wrong OTP, accepts 6-digit OTP email code, and logs into /member', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/login']}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="*" element={<Destination />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    )

    // Live mode (not demo): the page has loaded and shows no demo accounts
    expect(await screen.findByRole('heading', { level: 1, name: 'Log in' })).toBeInTheDocument()
    expect(screen.queryByText('Quick demo logins')).not.toBeInTheDocument()

    // Switch to Sign up and create the account
    await user.click(screen.getAllByRole('button', { name: 'Sign up' })[0])
    await user.type(screen.getByLabelText('Full name'), 'Juan Dela Cruz')
    await user.type(screen.getByLabelText('Email'), 'Juan@Example.com')
    await user.type(screen.getByLabelText('Password'), 'secretpass123')
    await user.click(screen.getByRole('button', { name: /Read the Privacy Notice/ }))
    await user.click(screen.getByRole('button', { name: 'Unlock checkbox' }))
    await user.click(screen.getByRole('checkbox', { name: /I have read and understood the Privacy Notice/ }))
    await user.click(screen.getAllByRole('button', { name: 'Sign up' }).find((button) => button.getAttribute('type') === 'submit')!)

    // Lands on 6-digit Check your email screen
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument()
    expect(screen.getByText('juan@example.com')).toBeInTheDocument()
    expect(sim.mailbox).toHaveLength(1)
    const emailedToken = sim.mailbox[0].token

    // Entering an invalid code keeps the user on OTP entry
    const codeInput = screen.getByLabelText('6-digit code')
    await user.type(codeInput, '000000')
    await user.click(screen.getByRole('button', { name: 'Confirm and continue' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That code is wrong or has expired. Check the newest email or send a new code.',
    )

    // Paste formatted 6-digit code from email -> confirms and opens /member
    await user.clear(codeInput)
    await user.paste(`Code: ${emailedToken.slice(0, 3)} ${emailedToken.slice(3)}`)
    expect(codeInput).toHaveValue(emailedToken)
    await user.click(screen.getByRole('button', { name: 'Confirm and continue' }))

    // A new player with no page to go back to lands on Find a court.
    expect(await screen.findByText('Landed at /clubs')).toBeInTheDocument()
    expect(sim.users.get('juan@example.com')?.confirmed).toBe(true)
  })

  it('recovers an unverified user trying to log in: rejects wrong password cleanly, then lets valid password trigger OTP resend & verification', async () => {
    const user = userEvent.setup()
    sim.seedUnconfirmed('pending.player@example.com', 'courtpass123', 'Pending Player', '112233')

    const onAuthenticated = vi.fn()
    render(
      <MemoryRouter>
        <AuthProvider>
          <LoginPage dialog clubName="Rally Point Gensan" onAuthenticated={onAuthenticated} onClose={vi.fn()} />
        </AuthProvider>
      </MemoryRouter>,
    )

    const dialog = await screen.findByRole('dialog', { name: 'Log in to book at Rally Point Gensan' })

    const submitLogin = () =>
      within(dialog)
        .getAllByRole('button', { name: 'Log in' })
        .find((btn) => btn.getAttribute('type') === 'submit')!

    // 1. Wrong password does not reveal unconfirmed status
    await user.type(within(dialog).getByLabelText('Email'), 'pending.player@example.com')
    await user.type(within(dialog).getByLabelText('Password'), 'wrongpass')
    await user.click(submitLogin())

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Unable to log in. Check your email and password, then try again.',
    )
    expect(within(dialog).queryByLabelText('6-digit code')).not.toBeInTheDocument()

    // 2. Valid password + unconfirmed email opens the 6-digit verification step with immediate resend enabled
    await user.clear(within(dialog).getByLabelText('Password'))
    await user.type(within(dialog).getByLabelText('Password'), 'courtpass123')
    await user.click(submitLogin())

    expect(await within(dialog).findByRole('heading', { name: 'Check your email' })).toBeInTheDocument()
    expect(within(dialog).getByRole('status')).toHaveTextContent(
      'Your email is not verified yet. Enter your 6-digit code below or send a new code.',
    )

    const resendBtn = within(dialog).getByRole('button', { name: 'Send a new code' })
    expect(resendBtn).toBeEnabled()
    await user.click(resendBtn)

    expect(await within(dialog).findByRole('status')).toHaveTextContent(
      'We sent a new code to pending.player@example.com.',
    )
    const latestEmail = sim.mailbox[sim.mailbox.length - 1]
    expect(latestEmail.kind).toBe('resend')

    // 3. Submit new 6-digit code -> confirms account and notifies booking modal
    await user.type(within(dialog).getByLabelText('6-digit code'), latestEmail.token)
    await user.click(within(dialog).getByRole('button', { name: 'Confirm and continue' }))

    await vi.waitFor(() => expect(onAuthenticated).toHaveBeenCalledTimes(1))
    expect(onAuthenticated).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'pending.player@example.com',
        role: 'member',
      }),
    )
    expect(sim.users.get('pending.player@example.com')?.confirmed).toBe(true)
  })
})
