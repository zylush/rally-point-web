import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  BarChart3,
  Building2,
  CalendarDays,
  ChevronRight,
  Clock3,
  Coins,
  Home,
  ReceiptText,
  RefreshCw,
  Shuffle,
  Tv,
  Trophy,
  UserCog,
  Users,
  WalletCards,
} from 'lucide-react'
import { AppHeader, AppShell, SignOutButton } from '../components/Shell'
import { LoadingShapes, SkeletonBlock, SkeletonLine } from '../components/Skeleton'
import {
  AttentionList,
  FactList,
  Section,
  SortableTable,
  StatCard,
  UpdatedStamp,
} from '../components/dashboard'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { addDays, bookingStatusLabel, phDay, rangeInstants, sum, type ClubAnalytics } from '../lib/analytics'
import { stagger } from '../lib/motion'
import { isDemoMode } from '../lib/supabase'
import type { Booking, Court, DashboardStats, Transaction } from '../types'
import { appHour, fmtDateTime, fmtTime, peso } from '../types'

/** Figures refresh on their own this often while the page is open. */
const REFRESH_MS = 60_000

/** Runs an optional read; a failure only hides its part of the page. */
async function optional<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read()
  } catch {
    return null
  }
}

interface HomeData {
  stats: DashboardStats
  transactions: Transaction[]
  analytics: ClubAnalytics | null
  toConfirm: Booking[] | null
  today: Booking[] | null
  courts: Court[] | null
}

function greeting(now: Date) {
  const hour = appHour(now.toISOString())
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
}

function todayLabel(now: Date) {
  return now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'Asia/Manila' })
}

const HELD: Booking['status'][] = ['confirmed', 'completed', 'no_show']

/** Shaped like the dashboard: greeting, four today cards, then two wide cards. */
function AdminHomeLoading() {
  return (
    <LoadingShapes label="Loading admin home…">
      <div className="space-y-4" aria-hidden>
        <div>
          <SkeletonLine size="title" className="w-48" />
          <SkeletonLine size="caption" className="w-64" />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((key) => (
            <div key={key} className="card p-4">
              <SkeletonLine className="w-3/5" />
              <div className="mt-2 flex h-9 items-center">
                <div className="skeleton h-7 w-2/5" />
              </div>
              <SkeletonLine size="caption" className="mt-3 w-4/5" />
              <SkeletonLine size="caption" className="w-3/5" />
            </div>
          ))}
        </div>
        <SkeletonBlock className="h-40 w-full rounded-[12px]!" />
        <SkeletonBlock className="h-56 w-full rounded-[12px]!" />
      </div>
    </LoadingShapes>
  )
}

export function AdminHome() {
  const { user, activeClub } = useAuth()
  const [data, setData] = useState<HomeData | null>(null)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [stale, setStale] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    const now = new Date()
    const today = rangeInstants({ from: phDay(now), to: phDay(now), days: 1 })
    try {
      const [stats, transactions, analytics, toConfirm, todayBookings, courts] = await Promise.all([
        api.stats(),
        api.transactions(),
        optional(() => api.clubAnalytics(30)),
        optional(() => api.paymentsToConfirm()),
        optional(() => api.bookingsBetween(today.from, today.to)),
        optional(() => api.listCourts()),
      ])
      setData({ stats, transactions, analytics, toConfirm, today: todayBookings, courts })
      setUpdatedAt(new Date())
      setStale(false)
    } catch {
      // Keep the last figures on screen and say they are not current.
      setStale(true)
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [load])

  return (
    <AppShell role="admin">
      <AppHeader
        title="Admin home"
        subtitle={user?.full_name}
        right={
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-secondary min-h-12 w-auto! px-3"
              onClick={() => {
                setRefreshing(true)
                void load()
              }}
              disabled={refreshing}
              aria-busy={refreshing}
              aria-label="Refresh figures"
            >
              <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} aria-hidden />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <SignOutButton />
          </div>
        }
      />
      <main className="safe-bottom space-y-5 px-4 pt-4">
        {!data ? (
          stale ? (
            <p role="alert" className="rounded-2xl bg-red-50 p-4 text-base font-semibold text-red-800">
              We could not load the dashboard. Check your connection and press Refresh.
            </p>
          ) : (
            <AdminHomeLoading />
          )
        ) : (
          <Dashboard data={data} clubName={activeClub?.name ?? null} updatedAt={updatedAt} stale={stale} />
        )}
      </main>
    </AppShell>
  )
}

function Dashboard({ data, clubName, updatedAt, stale }: { data: HomeData; clubName: string | null; updatedAt: Date | null; stale: boolean }) {
  const { stats, analytics, toConfirm, courts } = data
  const now = new Date()
  const todayKey = phDay(now)
  const yesterday = analytics?.by_day.find((day) => day.day === addDays(todayKey, -1)) ?? null
  const todayBookings = (data.today ?? []).filter((booking) => phDay(booking.start_at) === todayKey)
  const held = todayBookings.filter((booking) => HELD.includes(booking.status))
  const waiting = todayBookings.filter((booking) => booking.status === 'pending_payment')
  const upcoming = todayBookings
    .filter((booking) => booking.status !== 'cancelled' && new Date(booking.end_at) > now)
    .sort((a, b) => a.start_at.localeCompare(b.start_at))
    .slice(0, 5)
  const overdue = (toConfirm ?? []).filter((booking) => booking.confirm_by && new Date(booking.confirm_by) < now)
  const outOfService = (courts ?? []).filter((court) => court.status === 'maintenance')
  const chargesLabel = isDemoMode ? 'Revenue today' : 'Recorded charges today'
  const last7 = analytics ? analytics.by_day.slice(-7) : []

  const attention = [
    toConfirm && toConfirm.length > 0
      ? {
          key: 'payments',
          tone: overdue.length > 0 ? ('danger' as const) : ('warn' as const),
          title: toConfirm.length === 1 ? '1 GCash payment to check' : `${toConfirm.length} GCash payments to check`,
          detail: overdue.length > 0 ? `${overdue.length} waiting longer than they should` : 'Players are waiting for your answer',
          count: toConfirm.length,
          to: '/admin/bookings',
        }
      : null,
    analytics && analytics.members.ending_soon > 0
      ? {
          key: 'memberships',
          tone: 'brand' as const,
          title: analytics.members.ending_soon === 1 ? '1 membership ends this week' : `${analytics.members.ending_soon} memberships end this week`,
          detail: 'A reminder now helps them renew on time',
          count: analytics.members.ending_soon,
          to: '/admin/members',
        }
      : null,
    outOfService.length > 0
      ? {
          key: 'courts',
          tone: 'warn' as const,
          title: outOfService.length === 1 ? `${outOfService[0].name} is out of service` : `${outOfService.length} courts are out of service`,
          detail: 'Players cannot book them until you put them back',
          count: outOfService.length,
          to: '/admin/venues',
        }
      : null,
  ].filter((item): item is NonNullable<typeof item> => item !== null)

  return (
    <>
      <section className="enter-rise flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-title font-semibold text-ink">
            {greeting(now)}
            {clubName ? `, ${clubName}` : ''}
          </p>
          <p className="text-body text-muted">{todayLabel(now)}</p>
        </div>
        <UpdatedStamp at={updatedAt} stale={stale} />
      </section>

      <section aria-label="Today" className="enter-rise grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" style={stagger(1)}>
        <div className="card p-4 sm:p-5">
          <div className="flex items-start justify-between gap-2">
            <p className="text-body font-semibold text-slate-600">{chargesLabel}</p>
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-ok" aria-hidden>
              <Coins size={20} />
            </span>
          </div>
          <p className="mt-1 text-heading-2 font-bold tabular-nums text-ink">{peso(stats.revenue_today)}</p>
          {analytics ? (
            <div className="mt-3">
              <FactList
                facts={[
                  ...(yesterday ? [{ label: 'Yesterday', value: peso(yesterday.charges) }] : []),
                  { label: 'Last 7 days', value: peso(sum(last7.map((day) => day.charges))) },
                ]}
              />
            </div>
          ) : null}
        </div>

        <div className="card p-4 sm:p-5">
          <div className="flex items-start justify-between gap-2">
            <p className="text-body font-semibold text-slate-600">Bookings today</p>
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700" aria-hidden>
              <CalendarDays size={20} />
            </span>
          </div>
          <p className="mt-1 text-heading-2 font-bold tabular-nums text-ink">{data.today ? held.length : '—'}</p>
          <div className="mt-3">
            <FactList
              facts={[
                { label: 'Court hours booked', value: data.today ? sum(held.map((booking) => booking.hours)) : '—' },
                { label: 'Waiting for payment', value: data.today ? waiting.length : '—' },
                { label: 'Playing now', value: stats.active_now },
              ]}
            />
          </div>
        </div>

        <Link to="/admin/bookings" className="card control-feedback block p-4 sm:p-5">
          <div className="flex items-start justify-between gap-2">
            <p className="text-body font-semibold text-slate-600">Payments to check</p>
            <span
              className={`grid size-10 shrink-0 place-items-center rounded-xl ${
                overdue.length > 0 ? 'bg-red-50 text-danger' : 'bg-amber-50 text-warn'
              }`}
              aria-hidden
            >
              <WalletCards size={20} />
            </span>
          </div>
          <p className="mt-1 text-heading-2 font-bold tabular-nums text-ink">{toConfirm ? toConfirm.length : '—'}</p>
          <div className="mt-3">
            <FactList
              facts={[
                { label: 'Overdue', value: toConfirm ? overdue.length : '—', strong: overdue.length > 0 },
                { label: 'Open the bookings desk', value: <ChevronRight size={18} aria-hidden className="text-slate-400" /> },
              ]}
            />
          </div>
        </Link>

        <div className="card p-4 sm:p-5">
          <div className="flex items-start justify-between gap-2">
            <p className="text-body font-semibold text-slate-600">Members</p>
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-ink" aria-hidden>
              <Users size={20} />
            </span>
          </div>
          <p className="mt-1 text-heading-2 font-bold tabular-nums text-ink">{stats.members}</p>
          {analytics ? (
            <div className="mt-3">
              <FactList
                facts={[
                  { label: 'Active memberships', value: analytics.members.active_members },
                  { label: 'Ending within 7 days', value: analytics.members.ending_soon, indent: true },
                  { label: 'Players without one', value: analytics.members.players },
                ]}
              />
            </div>
          ) : null}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[2fr_3fr]">
        <Section title="Needs attention" icon={Clock3} id="needs-attention">
          <AttentionList items={attention} empty="Nothing needs you right now." />
        </Section>

        <Section
          title="Next bookings today"
          icon={CalendarDays}
          id="next-bookings"
          actions={
            <Link to="/admin/board" className="control-feedback inline-flex min-h-12 items-center px-2 text-body font-semibold text-brand-700">
              Schedule
            </Link>
          }
        >
          {!data.today ? (
            <p className="text-body text-muted">Bookings could not load. Press Refresh to try again.</p>
          ) : upcoming.length === 0 ? (
            <p className="text-body text-muted">No more bookings today.</p>
          ) : (
            <ul className="divide-y divide-line">
              {upcoming.map((booking) => (
                <li key={booking.id} className="flex min-h-14 items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="text-body font-semibold text-ink tabular-nums">
                      {fmtTime(booking.start_at)} – {fmtTime(booking.end_at)}
                    </p>
                    <p className="truncate text-caption text-muted">
                      {booking.court?.name ?? 'Court'} · {booking.hours === 1 ? '1 hour' : `${booking.hours} hours`}
                    </p>
                  </div>
                  <span className={`pill ${booking.status === 'pending_payment' ? 'pill-warn' : 'pill-ok'}`}>
                    {bookingStatusLabel[booking.status]}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {analytics ? <LastThirtyDays analytics={analytics} /> : null}

      <Section
        title="Latest transactions"
        icon={ReceiptText}
        id="latest-transactions"
        actions={
          <Link to="/admin/transactions" className="control-feedback inline-flex min-h-12 items-center px-2 text-body font-semibold text-brand-700">
            All
          </Link>
        }
      >
        <SortableTable
          caption="Latest transactions"
          rows={data.transactions.slice(0, 5)}
          rowKey={(tx) => tx.id}
          initialSort={{ key: 'time', dir: 'desc' }}
          empty={<p className="text-body text-muted">No transactions yet.</p>}
          columns={[
            { key: 'time', header: 'When', render: (tx) => fmtDateTime(tx.created_at), sortValue: (tx) => tx.created_at },
            { key: 'what', header: 'What', render: (tx) => <span className="font-semibold text-ink">{tx.description}</span>, sortValue: (tx) => tx.description },
            {
              key: 'amount',
              header: 'Amount',
              align: 'right',
              render: (tx) => (
                <span className="font-semibold tabular-nums">
                  {peso(tx.amount)}
                  {!isDemoMode || tx.verification_status === 'unverified' ? ' recorded' : ''}
                </span>
              ),
              sortValue: (tx) => tx.amount,
            },
          ]}
        />
      </Section>

      <QuickLinks />
    </>
  )
}

/** The Oefy-style strip: four figures for the last 30 days, each against the 30 before. */
function LastThirtyDays({ analytics }: { analytics: ClubAnalytics }) {
  const { current, previous, by_day } = analytics
  return (
    <section aria-labelledby="last-30" className="enter-rise space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="last-30" className="text-subtitle font-bold text-ink">
          Last 30 days
        </h2>
        <Link to="/admin/analytics" className="control-feedback inline-flex min-h-12 items-center gap-1 px-2 text-body font-semibold text-brand-700">
          See analytics <ChevronRight size={18} aria-hidden />
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={isDemoMode ? 'Revenue' : 'Recorded charges'}
          value={peso(current.charges)}
          icon={Coins}
          tone="ok"
          current={current.charges}
          previous={previous.charges}
          series={by_day.map((day) => day.charges)}
          to="/admin/analytics"
        />
        <StatCard
          label="Court hours booked"
          value={String(current.hours)}
          icon={CalendarDays}
          current={current.hours}
          previous={previous.hours}
          series={by_day.map((day) => day.hours)}
          to="/admin/analytics"
        />
        <StatCard
          label="Bookings"
          value={String(current.bookings)}
          icon={BarChart3}
          current={current.bookings}
          previous={previous.bookings}
          series={by_day.map((day) => day.bookings)}
          to="/admin/analytics"
        />
        <StatCard
          label="New members and players"
          value={String(current.new_members + current.new_players)}
          icon={Users}
          tone="ink"
          current={current.new_members + current.new_players}
          previous={previous.new_members + previous.new_players}
          series={by_day.map((day) => day.new_members)}
          to="/admin/analytics"
        />
      </div>
    </section>
  )
}

const quickLinks = [
  { to: '/admin/ops', label: 'Floor ops', icon: Home },
  { to: '/admin/bookings', label: 'Bookings', icon: CalendarDays },
  { to: '/admin/board', label: 'Schedule board', icon: Tv },
  { to: '/admin/members', label: 'Members', icon: Users },
  { to: '/admin/open', label: 'Open play', icon: Users },
  { to: '/admin/leaderboard', label: 'Leaderboard & scorers', icon: Trophy },
  { to: '/admin/tournaments', label: 'Tournaments', icon: Shuffle },
  { to: '/admin/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/admin/venues', label: 'Venues & courts', icon: Building2 },
  { to: '/admin/profile', label: 'Business profile', icon: ReceiptText },
  { to: '/admin/users', label: 'Users', icon: UserCog },
]

function QuickLinks() {
  return (
    <nav aria-label="Go to" className="enter-rise">
      <h2 className="mb-3 text-subtitle font-bold text-ink">Go to</h2>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {quickLinks.map(({ to, label, icon: Icon }) => (
          <li key={to}>
            <Link to={to} className="card control-feedback flex min-h-14 items-center gap-3 px-3 py-2 text-body font-semibold text-ink">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700" aria-hidden>
                <Icon size={18} />
              </span>
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
