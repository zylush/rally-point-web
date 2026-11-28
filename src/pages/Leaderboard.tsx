import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ChevronLeft, Plus, ShieldCheck, Shuffle } from 'lucide-react'
import { BackButton } from '../components/BackButton'
import { LeaderboardView } from '../components/LeaderboardView'
import { PublicFrame } from '../components/PublicFrame'
import { RecordMatchModal } from '../components/RecordMatchModal'
import { AppHeader, AppShell, SignOutButton, Toast } from '../components/Shell'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { useClubLiveRefresh } from '../lib/livePulse'
import { DEFAULT_CLUB_SLUG } from '../lib/tenant'
import type {
  ClubLeaderboardSnapshot,
  ClubMatch,
  LeaderboardFormatFilter,
  LeaderboardPeriod,
  LeaderboardScorerStaff,
  PublicClub,
  RecordMatchInput,
} from '../types'

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  const message = (error as { message?: unknown } | null)?.message
  return typeof message === 'string' && message ? message : fallback
}

export function PublicClubLeaderboardPage() {
  const { slug = '' } = useParams()
  const [club, setClub] = useState<PublicClub | null | undefined>(undefined)
  const [period, setPeriod] = useState<LeaderboardPeriod>('month')
  const [format, setFormat] = useState<LeaderboardFormatFilter>('all')
  const [snapshot, setSnapshot] = useState<ClubLeaderboardSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const latestRequest = useRef(0)

  const load = useCallback(async (quiet = false) => {
    if (!slug) return
    const req = ++latestRequest.current
    if (!quiet) setLoading(true)
    setError(null)
    try {
      const foundClub = typeof api.publicClub === 'function' ? await api.publicClub(slug) : null
      if (req !== latestRequest.current) return
      setClub(foundClub)
      if (!foundClub) {
        setSnapshot(null)
        return
      }
      const next = await api.publicClubLeaderboard(slug, period, format, 50)
      if (req !== latestRequest.current) return
      setSnapshot(next)
    } catch (cause) {
      if (req === latestRequest.current) {
        setError(errorMessage(cause, 'Could not load club leaderboard.'))
      }
    } finally {
      if (req === latestRequest.current) setLoading(false)
    }
  }, [slug, period, format])

  useEffect(() => {
    void load(false)
  }, [load])

  useClubLiveRefresh([club?.id, slug], () => {
    void load(true)
  }, 15000)

  const back = (
    <Link to={`/clubs/${slug}`} className="text-link -ml-1 inline-flex min-h-12 items-center gap-1 text-subtitle">
      <ChevronLeft size={18} aria-hidden /> Back to club
    </Link>
  )

  if (club === null) {
    return (
      <PublicFrame title="Leaderboard not available" back={<Link to="/clubs" className="text-link -ml-1 inline-flex min-h-12 items-center gap-1 text-subtitle"><ChevronLeft size={18} aria-hidden /> All clubs</Link>}>
        <p className="text-subtitle text-muted">Check the link, or pick another club from the list.</p>
        <Link to="/clubs" className="btn-secondary sm:w-auto! sm:px-6">See all clubs</Link>
      </PublicFrame>
    )
  }

  return (
    <PublicFrame
      title={club ? `${club.name} leaderboard` : 'Club leaderboard'}
      subtitle="Points, win-loss records and recent club matches"
      back={back}
    >
      <div className="mb-4">
        <Link to={`/clubs/${slug}/tournaments`} className="btn-secondary sm:w-auto! sm:px-6">
          <Shuffle size={18} aria-hidden />
          Tournaments & live brackets
        </Link>
      </div>
      <LeaderboardView
        snapshot={snapshot}
        loading={loading}
        error={error}
        period={period}
        onPeriodChange={setPeriod}
        format={format}
        onFormatChange={setFormat}
        onRetry={() => void load(false)}
        onLoadPlayerMatches={(memberId) =>
          api.publicPlayerMatches(slug, memberId, 15).then((rows) => rows ?? [])
        }
      />
    </PublicFrame>
  )
}

function ClubLeaderboardScreen({ role }: { role: 'member' | 'staff' | 'admin' }) {
  const { activeClub } = useAuth()
  const [period, setPeriod] = useState<LeaderboardPeriod>('month')
  const [format, setFormat] = useState<LeaderboardFormatFilter>('all')
  const [snapshot, setSnapshot] = useState<ClubLeaderboardSnapshot | null>(null)
  const [scorers, setScorers] = useState<LeaderboardScorerStaff[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [scorerBusyId, setScorerBusyId] = useState<string | null>(null)
  const [scorerError, setScorerError] = useState<string | null>(null)
  const [recordOpen, setRecordOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const latestRequest = useRef(0)

  const showToast = useCallback((message: string) => {
    setToast(message)
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 3200)
    return () => window.clearTimeout(timer)
  }, [toast])

  const load = useCallback(async (quiet = false) => {
    const req = ++latestRequest.current
    if (!quiet) setLoading(true)
    setError(null)
    try {
      const [board, staffList] = await Promise.all([
        api.clubLeaderboard(period, format, 100),
        role === 'admin' && typeof api.listLeaderboardScorers === 'function'
          ? api.listLeaderboardScorers()
          : Promise.resolve([] as LeaderboardScorerStaff[]),
      ])
      if (req !== latestRequest.current) return
      setSnapshot(board)
      if (role === 'admin') setScorers(staffList)
    } catch (cause) {
      if (req === latestRequest.current) {
        setError(errorMessage(cause, 'Could not load club leaderboard.'))
      }
    } finally {
      if (req === latestRequest.current) setLoading(false)
    }
  }, [period, format, role])

  useEffect(() => {
    void load(false)
  }, [load])

  useClubLiveRefresh([activeClub?.club_id, activeClub?.slug], () => {
    void load(true)
  }, 12000)

  const clubSlug = activeClub?.slug ?? snapshot?.club?.slug ?? DEFAULT_CLUB_SLUG
  const canScore = Boolean(snapshot?.can_score) && (role === 'staff' || role === 'admin')

  async function handleRecordMatch(input: RecordMatchInput): Promise<ClubMatch> {
    const created = await api.recordClubMatch(input, clubSlug)
    showToast('Match result saved. Rankings updated.')
    await load(true)
    return created
  }

  async function handleVoidMatch(matchId: string, reason: string) {
    await api.voidClubMatch(matchId, reason, clubSlug)
    showToast('Match voided. Rankings updated.')
    await load(true)
  }

  async function toggleScorer(staff: LeaderboardScorerStaff) {
    if (scorerBusyId) return
    setScorerBusyId(staff.user_id)
    setScorerError(null)
    try {
      await api.setLeaderboardScorer(staff.user_id, !staff.can_score)
      showToast(!staff.can_score ? `${staff.full_name} can now score matches.` : `Removed scoring access for ${staff.full_name}.`)
      await load(true)
    } catch (cause) {
      setScorerError(errorMessage(cause, 'Could not update scorer access.'))
    } finally {
      setScorerBusyId(null)
    }
  }

  async function loadPlayerMatches(memberId: string): Promise<ClubMatch[]> {
    if (typeof api.publicPlayerMatches === 'function' && clubSlug) {
      try {
        const rows = await api.publicPlayerMatches(clubSlug, memberId, 15)
        if (rows) return rows
      } catch {
        // Fall back to filtering loaded matches below.
      }
    }
    return (snapshot?.recent_matches ?? []).filter(
      (match) =>
        match.status === 'completed'
        && (match.team_a.some((p) => p.member_id === memberId)
          || match.team_b.some((p) => p.member_id === memberId)),
    )
  }

  return (
    <AppShell role={role}>
      <AppHeader
        title="Leaderboard"
        subtitle={activeClub?.name ?? snapshot?.club?.name ?? 'Club standings'}
        left={<BackButton />}
        right={<SignOutButton />}
      />
      <main className="safe-bottom px-4 pt-4 space-y-4">
        <div className="flex flex-wrap gap-2">
          {canScore ? (
            <button
              type="button"
              className="btn-primary min-h-14 flex-1"
              onClick={() => setRecordOpen(true)}
            >
              <Plus size={18} aria-hidden />
              Record match
            </button>
          ) : null}
          <Link to={`/${role}/tournaments`} className="btn-secondary min-h-12 flex-1">
            <Shuffle size={18} aria-hidden />
            Tournaments
          </Link>
        </div>
        {role === 'staff' && snapshot && !snapshot.can_score ? (
          <section className="notice text-body text-slate-700" role="note">
            View only. Ask a club admin to add you as a scorer to record match results.
          </section>
        ) : null}

        <LeaderboardView
          snapshot={snapshot}
          loading={loading}
          error={error}
          period={period}
          onPeriodChange={setPeriod}
          format={format}
          onFormatChange={setFormat}
          showMyStanding={role === 'member'}
          canScore={canScore}
          onVoidMatch={canScore ? handleVoidMatch : undefined}
          onLoadPlayerMatches={loadPlayerMatches}
          onRetry={() => void load(false)}
        />

        {role === 'admin' ? (
          <section className="card p-4 space-y-3" aria-labelledby="designated-scorers-heading">
            <div className="flex items-start gap-2.5">
              <ShieldCheck size={20} className="shrink-0 text-brand-700 mt-0.5" aria-hidden />
              <div>
                <h2 id="designated-scorers-heading" className="text-subtitle font-semibold text-ink">
                  Designated scorers
                </h2>
                <p className="text-body text-slate-600">
                  Club admins can always record matches. Choose which staff members can also score matches courtside.
                </p>
              </div>
            </div>
            {scorerError ? (
              <p role="alert" className="text-body font-semibold text-red-700">{scorerError}</p>
            ) : null}
            {scorers.length === 0 ? (
              <p className="text-body text-slate-600">No active staff accounts in this club yet.</p>
            ) : (
              <div className="divide-y divide-line">
                {scorers.map((staff) => {
                  const busy = scorerBusyId === staff.user_id
                  return (
                    <div key={staff.user_id} className="list-row">
                      <div className="flex-1 min-w-0">
                        <p className="text-subtitle font-semibold truncate text-ink">{staff.full_name}</p>
                        <p className="text-caption text-slate-500 truncate">{staff.email}</p>
                      </div>
                      <button
                        type="button"
                        disabled={Boolean(scorerBusyId)}
                        aria-busy={busy}
                        onClick={() => void toggleScorer(staff)}
                        className={`control-feedback min-h-12 shrink-0 rounded-xl border px-3 text-body font-semibold ${
                          staff.can_score
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                            : 'border-slate-300 bg-white text-ink'
                        }`}
                      >
                        {busy
                          ? 'Saving…'
                          : staff.can_score
                            ? 'Can score — remove'
                            : 'Allow scoring'}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        ) : null}
      </main>

      <RecordMatchModal
        open={recordOpen}
        onClose={() => setRecordOpen(false)}
        onRecord={handleRecordMatch}
      />
      <Toast message={toast} />
    </AppShell>
  )
}

export function MemberLeaderboardPage() {
  return <ClubLeaderboardScreen role="member" />
}

export function StaffLeaderboardPage() {
  return <ClubLeaderboardScreen role="staff" />
}

export function AdminLeaderboardPage() {
  return <ClubLeaderboardScreen role="admin" />
}
