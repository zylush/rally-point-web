import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { LoadingShapes, SkeletonBlock, SkeletonLine } from '../components/Skeleton'
import { api } from '../lib/api'
import { homeFor } from '../lib/roleHome'
import type { PublicClub } from '../types'
import LoginPage from './LoginPage'

type Lookup = { status: 'loading' } | { status: 'missing' } | { status: 'found'; club: PublicClub }

/**
 * A club's join link (#/join/<club-link>). New players sign up straight into
 * the club; players who are already signed in confirm joining it.
 */
export function JoinClubPage() {
  const { slug = '' } = useParams()
  const { user, loading, clubs, joinClub, switchClub } = useAuth()
  const nav = useNavigate()
  const [lookup, setLookup] = useState<Lookup>({ status: 'loading' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLookup({ status: 'loading' })
    api
      .publicClub(slug)
      .then((club) => {
        if (!cancelled) setLookup(club ? { status: 'found', club } : { status: 'missing' })
      })
      .catch(() => {
        if (!cancelled) setLookup({ status: 'missing' })
      })
    return () => {
      cancelled = true
    }
  }, [slug])

  if (loading || lookup.status === 'loading') return <JoinCardLoading />

  if (lookup.status === 'missing') {
    return (
      <JoinCard title="This club link is not valid">
        <p>Ask the club for a new link, or log in to the club you already use.</p>
        <Link to="/login" className="btn-primary w-full justify-center">
          Go to log in
        </Link>
      </JoinCard>
    )
  }

  const club = lookup.club
  if (!user) return <LoginPage joinClub={club} />

  if (user.role === 'superadmin') {
    return (
      <JoinCard title={club.name}>
        <p>Platform accounts look after clubs from the platform portal and cannot join as members.</p>
        <Link to="/superadmin" className="btn-primary w-full justify-center">
          Back to the platform portal
        </Link>
      </JoinCard>
    )
  }

  const existing = clubs.find((item) => item.club_id === club.id)
  if (existing) {
    return (
      <JoinCard title={`You are already in ${club.name}`}>
        <button
          type="button"
          className="btn-primary w-full justify-center"
          onClick={() => {
            switchClub(existing.club_id)
            nav(homeFor(existing.role), { replace: true })
          }}
        >
          Go to {club.name}
        </button>
      </JoinCard>
    )
  }

  async function confirmJoin() {
    setBusy(true)
    setError(null)
    try {
      const joined = await joinClub(club.slug)
      nav(homeFor(joined.role), { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join this club. Please try again.')
      setBusy(false)
    }
  }

  return (
    <JoinCard title={`Join ${club.name}?`}>
      <p>You will become a member of {club.name}. Your other clubs stay as they are.</p>
      {error ? (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-base font-semibold text-red-800">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        className="btn-primary w-full justify-center"
        onClick={() => void confirmJoin()}
        disabled={busy}
        aria-busy={busy}
      >
        {busy ? 'Joining…' : `Join ${club.name}`}
      </button>
      <Link to={homeFor(user.role)} className="btn-secondary w-full justify-center">
        Not now
      </Link>
    </JoinCard>
  )
}

function JoinCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="app-shell flex min-h-screen items-center justify-center px-4">
      <main className="card enter-rise w-full max-w-md space-y-4 p-6 text-base text-slate-700">
        <h1 className="text-2xl font-extrabold text-slate-900">{title}</h1>
        {children}
      </main>
    </div>
  )
}

/** The join card's shape (title, a line of text, two buttons) while the club link is checked. */
function JoinCardLoading() {
  return (
    <div className="app-shell flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md">
        <LoadingShapes label="Loading club…">
          <div className="card space-y-4 p-6" aria-hidden>
            <SkeletonLine size="heading" className="w-3/4" />
            <div>
              <SkeletonLine size="subtitle" />
              <SkeletonLine size="subtitle" className="w-2/3" />
            </div>
            <SkeletonBlock className="h-[54px] w-full rounded-[16px]!" />
            <SkeletonBlock className="h-[54px] w-full rounded-[16px]!" />
          </div>
        </LoadingShapes>
      </div>
    </div>
  )
}
