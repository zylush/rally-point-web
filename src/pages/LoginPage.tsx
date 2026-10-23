import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  Camera,
  Crown,
  Eye,
  EyeOff,
  MailCheck,
  Shield,
  UserPlus,
  UserRound,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import type { PublicClub, Role } from '../types'
import { RallyPointLogo } from '../components/RallyPointLogo'
import { helpFaqs } from '../lib/helpContent'
import { privacyNoticePath, type PrivacyNoticeState } from '../lib/privacyNotice'
import { homeFor } from '../lib/roleHome'
import { DEFAULT_CLUB_SLUG } from '../lib/tenant'

const demos: { role: Role; email: string; password: string; label: string }[] = [
  {
    role: 'superadmin',
    email: 'superadmin@rallypoint.local',
    password: 'superadmin123',
    label: 'Superadmin',
  },
  {
    role: 'admin',
    email: 'admin@rallypoint.local',
    password: 'admin123',
    label: 'Admin',
  },
  {
    role: 'staff',
    email: 'staff@rallypoint.local',
    password: 'staff123',
    label: 'Staff',
  },
  {
    role: 'member',
    email: 'member@rallypoint.local',
    password: 'member123',
    label: 'Member',
  },
]

const HERO_VIDEO = `${import.meta.env.BASE_URL}media/pickleball-hero.mp4`
const HERO_POSTER = `${import.meta.env.BASE_URL}media/pickleball-poster.jpg`

type Mode = 'login' | 'join' | 'reset'

/** A new code can be asked for once a minute (matches the email service's limit). */
const RESEND_COOLDOWN_SECONDS = 60

function errorDetail(error: unknown, key: 'code' | 'status') {
  if (!error || typeof error !== 'object' || !(key in error)) return undefined
  const value = (error as Record<string, unknown>)[key]
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined
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
    /^This club link is not valid/i.test(message)
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

/** With `joinClub` (from a club's join link) the page signs up into that club. */
export default function LoginPage({ joinClub }: { joinClub?: PublicClub } = {}) {
  const { user, loading, signIn, signUpMember, verifySignupCode, resendSignupCode, resetPassword, demo } =
    useAuth()
  const nav = useNavigate()
  // A club page sends visitors here to sign in, then expects them back to finish booking.
  // The Find a court "Sign up" button opens the sign-up tab directly.
  const location = useLocation()
  const navState = location.state as { returnTo?: unknown; mode?: unknown } | null
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
  // Set when leaving the code step from inside it, so focus returns to the email box.
  const focusEmailNext = useRef(false)
  const modeFade = modeSwitches === 0 ? undefined : modeSwitches % 2 ? 'enter-fade' : 'enter-fade-again'
  // Keep the join link's club, so returning from the notice still signs up into it.
  const privacyPath = privacyNoticePath(joinClub?.slug)
  const privacyState: PrivacyNoticeState = { from: joinClub ? `/join/${joinClub.slug}` : '/login' }
  const requested = navState?.returnTo
  const returnTo = typeof requested === 'string' && requested.startsWith('/clubs/') ? requested : null

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

  if (!loading && user) return <Navigate to={returnTo ?? homeFor(user.role)} replace />

  /** Where a new member goes once signed in: back to the club page, or their home. */
  function finishSignup(role: Role) {
    nav(returnTo ?? homeFor(role), { replace: true })
  }

  function openCodeStep(sentTo: string) {
    setCodeEmail(sentTo)
    setCode('')
    setCodeNotice(null)
    setResendIn(RESEND_COOLDOWN_SECONDS)
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
      finishSignup(profile.role)
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      if (/^Your club profile is not ready/i.test(message)) {
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
          finishSignup(result.profile.role)
        }
      } else if (mode === 'reset') {
        await resetPassword(email)
        setResetSuccess(true)
      } else {
        const profile = await signIn(email, password)
        // From a join link, existing players come back to confirm joining the club.
        nav(joinClub ? `/join/${joinClub.slug}` : returnTo ?? homeFor(profile.role), { replace: true })
      }
    } catch (err) {
      setError(authenticationErrorMessage(mode, err))
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
    setError(null)
    setResetSuccess(false)
  }

  return (
    <div className="app-shell app-shell-bleed relative min-h-[100dvh] text-white overflow-hidden">
      {/* Cinematic pickleball video hero */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
        <video
          className="absolute inset-0 h-full w-full object-cover scale-105"
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          poster={HERO_POSTER}
        >
          <source src={HERO_VIDEO} type="video/mp4" />
        </video>
        {/* Dark cinematic grade — readable text, sports-site feel */}
        <div className="absolute inset-0 bg-gradient-to-br from-slate-950/75 via-slate-900/55 to-teal-950/65" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_40%,transparent_0%,rgba(2,6,23,0.55)_70%)]" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/35" />
      </div>

      <div className="relative z-10 mx-auto grid min-h-[100dvh] w-full max-w-6xl grid-cols-1 lg:grid-cols-2 lg:items-center lg:gap-12 px-5 py-10 sm:px-8 lg:px-10">
        {/* Brand panel */}
        <div className="flex flex-col justify-center text-center lg:text-left pt-6 lg:pt-0 pb-8 lg:pb-0">
          <div className="mb-5 inline-flex self-center lg:self-start items-center gap-2 rounded-full border border-white/20 bg-black/30 px-3.5 py-1.5 text-sm font-semibold text-white/95 backdrop-blur-md shadow-lg">
            <span aria-hidden>🏓</span>
            {demo ? 'Try it now · demo' : 'Pickleball club app'}
          </div>

          <div className="mb-5 flex justify-center lg:justify-start">
            {/* The logo artwork says "Gensan"; other clubs' join links show their own name instead. */}
            {joinClub && joinClub.slug !== DEFAULT_CLUB_SLUG ? (
              <p className="text-3xl sm:text-4xl font-extrabold text-white drop-shadow-lg">{joinClub.name}</p>
            ) : (
              <RallyPointLogo
                variant="color"
                className="h-28 sm:h-36 w-auto max-w-[min(100%,320px)] object-contain drop-shadow-[0_12px_40px_rgba(0,0,0,0.55)]"
                title="Rally Point"
              />
            )}
          </div>

          <h1 className="sr-only">Rally Point</h1>
          <p className="text-4xl sm:text-5xl xl:text-6xl font-extrabold leading-[1.05] tracking-tight text-center lg:text-left drop-shadow-lg">
            <span className="block text-white">PICKLEBALL</span>
            <span className="mt-1 block bg-gradient-to-r from-teal-200 via-cyan-200 to-white bg-clip-text text-transparent">
              PASSION
            </span>
          </p>

          <p className="mt-5 max-w-md mx-auto lg:mx-0 text-base sm:text-lg leading-relaxed text-white/90 drop-shadow">
            Book a court. Join open play. Show your QR at the desk. Players join online — staff
            &amp; admin are set up by the club.
          </p>

          <div className="mt-8 hidden lg:flex flex-wrap gap-3">
            <div className="rounded-2xl border border-white/15 bg-black/35 px-4 py-3 backdrop-blur-md shadow-lg">
              <p className="text-sm font-bold text-teal-200">Members</p>
              <p className="text-base font-semibold text-white">{demo ? 'Book · pay · QR · open play' : 'Availability · QR · open play'}</p>
            </div>
            <div className="rounded-2xl border border-white/15 bg-black/35 px-4 py-3 backdrop-blur-md shadow-lg">
              <p className="text-sm font-bold text-teal-200">Staff / Admin</p>
              <p className="text-base font-semibold text-white">Desk, courts, club ops</p>
            </div>
          </div>
        </div>

        {/* Access card — glass over video */}
        <div className="flex items-center justify-center lg:justify-end pb-8 lg:pb-0">
          <div className="enter-rise w-full max-w-md rounded-3xl border border-white/25 bg-white/95 backdrop-blur-xl p-5 sm:p-7 text-slate-900 shadow-2xl shadow-black/50">
            <div className="mb-5 grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1">
              <button
                type="button"
                className={`min-h-12 cursor-pointer rounded-xl py-2.5 text-sm font-extrabold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 ${
                  mode === 'login' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                }`}
                onClick={() => switchMode('login')}
                aria-pressed={mode === 'login'}
              >
                Log in
              </button>
              <button
                type="button"
                className={`min-h-12 cursor-pointer rounded-xl py-2.5 text-sm font-extrabold transition inline-flex items-center justify-center gap-1.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 ${
                  mode === 'join' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                }`}
                onClick={() => switchMode('join')}
                aria-pressed={mode === 'join'}
              >
                <UserPlus size={16} aria-hidden />
                Join as member
              </button>
            </div>

            {codeEmail ? (
              <div className="enter-fade">
                <div className="mb-4">
                  <span
                    aria-hidden
                    className="mb-3 inline-flex size-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-700"
                  >
                    <MailCheck size={24} />
                  </span>
                  <p className="text-sm font-bold text-slate-500">
                    {joinClub ? `Joining ${joinClub.name}` : 'One more step'}
                  </p>
                  <h2 id="signup-code-title" className="mt-1 text-2xl font-extrabold text-slate-900">
                    Check your email
                  </h2>
                  <p className="mt-1.5 text-base text-slate-600">
                    We sent a 6-digit code to{' '}
                    <strong className="break-all font-extrabold text-slate-900">{codeEmail}</strong>. Type it
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
                      className="input text-center indent-[0.4em] text-2xl font-extrabold tracking-[0.4em] tabular-nums"
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
                    <p id="signup-code-hint" className="mt-1.5 text-sm text-slate-600">
                      Can’t find it? Check your spam or promotions folder.
                    </p>
                  </div>

                  {error ? (
                    <p
                      id="authentication-error"
                      role="alert"
                      aria-live="assertive"
                      className="text-sm font-semibold text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2"
                    >
                      {error}
                    </p>
                  ) : null}

                  {codeNotice ? (
                    <p
                      role="status"
                      className="text-sm font-semibold text-teal-700 bg-teal-50 border border-teal-100 rounded-xl px-3 py-2"
                    >
                      {codeNotice}
                    </p>
                  ) : null}

                  <button className="btn-primary gap-2" type="submit" disabled={busy} aria-busy={busy}>
                    {busy ? 'Checking code…' : 'Confirm and continue'}
                    {!busy ? <ArrowRight size={18} aria-hidden /> : null}
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

                <p className="mt-4 text-center text-base text-slate-600">
                  Wrong email?{' '}
                  <button
                    type="button"
                    className="inline-flex min-h-12 items-center font-extrabold text-brand-800 underline-offset-2 hover:underline"
                    onClick={() => leaveCodeStep(true)}
                  >
                    Use a different email
                  </button>
                </p>
              </div>
            ) : (
            <div className={modeFade}>
            <div className="mb-4">
              <p className="text-sm font-bold text-slate-500">
                {mode === 'join'
                  ? joinClub ? `Joining ${joinClub.name}` : 'New player'
                  : mode === 'reset'
                  ? 'Forgot your password?'
                  : 'Welcome back'}
              </p>
              <h2 className="mt-1 text-2xl font-extrabold text-slate-900">
                {mode === 'join'
                  ? 'Create member account'
                  : mode === 'reset'
                  ? 'Reset your password'
                  : 'Log in'}
              </h2>
              <p className="mt-1.5 text-base text-slate-600">
                {mode === 'join'
                  ? demo
                    ? 'For players only. You’ll get book, pay, open play, and your QR pass.'
                    : 'For players only. View availability, open play, and your QR pass.'
                  : mode === 'reset'
                  ? 'Enter your email and we’ll send a password reset link.'
                  : joinClub
                  ? `Already have an account? Log in, then confirm joining ${joinClub.name}.`
                  : 'Members, staff, and admin all use this log-in.'}
              </p>
            </div>

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
                  <label className="label" htmlFor="password">
                    Password
                  </label>
                  <div className="relative">
                    <input
                      id="password"
                      className="input pr-14"
                      type={passwordVisible ? 'text' : 'password'}
                      autoComplete={mode === 'join' ? 'new-password' : 'current-password'}
                      placeholder={mode === 'join' ? 'At least 6 characters' : '••••••••'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={mode === 'join' ? 6 : undefined}
                      aria-describedby={error ? 'authentication-error' : undefined}
                    />
                    <button
                      type="button"
                      className="absolute inset-y-0 right-0 inline-flex min-h-12 min-w-12 cursor-pointer items-center justify-center rounded-xl text-slate-600 transition hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
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
                </div>
              ) : null}

              {mode === 'login' ? (
                <div className="flex justify-end">
                  <button
                    type="button"
                    className="text-sm font-semibold text-slate-500 hover:text-slate-700"
                    onClick={() => switchMode('reset')}
                  >
                    Forgot password?
                  </button>
                </div>
              ) : null}

              {error ? (
                <p
                  id="authentication-error"
                  role="alert"
                  aria-live="assertive"
                  className="text-sm font-semibold text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2"
                >
                  {error}
                </p>
              ) : null}

              {resetSuccess ? (
                <p
                  role="status"
                  className="text-sm font-semibold text-teal-700 bg-teal-50 border border-teal-100 rounded-xl px-3 py-2"
                >
                  Check your inbox for a password reset link.
                </p>
              ) : null}

              {mode === 'join' ? (
                <p className="text-sm leading-relaxed text-slate-600">
                  By registering, you acknowledge that you have read our{' '}
                  {/* A new tab keeps the details already typed into this form. */}
                  <Link
                    className="inline-flex min-h-12 items-center font-semibold text-brand-800 underline underline-offset-2"
                    to={privacyPath}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Privacy Notice
                  </Link>{' '}
                  (opens in a new tab).
                </p>
              ) : null}

              <button className="btn-primary gap-2" type="submit" disabled={busy} aria-busy={busy}>
                {busy
                  ? 'Please wait…'
                  : mode === 'join'
                  ? 'Join Rally Point'
                  : mode === 'reset'
                  ? 'Send reset link'
                  : 'Log in'}
                {!busy ? <ArrowRight size={18} aria-hidden /> : null}
              </button>
            </form>

            {mode === 'reset' ? (
              <p className="mt-4 text-center text-base text-slate-600">
                Remembered your password?{' '}
                <button
                  type="button"
                  className="font-extrabold text-brand-800 underline-offset-2 hover:underline"
                  onClick={() => switchMode('login')}
                >
                  Back to log in
                </button>
              </p>
            ) : mode === 'login' ? (
              <p className="mt-4 text-center text-base text-slate-600">
                New player?{' '}
                <button
                  type="button"
                  className="font-extrabold text-brand-800 underline-offset-2 hover:underline"
                  onClick={() => switchMode('join')}
                >
                  Join as member
                </button>
              </p>
            ) : (
              <p className="mt-4 text-center text-base text-slate-600">
                Already have an account?{' '}
                <button
                  type="button"
                  className="font-extrabold text-brand-800 underline-offset-2 hover:underline"
                  onClick={() => switchMode('login')}
                >
                  Log in
                </button>
              </p>
            )}
            </div>
            )}

            {demo ? (
              <div className="mt-6 pt-5 border-t border-slate-100">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">
                  Quick demo logins
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {demos.map((d) => (
                    <button
                      key={d.role}
                      type="button"
                      className="card p-3 text-left active:scale-[0.98] transition hover:border-teal-300"
                      onClick={() => {
                        switchMode('login')
                        setEmail(d.email)
                        setPassword(d.password)
                      }}
                    >
                      <div className="w-8 h-8 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center mb-2">
                        {d.role === 'superadmin' ? (
                          <Crown size={16} />
                        ) : d.role === 'admin' ? (
                          <Shield size={16} />
                        ) : (
                          <UserRound size={16} />
                        )}
                      </div>
                      <p className="text-sm font-bold text-slate-800">{d.label}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5 truncate">{d.password}</p>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="mt-5 text-center text-sm text-slate-500">
                Staff / admin accounts are created by the club — not by joining here.
              </p>
            )}

            <section className="mt-6 border-t border-slate-200 pt-5" aria-labelledby="login-faq-title">
              <div className="flex items-baseline justify-between gap-3">
                <h3 id="login-faq-title" className="text-lg font-extrabold text-slate-900">
                  Quick questions
                </h3>
                <span className="text-xs font-semibold text-slate-500">FAQ</span>
              </div>
              <div className="mt-2 divide-y divide-slate-200">
                {helpFaqs.slice(0, 3).map(({ question, answer }) => (
                  <details key={question} className="py-1">
                    <summary className="flex min-h-12 cursor-pointer items-center text-sm font-bold text-slate-800">
                      {question}
                    </summary>
                    <p className="pb-3 text-sm leading-relaxed text-slate-600">{answer}</p>
                  </details>
                ))}
              </div>
              <p className="mt-2 text-center text-xs text-slate-500">
                More FAQs and Contact Us are available in Help after you sign in.
              </p>
            </section>

            <section className="mt-5 border-t border-slate-200 pt-4" aria-labelledby="login-social-title">
              <h3 id="login-social-title" className="text-center text-sm font-bold text-slate-700">
                Find us on social media
              </h3>
              <div className="mt-3 flex justify-center gap-3" aria-label="Social profile previews">
                <span className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm font-semibold text-slate-600">
                  <span aria-hidden className="inline-flex size-[18px] items-center justify-center rounded-full bg-blue-700 text-sm font-extrabold leading-none text-white">
                    f
                  </span>
                  Facebook
                </span>
                <span className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm font-semibold text-slate-600">
                  <Camera size={18} aria-hidden />
                  Instagram
                </span>
              </div>
              <p className="mt-2 text-center text-xs text-slate-500">
                Social links will be added when the official pages are confirmed.
              </p>
            </section>
            <p className="mt-4 border-t border-slate-200 pt-3 text-center text-sm text-slate-600 flex flex-wrap justify-center gap-x-6">
              <Link
                className="inline-flex min-h-12 items-center font-semibold text-brand-800 underline underline-offset-2"
                to="/clubs"
              >
                Find a court near you
              </Link>
              <Link
                className="inline-flex min-h-12 items-center font-semibold text-brand-800 underline underline-offset-2"
                to={privacyPath}
                state={privacyState}
              >
                Privacy Notice
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
