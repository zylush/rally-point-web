import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Search, Shuffle, Trophy, X } from 'lucide-react'
import { api } from '../lib/api'
import { useModalDialog } from '../lib/useModalDialog'
import type { CreateTournamentInput, Member, TournamentFormat, Venue } from '../types'

interface CreateTournamentModalProps {
  open: boolean
  onClose: () => void
  onCreate: (input: CreateTournamentInput) => Promise<void>
}

export function CreateTournamentModal({ open, onClose, onCreate }: CreateTournamentModalProps) {
  const [roster, setRoster] = useState<Member[]>([])
  const [venues, setVenues] = useState<Venue[]>([])
  const [loadingLists, setLoadingLists] = useState(false)
  const [title, setTitle] = useState('')
  const [format, setFormat] = useState<TournamentFormat>('single_elimination')
  const [teamSize, setTeamSize] = useState<1 | 2>(2)
  const [venueId, setVenueId] = useState('')
  const [countsForLeaderboard, setCountsForLeaderboard] = useState(true)
  const [notes, setNotes] = useState('')
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    let active = true
    setTitle('')
    setFormat('single_elimination')
    setTeamSize(2)
    setVenueId('')
    setCountsForLeaderboard(true)
    setNotes('')
    setSearch('')
    setSelectedIds([])
    setSaving(false)
    setError(null)
    setLoadingLists(true)

    void Promise.all([
      api.memberRoster(),
      typeof api.listVenues === 'function' ? api.listVenues(undefined, 'admin') : Promise.resolve([] as Venue[]),
    ])
      .then(([members, venueList]) => {
        if (!active) return
        setRoster(members)
        setVenues(venueList)
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not load club roster.')
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
      if (!saving) onClose()
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

  const selectedSet = new Set(selectedIds)

  function toggleMember(memberId: string) {
    setSelectedIds((prev) => (prev.includes(memberId) ? prev.filter((id) => id !== memberId) : [...prev, memberId]))
  }

  function pickFirst(count: number) {
    setSelectedIds(roster.slice(0, count).map((m) => m.id))
  }

  async function submit() {
    if (saving) return
    const cleanTitle = title.trim()
    if (!cleanTitle) {
      setError('Enter a tournament title.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onCreate({
        title: cleanTitle,
        format,
        team_size: teamSize,
        venue_id: venueId || null,
        counts_for_leaderboard: countsForLeaderboard,
        notes: notes.trim() || null,
        player_ids: selectedIds,
      })
      onClose()
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : 'Could not create tournament.')
    } finally {
      setSaving(false)
    }
  }

  const modeBtn = (active: boolean) =>
    `control-feedback rounded-xl border p-3 text-left min-h-14 space-y-0.5 ${
      active
        ? 'border-brand-700 bg-brand-50 text-ink'
        : 'border-line bg-white text-ink'
    }`

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 sm:items-center sm:p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget && !saving) onClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-tournament-title"
        tabIndex={-1}
        className="w-full max-w-lg max-h-[90dvh] overflow-y-auto rounded-t-3xl bg-white p-5 space-y-4 sm:rounded-3xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="create-tournament-title" className="text-title font-bold text-ink">
              New tournament
            </h2>
            <p className="text-body text-slate-600">
              Set the format, pick participating players, then randomize teams.
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            disabled={saving}
            onClick={onClose}
            aria-label="Close new tournament form"
            className="min-h-12 min-w-12 rounded-xl border border-line bg-white inline-flex items-center justify-center text-ink"
          >
            <X size={20} aria-hidden />
          </button>
        </div>

        <div>
          <label className="label" htmlFor="tournament-title-input">Tournament title</label>
          <input
            id="tournament-title-input"
            className="input min-h-12"
            placeholder="Saturday Doubles Smash"
            maxLength={120}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <p className="label">Format</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setFormat('single_elimination')}
              className={modeBtn(format === 'single_elimination')}
            >
              <span className="flex items-center gap-1.5 text-subtitle font-semibold">
                <Trophy size={16} aria-hidden /> Single-elimination bracket
              </span>
              <span className="block text-caption text-slate-600">
                Random teams & knockout tree
              </span>
            </button>
            <button
              type="button"
              onClick={() => setFormat('random_queue')}
              className={modeBtn(format === 'random_queue')}
            >
              <span className="flex items-center gap-1.5 text-subtitle font-semibold">
                <Shuffle size={16} aria-hidden /> Random queue mixer
              </span>
              <span className="block text-caption text-slate-600">
                Random court rotation each game
              </span>
            </button>
          </div>
        </div>

        <div>
          <p id="tournament-team-size-label" className="label">Team size</p>
          <div className="segmented" role="group" aria-labelledby="tournament-team-size-label">
            <button
              type="button"
              aria-pressed={teamSize === 2}
              onClick={() => setTeamSize(2)}
            >
              Doubles (2v2)
            </button>
            <button
              type="button"
              aria-pressed={teamSize === 1}
              onClick={() => setTeamSize(1)}
            >
              Singles (1v1)
            </button>
          </div>
        </div>

        {venues.length > 0 ? (
          <div>
            <label className="label" htmlFor="tournament-venue-select">Location (optional)</label>
            <select
              id="tournament-venue-select"
              className="input min-h-12"
              value={venueId}
              onChange={(e) => setVenueId(e.target.value)}
            >
              <option value="">All club locations</option>
              {venues.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </div>
        ) : null}

        <label className="flex items-center gap-3 min-h-12 rounded-xl border border-line px-3 py-2 cursor-pointer">
          <input
            type="checkbox"
            checked={countsForLeaderboard}
            onChange={(e) => setCountsForLeaderboard(e.target.checked)}
            className="h-5 w-5 rounded border-field accent-brand-700"
          />
          <span className="text-body font-medium text-ink">
            Count matches toward the club leaderboard
          </span>
        </label>

        <div>
          <label className="label" htmlFor="tournament-notes-input">Notes (optional)</label>
          <input
            id="tournament-notes-input"
            className="input min-h-12"
            placeholder="First to 11, rally scoring"
            maxLength={240}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <div className="space-y-2 border-t border-line pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-subtitle font-semibold text-ink">
              Participating players ({selectedIds.length} selected)
            </p>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => pickFirst(4)}
                className="min-h-12 rounded-xl border border-line bg-white px-3 text-caption font-semibold text-ink"
              >
                Pick 4
              </button>
              <button
                type="button"
                onClick={() => pickFirst(8)}
                className="min-h-12 rounded-xl border border-line bg-white px-3 text-caption font-semibold text-ink"
              >
                Pick 8
              </button>
              {selectedIds.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setSelectedIds([])}
                  className="min-h-12 rounded-xl border border-line bg-white px-3 text-caption font-semibold text-slate-600"
                >
                  Clear
                </button>
              ) : null}
            </div>
          </div>

          <div className="relative">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              type="search"
              aria-label="Search club players"
              placeholder="Search players by name or code…"
              className="input pl-10 min-h-12"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {loadingLists ? (
            <p className="text-body text-slate-500 py-2">Loading club players…</p>
          ) : (
            <div className="max-h-52 overflow-y-auto divide-y divide-line rounded-xl border border-line">
              {filteredRoster.length === 0 ? (
                <p className="p-3 text-body text-slate-500">No players match your search.</p>
              ) : (
                filteredRoster.map((member) => {
                  const checked = selectedSet.has(member.id)
                  return (
                    <label
                      key={member.id}
                      className="flex items-center gap-3 px-3 py-2.5 min-h-12 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleMember(member.id)}
                        className="h-5 w-5 rounded border-field accent-brand-700"
                      />
                      <span className="flex-1 min-w-0">
                        <span className="block text-body font-semibold text-ink truncate">{member.full_name}</span>
                        <span className="block text-caption text-slate-500">{member.member_code}</span>
                      </span>
                    </label>
                  )
                })
              )}
            </div>
          )}
        </div>

        {error ? (
          <p role="alert" className="text-body font-semibold text-red-700">{error}</p>
        ) : null}

        <button
          type="button"
          disabled={saving}
          aria-busy={saving}
          onClick={() => void submit()}
          className="btn-primary min-h-14"
        >
          <Check size={18} aria-hidden />
          {saving ? 'Creating…' : 'Create tournament'}
        </button>
      </div>
    </div>,
    document.body,
  )
}
