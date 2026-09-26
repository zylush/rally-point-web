import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { ArrowRight, Eye, EyeOff, Shield, UserPlus, UserRound } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import type { Role } from '../types'
import { RallyPointLogo } from '../components/RallyPointLogo'

const demos: { role: Role; email: string; password: string; label: string }[] = [
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

function homeFor(role: Role) {
  if (role === 'admin') return '/admin'
  if (role === 'staff') return '/staff'
  return '/member'
}

type Mode = 'login' | 'join' | 'reset'

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
    /^Please enter your name$/i.test(message)
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

export default function LoginPage() {
  const { user, loading, signIn, signUpMember, resetPassword, demo } = useAuth()
  const nav = useNavigate()
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [resetSuccess, setResetSuccess] = useState(false)
  const [busy, setBusy] = useState(false)

  if (!loading && user) return <Navigate to={homeFor(user.role)} replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setResetSuccess(false)
    try {
      if (mode === 'join') {
        const profile = await signUpMember({
          email,
          password,
          full_name: fullName,
          phone: phone || undefined,
        })
        nav(homeFor(profile.role), { replace: true })
      } else if (mode === 'reset') {
        await resetPassword(email)
        setResetSuccess(true)
      } else {
        const profile = await signIn(email, password)
        nav(homeFor(profile.role), { replace: true })
      }
    } catch (err) {
      setError(authenticationErrorMessage(mode, err))
    } finally {
      setBusy(false)
    }
  }

  function switchMode(next: Mode) {
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
            <RallyPointLogo
              variant="color"
              className="h-28 sm:h-36 w-auto max-w-[min(100%,320px)] object-contain drop-shadow-[0_12px_40px_rgba(0,0,0,0.55)]"
              title="Rally Point Gensan"
            />
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
          <div className="w-full max-w-md rounded-3xl border border-white/25 bg-white/95 backdrop-blur-xl p-5 sm:p-7 text-slate-900 shadow-2xl shadow-black/50">
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

            <div className="mb-4">
              <p className="text-sm font-bold text-slate-500">
                {mode === 'join'
                  ? 'New player'
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

            {demo ? (
              <div className="mt-6 pt-5 border-t border-slate-100">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">
                  Quick demo logins
                </p>
                <div className="grid grid-cols-3 gap-2">
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
                        {d.role === 'admin' ? <Shield size={16} /> : <UserRound size={16} />}
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
          </div>
        </div>
      </div>
    </div>
  )
}
