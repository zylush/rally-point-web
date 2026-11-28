import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { ClubImage } from '../components/ClubImage'
import { PrivacyAcknowledgement } from '../components/PrivacyAcknowledgement'
import { PublicFrame } from '../components/PublicFrame'
import { LoadingShapes, SkeletonBlock, SkeletonLine } from '../components/Skeleton'
import { api } from '../lib/api'
import { homeFor } from '../lib/roleHome'
import { PRIVACY_ACK_ERROR, PRIVACY_READ_FIRST_ERROR, usePrivacyGate } from '../lib/usePrivacyGate'

/** Players and members land on the club's own page; staff and admins on their desk there. */
function clubHome(role: Parameters<typeof homeFor>[0], slug: string) {
  return role === 'member' ? `/clubs/${encodeURIComponent(slug)}` : homeFor(role)
}
import type { PublicClub } from '../types'
import LoginPage from './LoginPage'

/** `missing`: no club takes bookings under this link. `error`: the check itself failed (offline, say). */
type Lookup =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error' }
  | { status: 'found'; club: PublicClub }

/**
 * A club's join link (#/join/<club-link>). New players sign up straight into
 * the club; players who are already signed in confirm joining it.
 */
export function JoinClubPage() {
  const { slug = '' } = useParams()
  const { user, loading, clubs, joinClub, switchClub } = useAuth()
  const nav = useNavigate()
  const [lookup, setLookup] = useState<Lookup>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
  const resetPrivacy = privacyGate.reset

  useEffect(() => {
    let cancelled = false
    setLookup({ status: 'loading' })
    resetPrivacy()
    setError(null)
    // The lookup answers null for a link no club uses; it throws only when it could not ask.
    api
      .publicClub(slug)
      .then((club) => {
        if (!cancelled) setLookup(club ? { status: 'found', club } : { status: 'missing' })
      })
      .catch(() => {
        if (!cancelled) setLookup({ status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [slug, attempt, resetPrivacy])

  if (loading || lookup.status === 'loading') return <JoinCardLoading />

  if (lookup.status === 'error') {
    return (
      <JoinCard title="We could not load this link">
        <p>Check your connection, then try again.</p>
        <button type="button" className="btn-primary" onClick={() => setAttempt((count) => count + 1)}>
          Try again
        </button>
      </JoinCard>
    )
  }

  if (lookup.status === 'missing') {
    return (
      <JoinCard title="This club link is not valid">
        <p>Ask the club for a new link, or log in to the club you already use.</p>
        <Link to="/login" className="btn-primary">
          Go to log in
        </Link>
        <Link to="/clubs" className="btn-secondary">
          Find a court
        </Link>
      </JoinCard>
    )
  }

  const club = lookup.club
  if (!user) return <LoginPage joinClub={club} />

  if (user.role === 'superadmin') {
    return (
      <JoinCard title={club.name} club={club}>
        <p>Platform accounts look after clubs from the platform portal and cannot join a club as a player.</p>
        <Link to="/superadmin" className="btn-primary">
          Back to the platform portal
        </Link>
      </JoinCard>
    )
  }

  const existing = clubs.find((item) => item.club_id === club.id)
  if (existing) {
    return (
      <JoinCard title={`You are already in ${club.name}`} club={club}>
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            switchClub(existing.club_id)
            nav(clubHome(existing.role, club.slug), { replace: true })
          }}
        >
          Go to {club.name}
        </button>
      </JoinCard>
    )
  }

  async function confirmJoin() {
    const privacyProblem = privacyGate.validate()
    if (privacyProblem) {
      setError(privacyProblem)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const joined = await joinClub(club.slug)
      nav(clubHome(joined.role, club.slug), { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join this club. Please try again.')
      setBusy(false)
    }
  }

  return (
    <JoinCard title={`Join ${club.name}?`} club={club}>
      <p>You will become a member of {club.name}. Your other clubs stay as they are.</p>
      <PrivacyAcknowledgement
        gate={privacyGate}
        clubSlug={club.slug}
        clubName={club.name}
      />
      {error ? (
        <p role="alert" className="notice notice-error font-semibold">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        className="btn-primary"
        onClick={() => void confirmJoin()}
        disabled={busy}
        aria-busy={busy}
      >
        {busy ? 'Joining…' : `Join ${club.name}`}
      </button>
      <Link to={homeFor(user.role)} className="btn-secondary">
        Not now
      </Link>
    </JoinCard>
  )
}

/** The page heading comes from the frame; the club's picture (or a labelled sample) sits above the card. */
function JoinCard({ title, club, children }: { title: string; club?: PublicClub; children: ReactNode }) {
  return (
    <PublicFrame title={title} accountLinks="login" width="narrow">
      <div className="enter-rise max-w-md space-y-4">
        {club ? (
          <ClubImage
            photos={[]}
            seed={club.slug}
            alt={`Photo of ${club.name}`}
            priority
            sizes="(min-width: 768px) 448px, 100vw"
            className="aspect-[16/7] w-full rounded-[12px]"
          />
        ) : null}
        <div className="card space-y-4 p-5 text-subtitle text-muted">{children}</div>
      </div>
    </PublicFrame>
  )
}

/** The join page's shape (heading, picture, a line of text, two buttons) while the club link is checked. */
function JoinCardLoading() {
  return (
    <PublicFrame title="Join a club" accountLinks="login" heading="none" width="narrow">
      <div className="max-w-md">
        <LoadingShapes label="Loading club…">
          <div className="space-y-4" aria-hidden>
            <SkeletonLine size="heading" className="w-3/4" />
            <SkeletonBlock className="aspect-[16/7] w-full rounded-[12px]!" />
            <div className="card space-y-4 p-5">
              <div>
                <SkeletonLine size="subtitle" />
                <SkeletonLine size="subtitle" className="w-2/3" />
              </div>
              <SkeletonBlock className="h-[54px] w-full rounded-[10px]!" />
              <SkeletonBlock className="h-[54px] w-full rounded-[10px]!" />
            </div>
          </div>
        </LoadingShapes>
      </div>
    </PublicFrame>
  )
}
