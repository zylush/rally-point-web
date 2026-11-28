import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Award, Check, ChevronRight, RotateCcw, Shuffle, Trophy, Users, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { MemberAvatar } from './MemberIdentity'
import { LoadingShapes, SkeletonCard, SkeletonLine, SkeletonRows } from './Skeleton'
import { stagger } from '../lib/motion'
import { useModalDialog } from '../lib/useModalDialog'
import type {
  Court,
  LeaderboardEntry,
  LeaderboardPlayerSummary,
  MatchSide,
  ScoreTournamentMatchInput,
  TournamentDetail,
  TournamentFormat,
  TournamentMatch,
  TournamentStatus,
  TournamentSummary,
} from '../types'
import { fmtDateTime } from '../types'

function playerLabel(player: Pick<LeaderboardPlayerSummary, 'full_name' | 'nickname'>) {
  return player.nickname?.trim() ? player.nickname.trim() : player.full_name
}

function teamDisplay(players: LeaderboardPlayerSummary[], fallbackName?: string | null) {
  if (players.length > 0) return players.map(playerLabel).join(' / ')
  return fallbackName?.trim() || 'Waiting on winner'
}

function formatTournamentType(format: TournamentFormat, teamSize: 1 | 2) {
  const mode = format === 'single_elimination' ? 'Bracket' : 'Random queue'
  const team = teamSize === 1 ? 'Singles' : 'Doubles'
  return `${mode} · ${team}`
}

function tournamentStatusBadge(status: TournamentStatus, dark = false): { label: string; className: string } {
  if (status === 'live') {
    return { label: 'Live', className: dark ? 'bg-emerald-500 text-emerald-950' : 'pill-ok' }
  }
  if (status === 'setup') {
    return { label: 'Setup', className: dark ? 'bg-sky-400 text-slate-950' : 'pill-brand' }
  }
  if (status === 'completed') {
    return { label: 'Finished', className: dark ? 'bg-slate-700 text-slate-100' : 'bg-slate-200 text-slate-800' }
  }
  return { label: 'Cancelled', className: dark ? 'bg-amber-400 text-amber-950' : 'pill-warn' }
}

function rankBadgeClass(rank: number, dark: boolean) {
  if (rank === 1) return dark ? 'bg-amber-400 text-amber-950' : 'bg-amber-100 text-amber-900'
  if (rank === 2) return dark ? 'bg-slate-200 text-slate-900' : 'bg-slate-200 text-slate-800'
  if (rank === 3) return dark ? 'bg-orange-300 text-orange-950' : 'bg-orange-100 text-orange-900'
  return dark ? 'bg-slate-800 text-slate-200' : 'bg-slate-100 text-slate-700'
}

function streakLabel(streak: number) {
  if (streak >= 2) return `W${streak}`
  if (streak <= -2) return `L${Math.abs(streak)}`
  return null
}

function TournamentLoading({ dark }: { dark: boolean }) {
  if (dark) {
    return (
      <LoadingShapes label="Loading tournament…" tone="dark">
        <div className="space-y-3" aria-hidden>
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 space-y-2">
            <div className="h-5 w-32 rounded-lg bg-slate-800" />
            <div className="h-4 w-48 rounded-lg bg-slate-800" />
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {[0, 1].map((key) => (
              <div key={key} className="rounded-2xl border border-slate-800 bg-slate-900 p-4 space-y-2">
                <div className="h-4 w-24 rounded-lg bg-slate-800" />
                <div className="h-6 w-40 rounded-lg bg-slate-800" />
                <div className="h-6 w-40 rounded-lg bg-slate-800" />
              </div>
            ))}
          </div>
        </div>
      </LoadingShapes>
    )
  }
  return (
    <LoadingShapes label="Loading tournament…">
      <div className="space-y-4" aria-hidden>
        <SkeletonCard className="space-y-2">
          <SkeletonLine size="title" className="w-2/3" />
          <SkeletonLine className="w-1/2" />
        </SkeletonCard>
        <SkeletonCard>
          <SkeletonRows count={4} />
        </SkeletonCard>
      </div>
    </LoadingShapes>
  )
}

export function TournamentListCard({
  tournament,
  to,
  club,
}: {
  tournament: TournamentSummary
  to: string
  /** On the all-clubs Tournaments page: the club it is played at. */
  club?: { name: string, city?: string | null }
}) {
  const status = tournamentStatusBadge(tournament.status, false)
  return (
    <Link
      to={to}
      className="control-feedback card p-4 flex items-center gap-3 min-h-[76px]"
    >
      <span className="action-tile-icon shrink-0" aria-hidden>
        {tournament.format === 'single_elimination' ? <Trophy size={22} /> : <Shuffle size={22} />}
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-subtitle font-semibold text-ink truncate">{tournament.title}</p>
          <span className={`pill ${status.className}`}>{status.label}</span>
        </div>
        {club ? (
          <p className="text-body font-semibold text-ink">
            {club.name}
            {club.city ? <span className="font-normal text-slate-600"> · {club.city}</span> : null}
          </p>
        ) : null}
        <p className="text-body text-slate-600">
          {formatTournamentType(tournament.format, tournament.team_size)}
          {tournament.venue_name ? ` · ${tournament.venue_name}` : ''}
        </p>
        <p className="text-caption text-slate-500">
          {tournament.player_count} {tournament.player_count === 1 ? 'player' : 'players'} ·{' '}
          {tournament.completed_matches} {tournament.completed_matches === 1 ? 'game' : 'games'} done
          {tournament.champion_label ? ` · Champion: ${tournament.champion_label}` : ''}
        </p>
      </div>
      <ChevronRight size={20} className="shrink-0 text-slate-400" aria-hidden />
    </Link>
  )
}

export function ClubTournamentsPreviewCard({
  clubSlug,
  clubName,
  tournaments,
  index = 0,
}: {
  clubSlug: string
  clubName: string
  tournaments: TournamentSummary[] | null
  index?: number
}) {
  const shown = tournaments?.slice(0, 3) ?? []
  return (
    <section
      className="enter-rise card p-4 space-y-3 sm:p-5"
      style={stagger(index)}
      aria-labelledby="club-tournaments-preview-heading"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="club-tournaments-preview-heading" className="text-heading-3 font-semibold text-ink">
            Tournaments
          </h2>
          <p className="text-subtitle font-normal text-muted">
            Live brackets & queue mixers · {clubName}
          </p>
        </div>
        <Shuffle size={22} className="shrink-0 text-brand-700 mt-1" aria-hidden />
      </div>

      {shown.length === 0 ? (
        <p className="text-subtitle text-muted">
          No active tournaments right now. Upcoming brackets and queue mixers appear here.
        </p>
      ) : (
        <div className="space-y-2.5">
          {shown.map((t) => {
            const status = tournamentStatusBadge(t.status, false)
            return (
              <Link
                key={t.id}
                to={`/clubs/${clubSlug}/tournaments/${t.id}`}
                className="control-feedback flex items-center justify-between gap-3 rounded-xl border border-line bg-white p-3 min-h-14"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-subtitle font-semibold text-ink truncate">{t.title}</p>
                    <span className={`pill ${status.className}`}>{status.label}</span>
                  </div>
                  <p className="text-caption text-muted">
                    {formatTournamentType(t.format, t.team_size)} · {t.player_count} players
                    {t.champion_label ? ` · Winner: ${t.champion_label}` : ''}
                  </p>
                </div>
                <ChevronRight size={18} className="shrink-0 text-slate-400" aria-hidden />
              </Link>
            )
          })}
        </div>
      )}

      <Link
        to={`/clubs/${clubSlug}/tournaments`}
        className="btn-secondary sm:w-auto! sm:px-6"
      >
        <span>{shown.length > 0 ? 'See all tournaments' : 'Open tournaments'}</span>
        <ChevronRight size={16} aria-hidden />
      </Link>
    </section>
  )
}

function TournamentMatchCard({
  match,
  dark,
  isLive,
  canScore,
  courts,
  showCancel,
  onScore,
  onAssignCourt,
  onCancelQueueMatch,
  onUndoResult,
}: {
  match: TournamentMatch
  dark: boolean
  isLive: boolean
  canScore: boolean
  courts: Court[]
  showCancel: boolean
  onScore?: (match: TournamentMatch) => void
  onAssignCourt?: (matchId: string, courtId: string | null) => Promise<void>
  onCancelQueueMatch?: (matchId: string) => Promise<void>
  /** Scorers only: undo a finished result (the match can be scored again). */
  onUndoResult?: (matchId: string) => Promise<void>
}) {
  const [busyAction, setBusyAction] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [confirmUndo, setConfirmUndo] = useState(false)
  const isCompleted = match.status === 'completed'
  const isBye = match.status === 'bye'
  const isReady = match.status === 'ready' || match.status === 'playing'
  const hasScore = match.score_a != null && match.score_b != null
  const teamALabel = teamDisplay(match.team_a_players, match.team_a_name)
  const teamBLabel = isBye
    ? 'BYE (advances)'
    : teamDisplay(match.team_b_players, match.team_b_name)
  const canScoreThis = Boolean(isLive && canScore && !dark && isReady && onScore && match.team_a_players.length > 0 && match.team_b_players.length > 0)

  async function runCardAction(action: () => Promise<void>, fallback: string) {
    if (busyAction) return
    setBusyAction(true)
    setActionError(null)
    try {
      await action()
      setConfirmUndo(false)
    } catch (cause) {
      const message = (cause as { message?: unknown } | null)?.message
      setActionError(typeof message === 'string' && message ? message : fallback)
    } finally {
      setBusyAction(false)
    }
  }

  async function handleCourtChange(nextCourtId: string) {
    if (!onAssignCourt) return
    await runCardAction(() => onAssignCourt(match.id, nextCourtId || null), 'The court could not be changed.')
  }

  async function handleCancel() {
    if (!onCancelQueueMatch) return
    await runCardAction(() => onCancelQueueMatch(match.id), 'The game could not be cancelled.')
  }

  async function handleUndo() {
    if (!onUndoResult) return
    await runCardAction(() => onUndoResult(match.id), 'The result could not be undone.')
  }

  const canUndoThis = Boolean(canScore && !dark && isCompleted && onUndoResult)

  return (
    <article
      className={`rounded-2xl border p-3.5 space-y-2.5 ${
        dark
          ? isReady
            ? 'border-brand-500/60 bg-slate-900 text-white'
            : 'border-slate-800 bg-slate-900 text-white'
          : isReady
            ? 'border-brand-300 bg-white text-ink'
            : 'border-line bg-white text-ink'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`pill ${dark ? 'bg-slate-800 text-slate-200' : 'bg-slate-100 text-slate-700'}`}>
            {match.round_label}
          </span>
          {match.court_name ? (
            <span className={`pill ${dark ? 'bg-sky-500/20 text-sky-200' : 'pill-brand'}`}>
              {match.court_name}
            </span>
          ) : null}
          {isBye ? (
            <span className={`pill ${dark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-600'}`}>
              Auto advance
            </span>
          ) : isReady ? (
            <span className={`pill ${dark ? 'bg-emerald-500 text-emerald-950' : 'pill-ok'}`}>
              Up next
            </span>
          ) : null}
        </div>
        {match.completed_at ? (
          <span className={`text-caption ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
            {fmtDateTime(match.completed_at)}
          </span>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <div
          className={`rounded-xl border px-3 py-2 flex items-center justify-between gap-2 ${
            isCompleted && match.winner_side === 'a'
              ? dark ? 'border-emerald-500/70 bg-emerald-950/60' : 'border-emerald-300 bg-emerald-50'
              : dark ? 'border-slate-800 bg-slate-950/50' : 'border-line bg-slate-50'
          }`}
        >
          <div className="min-w-0 flex-1">
            <p className="text-body font-semibold truncate">
              {match.team_a_seed != null ? `#${match.team_a_seed} ` : ''}
              {teamALabel}
            </p>
          </div>
          {hasScore ? (
            <span className="text-title font-bold tabular-nums shrink-0">{match.score_a}</span>
          ) : null}
          {isCompleted && match.winner_side === 'a' ? (
            <span className={`pill shrink-0 ${dark ? 'bg-emerald-500 text-emerald-950' : 'pill-ok'}`}>Winner</span>
          ) : null}
        </div>

        <div
          className={`rounded-xl border px-3 py-2 flex items-center justify-between gap-2 ${
            isCompleted && match.winner_side === 'b'
              ? dark ? 'border-emerald-500/70 bg-emerald-950/60' : 'border-emerald-300 bg-emerald-50'
              : dark ? 'border-slate-800 bg-slate-950/50' : 'border-line bg-slate-50'
          }`}
        >
          <div className="min-w-0 flex-1">
            <p className={`text-body font-semibold truncate ${match.team_b_players.length === 0 ? 'text-slate-500 font-normal' : ''}`}>
              {match.team_b_seed != null ? `#${match.team_b_seed} ` : ''}
              {teamBLabel}
            </p>
          </div>
          {hasScore ? (
            <span className="text-title font-bold tabular-nums shrink-0">{match.score_b}</span>
          ) : null}
          {isCompleted && match.winner_side === 'b' ? (
            <span className={`pill shrink-0 ${dark ? 'bg-emerald-500 text-emerald-950' : 'pill-ok'}`}>Winner</span>
          ) : null}
        </div>
      </div>

      {canScore && isLive && !dark && isReady ? (
        <div className="pt-1 space-y-2">
          {onAssignCourt && courts.length > 0 ? (
            <div>
              <label className="sr-only" htmlFor={`court-${match.id}`}>Court for {match.round_label}</label>
              <select
                id={`court-${match.id}`}
                className="input min-h-12 text-body"
                value={match.court_id ?? ''}
                disabled={busyAction}
                onChange={(e) => void handleCourtChange(e.target.value)}
              >
                <option value="">No court assigned</option>
                {courts.map((c) => (
                  <option key={c.id} value={c.id} disabled={c.status === 'maintenance' && c.id !== match.court_id}>
                    {c.status === 'maintenance' ? `${c.name} (out of service)` : c.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {canScoreThis ? (
              <button
                type="button"
                className="btn-primary min-h-[52px] flex-1"
                disabled={busyAction}
                onClick={() => onScore?.(match)}
              >
                <Award size={18} aria-hidden />
                Score match
              </button>
            ) : null}
            {showCancel && onCancelQueueMatch ? (
              <button
                type="button"
                className="btn-secondary min-h-[52px] px-4"
                disabled={busyAction}
                onClick={() => void handleCancel()}
              >
                Cancel game
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {canUndoThis ? (
        confirmUndo ? (
          <div className="pt-1 space-y-2" role="group" aria-label={`Undo the result of ${match.round_label}`}>
            <p className="text-body text-ink">Undo this result? The match goes back to “Up next” and can be scored again.</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-primary min-h-[52px] flex-1"
                disabled={busyAction}
                onClick={() => void handleUndo()}
              >
                Yes, undo it
              </button>
              <button
                type="button"
                className="btn-secondary min-h-[52px] px-4"
                disabled={busyAction}
                onClick={() => { setConfirmUndo(false); setActionError(null) }}
              >
                Keep result
              </button>
            </div>
          </div>
        ) : (
          <div className="pt-1">
            <button
              type="button"
              className="btn-secondary min-h-[52px] w-full"
              onClick={() => { setConfirmUndo(true); setActionError(null) }}
            >
              <RotateCcw size={18} aria-hidden />
              Undo result
            </button>
          </div>
        )
      ) : null}

      {actionError ? (
        <p role="alert" className="notice notice-error text-body">{actionError}</p>
      ) : null}
    </article>
  )
}

export function TournamentLiveView({
  detail,
  loading = false,
  error = null,
  tone = 'light',
  courts = [],
  onRetry,
  onScoreMatch,
  onDrawQueueMatch,
  onAssignCourt,
  onCancelQueueMatch,
  onUndoResult,
}: {
  detail: TournamentDetail | null
  loading?: boolean
  error?: string | null
  tone?: 'light' | 'dark'
  courts?: Court[]
  onRetry?: () => void
  onScoreMatch?: (match: TournamentMatch) => void
  onDrawQueueMatch?: (courtId: string | null) => Promise<void>
  onAssignCourt?: (matchId: string, courtId: string | null) => Promise<void>
  onCancelQueueMatch?: (matchId: string) => Promise<void>
  onUndoResult?: (matchId: string) => Promise<void>
}) {
  const dark = tone === 'dark'
  const [tab, setTab] = useState<'main' | 'standings' | 'players'>('main')
  const [drawCourtId, setDrawCourtId] = useState('')
  const [drawing, setDrawing] = useState(false)
  const [drawError, setDrawError] = useState<string | null>(null)

  const tournament = detail?.tournament
  const canScore = Boolean(detail?.can_score) && !dark
  const isLive = tournament?.status === 'live'

  const myActiveMatch = useMemo(() => {
    if (!detail?.my_member_id || !detail.matches) return null
    return (
      detail.matches.find(
        (m) =>
          (m.status === 'ready' || m.status === 'playing')
          && (m.team_a_players.some((p) => p.member_id === detail.my_member_id)
            || m.team_b_players.some((p) => p.member_id === detail.my_member_id)),
      ) ?? null
    )
  }, [detail])

  const bracketRounds = useMemo(() => {
    if (!detail || detail.tournament.format !== 'single_elimination') return []
    const byRound = new Map<number, TournamentMatch[]>()
    for (const m of detail.matches) {
      const list = byRound.get(m.round_number) ?? []
      list.push(m)
      byRound.set(m.round_number, list)
    }
    return [...byRound.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([roundNumber, list]) => ({
        roundNumber,
        label: list[0]?.round_label ?? `Round ${roundNumber}`,
        matches: list.slice().sort((a, b) => a.match_order - b.match_order),
      }))
  }, [detail])

  const activeQueueMatches = useMemo(() => {
    if (!detail) return []
    return detail.matches.filter((m) => m.status === 'ready' || m.status === 'playing')
  }, [detail])

  const completedQueueMatches = useMemo(() => {
    if (!detail) return []
    return detail.matches
      .filter((m) => m.status === 'completed')
      .slice()
      .sort((a, b) => b.match_order - a.match_order)
  }, [detail])

  async function handleDraw() {
    if (!onDrawQueueMatch || drawing) return
    setDrawing(true)
    setDrawError(null)
    try {
      await onDrawQueueMatch(drawCourtId || null)
    } catch (cause) {
      setDrawError(cause instanceof Error && cause.message ? cause.message : 'Could not draw next match.')
    } finally {
      setDrawing(false)
    }
  }

  if (loading && !detail) return <TournamentLoading dark={dark} />
  if (error && !detail) {
    return (
      <section role="alert" className={dark ? 'rounded-2xl border border-red-800 bg-slate-900 p-4 text-red-200 space-y-3' : 'notice notice-error space-y-3'}>
        <p className="text-subtitle font-semibold">{error}</p>
        {onRetry ? (
          <button type="button" onClick={onRetry} className="btn-secondary sm:w-auto! sm:px-5">
            Try again
          </button>
        ) : null}
      </section>
    )
  }
  if (!detail || !tournament) {
    return (
      <section className={dark ? 'rounded-2xl border border-slate-800 bg-slate-900 p-6 text-center text-slate-300' : 'card p-6 text-center text-slate-600'}>
        <p className="text-subtitle font-semibold">Tournament not found.</p>
      </section>
    )
  }

  const statusBadge = tournamentStatusBadge(tournament.status, dark)
  const mainTabLabel = tournament.format === 'single_elimination' ? 'Bracket' : 'Live courts'

  return (
    <div className="space-y-4">
      <section className={`rounded-2xl border p-4 space-y-2 ${dark ? 'border-slate-800 bg-slate-900 text-white' : 'card'}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`pill ${statusBadge.className}`}>{statusBadge.label}</span>
            <span className={`pill ${dark ? 'bg-slate-800 text-slate-200' : 'bg-slate-100 text-slate-700'}`}>
              {formatTournamentType(tournament.format, tournament.team_size)}
            </span>
          </div>
          {tournament.venue_name ? (
            <span className={`text-caption ${dark ? 'text-slate-400' : 'text-slate-500'}`}>{tournament.venue_name}</span>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-3 text-caption">
          <span className={dark ? 'text-slate-300' : 'text-slate-600'}>
            {tournament.player_count} {tournament.player_count === 1 ? 'player' : 'players'}
          </span>
          <span className={dark ? 'text-slate-300' : 'text-slate-600'}>
            {tournament.completed_matches} completed · {tournament.active_matches} active
          </span>
          <span className={dark ? 'text-slate-300' : 'text-slate-600'}>
            {tournament.counts_for_leaderboard ? 'Counts for club leaderboard' : 'Friendly event only'}
          </span>
        </div>

        {tournament.notes ? (
          <p className={`text-body ${dark ? 'text-slate-300' : 'text-slate-600'}`}>{tournament.notes}</p>
        ) : null}
      </section>

      {tournament.champion_label ? (
        <section
          aria-label="Tournament champion"
          className={`rounded-2xl border p-4 flex items-center gap-3 ${
            dark ? 'border-amber-400/60 bg-amber-950/40 text-amber-100' : 'border-amber-300 bg-amber-50 text-amber-950'
          }`}
        >
          <Trophy size={24} className="shrink-0" aria-hidden />
          <div>
            <p className="text-caption font-semibold">Champion</p>
            <p className="text-title font-bold">{tournament.champion_label}</p>
          </div>
        </section>
      ) : null}

      {!dark && myActiveMatch ? (
        <section
          aria-label="Your next match"
          className="rounded-2xl border border-brand-500 bg-brand-700 text-white p-4 space-y-1"
        >
          <p className="text-caption font-semibold text-brand-100">You're up next</p>
          <p className="text-subtitle font-bold">
            {myActiveMatch.round_label}
            {myActiveMatch.court_name ? ` · ${myActiveMatch.court_name}` : ''}
          </p>
          <p className="text-body text-brand-50">
            {teamDisplay(myActiveMatch.team_a_players, myActiveMatch.team_a_name)} vs{' '}
            {teamDisplay(myActiveMatch.team_b_players, myActiveMatch.team_b_name)}
          </p>
        </section>
      ) : null}

      <div className={`text-tabs text-tabs-fill ${dark ? 'text-tabs-dark' : ''}`} role="tablist" aria-label="Tournament views">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'main'}
          onClick={() => setTab('main')}
        >
          {mainTabLabel}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'standings'}
          onClick={() => setTab('standings')}
        >
          Standings
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'players'}
          onClick={() => setTab('players')}
        >
          Players ({detail.players.length})
        </button>
      </div>

      {tab === 'main' ? (
        tournament.format === 'single_elimination' ? (
          bracketRounds.length === 0 ? (
            <section className={`rounded-2xl border p-5 text-center space-y-1 ${dark ? 'border-slate-800 bg-slate-900 text-slate-300' : 'card text-slate-600'}`}>
              <p className="text-subtitle font-semibold">No bracket draw yet</p>
              <p className="text-body">
                {tournament.status === 'setup'
                  ? 'Add players and generate the random teams and bracket draw.'
                  : 'Matches will appear once teams are paired.'}
              </p>
            </section>
          ) : (
            <div className="space-y-4 md:grid md:grid-flow-col md:auto-cols-[minmax(280px,1fr)] md:gap-4 md:space-y-0 md:overflow-x-auto md:pb-2">
              {bracketRounds.map((round) => (
                <section key={round.roundNumber} className="space-y-2.5">
                  <h2 className={`text-subtitle font-bold px-1 ${dark ? 'text-white' : 'text-ink'}`}>
                    {round.label}
                  </h2>
                  <div className="space-y-2.5">
                    {round.matches.map((m) => (
                      <TournamentMatchCard
                        key={m.id}
                        match={m}
                        dark={dark}
                        isLive={isLive}
                        canScore={canScore}
                        courts={courts}
                        showCancel={false}
                        onScore={onScoreMatch}
                        onAssignCourt={onAssignCourt}
                        onUndoResult={onUndoResult}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )
        ) : (
          <div className="space-y-4">
            {isLive && canScore && onDrawQueueMatch ? (
              <section className="card p-4 space-y-3" aria-label="Queue matcher controls">
                <div className="space-y-1">
                  <p className="text-subtitle font-semibold text-ink">Next random matchup</p>
                  <p className="text-body text-slate-600">
                    Picks waiting players with the fewest games and fresh partners automatically.
                  </p>
                </div>
                {courts.length > 0 ? (
                  <div>
                    <label className="label" htmlFor="draw-court-select">Court (optional)</label>
                    <select
                      id="draw-court-select"
                      className="input min-h-12"
                      value={drawCourtId}
                      disabled={drawing}
                      onChange={(e) => setDrawCourtId(e.target.value)}
                    >
                      <option value="">Auto-pick open court</option>
                      {courts.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                ) : null}
                {drawError ? (
                  <p role="alert" className="text-body font-semibold text-red-700">{drawError}</p>
                ) : null}
                <button
                  type="button"
                  disabled={drawing}
                  aria-busy={drawing}
                  onClick={() => void handleDraw()}
                  className="btn-primary min-h-14"
                >
                  <Shuffle size={18} aria-hidden />
                  {drawing ? 'Drawing teams…' : 'Draw next random match'}
                </button>
              </section>
            ) : null}

            <section className="space-y-2.5">
              <h2 className={`text-subtitle font-bold px-1 ${dark ? 'text-white' : 'text-ink'}`}>
                On court now ({activeQueueMatches.length})
              </h2>
              {activeQueueMatches.length === 0 ? (
                <section className={`rounded-2xl border p-4 ${dark ? 'border-slate-800 bg-slate-900 text-slate-300' : 'card text-slate-600'}`}>
                  <p className="text-body">
                    {tournament.status === 'setup'
                      ? 'Queue starts as soon as the admin starts the tournament.'
                      : tournament.status === 'completed'
                        ? 'All queue games have finished.'
                        : 'No game active right now. Draw the next random match above.'}
                  </p>
                </section>
              ) : (
                <div className={dark ? 'grid grid-cols-1 gap-3 md:grid-cols-2' : 'space-y-2.5'}>
                  {activeQueueMatches.map((m) => (
                    <TournamentMatchCard
                      key={m.id}
                      match={m}
                      dark={dark}
                      isLive={isLive}
                      canScore={canScore}
                      courts={courts}
                      showCancel
                      onScore={onScoreMatch}
                      onAssignCourt={onAssignCourt}
                      onCancelQueueMatch={onCancelQueueMatch}
                      onUndoResult={onUndoResult}
                    />
                  ))}
                </div>
              )}
            </section>

            {completedQueueMatches.length > 0 ? (
              <section className="space-y-2.5">
                <h2 className={`text-subtitle font-bold px-1 ${dark ? 'text-white' : 'text-ink'}`}>
                  Completed games ({completedQueueMatches.length})
                </h2>
                <div className={dark ? 'grid grid-cols-1 gap-3 md:grid-cols-2' : 'space-y-2.5'}>
                  {completedQueueMatches.map((m) => (
                    <TournamentMatchCard
                      key={m.id}
                      match={m}
                      dark={dark}
                      isLive={false}
                      canScore={canScore}
                      courts={courts}
                      showCancel={false}
                      onUndoResult={onUndoResult}
                    />
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        )
      ) : null}

      {tab === 'standings' ? (
        <section className={`rounded-2xl border overflow-hidden ${dark ? 'border-slate-800 bg-slate-900 text-white' : 'border-line bg-white text-ink'}`}>
          {detail.standings.length === 0 ? (
            <p className={`p-4 text-body ${dark ? 'text-slate-400' : 'text-slate-600'}`}>
              No players in this tournament yet.
            </p>
          ) : (
            <ol className={`divide-y ${dark ? 'divide-slate-800' : 'divide-line'}`}>
              {detail.standings.map((entry: LeaderboardEntry) => {
                const isMe = detail.my_member_id === entry.member_id
                const streak = streakLabel(entry.streak)
                return (
                  <li
                    key={entry.member_id}
                    className={`flex items-center gap-3 p-3.5 ${
                      isMe ? (dark ? 'bg-brand-950/40' : 'bg-brand-50/70') : ''
                    }`}
                  >
                    <span className={`pill shrink-0 tabular-nums ${rankBadgeClass(entry.rank, dark)}`}>
                      #{entry.rank}
                    </span>
                    <MemberAvatar name={entry.full_name} photoUrl={entry.photo_url} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="text-subtitle font-semibold truncate">
                        {playerLabel(entry)}
                        {isMe ? ' (You)' : ''}
                      </p>
                      <p className={`text-caption tabular-nums ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
                        {entry.wins}W–{entry.losses}L · {entry.win_pct}% win
                        {entry.score_diff !== 0 ? ` · Diff ${entry.score_diff > 0 ? `+${entry.score_diff}` : entry.score_diff}` : ''}
                      </p>
                    </div>
                    {streak ? (
                      <span className={`pill shrink-0 tabular-nums ${dark ? 'bg-slate-800 text-slate-200' : 'bg-slate-100 text-slate-700'}`}>
                        {streak}
                      </span>
                    ) : null}
                    <span className={`text-subtitle font-bold shrink-0 tabular-nums ${dark ? 'text-brand-200' : 'text-brand-800'}`}>
                      {entry.points} pts
                    </span>
                  </li>
                )
              })}
            </ol>
          )}
        </section>
      ) : null}

      {tab === 'players' ? (
        <div className="space-y-4">
          {tournament.format === 'single_elimination' && detail.teams.length > 0 ? (
            <section className={`rounded-2xl border p-4 space-y-2 ${dark ? 'border-slate-800 bg-slate-900 text-white' : 'card'}`}>
              <h2 className="text-subtitle font-bold">Seeded teams ({detail.teams.length})</h2>
              <div className={`divide-y ${dark ? 'divide-slate-800' : 'divide-line'}`}>
                {detail.teams.map((team) => (
                  <div key={team.id} className="flex items-center gap-3 py-2.5">
                    <span className={`pill shrink-0 tabular-nums ${dark ? 'bg-slate-800 text-slate-200' : 'bg-slate-100 text-slate-700'}`}>
                      Seed #{team.seed}
                    </span>
                    <p className="text-body font-semibold truncate">{team.name}</p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className={`rounded-2xl border p-4 space-y-2 ${dark ? 'border-slate-800 bg-slate-900 text-white' : 'card'}`}>
            <div className="flex items-center gap-2">
              <Users size={18} className="shrink-0" aria-hidden />
              <h2 className="text-subtitle font-bold">Participating players ({detail.players.length})</h2>
            </div>
            {detail.players.length === 0 ? (
              <p className={`text-body ${dark ? 'text-slate-400' : 'text-slate-600'}`}>
                No players registered yet.
              </p>
            ) : (
              <ul className={`divide-y ${dark ? 'divide-slate-800' : 'divide-line'}`}>
                {detail.players.map((player) => (
                  <li key={player.member_id} className="flex items-center gap-3 py-2.5">
                    <MemberAvatar name={player.full_name} photoUrl={player.photo_url} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="text-subtitle font-semibold truncate">{playerLabel(player)}</p>
                      {player.nickname ? (
                        <p className={`text-caption truncate ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
                          {player.full_name}
                        </p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}
    </div>
  )
}

export function ScoreTournamentMatchModal({
  open,
  tournamentId,
  match,
  courts,
  onClose,
  onSubmit,
}: {
  open: boolean
  tournamentId: string
  match: TournamentMatch | null
  courts: Court[]
  onClose: () => void
  onSubmit: (input: ScoreTournamentMatchInput) => Promise<void>
}) {
  const [scoreA, setScoreA] = useState('')
  const [scoreB, setScoreB] = useState('')
  const [courtId, setCourtId] = useState('')
  const [submitting, setSubmitting] = useState<MatchSide | null>(null)
  const [error, setError] = useState<string | null>(null)

  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open || !match) return
    setScoreA('')
    setScoreB('')
    setCourtId(match.court_id ?? '')
    setSubmitting(null)
    setError(null)
  }, [open, match])

  useModalDialog(open && Boolean(match), {
    dialogRef,
    initialFocusRef: closeRef,
    onEscape: () => {
      if (!submitting) onClose()
    },
    lockScroll: true,
  })

  if (!open || !match) return null

  const teamALabel = teamDisplay(match.team_a_players, match.team_a_name)
  const teamBLabel = teamDisplay(match.team_b_players, match.team_b_name)

  async function submitWinner(winnerSide: MatchSide) {
    if (submitting || !match) return
    const rawA = scoreA.trim()
    const rawB = scoreB.trim()
    let parsedA: number | null = null
    let parsedB: number | null = null
    if ((rawA !== '') !== (rawB !== '')) {
      setError('Enter scores for both teams, or leave both blank.')
      return
    }
    if (rawA !== '' && rawB !== '') {
      parsedA = Number(rawA)
      parsedB = Number(rawB)
      if (!Number.isInteger(parsedA) || !Number.isInteger(parsedB) || parsedA < 0 || parsedA > 99 || parsedB < 0 || parsedB > 99) {
        setError('Scores must be whole numbers between 0 and 99.')
        return
      }
      if ((winnerSide === 'a' && parsedA <= parsedB) || (winnerSide === 'b' && parsedB <= parsedA)) {
        setError('Winning team score must be higher than the losing team score.')
        return
      }
    }

    setSubmitting(winnerSide)
    setError(null)
    try {
      await onSubmit({
        tournament_id: tournamentId,
        match_id: match.id,
        winner_side: winnerSide,
        score_a: parsedA,
        score_b: parsedB,
        court_id: courtId || null,
      })
      onClose()
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : 'Could not save match score.')
    } finally {
      setSubmitting(null)
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 sm:items-center sm:p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="score-tournament-match-title"
        tabIndex={-1}
        className="w-full max-w-md rounded-t-3xl bg-white p-5 space-y-4 sm:rounded-3xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="score-tournament-match-title" className="text-title font-bold text-ink">
              Score {match.round_label}
            </h2>
            <p className="text-body text-slate-600">
              {teamALabel} vs {teamBLabel}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            disabled={Boolean(submitting)}
            onClick={onClose}
            aria-label="Close score dialog"
            className="min-h-12 min-w-12 rounded-xl border border-line bg-white inline-flex items-center justify-center text-ink"
          >
            <X size={20} aria-hidden />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="tour-score-a">Team A score (optional)</label>
            <input
              id="tour-score-a"
              type="number"
              inputMode="numeric"
              min={0}
              max={99}
              placeholder="11"
              className="input min-h-12"
              value={scoreA}
              onChange={(e) => setScoreA(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="tour-score-b">Team B score (optional)</label>
            <input
              id="tour-score-b"
              type="number"
              inputMode="numeric"
              min={0}
              max={99}
              placeholder="7"
              className="input min-h-12"
              value={scoreB}
              onChange={(e) => setScoreB(e.target.value)}
            />
          </div>
        </div>

        {courts.length > 0 ? (
          <div>
            <label className="label" htmlFor="tour-score-court">Court</label>
            <select
              id="tour-score-court"
              className="input min-h-12"
              value={courtId}
              onChange={(e) => setCourtId(e.target.value)}
            >
              <option value="">No court</option>
              {courts.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="text-body font-semibold text-red-700">{error}</p>
        ) : null}

        <div className="space-y-2.5 pt-1">
          <button
            type="button"
            disabled={Boolean(submitting)}
            aria-busy={submitting === 'a'}
            onClick={() => void submitWinner('a')}
            className="btn-primary min-h-14"
          >
            <Check size={18} aria-hidden />
            {submitting === 'a' ? 'Saving…' : `${teamALabel} won`}
          </button>
          <button
            type="button"
            disabled={Boolean(submitting)}
            aria-busy={submitting === 'b'}
            onClick={() => void submitWinner('b')}
            className="btn-secondary min-h-14"
          >
            <Check size={18} aria-hidden />
            {submitting === 'b' ? 'Saving…' : `${teamBLabel} won`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
