import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { Award, Ban, ChevronRight, Flame, Trophy, X } from 'lucide-react'
import { MemberAvatar } from './MemberIdentity'
import { LoadingShapes, SkeletonBlock, SkeletonCard, SkeletonLine, SkeletonRows } from './Skeleton'
import { stagger } from '../lib/motion'
import { useModalDialog } from '../lib/useModalDialog'
import type {
  ClubLeaderboardSnapshot,
  ClubMatch,
  LeaderboardEntry,
  LeaderboardFormatFilter,
  LeaderboardPeriod,
  LeaderboardPlayerSummary,
} from '../types'
import { fmtDateTime } from '../types'

export interface LeaderboardViewProps {
  snapshot: ClubLeaderboardSnapshot | null
  loading?: boolean
  error?: string | null
  period: LeaderboardPeriod
  onPeriodChange: (period: LeaderboardPeriod) => void
  format: LeaderboardFormatFilter
  onFormatChange: (format: LeaderboardFormatFilter) => void
  tone?: 'light' | 'dark'
  showMyStanding?: boolean
  canScore?: boolean
  onVoidMatch?: (matchId: string, reason: string) => Promise<void>
  onLoadPlayerMatches?: (memberId: string) => Promise<ClubMatch[]>
  onRetry?: () => void
}

function playerLabel(player: Pick<LeaderboardPlayerSummary, 'full_name' | 'nickname'>) {
  return player.nickname?.trim() ? player.nickname.trim() : player.full_name
}

function teamNames(players: LeaderboardPlayerSummary[]) {
  return players.map(playerLabel).join(' / ')
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

function LeaderboardLoading({ dark }: { dark: boolean }) {
  if (dark) {
    return (
      <LoadingShapes label="Loading leaderboard…" tone="dark">
        <div className="space-y-3" aria-hidden>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[0, 1, 2].map((key) => (
              <div key={key} className="rounded-2xl border border-slate-800 bg-slate-900 p-4 space-y-2">
                <div className="h-5 w-12 rounded-full bg-slate-800" />
                <div className="h-6 w-32 rounded-lg bg-slate-800" />
                <div className="h-4 w-24 rounded-lg bg-slate-800" />
              </div>
            ))}
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 space-y-3">
            {[0, 1, 2, 3].map((key) => (
              <div key={key} className="flex items-center justify-between gap-3">
                <div className="h-5 w-40 rounded-lg bg-slate-800" />
                <div className="h-5 w-16 rounded-lg bg-slate-800" />
              </div>
            ))}
          </div>
        </div>
      </LoadingShapes>
    )
  }
  return (
    <LoadingShapes label="Loading leaderboard…">
      <div className="space-y-4" aria-hidden>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((key) => (
            <SkeletonCard key={key} className="space-y-2">
              <SkeletonBlock className="h-6 w-12 rounded-full!" />
              <SkeletonLine size="title" className="w-3/4" />
              <SkeletonLine className="w-1/2" />
            </SkeletonCard>
          ))}
        </div>
        <SkeletonCard>
          <SkeletonRows count={4} />
        </SkeletonCard>
      </div>
    </LoadingShapes>
  )
}

function MatchCard({
  match,
  dark,
  canScore,
  onAskVoid,
}: {
  match: ClubMatch
  dark: boolean
  canScore?: boolean
  onAskVoid?: (match: ClubMatch) => void
}) {
  const isVoided = match.status === 'voided'
  const teamAWon = match.winner_side === 'a'
  const hasScore = match.score_a != null && match.score_b != null
  const place = [match.venue_name, match.court_name].filter(Boolean).join(' · ')

  return (
    <article
      className={`rounded-2xl border p-4 space-y-2.5 ${
        dark
          ? 'border-slate-800 bg-slate-900 text-white'
          : isVoided
            ? 'border-slate-200 bg-slate-50 text-slate-700'
            : 'border-line bg-white text-ink'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`pill ${dark ? 'bg-slate-800 text-slate-200' : 'pill-brand'}`}>
            {match.format === 'doubles' ? 'Doubles' : 'Singles'}
          </span>
          {match.tournament_title ? (
            <span className={`pill ${dark ? 'bg-slate-800 text-brand-200' : 'bg-slate-100 text-slate-700'}`}>
              {match.tournament_title}
            </span>
          ) : null}
          {isVoided ? (
            <span className={`pill ${dark ? 'bg-amber-400 text-amber-950' : 'pill-warn'}`}>Voided</span>
          ) : null}
          {place ? (
            <span className={`text-caption ${dark ? 'text-slate-400' : 'text-slate-500'}`}>{place}</span>
          ) : null}
        </div>
        <span className={`text-caption ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
          {fmtDateTime(match.played_at)}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
        <div className={`rounded-xl px-3 py-2 border ${
          teamAWon && !isVoided
            ? dark ? 'border-emerald-500/60 bg-emerald-950/50' : 'border-emerald-200 bg-emerald-50'
            : dark ? 'border-slate-800 bg-slate-950/50' : 'border-line bg-slate-50'
        }`}>
          <div className="flex items-center justify-between gap-2">
            <p className={`text-body font-semibold ${isVoided ? 'line-through' : ''}`}>
              {teamNames(match.team_a)}
            </p>
            {teamAWon && !isVoided ? (
              <span className={`pill ${dark ? 'bg-emerald-500 text-emerald-950' : 'pill-ok'}`}>Winner</span>
            ) : null}
          </div>
          {hasScore ? (
            <p className={`text-title font-bold tabular-nums mt-0.5 ${dark ? 'text-white' : 'text-ink'}`}>
              {match.score_a}
            </p>
          ) : null}
        </div>

        <span className={`text-center text-caption font-semibold ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
          vs
        </span>

        <div className={`rounded-xl px-3 py-2 border ${
          !teamAWon && !isVoided
            ? dark ? 'border-emerald-500/60 bg-emerald-950/50' : 'border-emerald-200 bg-emerald-50'
            : dark ? 'border-slate-800 bg-slate-950/50' : 'border-line bg-slate-50'
        }`}>
          <div className="flex items-center justify-between gap-2">
            <p className={`text-body font-semibold ${isVoided ? 'line-through' : ''}`}>
              {teamNames(match.team_b)}
            </p>
            {!teamAWon && !isVoided ? (
              <span className={`pill ${dark ? 'bg-emerald-500 text-emerald-950' : 'pill-ok'}`}>Winner</span>
            ) : null}
          </div>
          {hasScore ? (
            <p className={`text-title font-bold tabular-nums mt-0.5 ${dark ? 'text-white' : 'text-ink'}`}>
              {match.score_b}
            </p>
          ) : null}
        </div>
      </div>

      {match.notes ? (
        <p className={`text-caption ${dark ? 'text-slate-400' : 'text-slate-600'}`}>{match.notes}</p>
      ) : null}
      {isVoided && match.void_reason ? (
        <p className={`text-caption ${dark ? 'text-amber-300' : 'text-amber-900'}`}>
          Void reason: {match.void_reason}
        </p>
      ) : null}

      {canScore && onAskVoid && !isVoided ? (
        <div className="pt-1 flex justify-end">
          <button
            type="button"
            className="control-feedback inline-flex min-h-12 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 text-body font-semibold text-slate-700"
            onClick={() => onAskVoid(match)}
          >
            <Ban size={16} aria-hidden />
            Void match
          </button>
        </div>
      ) : null}
    </article>
  )
}

function PlayerMatchesDialog({
  entry,
  matches,
  loading,
  error,
  onClose,
}: {
  entry: LeaderboardEntry | null
  matches: ClubMatch[]
  loading: boolean
  error: string | null
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useModalDialog(Boolean(entry), {
    dialogRef,
    initialFocusRef: closeRef,
    onEscape: onClose,
    lockScroll: true,
  })

  if (!entry) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-slate-950/50 p-3 sm:p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="player-history-title"
        className="card w-full max-w-lg max-h-[85dvh] flex flex-col overflow-hidden bg-white"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line p-4">
          <div className="flex items-center gap-3 min-w-0">
            <MemberAvatar name={entry.full_name} photoUrl={entry.photo_url} size="md" />
            <div className="min-w-0">
              <h2 id="player-history-title" className="text-title font-bold text-ink truncate">
                {entry.full_name}
              </h2>
              {entry.nickname ? (
                <p className="text-body text-slate-600 truncate">Goes by {entry.nickname}</p>
              ) : null}
              <p className="text-caption text-slate-500 mt-0.5">
                Rank #{entry.rank} · {entry.points} pts · {entry.wins}W–{entry.losses}L ({entry.win_pct}%)
              </p>
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close player match history"
            className="control-feedback inline-flex min-h-12 min-w-12 items-center justify-center rounded-xl border border-slate-200 text-slate-700"
          >
            <X size={20} aria-hidden />
          </button>
        </div>

        <div className="overflow-y-auto p-4 space-y-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl border border-line bg-slate-50 p-2.5">
              <p className="text-caption text-slate-500">Points</p>
              <p className="text-title font-bold text-ink tabular-nums">{entry.points}</p>
            </div>
            <div className="rounded-xl border border-line bg-slate-50 p-2.5">
              <p className="text-caption text-slate-500">Record</p>
              <p className="text-title font-bold text-ink tabular-nums">{entry.wins}–{entry.losses}</p>
            </div>
            <div className="rounded-xl border border-line bg-slate-50 p-2.5">
              <p className="text-caption text-slate-500">Point diff</p>
              <p className="text-title font-bold text-ink tabular-nums">
                {entry.score_diff >= 0 ? `+${entry.score_diff}` : entry.score_diff}
              </p>
            </div>
          </div>

          <h3 className="text-subtitle font-semibold text-ink pt-1">Recent matches</h3>
          {loading ? (
            <SkeletonCard>
              <SkeletonRows count={3} />
            </SkeletonCard>
          ) : error ? (
            <p role="alert" className="text-body text-red-700">{error}</p>
          ) : matches.length === 0 ? (
            <p className="text-body text-slate-600">No completed matches found for this player yet.</p>
          ) : (
            <div className="space-y-2.5">
              {matches.map((match) => (
                <MatchCard key={match.id} match={match} dark={false} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function VoidMatchDialog({
  match,
  onCancel,
  onConfirm,
}: {
  match: ClubMatch | null
  onCancel: () => void
  onConfirm: (matchId: string, reason: string) => Promise<void>
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    setReason('')
    setError(null)
    setBusy(false)
  }, [match?.id])

  useModalDialog(Boolean(match), {
    dialogRef,
    initialFocusRef: cancelRef,
    onEscape: () => {
      if (!busy) onCancel()
    },
    lockScroll: true,
  })

  if (!match) return null

  async function submit() {
    if (!match || busy) return
    setBusy(true)
    setError(null)
    try {
      await onConfirm(match.id, reason)
      onCancel()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not void this match.')
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="void-match-title"
        className="card w-full max-w-sm p-5 space-y-3 bg-white"
      >
        <h2 id="void-match-title" className="text-title font-bold text-ink">
          Void this match?
        </h2>
        <p className="text-body text-slate-600">
          {teamNames(match.team_a)} vs {teamNames(match.team_b)}. Standings and points recalculate right away.
        </p>
        <div>
          <label className="label" htmlFor="void-match-reason">Reason (optional)</label>
          <input
            id="void-match-reason"
            className="input"
            maxLength={200}
            placeholder="e.g. Wrong winner tapped"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
        {error ? <p role="alert" className="text-body font-semibold text-red-700">{error}</p> : null}
        <div className="grid grid-cols-2 gap-3 pt-1">
          <button
            ref={cancelRef}
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            aria-busy={busy}
            onClick={() => void submit()}
            className="control-feedback min-h-[54px] rounded-[10px] bg-red-700 px-3 text-body font-semibold text-white"
          >
            {busy ? 'Voiding…' : 'Confirm void'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export function LeaderboardView({
  snapshot,
  loading = false,
  error = null,
  period,
  onPeriodChange,
  format,
  onFormatChange,
  tone = 'light',
  showMyStanding = false,
  canScore = false,
  onVoidMatch,
  onLoadPlayerMatches,
  onRetry,
}: LeaderboardViewProps) {
  const dark = tone === 'dark'
  const [tab, setTab] = useState<'standings' | 'matches'>('standings')
  const [selectedEntry, setSelectedEntry] = useState<LeaderboardEntry | null>(null)
  const [playerMatches, setPlayerMatches] = useState<ClubMatch[]>([])
  const [playerMatchesLoading, setPlayerMatchesLoading] = useState(false)
  const [playerMatchesError, setPlayerMatchesError] = useState<string | null>(null)
  const [matchToVoid, setMatchToVoid] = useState<ClubMatch | null>(null)

  async function openPlayer(entry: LeaderboardEntry) {
    setSelectedEntry(entry)
    setPlayerMatchesError(null)
    if (onLoadPlayerMatches) {
      setPlayerMatchesLoading(true)
      try {
        const list = await onLoadPlayerMatches(entry.member_id)
        setPlayerMatches(list)
      } catch (cause) {
        setPlayerMatchesError(cause instanceof Error ? cause.message : 'Could not load player matches.')
        setPlayerMatches([])
      } finally {
        setPlayerMatchesLoading(false)
      }
      return
    }
    const fallback = (snapshot?.recent_matches ?? []).filter(
      (match) =>
        match.status === 'completed'
        && (match.team_a.some((p) => p.member_id === entry.member_id)
          || match.team_b.some((p) => p.member_id === entry.member_id)),
    )
    setPlayerMatches(fallback)
    setPlayerMatchesLoading(false)
  }

  // Each filter is one joined bar; the picked part is solid (aria-pressed).
  const filterBar = dark ? 'segmented segmented-dark' : 'segmented'

  const entries = snapshot?.entries ?? []
  const recentMatches = snapshot?.recent_matches ?? []
  const podium = entries.slice(0, 3)

  const standingsPanel = entries.length === 0 ? (
    <section className={`rounded-2xl border p-6 text-center space-y-2 ${dark ? 'border-slate-800 bg-slate-900 text-slate-200' : 'card text-ink'}`}>
      <Trophy className={`mx-auto ${dark ? 'text-slate-400' : 'text-brand-700'}`} size={28} aria-hidden />
      <p className="text-title font-bold">No ranked matches yet</p>
      <p className={`text-body ${dark ? 'text-slate-400' : 'text-slate-600'}`}>
        {period === 'month'
          ? 'No completed matches have been recorded this month for this filter.'
          : 'Matches recorded by club staff will rank players here.'}
      </p>
    </section>
  ) : (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="Top three players">
        {podium.map((entry, idx) => {
          const streak = streakLabel(entry.streak)
          return (
            <button
              key={entry.member_id}
              type="button"
              onClick={() => void openPlayer(entry)}
              style={dark ? undefined : stagger(idx)}
              className={`control-feedback w-full text-left rounded-2xl border p-4 space-y-3 ${
                dark ? 'border-slate-800 bg-slate-900 text-white' : 'enter-rise card'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`pill ${rankBadgeClass(entry.rank, dark)}`}>
                  <Award size={14} aria-hidden /> #{entry.rank}
                </span>
                {streak ? (
                  <span className={`pill ${entry.streak > 0 ? (dark ? 'bg-emerald-500 text-emerald-950' : 'pill-ok') : (dark ? 'bg-slate-800 text-slate-300' : 'pill-muted')}`}>
                    <Flame size={14} aria-hidden /> {streak}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-3 min-w-0">
                <MemberAvatar name={entry.full_name} photoUrl={entry.photo_url} size="md" />
                <div className="min-w-0">
                  <p className="text-subtitle font-bold truncate">{playerLabel(entry)}</p>
                  {entry.nickname && entry.nickname !== entry.full_name ? (
                    <p className={`text-caption truncate ${dark ? 'text-slate-400' : 'text-slate-500'}`}>{entry.full_name}</p>
                  ) : null}
                  <p className={`text-body font-semibold mt-0.5 tabular-nums ${dark ? 'text-brand-200' : 'text-brand-800'}`}>
                    {entry.points} pts
                  </p>
                </div>
              </div>
              <p className={`text-caption tabular-nums ${dark ? 'text-slate-400' : 'text-slate-600'}`}>
                {entry.wins}W–{entry.losses}L · {entry.win_pct}% win · Diff {entry.score_diff >= 0 ? `+${entry.score_diff}` : entry.score_diff}
              </p>
            </button>
          )
        })}
      </div>

      <section className={`rounded-2xl border overflow-hidden ${dark ? 'border-slate-800 bg-slate-900' : 'card'}`} aria-label="Player rankings">
        <div className={`px-4 py-3 border-b flex items-center justify-between gap-2 ${dark ? 'border-slate-800' : 'border-line'}`}>
          <h2 className={`text-subtitle font-semibold ${dark ? 'text-white' : 'text-ink'}`}>
            Standings ({snapshot?.total_players ?? entries.length})
          </h2>
          <span className={`text-caption ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
            {snapshot?.total_matches ?? 0} {snapshot?.total_matches === 1 ? 'match' : 'matches'}
          </span>
        </div>
        <div className={dark ? 'divide-y divide-slate-800' : 'divide-y divide-line'}>
          {entries.map((entry) => {
            const streak = streakLabel(entry.streak)
            const isMe = snapshot?.my_member_id != null && entry.member_id === snapshot.my_member_id
            return (
              <button
                key={entry.member_id}
                type="button"
                onClick={() => void openPlayer(entry)}
                className={`control-feedback w-full text-left px-4 py-3 min-h-[64px] flex items-center gap-3 ${
                  isMe ? (dark ? 'bg-slate-800/80' : 'bg-brand-50') : ''
                }`}
              >
                <span className={`pill shrink-0 tabular-nums ${rankBadgeClass(entry.rank, dark)}`}>
                  #{entry.rank}
                </span>
                <MemberAvatar name={entry.full_name} photoUrl={entry.photo_url} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <p className={`text-subtitle font-semibold truncate ${dark ? 'text-white' : 'text-ink'}`}>
                      {playerLabel(entry)}
                    </p>
                    {isMe ? (
                      <span className={`pill shrink-0 ${dark ? 'bg-brand-500 text-white' : 'pill-brand'}`}>You</span>
                    ) : null}
                    {streak ? (
                      <span className={`pill shrink-0 ${entry.streak > 0 ? (dark ? 'bg-emerald-500 text-emerald-950' : 'pill-ok') : (dark ? 'bg-slate-800 text-slate-300' : 'pill-muted')}`}>
                        {streak}
                      </span>
                    ) : null}
                  </div>
                  <p className={`text-caption tabular-nums mt-0.5 ${dark ? 'text-slate-400' : 'text-slate-600'}`}>
                    {entry.wins}W–{entry.losses}L · {entry.win_pct}% · Diff {entry.score_diff >= 0 ? `+${entry.score_diff}` : entry.score_diff}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className={`text-subtitle font-bold tabular-nums ${dark ? 'text-brand-200' : 'text-brand-800'}`}>
                    {entry.points} pts
                  </p>
                </div>
              </button>
            )
          })}
        </div>
      </section>

      <p className={`text-caption px-1 ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
        Scoring: 3 pts per win, 1 pt per game played. Ties break by wins, win %, point diff, and games played.
      </p>
    </div>
  )

  const matchesPanel = recentMatches.length === 0 ? (
    <section className={`rounded-2xl border p-6 text-center ${dark ? 'border-slate-800 bg-slate-900 text-slate-300' : 'card text-slate-600'}`}>
      <p className="text-body">No matches recorded in this view yet.</p>
    </section>
  ) : (
    <div className="space-y-3" aria-label="Recent games">
      {recentMatches.map((match) => (
        <MatchCard
          key={match.id}
          match={match}
          dark={dark}
          canScore={canScore && !dark}
          onAskVoid={onVoidMatch ? (target) => setMatchToVoid(target) : undefined}
        />
      ))}
    </div>
  )

  return (
    <div className="space-y-4">
      <section className="flex flex-col gap-2 sm:flex-row sm:gap-3" aria-label="Leaderboard filters">
        <div role="group" aria-label="Period" className={filterBar}>
          <button
            type="button"
            aria-pressed={period === 'month'}
            onClick={() => onPeriodChange('month')}
          >
            This month
          </button>
          <button
            type="button"
            aria-pressed={period === 'all'}
            onClick={() => onPeriodChange('all')}
          >
            All time
          </button>
        </div>
        <div role="group" aria-label="Game type" className={filterBar}>
          {([
            ['all', 'All games'],
            ['doubles', 'Doubles'],
            ['singles', 'Singles'],
          ] as Array<[LeaderboardFormatFilter, string]>).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={format === value}
              onClick={() => onFormatChange(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {error && !snapshot ? (
        <section role="alert" className={`rounded-2xl border p-4 space-y-3 ${dark ? 'border-red-500/40 bg-red-950/50 text-red-100' : 'notice notice-error'}`}>
          <p className="text-body font-semibold">{error}</p>
          {onRetry ? (
            <button type="button" onClick={onRetry} className="btn-secondary sm:w-auto! sm:px-6">
              Try again
            </button>
          ) : null}
        </section>
      ) : loading && !snapshot ? (
        <LeaderboardLoading dark={dark} />
      ) : (
        <>
          {showMyStanding && snapshot && !dark ? (
            snapshot.my_entry ? (
              <section className="stat-card space-y-2" aria-label="Your standing">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-caption text-brand-100">Your standing</p>
                    <p className="text-heading-2 font-bold mt-0.5 tabular-nums">
                      Rank #{snapshot.my_entry.rank} · {snapshot.my_entry.points} pts
                    </p>
                    <p className="text-body text-brand-100 mt-1 tabular-nums">
                      {snapshot.my_entry.wins}W–{snapshot.my_entry.losses}L · {snapshot.my_entry.win_pct}% win
                      {streakLabel(snapshot.my_entry.streak) ? ` · Streak ${streakLabel(snapshot.my_entry.streak)}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void openPlayer(snapshot.my_entry!)}
                    className="control-feedback min-h-12 shrink-0 rounded-xl bg-white px-4 text-body font-semibold text-brand-900"
                  >
                    My games
                  </button>
                </div>
              </section>
            ) : snapshot.my_member_id ? (
              <section className="card p-4" aria-label="Your standing">
                <p className="text-subtitle font-semibold text-ink">Your standing</p>
                <p className="text-body text-slate-600 mt-1">
                  You have no completed matches in this view yet. Join open play or ask staff to log your next game.
                </p>
              </section>
            ) : null
          ) : null}

          {dark ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
              <div>{standingsPanel}</div>
              <div className="space-y-3">
                <h2 className="text-title font-bold text-white px-1">Recent games</h2>
                {matchesPanel}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-tabs text-tabs-fill" role="tablist" aria-label="Leaderboard views">
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
                  aria-selected={tab === 'matches'}
                  onClick={() => setTab('matches')}
                >
                  Recent games ({recentMatches.length})
                </button>
              </div>
              {tab === 'standings' ? standingsPanel : matchesPanel}
            </div>
          )}
        </>
      )}

      {!dark ? (
        <>
          <PlayerMatchesDialog
            entry={selectedEntry}
            matches={playerMatches}
            loading={playerMatchesLoading}
            error={playerMatchesError}
            onClose={() => setSelectedEntry(null)}
          />
          <VoidMatchDialog
            match={matchToVoid}
            onCancel={() => setMatchToVoid(null)}
            onConfirm={async (matchId, reason) => {
              if (!onVoidMatch) return
              await onVoidMatch(matchId, reason)
            }}
          />
        </>
      ) : null}
    </div>
  )
}

/** Public club detail preview card showing top 5 ranked players and a link to the full leaderboard. */
export function ClubLeaderboardPreviewCard({
  clubSlug,
  clubName,
  snapshot,
  index = 0,
}: {
  clubSlug: string
  clubName: string
  snapshot: ClubLeaderboardSnapshot | null
  index?: number
}) {
  const topFive = snapshot?.entries.slice(0, 5) ?? []
  return (
    <section
      className="enter-rise card p-4 space-y-3 sm:p-5"
      style={stagger(index)}
      aria-labelledby="club-leaderboard-preview-heading"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="club-leaderboard-preview-heading" className="text-heading-3 font-semibold text-ink">
            Leaderboard
          </h2>
          <p className="text-subtitle font-normal text-muted">
            This month · {clubName}
          </p>
        </div>
        <Trophy size={22} className="shrink-0 text-brand-700 mt-1" aria-hidden />
      </div>

      {topFive.length === 0 ? (
        <p className="text-subtitle text-muted">
          No matches recorded this month yet. Check back after the next open play or club match.
        </p>
      ) : (
        <ol className="divide-y divide-line">
          {topFive.map((entry) => (
            <li key={entry.member_id} className="flex items-center gap-3 py-2.5">
              <span className={`pill shrink-0 tabular-nums ${rankBadgeClass(entry.rank, false)}`}>
                #{entry.rank}
              </span>
              <MemberAvatar name={entry.full_name} photoUrl={entry.photo_url} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-subtitle font-semibold text-ink truncate">{playerLabel(entry)}</p>
                <p className="text-caption text-muted tabular-nums">
                  {entry.wins}W–{entry.losses}L · {entry.win_pct}% win
                </p>
              </div>
              <span className="text-subtitle font-bold text-brand-800 shrink-0 tabular-nums">
                {entry.points} pts
              </span>
            </li>
          ))}
        </ol>
      )}

      <Link
        to={`/clubs/${clubSlug}/leaderboard`}
        className="btn-secondary sm:w-auto! sm:px-6"
      >
        <span>{topFive.length > 0 ? 'See full leaderboard' : 'Open leaderboard'}</span>
        <ChevronRight size={16} aria-hidden />
      </Link>
    </section>
  )
}
