import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  Check,
  ChevronLeft,
  Maximize2,
  Play,
  Plus,
  Search,
  ShieldCheck,
  Shuffle,
  Trophy,
  UserPlus,
} from 'lucide-react'
import { BackButton } from '../components/BackButton'
import { CreateTournamentModal } from '../components/CreateTournamentModal'
import { PublicFrame } from '../components/PublicFrame'
import { AppHeader, AppShell, SignOutButton, Toast } from '../components/Shell'
import { SkeletonCard, SkeletonLine } from '../components/Skeleton'
import {
  ScoreTournamentMatchModal,
  TournamentListCard,
  TournamentLiveView,
} from '../components/TournamentView'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { useClubLiveRefresh } from '../lib/livePulse'
import { DEFAULT_CLUB_SLUG } from '../lib/tenant'
import type {
  Court,
  CreateTournamentInput,
  Member,
  PublicClub,
  PublicTournamentFilter,
  PublicTournamentSummary,
  ScoreTournamentMatchInput,
  TournamentDetail,
  TournamentMatch,
  TournamentScorerStaff,
  TournamentSummary,
} from '../types'

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  const message = (error as { message?: unknown } | null)?.message
  return typeof message === 'string' && message ? message : fallback
}

function TournamentsListLoading() {
  return (
    <div className="space-y-3" aria-label="Loading tournaments…">
      {[0, 1].map((key) => (
        <SkeletonCard key={key} className="space-y-2">
          <SkeletonLine size="subtitle" className="w-2/3" />
          <SkeletonLine className="w-1/2" />
        </SkeletonCard>
      ))}
    </div>
  )
}

const PUBLIC_FILTERS: { value: PublicTournamentFilter, label: string }[] = [
  { value: null, label: 'All' },
  { value: 'live', label: 'Live now' },
  { value: 'setup', label: 'Coming up' },
  { value: 'completed', label: 'Finished' },
]

const PUBLIC_SECTIONS: { status: TournamentSummary['status'], heading: string }[] = [
  { status: 'live', heading: 'Live now' },
  { status: 'setup', heading: 'Coming up' },
  { status: 'completed', heading: 'Finished' },
]

/** Tournaments from every club, each card naming the club it is played at. Open to visitors. */
export function PublicTournamentsPage() {
  const [filter, setFilter] = useState<PublicTournamentFilter>(null)
  const [tournaments, setTournaments] = useState<PublicTournamentSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const latestRequest = useRef(0)

  const load = useCallback(async (quiet = false) => {
    const req = ++latestRequest.current
    if (!quiet) setLoading(true)
    setError(null)
    try {
      const rows = typeof api.listPublicTournaments === 'function'
        ? await api.listPublicTournaments(filter, 60)
        : []
      if (req !== latestRequest.current) return
      setTournaments(rows ?? [])
    } catch (cause) {
      if (req === latestRequest.current) setError(errorMessage(cause, 'Could not load tournaments.'))
    } finally {
      if (req === latestRequest.current) setLoading(false)
    }
  }, [filter])

  useEffect(() => {
    void load(false)
  }, [load])

  const clubSlugs = useMemo(() => [...new Set(tournaments.map((t) => t.club.slug))].sort(), [tournaments])
  useClubLiveRefresh(['public-tournaments', ...clubSlugs], () => {
    void load(true)
  }, 30000)

  const sections = PUBLIC_SECTIONS
    .map((section) => ({ ...section, rows: tournaments.filter((t) => t.status === section.status) }))
    .filter((section) => section.rows.length > 0)
  const emptyText = filter === 'live'
    ? 'No tournament is being played right now.'
    : filter === 'setup'
      ? 'No tournament is coming up yet.'
      : filter === 'completed'
        ? 'No tournament has finished yet.'
        : 'No club has listed a tournament yet.'

  return (
    <PublicFrame title="Tournaments" subtitle="Brackets and queue mixers at every club">
      <div className="space-y-4">
        <div role="group" aria-label="Show tournaments" className="segmented">
          {PUBLIC_FILTERS.map((option) => (
            <button
              key={option.label}
              type="button"
              aria-pressed={filter === option.value}
              onClick={() => setFilter(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>

        {loading && tournaments.length === 0 ? (
          <TournamentsListLoading />
        ) : error ? (
          <section role="alert" className="notice notice-error space-y-3">
            <p className="text-subtitle font-semibold">{error}</p>
            <button type="button" onClick={() => void load(false)} className="btn-secondary sm:w-auto! sm:px-5">
              Try again
            </button>
          </section>
        ) : sections.length === 0 ? (
          <section className="card p-6 text-center space-y-3">
            <p className="text-subtitle font-semibold text-ink">{emptyText}</p>
            <p className="text-body text-muted">Clubs add their tournaments here. You can also look up a club and its courts.</p>
            <Link to="/clubs" className="btn-secondary sm:w-auto! sm:px-6">See all clubs</Link>
          </section>
        ) : (
          sections.map((section) => (
            <section key={section.status} aria-labelledby={`tournaments-${section.status}`} className="space-y-3">
              <h2 id={`tournaments-${section.status}`} className="text-heading-3 font-semibold text-ink">
                {section.heading}
              </h2>
              {section.rows.map((t) => (
                <TournamentListCard
                  key={t.id}
                  tournament={t}
                  club={t.club}
                  to={`/clubs/${t.club.slug}/tournaments/${t.id}`}
                />
              ))}
            </section>
          ))
        )}
      </div>
    </PublicFrame>
  )
}

export function PublicClubTournamentsPage() {
  const { slug = '' } = useParams()
  const [club, setClub] = useState<PublicClub | null | undefined>(undefined)
  const [tournaments, setTournaments] = useState<TournamentSummary[]>([])
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
        setTournaments([])
        return
      }
      const rows = typeof api.listPublicClubTournaments === 'function'
        ? await api.listPublicClubTournaments(slug, 20)
        : []
      if (req !== latestRequest.current) return
      setTournaments(rows ?? [])
    } catch (cause) {
      if (req === latestRequest.current) {
        setError(errorMessage(cause, 'Could not load club tournaments.'))
      }
    } finally {
      if (req === latestRequest.current) setLoading(false)
    }
  }, [slug])

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
      <PublicFrame
        title="Tournaments not available"
        back={<Link to="/clubs" className="text-link -ml-1 inline-flex min-h-12 items-center gap-1 text-subtitle"><ChevronLeft size={18} aria-hidden /> All clubs</Link>}
      >
        <p className="text-subtitle text-muted">Check the link, or pick another club from the list.</p>
        <Link to="/clubs" className="btn-secondary sm:w-auto! sm:px-6">See all clubs</Link>
      </PublicFrame>
    )
  }

  return (
    <PublicFrame
      title={club ? `${club.name} tournaments` : 'Club tournaments'}
      subtitle="Live knockout brackets and random queue mixers"
      back={back}
    >
      <div className="space-y-4">
        <Link
          to={`/clubs/${slug}/leaderboard`}
          className="btn-secondary sm:w-auto! sm:px-6"
        >
          <Trophy size={18} aria-hidden />
          Club leaderboard
        </Link>

        {loading && tournaments.length === 0 ? (
          <TournamentsListLoading />
        ) : error ? (
          <section role="alert" className="notice notice-error space-y-3">
            <p className="text-subtitle font-semibold">{error}</p>
            <button type="button" onClick={() => void load(false)} className="btn-secondary sm:w-auto! sm:px-5">
              Try again
            </button>
          </section>
        ) : tournaments.length === 0 ? (
          <section className="card p-6 text-center space-y-2">
            <p className="text-subtitle font-semibold text-ink">No tournaments listed yet</p>
            <p className="text-body text-muted">
              Upcoming brackets and queue mixers appear here once created by the club.
            </p>
          </section>
        ) : (
          <div className="space-y-3">
            {tournaments.map((t) => (
              <TournamentListCard
                key={t.id}
                tournament={t}
                to={`/clubs/${slug}/tournaments/${t.id}`}
              />
            ))}
          </div>
        )}
      </div>
    </PublicFrame>
  )
}

export function PublicTournamentDetailPage() {
  const { slug = '', tournamentId = '' } = useParams()
  const [club, setClub] = useState<PublicClub | null | undefined>(undefined)
  const [detail, setDetail] = useState<TournamentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const latestRequest = useRef(0)

  const load = useCallback(async (quiet = false) => {
    if (!slug || !tournamentId) return
    const req = ++latestRequest.current
    if (!quiet) setLoading(true)
    setError(null)
    try {
      const foundClub = typeof api.publicClub === 'function' ? await api.publicClub(slug) : null
      if (req !== latestRequest.current) return
      setClub(foundClub)
      if (!foundClub) {
        setDetail(null)
        return
      }
      const next = typeof api.publicTournament === 'function'
        ? await api.publicTournament(slug, tournamentId)
        : null
      if (req !== latestRequest.current) return
      setDetail(next)
    } catch (cause) {
      if (req === latestRequest.current) {
        setError(errorMessage(cause, 'Could not load tournament.'))
      }
    } finally {
      if (req === latestRequest.current) setLoading(false)
    }
  }, [slug, tournamentId])

  useEffect(() => {
    void load(false)
  }, [load])

  useClubLiveRefresh([club?.id, slug], () => {
    void load(true)
  }, 12000)

  const back = (
    <Link to={`/clubs/${slug}/tournaments`} className="text-link -ml-1 inline-flex min-h-12 items-center gap-1 text-subtitle">
      <ChevronLeft size={18} aria-hidden /> All tournaments
    </Link>
  )

  return (
    <PublicFrame
      title={detail?.tournament.title ?? (club ? `${club.name} tournament` : 'Tournament')}
      subtitle={club ? `${club.name} · Live updates` : undefined}
      back={back}
    >
      <TournamentLiveView
        detail={detail}
        loading={loading}
        error={error}
        onRetry={() => void load(false)}
      />
    </PublicFrame>
  )
}

function ClubTournamentsListScreen({ role }: { role: 'member' | 'staff' | 'admin' }) {
  const { activeClub } = useAuth()
  const nav = useNavigate()
  const [tournaments, setTournaments] = useState<TournamentSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const latestRequest = useRef(0)

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
      const rows = typeof api.listClubTournaments === 'function' ? await api.listClubTournaments(50) : []
      if (req !== latestRequest.current) return
      setTournaments(rows)
    } catch (cause) {
      if (req === latestRequest.current) {
        setError(errorMessage(cause, 'Could not load club tournaments.'))
      }
    } finally {
      if (req === latestRequest.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(false)
  }, [load])

  useClubLiveRefresh([activeClub?.club_id, activeClub?.slug], () => {
    void load(true)
  }, 15000)

  const clubSlug = activeClub?.slug ?? DEFAULT_CLUB_SLUG

  async function handleCreate(input: CreateTournamentInput) {
    const created = await api.createTournament(input, clubSlug)
    setToast('Tournament created.')
    nav(`/admin/tournaments/${created.tournament.id}`)
  }

  return (
    <AppShell role={role}>
      <AppHeader
        title="Tournaments"
        subtitle={activeClub?.name ?? 'Club tournaments'}
        left={<BackButton />}
        right={<SignOutButton />}
      />
      <main className="safe-bottom px-4 pt-4 space-y-4">
        <div className="flex flex-wrap gap-2">
          {role === 'admin' ? (
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="btn-primary min-h-14 flex-1"
            >
              <Plus size={18} aria-hidden />
              New tournament
            </button>
          ) : null}
          <Link
            to={`/${role}/leaderboard`}
            className="btn-secondary min-h-12"
          >
            <Trophy size={18} aria-hidden />
            Leaderboard
          </Link>
        </div>

        {loading && tournaments.length === 0 ? (
          <TournamentsListLoading />
        ) : error ? (
          <section role="alert" className="notice notice-error space-y-3">
            <p className="text-subtitle font-semibold">{error}</p>
            <button type="button" onClick={() => void load(false)} className="btn-secondary sm:w-auto! sm:px-5">
              Try again
            </button>
          </section>
        ) : tournaments.length === 0 ? (
          <section className="card p-6 text-center space-y-2">
            <p className="text-subtitle font-semibold text-ink">No tournaments yet</p>
            <p className="text-body text-slate-600">
              {role === 'admin'
                ? 'Tap New tournament above to set up a bracket or random queue mixer.'
                : 'Brackets and queue mixers created by your club appear here.'}
            </p>
          </section>
        ) : (
          <div className="space-y-3">
            {tournaments.map((t) => (
              <TournamentListCard
                key={t.id}
                tournament={t}
                to={`/${role}/tournaments/${t.id}`}
              />
            ))}
          </div>
        )}
      </main>

      {role === 'admin' ? (
        <CreateTournamentModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreate={handleCreate}
        />
      ) : null}
      <Toast message={toast} />
    </AppShell>
  )
}

function ClubTournamentDetailScreen({ role }: { role: 'member' | 'staff' | 'admin' }) {
  const { tournamentId = '' } = useParams()
  const { activeClub } = useAuth()
  const [detail, setDetail] = useState<TournamentDetail | null>(null)
  const [courts, setCourts] = useState<Court[]>([])
  const [roster, setRoster] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionBusy, setActionBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const [editingRoster, setEditingRoster] = useState(false)
  const [rosterSearch, setRosterSearch] = useState('')
  const [editedPlayerIds, setEditedPlayerIds] = useState<string[]>([])
  const [latePlayerId, setLatePlayerId] = useState('')
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [scoringMatch, setScoringMatch] = useState<TournamentMatch | null>(null)
  const latestRequest = useRef(0)

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 3200)
    return () => window.clearTimeout(timer)
  }, [toast])

  const load = useCallback(async (quiet = false) => {
    if (!tournamentId) return
    const req = ++latestRequest.current
    if (!quiet) setLoading(true)
    setError(null)
    try {
      const [nextDetail, courtList, memberList] = await Promise.all([
        api.clubTournament(tournamentId),
        (role === 'staff' || role === 'admin') && typeof api.listCourts === 'function'
          ? api.listCourts()
          : Promise.resolve([] as Court[]),
        role === 'admin' && typeof api.memberRoster === 'function'
          ? api.memberRoster()
          : Promise.resolve([] as Member[]),
      ])
      if (req !== latestRequest.current) return
      setDetail(nextDetail)
      setCourts(courtList)
      setRoster(memberList)
    } catch (cause) {
      if (req === latestRequest.current) {
        setError(errorMessage(cause, 'Could not load tournament.'))
      }
    } finally {
      if (req === latestRequest.current) setLoading(false)
    }
  }, [tournamentId, role])

  useEffect(() => {
    void load(false)
  }, [load])

  useClubLiveRefresh([activeClub?.club_id, activeClub?.slug], () => {
    void load(true)
  }, 12000)

  const clubSlug = activeClub?.slug ?? detail?.club?.slug ?? DEFAULT_CLUB_SLUG

  const scopedCourts = useMemo(() => {
    const venueId = detail?.tournament.venue_id
    if (!venueId) return courts
    const matching = courts.filter((c) => !c.venue_id || c.venue_id === venueId)
    return matching.length > 0 ? matching : courts
  }, [courts, detail?.tournament.venue_id])

  const filteredRoster = useMemo(() => {
    const q = rosterSearch.trim().toLowerCase()
    if (!q) return roster
    return roster.filter(
      (m) => m.full_name.toLowerCase().includes(q) || m.member_code.toLowerCase().includes(q),
    )
  }, [roster, rosterSearch])

  const availableLatePlayers = useMemo(() => {
    const current = new Set((detail?.players ?? []).map((p) => p.member_id))
    return roster.filter((m) => !current.has(m.id))
  }, [roster, detail?.players])

  async function runAdminAction(key: string, fn: () => Promise<TournamentDetail>, successToast: string) {
    if (actionBusy) return
    setActionBusy(key)
    setActionError(null)
    try {
      const updated = await fn()
      setDetail(updated)
      setToast(successToast)
    } catch (cause) {
      setActionError(errorMessage(cause, 'Action could not be completed.'))
    } finally {
      setActionBusy(null)
    }
  }

  function startEditingRoster() {
    setEditedPlayerIds((detail?.players ?? []).map((p) => p.member_id))
    setRosterSearch('')
    setActionError(null)
    setEditingRoster(true)
  }

  async function saveRoster() {
    if (actionBusy || !detail) return
    await runAdminAction(
      'roster',
      () => api.setTournamentPlayers(detail.tournament.id, editedPlayerIds, clubSlug),
      'Player roster updated.',
    )
    setEditingRoster(false)
  }

  async function addLatePlayer() {
    if (!detail || !latePlayerId || actionBusy) return
    const nextIds = [...detail.players.map((p) => p.member_id), latePlayerId]
    await runAdminAction(
      'late-player',
      () => api.setTournamentPlayers(detail.tournament.id, nextIds, clubSlug),
      'Player added to queue.',
    )
    setLatePlayerId('')
  }

  async function toggleTournamentScorer(staff: TournamentScorerStaff) {
    if (!detail || staff.is_club_scorer || actionBusy) return
    setActionBusy(`scorer-${staff.user_id}`)
    setActionError(null)
    try {
      await api.setTournamentScorer(detail.tournament.id, staff.user_id, !staff.can_score, clubSlug)
      setToast(!staff.can_score ? `${staff.full_name} can score this tournament.` : `Removed tournament scoring for ${staff.full_name}.`)
      await load(true)
    } catch (cause) {
      setActionError(errorMessage(cause, 'Could not update scorer access.'))
    } finally {
      setActionBusy(null)
    }
  }

  async function handleDrawQueue(courtId: string | null) {
    if (!detail) return
    const updated = await api.drawTournamentQueueMatch(detail.tournament.id, courtId, clubSlug)
    setDetail(updated)
    setToast('Next random match ready.')
  }

  async function handleAssignCourt(matchId: string, courtId: string | null) {
    if (!detail) return
    const updated = await api.assignTournamentMatchCourt(detail.tournament.id, matchId, courtId, clubSlug)
    setDetail(updated)
    setToast('Court updated.')
  }

  async function handleCancelQueueMatch(matchId: string) {
    if (!detail) return
    const updated = await api.cancelTournamentQueueMatch(detail.tournament.id, matchId, clubSlug)
    setDetail(updated)
    setToast('Queue match cancelled.')
  }

  async function handleUndoResult(matchId: string) {
    if (!detail) return
    const updated = await api.undoTournamentMatch(detail.tournament.id, matchId, undefined, clubSlug)
    setDetail(updated)
    setToast('Result undone. The match can be scored again.')
  }

  async function handleScoreMatch(input: ScoreTournamentMatchInput) {
    const updated = await api.scoreTournamentMatch(input, clubSlug)
    setDetail(updated)
    setToast('Match score saved!')
  }

  const tournament = detail?.tournament
  const canManage = role === 'admin' && Boolean(detail?.can_manage ?? true)
  const rosterHint = tournament && tournament.status === 'setup'
    ? tournament.format === 'single_elimination' && tournament.team_size === 2
      ? (detail.players.length < 4 || detail.players.length % 2 !== 0
          ? 'Doubles brackets need an even number of players (at least 4).'
          : `${detail.players.length / 2} randomized teams will enter the bracket.`)
      : tournament.format === 'single_elimination' && tournament.team_size === 1
        ? (detail.players.length < 2
            ? 'Singles brackets need at least 2 players.'
            : `${detail.players.length} players ready for randomized seeding.`)
        : detail.players.length < tournament.team_size * 2
          ? `Add at least ${tournament.team_size * 2} players before starting the queue.`
          : `${detail.players.length} players ready to rotate.`
    : null

  return (
    <AppShell role={role}>
      <AppHeader
        title={tournament?.title ?? 'Tournament'}
        subtitle={activeClub?.name ?? detail?.club?.name ?? 'Tournament'}
        left={<BackButton />}
        right={<SignOutButton />}
      />
      <main className="safe-bottom px-4 pt-4 space-y-4">
        {canManage && tournament && tournament.status === 'setup' ? (
          <section className="card p-4 space-y-3" aria-label="Tournament setup controls">
            <div className="space-y-1">
              <p className="text-subtitle font-bold text-ink">Setup controls</p>
              {rosterHint ? <p className="text-body text-slate-600">{rosterHint}</p> : null}
            </div>

            {actionError ? (
              <p role="alert" className="text-body font-semibold text-red-700">{actionError}</p>
            ) : null}

            {editingRoster ? (
              <div className="space-y-3 rounded-2xl border border-line p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-body font-semibold text-ink">Select players ({editedPlayerIds.length})</p>
                  <button
                    type="button"
                    onClick={() => setEditingRoster(false)}
                    className="min-h-12 px-3 text-body font-semibold text-slate-600"
                  >
                    Close
                  </button>
                </div>
                <div className="relative">
                  <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
                  <input
                    type="search"
                    aria-label="Filter club players"
                    placeholder="Search players…"
                    className="input pl-10 min-h-12"
                    value={rosterSearch}
                    onChange={(e) => setRosterSearch(e.target.value)}
                  />
                </div>
                <div className="max-h-48 overflow-y-auto divide-y divide-line rounded-xl border border-line">
                  {filteredRoster.map((m) => {
                    const checked = editedPlayerIds.includes(m.id)
                    return (
                      <label key={m.id} className="flex items-center gap-3 px-3 py-2 min-h-12 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setEditedPlayerIds((prev) =>
                              prev.includes(m.id) ? prev.filter((id) => id !== m.id) : [...prev, m.id],
                            )
                          }
                          className="h-5 w-5 rounded border-field accent-brand-700"
                        />
                        <span className="text-body font-semibold text-ink truncate">{m.full_name}</span>
                      </label>
                    )
                  })}
                </div>
                <button
                  type="button"
                  disabled={Boolean(actionBusy)}
                  aria-busy={actionBusy === 'roster'}
                  onClick={() => void saveRoster()}
                  className="btn-primary min-h-12"
                >
                  <Check size={18} aria-hidden />
                  Save roster
                </button>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              {!editingRoster ? (
                <button
                  type="button"
                  disabled={Boolean(actionBusy)}
                  onClick={startEditingRoster}
                  className="btn-secondary min-h-12 flex-1"
                >
                  <UserPlus size={18} aria-hidden />
                  Edit players
                </button>
              ) : null}
              {tournament.format === 'single_elimination' ? (
                <button
                  type="button"
                  disabled={Boolean(actionBusy)}
                  aria-busy={actionBusy === 'draw'}
                  onClick={() =>
                    void runAdminAction(
                      'draw',
                      () => api.generateTournamentDraw(tournament.id, clubSlug),
                      'Randomized teams and bracket ready.',
                    )
                  }
                  className="btn-secondary min-h-12 flex-1"
                >
                  <Shuffle size={18} aria-hidden />
                  Randomize teams & bracket
                </button>
              ) : null}
            </div>

            <button
              type="button"
              disabled={Boolean(actionBusy)}
              aria-busy={actionBusy === 'start'}
              onClick={() =>
                void runAdminAction(
                  'start',
                  () => api.startTournament(tournament.id, clubSlug),
                  'Tournament is live!',
                )
              }
              className="btn-primary min-h-14"
            >
              <Play size={18} aria-hidden />
              Start tournament
            </button>

            <div className="pt-1 flex justify-end">
              {confirmCancel ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={Boolean(actionBusy)}
                    onClick={() =>
                      void runAdminAction(
                        'cancel',
                        () => api.cancelTournament(tournament.id, clubSlug),
                        'Tournament cancelled.',
                      )
                    }
                    className="btn-danger min-h-12 px-4"
                  >
                    Confirm cancel
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(actionBusy)}
                    onClick={() => setConfirmCancel(false)}
                    className="btn-secondary min-h-12 px-4"
                  >
                    Keep
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={Boolean(actionBusy)}
                  onClick={() => setConfirmCancel(true)}
                  className="min-h-12 px-3 text-body font-semibold text-red-700"
                >
                  Cancel tournament
                </button>
              )}
            </div>
          </section>
        ) : null}

        {canManage && tournament && tournament.status === 'live' ? (
          <section className="card p-4 space-y-3" aria-label="Live tournament admin controls">
            {actionError ? (
              <p role="alert" className="text-body font-semibold text-red-700">{actionError}</p>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Link
                to={`/board/tv/${clubSlug}?view=tournament&tournament=${tournament.id}`}
                target="_blank"
                className="btn-secondary min-h-12 flex-1"
              >
                <Maximize2 size={16} aria-hidden />
                TV view
              </Link>
              {tournament.format === 'random_queue' ? (
                <button
                  type="button"
                  disabled={Boolean(actionBusy)}
                  aria-busy={actionBusy === 'complete'}
                  onClick={() =>
                    void runAdminAction(
                      'complete',
                      () => api.completeTournament(tournament.id, clubSlug),
                      'Tournament finished!',
                    )
                  }
                  className="btn-secondary min-h-12 flex-1"
                >
                  <Check size={16} aria-hidden />
                  Finish tournament
                </button>
              ) : null}
            </div>

            {tournament.format === 'random_queue' && availableLatePlayers.length > 0 ? (
              <div className="flex gap-2 items-center pt-1">
                <label className="sr-only" htmlFor="add-late-player">Add player to queue</label>
                <select
                  id="add-late-player"
                  className="input min-h-12 flex-1"
                  value={latePlayerId}
                  onChange={(e) => setLatePlayerId(e.target.value)}
                >
                  <option value="">Add late player…</option>
                  {availableLatePlayers.map((m) => (
                    <option key={m.id} value={m.id}>{m.full_name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!latePlayerId || Boolean(actionBusy)}
                  onClick={() => void addLatePlayer()}
                  className="btn-secondary min-h-12 px-4 shrink-0"
                >
                  <UserPlus size={16} aria-hidden />
                  Add
                </button>
              </div>
            ) : null}
          </section>
        ) : null}

        {role === 'staff' && detail && !detail.can_score && detail.tournament.status === 'live' ? (
          <section className="notice text-body text-slate-700" role="note">
            View only. Ask a club admin to assign you as a scorer for this tournament.
          </section>
        ) : null}

        <TournamentLiveView
          detail={detail ? { ...detail, can_score: (role === 'staff' || role === 'admin') && Boolean(detail.can_score) } : null}
          loading={loading}
          error={error}
          courts={scopedCourts}
          onRetry={() => void load(false)}
          onScoreMatch={role === 'staff' || role === 'admin' ? setScoringMatch : undefined}
          onDrawQueueMatch={(role === 'staff' || role === 'admin') && detail?.can_score ? handleDrawQueue : undefined}
          onAssignCourt={(role === 'staff' || role === 'admin') && detail?.can_score ? handleAssignCourt : undefined}
          onCancelQueueMatch={(role === 'staff' || role === 'admin') && detail?.can_score ? handleCancelQueueMatch : undefined}
          onUndoResult={(role === 'staff' || role === 'admin') && detail?.can_score ? handleUndoResult : undefined}
        />

        {canManage && detail && (detail.tournament.status === 'setup' || detail.tournament.status === 'live') ? (
          <section className="card p-4 space-y-3" aria-labelledby="tournament-scorers-heading">
            <div className="flex items-start gap-2.5">
              <ShieldCheck size={20} className="shrink-0 text-brand-700 mt-0.5" aria-hidden />
              <div>
                <h2 id="tournament-scorers-heading" className="text-subtitle font-semibold text-ink">
                  Tournament scorers
                </h2>
                <p className="text-body text-slate-600">
                  Club admins and club-wide scorers can always score. Add extra staff just for this event if needed.
                </p>
              </div>
            </div>
            {(detail.scorers ?? []).length === 0 ? (
              <p className="text-body text-slate-600">No active staff accounts in this club yet.</p>
            ) : (
              <div className="divide-y divide-line">
                {(detail.scorers ?? []).map((staff) => (
                  <div key={staff.user_id} className="list-row">
                    <div className="flex-1 min-w-0">
                      <p className="text-subtitle font-semibold truncate text-ink">{staff.full_name}</p>
                      <p className="text-caption text-slate-500 truncate">{staff.email}</p>
                    </div>
                    {staff.is_club_scorer ? (
                      <span className="pill pill-ok shrink-0">Club-wide scorer</span>
                    ) : (
                      <button
                        type="button"
                        disabled={Boolean(actionBusy)}
                        aria-busy={actionBusy === `scorer-${staff.user_id}`}
                        onClick={() => void toggleTournamentScorer(staff)}
                        className={`control-feedback min-h-12 shrink-0 rounded-xl border px-3 text-body font-semibold ${
                          staff.can_score
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                            : 'border-slate-300 bg-white text-ink'
                        }`}
                      >
                        {staff.can_score ? 'Can score — remove' : 'Allow scoring'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        ) : null}
      </main>

      {detail ? (
        <ScoreTournamentMatchModal
          open={Boolean(scoringMatch)}
          tournamentId={detail.tournament.id}
          match={scoringMatch}
          courts={scopedCourts}
          onClose={() => setScoringMatch(null)}
          onSubmit={handleScoreMatch}
        />
      ) : null}
      <Toast message={toast} />
    </AppShell>
  )
}

export function MemberTournamentsPage() {
  return <ClubTournamentsListScreen role="member" />
}
export function StaffTournamentsPage() {
  return <ClubTournamentsListScreen role="staff" />
}
export function AdminTournamentsPage() {
  return <ClubTournamentsListScreen role="admin" />
}

export function MemberTournamentDetailPage() {
  return <ClubTournamentDetailScreen role="member" />
}
export function StaffTournamentDetailPage() {
  return <ClubTournamentDetailScreen role="staff" />
}
export function AdminTournamentDetailPage() {
  return <ClubTournamentDetailScreen role="admin" />
}
