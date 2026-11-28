import { useCallback, useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import type { Profile, PublicClub, Role } from '../types'
import { BrinelyLogo } from '../components/BrinelyLogo'
import { Photo } from '../components/Photo'
import { PrivacyAcknowledgement } from '../components/PrivacyAcknowledgement'
import { ClubBadge } from '../components/Shell'
import { PublicFrame } from '../components/PublicFrame'
import { helpFaqs } from '../lib/helpContent'
import { privacyNoticePath, type PrivacyNoticeState } from '../lib/privacyNotice'
import { PRIVACY_ACK_ERROR, PRIVACY_READ_FIRST_ERROR, usePrivacyGate } from '../lib/usePrivacyGate'
import { afterSignIn } from '../lib/roleHome'
import { LOGIN_PHOTO, stockSrc, stockSrcSet } from '../lib/stockPhotos'
import { useModalDialog } from '../lib/useModalDialog'

const demos: { role: Role; email: string; password: string; label: string }[] = [
  {
    role: 'superadmin',
    email: 'superadmin@brinely.info',
    password: 'superadmin123',
    label: 'Superadmin',
  },
  {
    role: 'admin',
    email: 'admin@brinely.info',
    password: 'admin123',
    label: 'Admin',
  },
  {
    role: 'staff',
    email: 'staff@brinely.info',
    password: 'staff123',
    label: 'Staff',
  },
  {
    role: 'member',
    email: 'member@brinely.info',
    password: 'member123',
    label: 'Player',
  },
]

type Mode = 'login' | 'join' | 'reset'

/** A new code can be asked for once a minute (matches the email service's limit). */
const RESEND_COOLDOWN_SECONDS = 60

function errorDetail(error: unknown, key: 'code' | 'status') {
  if (!error || typeof error !== 'object' || !(key in error)) return undefined
  const value = (error as Record<string, unknown>)[key]
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined
}

function isEmailNotConfirmedError(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  const code = errorDetail(error, 'code')
  return code === 'email_not_confirmed' || /email not confirmed/i.test(message)
}

/** Plain-English messages for the "Check your email" code step. */
function signupCodeErrorMessage(action: 'verify' | 'resend', error: unknown) {
  const message = error instanceof Error ? error.message : ''
  const code = errorDetail(error, 'code')
  const status = errorDetail(error, 'status')

  if (code === 'over_email_send_rate_limit' || /email rate limit|only request this after/i.test(message)) {
    return 'Too many codes were sent. Please wait a few minutes, then send a new code.'
  }
  if (
    code === 'over_request_rate_limit' ||
    status === '429' ||
    /too many attempts|rate limit|too many requests|\b429\b/i.test(message)
  ) {
    return 'Too many attempts. Please try again in about 5 minutes.'
  }
  if (action === 'resend') {
    return 'Unable to send a new code. Please try again.'
  }
  if (
    code === 'otp_expired' ||
    /token has expired or is invalid|otp.*(expired|invalid)|invalid.*(otp|token)/i.test(message)
  ) {
    return 'That code is wrong or has expired. Check the newest email or send a new code.'
  }
  return 'Unable to confirm your code. Please try again.'
}

/** The court-owner messages from sign-in: an owner whose club is not open yet, or who should log in instead. */
const ownerNotice = /^Your owner account is ready\./

function authenticationErrorMessage(mode: Mode, error: unknown) {
  const message = error instanceof Error ? error.message : 'Unable to continue. Please try again.'

  if (/^Too many attempts\. Please try again in about \d+ minutes?\.$/i.test(message)) {
    return message
  }

  if (/too many attempts|rate limit|too many requests|\b429\b/i.test(message)) {
    return 'Too many attempts. Please try again in about 5 minutes.'
  }

  if (
    /^Password must be at least \d+ characters$/i.test(message) ||
    /^Please enter your name$/i.test(message) ||
    /^This club link is not valid/i.test(message) ||
    // Shown only after the password or sign-up worked, so it reveals nothing to a stranger.
    ownerNotice.test(message)
  ) {
    return message
  }

  if (mode === 'reset') {
    return 'Unable to send the reset email. Please check your email address and try again.'
  }

  return mode === 'login'
    ? 'Unable to log in. Check your email and password, then try again.'
    : 'Unable to create an account. Please check your details or try again.'
}

type LoginPageProps =
  | {
      joinClub?: PublicClub
      dialog?: false
      clubName?: never
      clubSlug?: never
      bookingSummary?: never
      onClose?: never
      onAuthenticated?: never
    }
  | {
      dialog: true
      /** Shown at the top of the dialog, so people see which club they are booking with. */
      clubName?: string
      /** The club slug for the Privacy Notice link inside the booking dialog. */
      clubSlug?: string
      /** The booking being made, shown under the title, e.g. "Court A · Nov 25 · 6–7 AM · Php 500.00". */
      bookingSummary?: string
      onClose: () => void
      onAuthenticated: (profile: Profile) => void
      joinClub?: never
    }

/**
 * Log in or join. With `joinClub` (from a club's join link) the page signs up into that club.
 * With `dialog` it opens over the current page instead, as the booking page does before payment:
 * it calls `onAuthenticated` once the person is signed in, and the caller then closes it.
 * `onClose` runs when the person closes it without signing in.
 */
export default function LoginPage({
  joinClub,
  clubName,
  clubSlug,
  bookingSummary,
  dialog = false,
  onClose,
  onAuthenticated,
}: LoginPageProps = {}) {
  const { user, loading, signIn, signInWithGoogle, signUpMember, verifySignupCode, resendSignupCode, resetPassword, demo } =
    useAuth()
  const nav = useNavigate()
  // The Find a court "Sign up" button opens the sign-up tab directly.
  const location = useLocation()
  const navState = location.state as { mode?: unknown; owner?: unknown; from?: unknown } | null
  // The page they were on: players and members go back to it once signed in.
  const returnTo = navState?.from
  // The court-owner page opens sign-up with a note: owners use the email they gave bRineLy.
  const ownerSignup = navState?.owner === true && !joinClub
  const [mode, setMode] = useState<Mode>(joinClub || navState?.mode === 'join' ? 'join' : 'login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [resetSuccess, setResetSuccess] = useState(false)
  const [busy, setBusy] = useState(false)
  // Counts mode changes so the form fades in on each change, not on first load or while typing.
  const [modeSwitches, setModeSwitches] = useState(0)
  // Set once sign-up needs the 6-digit code from the confirmation email.
  const [codeEmail, setCodeEmail] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [resendIn, setResendIn] = useState(0)
  const [resending, setResending] = useState(false)
  const [codeNotice, setCodeNotice] = useState<string | null>(null)
  const codeInputRef = useRef<HTMLInputElement>(null)
  const emailInputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const privacyGate = usePrivacyGate({
    onUnlock: () => {
      setError((current) => (current === PRIVACY_READ_FIRST_ERROR ? null : current))
    },
    onCheck: (checked) => {
      if (checked) {
        setError((current) =>
          current === PRIVACY_ACK_ERROR || current === PRIVACY_READ_FIRST_ERROR ? null : current,
        )
      }
    },
  })
  // Set once onAuthenticated has run. The submit handler and the signed-in check below can
  // both see the same sign-in, and the caller should hear about it only once.
  const authenticationReported = useRef(false)
  // Set when leaving the code step from inside it, so focus returns to the email box.
  const focusEmailNext = useRef(false)
  const modeFade = modeSwitches === 0 ? undefined : modeSwitches % 2 ? 'enter-fade' : 'enter-fade-again'
  const effectiveClubSlug = joinClub?.slug ?? clubSlug
  // Keep the join link's club, so returning from the notice still signs up into it.
  const privacyPath = privacyNoticePath(effectiveClubSlug)
  const privacyState: PrivacyNoticeState = { from: joinClub ? `/join/${joinClub.slug}` : '/login' }

  // Count down to when a new code may be sent; each tick schedules the next one.
  useEffect(() => {
    if (!codeEmail || resendIn <= 0) return
    const timer = window.setTimeout(() => setResendIn((seconds) => Math.max(0, seconds - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [codeEmail, resendIn])

  // Put the cursor in the code box as soon as the step appears, and back in the
  // email box when the person leaves it to use a different email.
  useEffect(() => {
    if (codeEmail) {
      codeInputRef.current?.focus()
    } else if (focusEmailNext.current) {
      focusEmailNext.current = false
      emailInputRef.current?.focus()
    }
  }, [codeEmail])

  // Closing while a sign-in is running would drop its result, so the dialog waits for it.
  function closeDialog() {
    if (!busy) onClose?.()
  }

  useModalDialog(dialog, {
    dialogRef,
    initialFocusRef: emailInputRef,
    onEscape: closeDialog,
    lockScroll: true,
  })

  /** Tells the dialog's caller about the sign-in, once. */
  const reportAuthenticated = useCallback(
    (profile: Profile) => {
      if (!onAuthenticated || authenticationReported.current) return
      authenticationReported.current = true
      onAuthenticated(profile)
    },
    [onAuthenticated],
  )

  // Someone already signed in, or whose saved session finishes loading, needs no dialog.
  useEffect(() => {
    if (dialog && !loading && user) reportAuthenticated(user)
  }, [dialog, loading, user, reportAuthenticated])

  if (!loading && user) {
    // The dialog's caller closes it once told; the page sends the person to their home.
    return dialog ? null : <Navigate to={afterSignIn(user.role, returnTo)} replace />
  }

  /**
   * Once signed in: the dialog tells its caller; the page goes to `next` (a club join link),
   * or back to the page the person came from (players and members), or their desk.
   */
  function finishSignIn(profile: Profile, next?: string) {
    if (dialog) reportAuthenticated(profile)
    else nav(next ?? afterSignIn(profile.role, returnTo), { replace: true })
  }

  function openCodeStep(sentTo: string, options?: { cooldownSeconds?: number; notice?: string | null }) {
    setCodeEmail(sentTo)
    setCode('')
    setCodeNotice(options?.notice ?? null)
    setResendIn(options?.cooldownSeconds ?? RESEND_COOLDOWN_SECONDS)
  }

  function leaveCodeStep(focusEmail = false) {
    focusEmailNext.current = focusEmail
    setCodeEmail(null)
    setCode('')
    setCodeNotice(null)
    setResendIn(0)
    setPassword('')
    setPasswordVisible(false)
    setError(null)
  }

  async function onSubmitCode(e: FormEvent) {
    e.preventDefault()
    if (!codeEmail) return
    setError(null)
    setCodeNotice(null)
    if (code.length !== 6) {
      setError('Enter the 6-digit code from the email.')
      codeInputRef.current?.focus()
      return
    }
    setBusy(true)
    try {
      const profile = await verifySignupCode(codeEmail, code)
      finishSignIn(profile)
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      if (ownerNotice.test(message)) {
        // The code worked and the email is confirmed; the owner logs in once their club is open.
        leaveCodeStep(true)
        setModeSwitches((count) => count + 1)
        setMode('login')
        setError(message)
      } else if (/^Your club profile is not ready/i.test(message)) {
        // The code worked and the email is confirmed, so the same code cannot be used
        // again. Send the person to Log in instead of asking for the code once more.
        leaveCodeStep(true)
        setModeSwitches((count) => count + 1)
        setMode('login')
        setError('Your email is confirmed, but your account could not be opened. Please log in. If that fails, ask staff for help.')
      } else {
        setError(signupCodeErrorMessage('verify', err))
        codeInputRef.current?.focus()
      }
    } finally {
      setBusy(false)
    }
  }

  async function onResendCode() {
    if (!codeEmail || resendIn > 0 || resending) return
    setResending(true)
    setError(null)
    setCodeNotice(null)
    try {
      await resendSignupCode(codeEmail)
      setCode('')
      setResendIn(RESEND_COOLDOWN_SECONDS)
      setCodeNotice(`We sent a new code to ${codeEmail}.`)
      codeInputRef.current?.focus()
    } catch (err) {
      setError(signupCodeErrorMessage('resend', err))
      codeInputRef.current?.focus()
    } finally {
      setResending(false)
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (mode === 'join') {
      const privacyProblem = privacyGate.validate()
      if (privacyProblem) {
        setError(privacyProblem)
        return
      }
    }
    setBusy(true)
    setError(null)
    setResetSuccess(false)
    try {
      if (mode === 'join') {
        const result = await signUpMember({
          email,
          password,
          full_name: fullName,
          phone: phone || undefined,
          clubSlug: joinClub?.slug,
        })
        if (result.status === 'needs_code') {
          // The password has done its job; never keep it around on the code step.
          setPassword('')
          setPasswordVisible(false)
          openCodeStep(result.email)
        } else {
          finishSignIn(result.profile)
        }
      } else if (mode === 'reset') {
        await resetPassword(email)
        setResetSuccess(true)
      } else {
        const profile = await signIn(email, password)
        // From a join link, existing players come back to confirm joining the club.
        finishSignIn(profile, joinClub ? `/join/${joinClub.slug}` : undefined)
      }
    } catch (err) {
      if (mode === 'login' && isEmailNotConfirmedError(err)) {
        setPassword('')
        setPasswordVisible(false)
        openCodeStep(email.trim().toLowerCase(), {
          cooldownSeconds: 0,
          notice: 'Your email is not verified yet. Enter your 6-digit code below or send a new code.',
        })
      } else {
        setError(authenticationErrorMessage(mode, err))
      }
    } finally {
      setBusy(false)
    }
  }

  async function onGoogleClick() {
    if (!signInWithGoogle) return
    if (mode === 'join') {
      const privacyProblem = privacyGate.validate()
      if (privacyProblem) {
        setError(privacyProblem)
        return
      }
    }
    setBusy(true)
    setError(null)
    try {
      await signInWithGoogle()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in with Google right now.')
    } finally {
      setBusy(false)
    }
  }

  function switchMode(next: Mode) {
    if (next !== mode || codeEmail) setModeSwitches((count) => count + 1)
    if (codeEmail) leaveCodeStep()
    setMode(next)
    setPassword('')
    setPasswordVisible(false)
    privacyGate.reset()
    setError(null)
    setResetSuccess(false)
  }


  // The page's main heading is the h1. The dialog's own title (an h2) names the step, so the
  // form inside it has no second heading; only the code step adds one, under the title.
  const Heading = dialog ? 'h3' : 'h1'
  const headingClass = dialog
    ? 'text-heading-3 font-semibold text-ink'
    : 'text-heading-1 font-semibold text-ink'
  const formHeading =
    mode === 'join'
      ? 'Create your player account'
      : mode === 'reset'
      ? 'Reset your password'
      : 'Log in'
  // The page names only the club a join link is for.
  const formLeadIn = mode === 'join' && joinClub ? `Joining ${joinClub.name}` : null
  const codeLeadIn = joinClub ? `Joining ${joinClub.name}` : dialog ? 'One more step' : null
  const formDescription =
    mode === 'join'
      ? demo
        ? 'For players only. Book and pay for courts, join open play, and use your QR pass.'
        : 'For players only. View availability, open play, and your QR pass.'
      : mode === 'reset'
      ? 'Enter your email and we’ll send a password reset link.'
      : joinClub
      ? `Already have an account? Log in, then confirm joining ${joinClub.name}.`
      : dialog
      ? null
      : 'Players, staff, and club admins all log in here.'
  const ownerNote = mode === 'join' && ownerSignup
  // The club being booked, named in the dialog's title beside its own badge (never the bRineLy mark).
  const dialogClub = clubName?.trim() || null
  const dialogTitle =
    mode === 'reset'
      ? 'Reset your password'
      : `${mode === 'join' ? 'Sign up' : 'Log in'} to book${dialogClub ? ` at ${dialogClub}` : ''}`

  const modeButtons = (
    <div className="mb-5 text-tabs text-tabs-fill" role="group" aria-label="Log in or sign up">
      <button
        type="button"
        className="min-h-12"
        onClick={() => switchMode('login')}
        aria-pressed={mode === 'login'}
      >
        Log in
      </button>
      <button
        type="button"
        className="min-h-12"
        onClick={() => switchMode('join')}
        aria-pressed={mode === 'join'}
      >
        Sign up
      </button>
    </div>
  )

  const codeStep = (
    <div className="enter-fade">
      <div className="mb-4">
        {codeLeadIn ? <p className="text-body font-semibold text-muted">{codeLeadIn}</p> : null}
        <Heading id="signup-code-title" className={`mt-1 ${headingClass}`}>
          Check your email
        </Heading>
        <p className="mt-1.5 text-subtitle text-muted">
          We sent a 6-digit code to{' '}
          <strong className="break-all font-semibold text-ink">{codeEmail}</strong>. Type it
          below to finish creating your account.
        </p>
      </div>

      <form onSubmit={onSubmitCode} className="space-y-3.5" aria-labelledby="signup-code-title" noValidate>
        <div>
          <label className="label" htmlFor="signup_code">
            6-digit code
          </label>
          <input
            ref={codeInputRef}
            id="signup_code"
            name="signup_code"
            className="input text-center indent-[0.4em] text-2xl font-semibold tracking-[0.4em] tabular-nums"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            value={code}
            // Pasted or typed codes often carry spaces or text; keep only the digits.
            // No maxLength: it would cut "12 34 56" before the spaces are removed.
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onPaste={(e) => {
              const digits = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
              if (!digits) return
              e.preventDefault()
              setCode(digits)
            }}
            required
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'signup-code-hint authentication-error' : 'signup-code-hint'}
          />
          <p id="signup-code-hint" className="mt-1.5 text-body text-muted">
            Can’t find it? Check your spam or promotions folder.
          </p>
        </div>

        {error ? (
          <p
            id="authentication-error"
            role="alert"
            aria-live="assertive"
            className="notice notice-error text-body font-semibold"
          >
            {error}
          </p>
        ) : null}

        {codeNotice ? (
          <p role="status" className="notice text-body font-semibold">
            {codeNotice}
          </p>
        ) : null}

        <button className="btn-primary" type="submit" disabled={busy} aria-busy={busy}>
          {busy ? 'Checking code…' : 'Confirm and continue'}
        </button>
        <button
          className="btn-secondary"
          type="button"
          onClick={() => void onResendCode()}
          disabled={resendIn > 0 || resending || busy}
          aria-busy={resending}
        >
          {resending
            ? 'Sending…'
            : resendIn > 0
            ? `Send a new code in ${resendIn}s`
            : 'Send a new code'}
        </button>
      </form>

      <p className="mt-4 text-center text-subtitle text-muted">
        Wrong email?{' '}
        <button
          type="button"
          className="text-link inline-flex min-h-12 cursor-pointer items-center"
          onClick={() => leaveCodeStep(true)}
        >
          Use a different email
        </button>
      </p>
    </div>
  )

  const formStep = (
    <div className={modeFade}>
      {!dialog || formDescription || ownerNote ? (
        <div className="mb-4">
          {dialog ? null : (
            <>
              {formLeadIn ? <p className="text-body font-semibold text-muted">{formLeadIn}</p> : null}
              <Heading className={`mt-1 ${headingClass}`}>{formHeading}</Heading>
            </>
          )}
          {formDescription ? (
            <p className={`${dialog ? '' : 'mt-1.5 '}text-subtitle text-muted`}>{formDescription}</p>
          ) : null}
          {ownerNote ? (
            <p className="notice mt-3 text-subtitle">
              Court owner? Use the email you gave bRineLy. Your account becomes your club’s admin, not a player membership.
            </p>
          ) : null}
        </div>
      ) : null}

      {dialog && mode !== 'reset' && signInWithGoogle ? (
        <div className="mb-4 space-y-3">
          <button
            type="button"
            onClick={() => void onGoogleClick()}
            disabled={busy}
            className="btn-secondary gap-2.5"
          >
            <svg viewBox="0 0 24 24" className="h-4.5 w-4.5 shrink-0" aria-hidden>
              <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.44a5.5 5.5 0 0 1-2.39 3.61v3h3.87c2.26-2.08 3.57-5.15 3.57-8.85z" />
              <path fill="#34A853" d="M12 24c3.24 0 5.95-1.07 7.94-2.9l-3.87-3c-1.07.72-2.44 1.14-4.07 1.14-3.13 0-5.78-2.11-6.73-4.96H1.28v3.1A12 12 0 0 0 12 24z" />
              <path fill="#FBBC05" d="M5.27 14.28A7.2 7.2 0 0 1 4.9 12c0-.79.14-1.56.37-2.28v-3.1H1.28a12 12 0 0 0 0 10.76l3.99-3.1z" />
              <path fill="#EA4335" d="M12 4.76c1.76 0 3.34.61 4.58 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.69 1.28 6.62l3.99 3.1c.95-2.85 3.6-4.96 6.73-4.96z" />
            </svg>
            Continue with Google
          </button>
          <div className="relative flex items-center justify-center">
            <span className="w-full border-t border-line" />
            <span className="bg-white px-2.5 text-body text-muted">or</span>
            <span className="w-full border-t border-line" />
          </div>
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="space-y-3.5">
        {mode === 'join' ? (
          <>
            <div>
              <label className="label" htmlFor="full_name">
                Full name
              </label>
              <input
                id="full_name"
                className="input"
                autoComplete="name"
                placeholder="Juan Dela Cruz"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="phone">
                Mobile (optional)
              </label>
              <input
                id="phone"
                className="input"
                type="tel"
                autoComplete="tel"
                placeholder="09xx xxx xxxx"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
          </>
        ) : null}

        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            ref={emailInputRef}
            id="email"
            className="input"
            type="email"
            autoComplete={mode === 'reset' ? 'email' : 'username'}
            placeholder="you@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        {mode !== 'reset' ? (
          <div>
            <div className="mb-1 flex items-end justify-between gap-2">
              <label className="label mb-0 pb-1" htmlFor="password">
                Password
              </label>
              {mode === 'login' ? (
                <button
                  type="button"
                  className="text-link inline-flex min-h-12 cursor-pointer items-center text-subtitle"
                  onClick={() => switchMode('reset')}
                >
                  Forgot password?
                </button>
              ) : null}
            </div>
            <div className="relative">
              <input
                id="password"
                className="input pr-14"
                type={passwordVisible ? 'text' : 'password'}
                autoComplete={mode === 'join' ? 'new-password' : 'current-password'}
                placeholder={mode === 'join' ? undefined : '••••••••'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={mode === 'join' ? 6 : undefined}
                aria-describedby={
                  [mode === 'join' ? 'password-rule' : null, error ? 'authentication-error' : null]
                    .filter(Boolean)
                    .join(' ') || undefined
                }
              />
              <button
                type="button"
                className="absolute inset-y-0 right-0 inline-flex min-h-12 min-w-12 cursor-pointer items-center justify-center rounded-[10px] text-muted transition hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
                onClick={() => setPasswordVisible((visible) => !visible)}
                aria-label={passwordVisible ? 'Hide password' : 'Show password'}
                aria-pressed={passwordVisible}
              >
                {passwordVisible ? (
                  <EyeOff size={20} aria-hidden />
                ) : (
                  <Eye size={20} aria-hidden />
                )}
              </button>
            </div>
            {/* The rule stays visible while typing; a placeholder would vanish. */}
            {mode === 'join' ? (
              <p id="password-rule" className="mt-1.5 text-body text-muted">
                At least 6 characters.
              </p>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <p
            id="authentication-error"
            role="alert"
            aria-live="assertive"
            className="notice notice-error text-body font-semibold"
          >
            {error}
          </p>
        ) : null}

        {resetSuccess ? (
          <p role="status" className="notice text-body font-semibold">
            Check your inbox for a password reset link.
          </p>
        ) : null}

        {mode === 'join' ? (
          <PrivacyAcknowledgement
            gate={privacyGate}
            clubSlug={effectiveClubSlug}
            clubName={joinClub?.name ?? dialogClub}
            describedBy={error ? 'authentication-error' : undefined}
          />
        ) : null}

        <button className="btn-primary" type="submit" disabled={busy} aria-busy={busy}>
          {busy
            ? 'Please wait…'
            : mode === 'join'
            ? 'Sign up'
            : mode === 'reset'
            ? 'Send reset link'
            : 'Log in'}
        </button>
      </form>

      {mode === 'reset' ? (
        <p className="mt-4 text-center text-subtitle text-muted">
          Remembered your password?{' '}
          <button
            type="button"
            className="text-link inline-flex min-h-12 cursor-pointer items-center"
            onClick={() => switchMode('login')}
          >
            Back to log in
          </button>
        </p>
      ) : mode === 'login' ? (
        <p className="mt-4 text-center text-subtitle text-muted">
          New player?{' '}
          <button
            type="button"
            className="text-link inline-flex min-h-12 cursor-pointer items-center"
            onClick={() => switchMode('join')}
          >
            Sign up
          </button>
        </p>
      ) : (
        <p className="mt-4 text-center text-subtitle text-muted">
          Already have an account?{' '}
          <button
            type="button"
            className="text-link inline-flex min-h-12 cursor-pointer items-center"
            onClick={() => switchMode('login')}
          >
            Log in
          </button>
        </p>
      )}
      {dialog && demo ? (
        <div className="mt-1 flex justify-center">
          <button
            type="button"
            className="text-link inline-flex min-h-12 cursor-pointer items-center text-subtitle"
            onClick={() => {
              switchMode('login')
              setEmail('member@brinely.info')
              setPassword('member123')
            }}
          >
            Fill demo player account
          </button>
        </div>
      ) : null}
      {dialog ? (
        <p className="mt-3 border-t border-line pt-3 text-body text-muted">
          By continuing, you confirm you are booking under your account.
        </p>
      ) : null}
    </div>
  )

  if (dialog) {
    return createPortal(
      <div
        className="fixed inset-0 z-[100] flex items-end justify-center overflow-y-auto bg-ink/50 [scrollbar-width:none] sm:items-center sm:p-4 [&::-webkit-scrollbar]:hidden"
        onClick={(event: MouseEvent<HTMLDivElement>) => {
          // A tap on the dimmed backdrop closes, like the X button.
          if (event.target === event.currentTarget) closeDialog()
        }}
      >
        {/* A plain sheet: rises from the bottom on phones, centred on larger screens. */}
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal
          aria-labelledby={codeEmail ? 'signup-code-title' : 'login-dialog-title'}
          className="enter-rise max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-t-[12px] border border-b-0 border-line bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] text-ink [scrollbar-width:none] sm:rounded-[12px] sm:border-b sm:p-6 [&::-webkit-scrollbar]:hidden"
        >
          <div className="mb-4 flex items-start justify-between gap-3 border-b border-line pb-3">
            <div className="flex min-w-0 items-center gap-3">
              {/* The club's own badge: the bRineLy mark here would read as the club's logo. */}
              {dialogClub ? (
                <ClubBadge name={dialogClub} size="large" />
              ) : (
                <BrinelyLogo variant="mark" title="" className="h-11 w-11 shrink-0 object-contain" />
              )}
              <div className="min-w-0">
                <h2 id="login-dialog-title" className="text-title font-semibold text-ink">
                  {dialogTitle}
                </h2>
                {bookingSummary ? <p className="mt-0.5 text-body text-muted">{bookingSummary}</p> : null}
              </div>
            </div>
            <button
              type="button"
              onClick={closeDialog}
              disabled={busy}
              className="control-feedback inline-flex min-h-12 min-w-12 shrink-0 items-center justify-center rounded-[10px] text-muted hover:text-ink"
              aria-label="Close sign-in"
            >
              <X size={20} aria-hidden />
            </button>
          </div>
          {modeButtons}
          {codeEmail ? codeStep : formStep}
        </div>
      </div>,
      document.body,
    )
  }

  return (
    <PublicFrame title={mode === 'join' ? 'Sign up' : 'Log in'} accountLinks="none" heading="none">
      <div className="grid gap-6 lg:grid-cols-2 lg:gap-12">
        <div className="lg:sticky lg:top-20 lg:self-start">
          <Photo
            src={stockSrc(LOGIN_PHOTO, 'small')}
            srcSet={stockSrcSet(LOGIN_PHOTO)}
            sizes="(min-width: 1024px) 50vw, 100vw"
            alt={LOGIN_PHOTO.alt}
            priority
            className="aspect-[16/7] w-full rounded-[12px] lg:aspect-auto lg:h-[min(44rem,calc(100dvh-7rem))]"
          />
        </div>

        <div className="enter-rise mx-auto w-full max-w-[440px]">
          {modeButtons}
          {codeEmail ? codeStep : formStep}

          {demo ? (
            <section className="mt-8 border-t border-line pt-5" aria-labelledby="demo-logins-title">
              <h2 id="demo-logins-title" className="text-title font-semibold text-ink">
                Quick demo logins
              </h2>
              <p className="mt-1 text-body text-muted">Demo only. Pick an account to fill in the form.</p>
              <ul className="mt-2 divide-y divide-line border-y border-line">
                {demos.map((d) => (
                  <li key={d.role}>
                    <button
                      type="button"
                      className="control-feedback flex min-h-14 w-full cursor-pointer items-center justify-between gap-3 py-2 text-left"
                      onClick={() => {
                        switchMode('login')
                        setEmail(d.email)
                        setPassword(d.password)
                      }}
                    >
                      <span className="font-semibold text-ink">{d.label}</span>
                      <span className="min-w-0 truncate text-body text-muted">{d.email}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <p className="mt-6 text-body text-muted">
              Staff and admin accounts are created by the club, not by signing up here.
            </p>
          )}

          <section className="mt-8 border-t border-line pt-5" aria-labelledby="login-faq-title">
            <h2 id="login-faq-title" className="text-title font-semibold text-ink">
              Quick questions
            </h2>
            <div className="mt-1 divide-y divide-line">
              {helpFaqs.slice(0, 3).map(({ question, answer }) => (
                <details key={question}>
                  <summary className="flex min-h-12 cursor-pointer items-center py-1 text-subtitle font-semibold text-ink">
                    {question}
                  </summary>
                  <p className="pb-3 text-body text-muted">{answer}</p>
                </details>
              ))}
            </div>
            <p className="mt-3 text-body text-muted">
              More FAQs and Contact Us are available in Help after you sign in.
            </p>
          </section>

          {/* Kept beside the site footer's link: this one opens the join link's club notice and comes back here. */}
          <p className="mt-2">
            <Link className="text-link inline-flex min-h-12 items-center text-body" to={privacyPath} state={privacyState}>
              Privacy Notice
            </Link>
          </p>
        </div>
      </div>
    </PublicFrame>
  )
}
