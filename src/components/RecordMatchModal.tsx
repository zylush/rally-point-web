import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Search, X } from 'lucide-react'
import { api } from '../lib/api'
import { useModalDialog } from '../lib/useModalDialog'
import type { ClubMatch, Court, MatchFormat, MatchSide, Member, RecordMatchInput } from '../types'

interface RecordMatchModalProps {
  open: boolean
  onClose: () => void
  onRecord: (input: RecordMatchInput) => Promise<ClubMatch>
}

export function RecordMatchModal({ open, onClose, onRecord }: RecordMatchModalProps) {
  const [roster, setRoster] = useState<Member[]>([])
  const [courts, setCourts] = useState<Court[]>([])
  const [loadingLists, setLoadingLists] = useState(false)
  const [format, setFormat] = useState<MatchFormat>('doubles')
  const [search, setSearch] = useState('')
  const [teamA1, setTeamA1] = useState('')
  const [teamA2, setTeamA2] = useState('')
  const [teamB1, setTeamB1] = useState('')
  const [teamB2, setTeamB2] = useState('')
  const [scoreA, setScoreA] = useState('')
  const [scoreB, setScoreB] = useState('')
  const [courtId, setCourtId] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState<MatchSide | null>(null)
  const [error, setError] = useState<string | null>(null)

  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    let active = true
    setError(null)
    setSearch('')
    setTeamA1('')
    setTeamA2('')
    setTeamB1('')
    setTeamB2('')
    setScoreA('')
    setScoreB('')
    setCourtId('')
    setNotes('')
    setSubmitting(null)
    setLoadingLists(true)
    void Promise.all([
      api.memberRoster(),
      typeof api.listCourts === 'function' ? api.listCourts() : Promise.resolve([] as Court[]),
    ])
      .then(([members, courtList]) => {
        if (!active) return
        setRoster(members)
        setCourts(courtList)
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not load club players.')
      })
      .finally(() => {
        if (active) setLoadingLists(false)
      })
    return () => {
      active = false
    }
  }, [open])

  useModalDialog(open, {
    dialogRef,
    initialFocusRef: closeRef,
    onEscape: () => {
      if (!submitting) onClose()
    },
    lockScroll: true,
  })

  const filteredRoster = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return roster
    return roster.filter(
      (m) => m.full_name.toLowerCase().includes(q) || m.member_code.toLowerCase().includes(q),
    )
  }, [roster, search])

  if (!open) return null

  const picked = new Set(
    (format === 'doubles' ? [teamA1, teamA2, teamB1, teamB2] : [teamA1, teamB1]).filter(Boolean),
  )

  const optionsFor = (currentValue: string) => {
    const base = filteredRoster.filter((m) => m.id === currentValue || !picked.has(m.id))
    if (currentValue && !base.some((m) => m.id === currentValue)) {
      const selected = roster.find((m) => m.id === currentValue)
      if (selected) return [selected, ...base]
    }
    return base
  }

  async function submit(winnerSide: MatchSide) {
    if (submitting) return
    const teamA = format === 'doubles' ? [teamA1, teamA2] : [teamA1]
    const teamB = format === 'doubles' ? [teamB1, teamB2] : [teamB1]
    if (teamA.some((id) => !id) || teamB.some((id) => !id)) {
      setError(`Choose ${format === 'doubles' ? '2 players' : '1 player'} for each team.`)
      return
    }
    if (new Set([...teamA, ...teamB]).size !== teamA.length + teamB.length) {
      setError('Choose different players for each spot.')
      return
    }

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
        setError('Scores must be whole numbers from 0 to 99.')
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
      await onRecord({
        format,
        team_a: teamA,
        team_b: teamB,
        winner_side: winnerSide,
        score_a: parsedA,
        score_b: parsedB,
        court_id: courtId || null,
        notes: notes.trim() || null,
      })
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not record match.')
    } finally {
      setSubmitting(null)
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-slate-950/50 p-3 sm:p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="record-match-title"
        className="card w-full max-w-lg max-h-[90dvh] flex flex-col overflow-hidden bg-white"
      >
        <div className="flex items-center justify-between gap-3 border-b border-line p-4">
          <div>
            <h2 id="record-match-title" className="text-title font-bold text-ink">
              Record match result
            </h2>
            <p className="text-caption text-slate-600">
              Pick the players, then tap the winning team to update rankings right away.
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            disabled={Boolean(submitting)}
            onClick={onClose}
            aria-label="Close record match dialog"
            className="control-feedback inline-flex min-h-12 min-w-12 items-center justify-center rounded-xl border border-slate-200 text-slate-700"
          >
            <X size={20} aria-hidden />
          </button>
        </div>

        <div className="overflow-y-auto p-4 space-y-4">
          {/* One joined bar; the picked format is the navy part (aria-pressed). */}
          <div className="segmented" role="group" aria-label="Match format">
            <button
              type="button"
              aria-pressed={format === 'doubles'}
              onClick={() => setFormat('doubles')}
            >
              Doubles (2 vs 2)
            </button>
            <button
              type="button"
              aria-pressed={format === 'singles'}
              onClick={() => setFormat('singles')}
            >
              Singles (1 vs 1)
            </button>
          </div>

          <div>
            <label className="label" htmlFor="record-player-search">Search club players</label>
            <div className="relative">
              <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
              <input
                id="record-player-search"
                type="search"
                className="input input-with-icon"
                placeholder="Type a name or member code…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </div>

          {loadingLists ? (
            <p role="status" className="text-body text-slate-600">Loading players and courts…</p>
          ) : (
            <div className="space-y-3">
              <fieldset className="rounded-2xl border border-line p-3 space-y-2.5">
                <legend className="px-1 text-subtitle font-semibold text-ink">Team A</legend>
                <div>
                  <label className="label" htmlFor="match-team-a1">
                    {format === 'doubles' ? 'Team A · Player 1' : 'Team A · Player'}
                  </label>
                  <select
                    id="match-team-a1"
                    className="input"
                    value={teamA1}
                    onChange={(event) => setTeamA1(event.target.value)}
                  >
                    <option value="">Choose player…</option>
                    {optionsFor(teamA1).map((m) => (
                      <option key={m.id} value={m.id}>{m.full_name} ({m.member_code})</option>
                    ))}
                  </select>
                </div>
                {format === 'doubles' ? (
                  <div>
                    <label className="label" htmlFor="match-team-a2">Team A · Player 2</label>
                    <select
                      id="match-team-a2"
                      className="input"
                      value={teamA2}
                      onChange={(event) => setTeamA2(event.target.value)}
                    >
                      <option value="">Choose partner…</option>
                      {optionsFor(teamA2).map((m) => (
                        <option key={m.id} value={m.id}>{m.full_name} ({m.member_code})</option>
                      ))}
                    </select>
                  </div>
                ) : null}
              </fieldset>

              <fieldset className="rounded-2xl border border-line p-3 space-y-2.5">
                <legend className="px-1 text-subtitle font-semibold text-ink">Team B</legend>
                <div>
                  <label className="label" htmlFor="match-team-b1">
                    {format === 'doubles' ? 'Team B · Player 1' : 'Team B · Player'}
                  </label>
                  <select
                    id="match-team-b1"
                    className="input"
                    value={teamB1}
                    onChange={(event) => setTeamB1(event.target.value)}
                  >
                    <option value="">Choose player…</option>
                    {optionsFor(teamB1).map((m) => (
                      <option key={m.id} value={m.id}>{m.full_name} ({m.member_code})</option>
                    ))}
                  </select>
                </div>
                {format === 'doubles' ? (
                  <div>
                    <label className="label" htmlFor="match-team-b2">Team B · Player 2</label>
                    <select
                      id="match-team-b2"
                      className="input"
                      value={teamB2}
                      onChange={(event) => setTeamB2(event.target.value)}
                    >
                      <option value="">Choose partner…</option>
                      {optionsFor(teamB2).map((m) => (
                        <option key={m.id} value={m.id}>{m.full_name} ({m.member_code})</option>
                      ))}
                    </select>
                  </div>
                ) : null}
              </fieldset>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="match-score-a">Team A score (optional)</label>
              <input
                id="match-score-a"
                type="number"
                inputMode="numeric"
                min={0}
                max={99}
                placeholder="e.g. 11"
                className="input"
                value={scoreA}
                onChange={(event) => setScoreA(event.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="match-score-b">Team B score (optional)</label>
              <input
                id="match-score-b"
                type="number"
                inputMode="numeric"
                min={0}
                max={99}
                placeholder="e.g. 7"
                className="input"
                value={scoreB}
                onChange={(event) => setScoreB(event.target.value)}
              />
            </div>
          </div>

          {courts.length > 0 ? (
            <div>
              <label className="label" htmlFor="match-court">Court (optional)</label>
              <select
                id="match-court"
                className="input"
                value={courtId}
                onChange={(event) => setCourtId(event.target.value)}
              >
                <option value="">Not specified</option>
                {courts.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          ) : null}

          <div>
            <label className="label" htmlFor="match-notes">Note (optional)</label>
            <input
              id="match-notes"
              className="input"
              maxLength={200}
              placeholder="e.g. Open play round 3"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>

          {error ? <p role="alert" className="text-body font-semibold text-red-700">{error}</p> : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 pt-1">
            <button
              type="button"
              disabled={loadingLists || Boolean(submitting)}
              aria-busy={submitting === 'a'}
              onClick={() => void submit('a')}
              className="btn-primary min-h-14"
            >
              <Check size={18} aria-hidden />
              {submitting === 'a' ? 'Saving Team A…' : 'Team A won'}
            </button>
            <button
              type="button"
              disabled={loadingLists || Boolean(submitting)}
              aria-busy={submitting === 'b'}
              onClick={() => void submit('b')}
              className="btn-primary min-h-14"
            >
              <Check size={18} aria-hidden />
              {submitting === 'b' ? 'Saving Team B…' : 'Team B won'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
