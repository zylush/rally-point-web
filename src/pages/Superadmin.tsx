import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Building2, Coins, LifeBuoy, Plus, RefreshCw, TrendingUp, Users } from 'lucide-react'
import { AppHeader, AppShell, LoadingBlock, SignOutButton } from '../components/Shell'
import { LoadingShapes, SkeletonBlock, SkeletonLine } from '../components/Skeleton'
import { api, summarizePlatform } from '../lib/api'
import { stagger } from '../lib/motion'
import { DEFAULT_CLUB_SLUG } from '../lib/tenant'
import type {
  ClubStatus,
  PlatformAction,
  PlatformClub,
  PlatformClubAdmin,
  PlatformCommission,
  ProvisionClubInput,
  SupportSession,
  SupportSnapshot,
} from '../types'
import { fmtDateTime, fmtTime, peso } from '../types'

export type SuperadminSection = 'overview' | 'clubs' | 'ledger'

type Notice = { tone: 'ok' | 'error'; text: string } | null

const statusLabel: Record<ClubStatus, string> = {
  provisioning: 'In setup',
  active: 'Active',
  suspended: 'Suspended',
}

const statusStyle: Record<ClubStatus, string> = {
  provisioning: 'bg-amber-100 text-amber-900',
  active: 'bg-emerald-100 text-emerald-900',
  suspended: 'bg-slate-200 text-slate-800',
}

const sectionTitle: Record<SuperadminSection, string> = {
  overview: 'Platform overview',
  clubs: 'Clubs',
  ledger: 'Commission ledger',
}

function errorText(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

function joinLink(slug: string) {
  return `#/join/${slug}`
}

/**
 * The platform superadmin portal. Every action goes through audited platform
 * functions; this page never reads a club's member or booking records.
 */
export function SuperadminPage({ section = 'overview' }: { section?: SuperadminSection }) {
  const [clubs, setClubs] = useState<PlatformClub[]>([])
  const [ledger, setLedger] = useState<PlatformCommission[]>([])
  const [actions, setActions] = useState<PlatformAction[]>([])
  const [supportSessions, setSupportSessions] = useState<SupportSession[]>([])
  const [ledgerClub, setLedgerClub] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  const [showSetup, setShowSetup] = useState(false)

  const load = useCallback(async () => {
    try {
      const [clubRows, ledgerRows, actionRows, sessionRows] = await Promise.all([
        api.platformClubs(),
        api.platformLedger(ledgerClub || null, 200),
        api.platformRecentActions(20),
        api.mySupportSessions(),
      ])
      setClubs(clubRows)
      setLedger(ledgerRows)
      setActions(actionRows)
      setSupportSessions(sessionRows)
    } catch (error) {
      setNotice({ tone: 'error', text: errorText(error, 'Could not load platform information.') })
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [ledgerClub])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * Runs one platform action, then reloads so every figure reflects it.
   * Resolves to null when it worked, or to the error text. Dialogs pass
   * `inline` and show the error themselves, because they cover the page notice.
   */
  async function run(action: () => Promise<unknown>, success: string, { inline = false } = {}) {
    setNotice(null)
    try {
      await action()
      setNotice({ tone: 'ok', text: success })
      await load()
      return null
    } catch (error) {
      const text = errorText(error, 'That did not work. Please try again.')
      if (!inline) setNotice({ tone: 'error', text })
      return text
    }
  }

  return (
    <AppShell role="superadmin">
      <AppHeader
        title={sectionTitle[section]}
        subtitle="Rally Point platform"
        right={
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-secondary min-h-12"
              onClick={() => {
                setRefreshing(true)
                void load()
              }}
              disabled={refreshing}
              aria-busy={refreshing}
            >
              <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} aria-hidden />
              Refresh
            </button>
            <SignOutButton />
          </div>
        }
      />

      <main className="safe-bottom app-content-rail space-y-4 px-4 pt-4">
        {notice ? (
          <p
            role={notice.tone === 'error' ? 'alert' : 'status'}
            className={`rounded-2xl p-4 text-base font-semibold ${
              notice.tone === 'error' ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-900'
            }`}
          >
            {notice.text}
          </p>
        ) : null}

        {loading ? (
          section === 'overview' ? (
            <OverviewLoading />
          ) : (
            <LoadingBlock label={section === 'clubs' ? 'Loading clubs…' : 'Loading the commission ledger…'} />
          )
        ) : section === 'overview' ? (
          <Overview clubs={clubs} actions={actions} />
        ) : section === 'clubs' ? (
          <ClubDirectory
            clubs={clubs}
            openSession={supportSessions.find((session) => session.is_open) ?? null}
            onSetUp={() => setShowSetup(true)}
            run={run}
          />
        ) : (
          <Ledger clubs={clubs} rows={ledger} clubFilter={ledgerClub} onFilter={setLedgerClub} />
        )}
      </main>

      {showSetup ? (
        <SetUpClubDialog
          onClose={() => setShowSetup(false)}
          onSubmit={async (input) => {
            const error = await run(
              () => api.provisionClub(input),
              `${input.name} is set up. Assign an admin, then activate it.`,
              { inline: true },
            )
            if (!error) setShowSetup(false)
            return error
          }}
        />
      ) : null}
    </AppShell>
  )
}

function RecordedNote() {
  return (
    <p className="text-body text-slate-600">
      Figures come from charges the clubs recorded. Payments are still simulated, so this is not collected money.
    </p>
  )
}

/** Shaped like the overview: four totals, the note, then the clubs and recent-actions cards. */
function OverviewLoading() {
  return (
    <LoadingShapes label="Loading platform overview…">
      <div className="space-y-4" aria-hidden>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((key) => (
            <div key={key} className="card p-4">
              <SkeletonBlock className="h-[22px] w-[22px] rounded-md!" />
              <SkeletonLine className="mt-2 w-4/5" />
              <div className="flex h-8 items-center">
                <div className="skeleton h-6 w-3/5" />
              </div>
            </div>
          ))}
        </div>
        <div>
          <SkeletonLine className="w-full" />
          <SkeletonLine className="w-2/3" />
        </div>
        <div className="card p-4">
          <SkeletonLine size="subtitle" className="w-40" />
          <div className="mt-3 divide-y divide-slate-100">
            {[0, 1].map((key) => (
              <div key={key} className="flex items-center justify-between gap-2 py-3">
                <div className="w-2/5 space-y-1">
                  <SkeletonLine size="subtitle" className="w-full" />
                  <SkeletonBlock className="h-5 w-16 rounded-full!" />
                </div>
                <div className="flex w-2/5 flex-col items-end">
                  <SkeletonLine className="w-full" />
                  <SkeletonLine className="w-4/5" />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="card p-4">
          <SkeletonLine size="subtitle" className="w-52" />
          <div className="mt-3 divide-y divide-slate-100">
            {[0, 1, 2].map((key) => (
              <div key={key} className="py-2.5">
                <SkeletonLine className="w-3/5" />
                <SkeletonLine size="caption" className="w-2/5" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </LoadingShapes>
  )
}

function Overview({ clubs, actions }: { clubs: PlatformClub[]; actions: PlatformAction[] }) {
  const stats = summarizePlatform(clubs)
  const cards: { label: string; value: string; icon: typeof Coins }[] = [
    { label: 'Commission recorded', value: peso(stats.totalCommissionsEarned), icon: Coins },
    { label: 'Court revenue recorded', value: peso(stats.totalGrossVolume), icon: TrendingUp },
    { label: 'Active clubs', value: String(stats.activeClubsCount), icon: Building2 },
    { label: 'Ledger entries', value: String(stats.totalEntriesCount), icon: Users },
  ]
  return (
    <div className="space-y-4">
      <section aria-label="Platform totals" className="enter-rise grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map(({ label, value, icon: Icon }) => (
          <div key={label} className="card p-4">
            <Icon size={22} className="text-brand-700" aria-hidden />
            <p className="mt-2 text-body font-semibold text-slate-600">{label}</p>
            <p className="text-heading-2 font-bold text-slate-900">{value}</p>
          </div>
        ))}
      </section>
      <RecordedNote />

      <section className="enter-rise card p-4" style={stagger(1)} aria-labelledby="club-figures">
        <h2 id="club-figures" className="text-subtitle font-bold text-slate-900">
          Clubs at a glance
        </h2>
        <ul className="mt-3 divide-y divide-slate-100">
          {clubs.map((club) => (
            <li key={club.club_id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div>
                <p className="text-base font-bold text-slate-900">{club.name}</p>
                <StatusBadge status={club.status} />
              </div>
              <div className="text-right text-body text-slate-700">
                <p>Court revenue {peso(club.gross_amount)}</p>
                <p className="font-semibold">Commission {peso(club.commission_amount)}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="enter-rise card p-4" style={stagger(2)} aria-labelledby="recent-actions">
        <h2 id="recent-actions" className="text-subtitle font-bold text-slate-900">
          Recent platform actions
        </h2>
        {actions.length === 0 ? (
          <p className="mt-2 text-body text-slate-600">No platform actions yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {actions.map((action) => (
              <li key={action.id} className="py-2.5 text-body text-slate-700">
                <span className="font-semibold text-slate-900">{describeAction(action)}</span>
                <span className="block text-caption text-slate-500">
                  {action.actor_email ?? 'System'} · {fmtDateTime(action.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function describeAction(action: PlatformAction) {
  const club = action.club_name ?? 'a club'
  const to = typeof action.details.to === 'string' || typeof action.details.to === 'number' ? String(action.details.to) : ''
  switch (action.action) {
    case 'club.provision':
      return `Set up ${club}`
    case 'club.status':
      return `${club} is now ${statusLabel[to as ClubStatus] ?? to}`
    case 'club.commission_rate':
      return `${club} commission set to ${to}%`
    case 'club.admin_assign':
      return `Added an admin to ${club}`
    case 'club.admin_revoke':
      return `Removed an admin from ${club}`
    case 'support.start':
      return `Opened a support view of ${club}`
    case 'support.read':
      return `Looked at ${club} in a support view`
    case 'support.end':
      return `Closed a support view of ${club}`
    case 'platform_role.insert':
      return 'Granted platform access'
    case 'platform_role.delete':
      return 'Removed platform access'
    default:
      return action.action
  }
}

function StatusBadge({ status }: { status: ClubStatus }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-caption font-bold ${statusStyle[status]}`}>
      {statusLabel[status]}
    </span>
  )
}

type Run = (action: () => Promise<unknown>, success: string, options?: { inline?: boolean }) => Promise<string | null>

function ClubDirectory({
  clubs,
  openSession,
  onSetUp,
  run,
}: {
  clubs: PlatformClub[]
  openSession: SupportSession | null
  onSetUp: () => void
  run: Run
}) {
  return (
    <div className="enter-rise space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body text-slate-600">
          New clubs start in setup and stay hidden from players until you activate them.
        </p>
        <button type="button" className="btn-primary min-h-12" onClick={onSetUp}>
          <Plus size={18} aria-hidden /> Set up a club
        </button>
      </div>
      {clubs.map((club) => (
        <ClubCard
          key={club.club_id}
          club={club}
          supportSession={openSession?.club_id === club.club_id ? openSession : null}
          run={run}
        />
      ))}
    </div>
  )
}

function ClubCard({ club, supportSession, run }: { club: PlatformClub; supportSession: SupportSession | null; run: Run }) {
  const [showSupport, setShowSupport] = useState(false)
  const [rate, setRate] = useState(String(club.commission_rate))
  const [adminEmail, setAdminEmail] = useState('')
  const [admins, setAdmins] = useState<PlatformClubAdmin[] | null>(null)
  const [busy, setBusy] = useState(false)
  const isDefault = club.slug === DEFAULT_CLUB_SLUG

  const loadAdmins = useCallback(async () => {
    try {
      setAdmins(await api.platformClubAdmins(club.club_id))
    } catch {
      setAdmins([])
    }
  }, [club.club_id])

  async function act(action: () => Promise<unknown>, success: string) {
    setBusy(true)
    const ok = (await run(action, success)) === null
    setBusy(false)
    if (ok && admins !== null) await loadAdmins()
    return ok
  }

  const statusActions: { label: string; next: ClubStatus }[] =
    club.status === 'active'
      ? isDefault
        ? []
        : [{ label: 'Suspend', next: 'suspended' }]
      : [{ label: club.status === 'provisioning' ? 'Activate' : 'Reactivate', next: 'active' }]

  return (
    <article className="card space-y-4 p-4" aria-labelledby={`club-${club.club_id}`}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={`club-${club.club_id}`} className="text-subtitle font-bold text-slate-900">
            {club.name}
          </h2>
          <StatusBadge status={club.status} />
          {isDefault ? <span className="ml-2 text-caption text-slate-600">Default sign-up club</span> : null}
          <p className="mt-1 text-body text-slate-600">
            Join link: <span className="font-mono text-slate-800">{joinLink(club.slug)}</span>
          </p>
          {club.city || club.contact_email ? (
            <p className="text-body text-slate-600">
              {[club.city, club.contact_email, club.contact_phone].filter(Boolean).join(' · ')}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {statusActions.map(({ label, next }) => (
            <button
              key={label}
              type="button"
              className={next === 'suspended' ? 'btn-secondary min-h-12' : 'btn-primary min-h-12'}
              disabled={busy}
              onClick={() => void act(() => api.setClubStatus(club.club_id, next), `${club.name} is now ${statusLabel[next].toLowerCase()}.`)}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <dl className="grid grid-cols-2 gap-2 text-body sm:grid-cols-4">
        <Figure label="Venues" value={club.venue_count} />
        <Figure label="Courts" value={club.court_count} />
        <Figure label="Members" value={club.member_count} />
        <Figure label="Admins" value={club.admin_count} />
      </dl>

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event: FormEvent) => {
          event.preventDefault()
          void act(() => api.setCommissionRate(club.club_id, Number(rate)), `${club.name} commission set to ${Number(rate)}%.`)
        }}
      >
        <label className="block">
          <span className="label">Commission (%)</span>
          <input
            className="input min-h-12 w-32"
            type="number"
            min={0}
            max={100}
            step="0.01"
            value={rate}
            onChange={(event) => setRate(event.target.value)}
            required
          />
        </label>
        <button type="submit" className="btn-secondary min-h-12" disabled={busy}>
          Save rate
        </button>
      </form>

      <section aria-label={`${club.name} admins`} className="space-y-3">
        {admins === null ? (
          <button type="button" className="btn-secondary min-h-12" onClick={() => void loadAdmins()}>
            Show admins
          </button>
        ) : admins.length === 0 ? (
          <p className="text-body text-slate-600">No admins yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {admins.map((admin) => (
              <li key={admin.user_id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <span className="text-body text-slate-800">
                  <span className="font-semibold">{admin.full_name}</span> · {admin.email}
                </span>
                <button
                  type="button"
                  className="btn-secondary min-h-12"
                  disabled={busy}
                  onClick={() => void act(() => api.revokeClubAdmin(club.club_id, admin.user_id), `${admin.full_name} is no longer an admin of ${club.name}.`)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={async (event: FormEvent) => {
            event.preventDefault()
            const ok = await act(() => api.assignClubAdmin(club.club_id, adminEmail), `${adminEmail.trim()} is now an admin of ${club.name}.`)
            if (ok) {
              setAdminEmail('')
              await loadAdmins()
            }
          }}
        >
          <label className="block min-w-[14rem] flex-1">
            <span className="label">Add an admin by email</span>
            <input
              className="input min-h-12 w-full"
              type="email"
              autoComplete="off"
              value={adminEmail}
              onChange={(event) => setAdminEmail(event.target.value)}
              placeholder="They must sign up first"
              required
            />
          </label>
          <button type="submit" className="btn-primary min-h-12" disabled={busy}>
            Add admin
          </button>
        </form>
      </section>

      <section aria-label={`${club.name} support view`} className="border-t border-slate-100 pt-4" tabIndex={-1} data-return-focus>
        {supportSession ? (
          <SupportPanel
            session={supportSession}
            onEnd={() => run(() => api.endSupportSession(supportSession.id), `Support view of ${club.name} closed.`)}
          />
        ) : (
          <button type="button" className="btn-secondary min-h-12" onClick={() => setShowSupport(true)}>
            <LifeBuoy size={18} aria-hidden /> Open support view
          </button>
        )}
      </section>

      {showSupport ? (
        <SupportDialog
          clubName={club.name}
          onClose={() => setShowSupport(false)}
          onStart={async (reason, minutes) => {
            const error = await run(
              () => api.startSupportSession(club.club_id, reason, minutes),
              `Support view of ${club.name} is open for ${minutes} minutes.`,
              { inline: true },
            )
            if (!error) setShowSupport(false)
            return error
          }}
        />
      ) : null}
    </article>
  )
}

const focusableInDialog =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'

/**
 * Keyboard behaviour for the dialogs on this page: focus the first field, keep
 * Tab inside the dialog, close on Escape, and hand focus back to the button
 * that opened it. If that button is gone, focus moves to its nearest
 * `data-return-focus` area instead.
 */
function useModal<T extends HTMLElement>(onClose: () => void) {
  const dialog = useRef<HTMLDivElement>(null)
  const firstField = useRef<T>(null)
  const close = useRef(onClose)

  useEffect(() => {
    close.current = onClose
  }, [onClose])

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const fallback = opener?.closest<HTMLElement>('[data-return-focus]') ?? null
    firstField.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close.current()
        return
      }
      const box = dialog.current
      if (event.key !== 'Tab' || !box) return
      const items = [...box.querySelectorAll<HTMLElement>(focusableInDialog)]
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const inside = box.contains(document.activeElement)
      if (event.shiftKey && (!inside || document.activeElement === first)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (!inside || document.activeElement === last)) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (opener?.isConnected) opener.focus()
      else if (fallback?.isConnected) fallback.focus()
    }
  }, [])

  return { dialog, firstField }
}

/** A dialog's own error line, scrolled into view because long dialogs scroll on phones. */
function DialogError({ text }: { text: string | null }) {
  const line = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (text) line.current?.scrollIntoView?.({ block: 'nearest' })
  }, [text])
  if (!text) return null
  return (
    <p ref={line} role="alert" className="rounded-xl bg-red-50 p-3 text-base font-semibold text-red-800">
      {text}
    </p>
  )
}

const supportDurations = [15, 30, 60, 120]

/** Asks why a support view is needed and for how long before opening it. */
function SupportDialog({
  clubName,
  onClose,
  onStart,
}: {
  clubName: string
  onClose: () => void
  onStart: (reason: string, minutes: number) => Promise<string | null>
}) {
  const [reason, setReason] = useState('')
  const [minutes, setMinutes] = useState(30)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { dialog, firstField: reasonField } = useModal<HTMLTextAreaElement>(onClose)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center">
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="support-title" className="card w-full max-w-lg p-5">
        <h2 id="support-title" className="text-heading-2 font-bold text-slate-900">
          Support view of {clubName}
        </h2>
        <p className="mt-1 text-body text-slate-600">
          Read-only, for a limited time. Every view is logged, and no member contact details are shown.
        </p>
        <form
          className="mt-4 space-y-3"
          onSubmit={async (event: FormEvent) => {
            event.preventDefault()
            setSaving(true)
            setError(null)
            setError(await onStart(reason, minutes))
            setSaving(false)
          }}
        >
          <label className="block">
            <span className="label">Reason</span>
            <textarea
              ref={reasonField}
              className="input min-h-24 w-full"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              minLength={10}
              maxLength={500}
              required
            />
          </label>
          <label className="block">
            <span className="label">How long</span>
            <select className="input min-h-12 w-full" value={minutes} onChange={(event) => setMinutes(Number(event.target.value))}>
              {supportDurations.map((value) => (
                <option key={value} value={value}>
                  {value < 60 ? `${value} minutes` : value === 60 ? '1 hour' : '2 hours'}
                </option>
              ))}
            </select>
          </label>
          <DialogError text={error} />
          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary min-h-12" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary min-h-12" disabled={saving} aria-busy={saving}>
              {saving ? 'Opening…' : 'Open support view'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/** The read-only club snapshot shown while a support session is open. */
function SupportPanel({ session, onEnd }: { session: SupportSession; onEnd: () => Promise<unknown> }) {
  const [snapshot, setSnapshot] = useState<SupportSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)

  const look = useCallback(async () => {
    setError(null)
    try {
      setSnapshot(await api.supportSnapshot(session.id))
    } catch (err) {
      setError(errorText(err, 'Could not load the support view.'))
    }
  }, [session.id])

  useEffect(() => {
    void look()
  }, [look])

  return (
    <div className="space-y-3 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-base font-bold text-amber-950">Support view open until {fmtTime(session.expires_at)}</p>
          <p className="text-body text-amber-900">Reason: {session.reason}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary min-h-12" onClick={() => void look()}>
            Refresh
          </button>
          <button type="button" className="btn-primary min-h-12" onClick={() => void onEnd()}>
            End support view
          </button>
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-base font-semibold text-red-800">
          {error}
        </p>
      ) : null}
      {snapshot ? (
        <div className="space-y-3 text-body text-slate-800">
          <p>
            Members: {snapshot.members.total} ({snapshot.members.active} active, {snapshot.members.expired} expired) · Staff and
            admins: {snapshot.staff_count}
          </p>
          <p>Venues: {snapshot.venues.map((venue) => `${venue.name} (${venue.courts} courts)`).join(', ') || 'None yet'}</p>
          <div>
            <h3 className="font-bold text-slate-900">Today</h3>
            {snapshot.today.length === 0 ? (
              <p>Nothing scheduled today.</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {snapshot.today.map((block) => (
                  <li key={`${block.kind}-${block.court_name}-${block.start_at}`}>
                    {fmtTime(block.start_at)}–{fmtTime(block.end_at)} · {block.court_name} · {block.kind.replace('_', ' ')} ({block.status})
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="font-bold text-slate-900">Open inquiries</h3>
            {snapshot.open_inquiries.length === 0 ? (
              <p>No open inquiries.</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {snapshot.open_inquiries.map((inquiry) => (
                  <li key={`${inquiry.created_at}-${inquiry.subject}`}>
                    {inquiry.subject} · {inquiry.category} · {inquiry.status === 'in_progress' ? 'In progress' : 'Open'}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <dt className="text-caption font-semibold text-slate-600">{label}</dt>
      <dd className="text-subtitle font-bold text-slate-900">{value}</dd>
    </div>
  )
}

function Ledger({
  clubs,
  rows,
  clubFilter,
  onFilter,
}: {
  clubs: PlatformClub[]
  rows: PlatformCommission[]
  clubFilter: string
  onFilter: (clubId: string) => void
}) {
  return (
    <div className="enter-rise space-y-4">
      <RecordedNote />
      <label className="block max-w-xs">
        <span className="label">Club</span>
        <select className="input min-h-12 w-full" value={clubFilter} onChange={(event) => onFilter(event.target.value)}>
          <option value="">All clubs</option>
          {clubs.map((club) => (
            <option key={club.club_id} value={club.club_id}>
              {club.name}
            </option>
          ))}
        </select>
      </label>
      {rows.length === 0 ? (
        <p className="card p-4 text-body text-slate-600">No commission recorded yet.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.id} className="card flex flex-wrap items-start justify-between gap-3 p-4">
              <div>
                <p className="text-base font-bold text-slate-900">{row.club_name}</p>
                <p className="text-body text-slate-700">{row.description}</p>
                <p className="text-caption text-slate-500">
                  {fmtDateTime(row.created_at)} · {row.commission_rate}% ·{' '}
                  {row.verification_status === 'verified' ? 'Verified' : 'Recorded, not verified'}
                </p>
              </div>
              <div className="text-right text-body">
                <p className="font-bold text-slate-900">Commission {peso(row.commission_amount)}</p>
                <p className="text-slate-600">Charge {peso(row.gross_amount)}</p>
                <p className="text-slate-600">Club keeps {peso(row.club_net_amount)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const emptySetup: ProvisionClubInput = {
  name: '',
  slug: '',
  city: '',
  address: '',
  contact_email: '',
  contact_phone: '',
  commission_rate: 5,
  court_count: 2,
}

function toLinkName(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
}

function SetUpClubDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void
  onSubmit: (input: ProvisionClubInput) => Promise<string | null>
}) {
  const [form, setForm] = useState<ProvisionClubInput>(emptySetup)
  const [linkTouched, setLinkTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { dialog, firstField } = useModal<HTMLInputElement>(onClose)

  function update<K extends keyof ProvisionClubInput>(key: K, value: ProvisionClubInput[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center">
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="setup-club-title"
        className="card max-h-[90dvh] w-full max-w-lg overflow-y-auto p-5"
      >
        <h2 id="setup-club-title" className="text-heading-2 font-bold text-slate-900">
          Set up a club
        </h2>
        <p className="mt-1 text-body text-slate-600">
          It starts in setup with one venue and its courts. Add an admin, then activate it.
        </p>
        <form
          className="mt-4 space-y-3"
          onSubmit={async (event: FormEvent) => {
            event.preventDefault()
            setSaving(true)
            setError(null)
            setError(await onSubmit({ ...form, slug: form.slug || toLinkName(form.name) }))
            setSaving(false)
          }}
        >
          <Field label="Club name">
            <input
              ref={firstField}
              className="input min-h-12 w-full"
              value={form.name}
              onChange={(event) => {
                update('name', event.target.value)
                if (!linkTouched) update('slug', toLinkName(event.target.value))
              }}
              required
            />
          </Field>
          <Field label="Link name" hint={`Players join at ${joinLink(form.slug || 'link-name')}`}>
            <input
              className="input min-h-12 w-full"
              value={form.slug}
              onChange={(event) => {
                setLinkTouched(true)
                update('slug', event.target.value.toLowerCase())
              }}
              pattern="[a-z0-9][a-z0-9-]{1,48}[a-z0-9]"
              title="3 to 50 lowercase letters, numbers or dashes"
              required
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="City">
              <input className="input min-h-12 w-full" value={form.city} onChange={(event) => update('city', event.target.value)} />
            </Field>
            <Field label="Address">
              <input className="input min-h-12 w-full" value={form.address} onChange={(event) => update('address', event.target.value)} />
            </Field>
            <Field label="Contact email">
              <input
                className="input min-h-12 w-full"
                type="email"
                value={form.contact_email}
                onChange={(event) => update('contact_email', event.target.value)}
              />
            </Field>
            <Field label="Contact phone">
              <input
                className="input min-h-12 w-full"
                type="tel"
                value={form.contact_phone}
                onChange={(event) => update('contact_phone', event.target.value)}
              />
            </Field>
            <Field label="Commission (%)">
              <input
                className="input min-h-12 w-full"
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={form.commission_rate}
                onChange={(event) => update('commission_rate', Number(event.target.value))}
                required
              />
            </Field>
            <Field label="Courts">
              <input
                className="input min-h-12 w-full"
                type="number"
                min={1}
                max={12}
                value={form.court_count}
                onChange={(event) => update('court_count', Number(event.target.value))}
                required
              />
            </Field>
          </div>
          <DialogError text={error} />
          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary min-h-12" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary min-h-12" disabled={saving} aria-busy={saving}>
              {saving ? 'Setting up…' : 'Set up club'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  // The hint sits outside the label so the field's accessible name stays short.
  return (
    <div>
      <label className="block">
        <span className="label">{label}</span>
        {children}
      </label>
      {hint ? <p className="mt-1 text-caption text-slate-500">{hint}</p> : null}
    </div>
  )
}
