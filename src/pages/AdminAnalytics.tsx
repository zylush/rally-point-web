import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  BarChart3,
  CalendarClock,
  CalendarDays,
  CalendarX2,
  Coins,
  Flame,
  GraduationCap,
  Landmark,
  MapPin,
  PieChart,
  Receipt,
  Users,
} from 'lucide-react'
import { AppHeader, AppShell, SignOutButton } from '../components/Shell'
import { BackButton } from '../components/BackButton'
import { LoadingShapes, SkeletonBlock, SkeletonLine } from '../components/Skeleton'
import {
  BarChart,
  FactList,
  HeatGrid,
  Meter,
  PeriodSwitch,
  Section,
  StackedBar,
  StatCard,
  type Tone,
} from '../components/dashboard'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import {
  WEEKDAY_SHORT,
  bookingStatusLabel,
  occupancyPct,
  parsePeriod,
  rangeLabel,
  txTypeLabel,
  type AnalyticsPeriod,
  type ClubAnalytics,
} from '../lib/analytics'
import { isDemoMode } from '../lib/supabase'
import type { BookingStatus, TxType } from '../types'
import { hourLabel, peso } from '../types'

const typeTone: Record<TxType, Tone> = {
  booking: 'brand',
  court_rental: 'ink',
  extension: 'muted',
  membership: 'ok',
  walk_in: 'warn',
  other: 'danger',
}

const statusTone: Record<BookingStatus, Tone> = {
  confirmed: 'brand',
  completed: 'ok',
  pending_payment: 'warn',
  cancelled: 'muted',
  no_show: 'danger',
}

/** "18 Nov" for chart labels. */
function shortDay(day: string) {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function hours(n: number) {
  return n === 1 ? '1 hour' : `${n.toLocaleString('en-PH')} hours`
}

function AnalyticsLoading() {
  return (
    <LoadingShapes label="Loading analytics…">
      <div className="space-y-4" aria-hidden>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, key) => (
            <div key={key} className="card p-4">
              <SkeletonLine className="w-3/5" />
              <div className="mt-2 flex h-9 items-center">
                <div className="skeleton h-7 w-2/5" />
              </div>
              <SkeletonLine size="caption" className="mt-1 w-4/5" />
              <SkeletonBlock className="mt-3 h-10 w-full" />
            </div>
          ))}
        </div>
        <SkeletonBlock className="h-64 w-full rounded-[12px]!" />
      </div>
    </LoadingShapes>
  )
}

export function AdminAnalytics() {
  const { activeClub } = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const period = parsePeriod(params.get('period'))
  const [data, setData] = useState<ClubAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (days: AnalyticsPeriod) => {
    setLoading(true)
    setError(null)
    try {
      setData(await api.clubAnalytics(days))
    } catch (loadError) {
      setError(loadError instanceof Error && loadError.message ? loadError.message : 'Could not load analytics.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(period)
  }, [load, period])

  const chargesWord = isDemoMode ? 'Revenue' : 'Recorded charges'

  return (
    <AppShell role="admin">
      <AppHeader
        title="Analytics"
        subtitle={activeClub?.name}
        left={
          // Phones reach Analytics from Home; the desktop menu lists it, so Back is phone-only.
          <span className="md:hidden">
            <BackButton onClick={() => navigate('/admin')} />
          </span>
        }
        right={<SignOutButton />}
      />
      <main className="safe-bottom space-y-5 px-4 pt-4">
        <div className="enter-rise flex flex-wrap items-center justify-between gap-3">
          <PeriodSwitch
            value={period}
            onChange={(next) => setParams((current) => {
              const copy = new URLSearchParams(current)
              copy.set('period', String(next))
              return copy
            }, { replace: true })}
            rangeText={data ? rangeLabel(data.period) : undefined}
          />
        </div>

        {error ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-red-50 p-4 text-base font-semibold text-red-800">
            {error}
            <button type="button" className="btn-secondary min-h-12 w-auto! px-4" onClick={() => void load(period)}>
              Try again
            </button>
          </div>
        ) : null}

        {!data ? (
          loading ? <AnalyticsLoading /> : null
        ) : (
          <div className={`space-y-5 transition-opacity ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
            <ClubFigures data={data} chargesWord={chargesWord} />
          </div>
        )}
      </main>
    </AppShell>
  )
}

function ClubFigures({ data, chargesWord }: { data: ClubAnalytics; chargesWord: string }) {
  const { current: cur, previous: prev, by_day: days } = data
  const occupancy = occupancyPct(cur.hours, cur.open_hours)
  const previousOccupancy = occupancyPct(prev.hours, prev.open_hours)
  const dayPoints = (pick: (day: ClubAnalytics['by_day'][number]) => number) =>
    days.map((day) => ({ key: day.day, label: shortDay(day.day), value: pick(day) }))
  const totalSplit = data.payment_split.online + data.payment_split.desk

  return (
    <>
      {!isDemoMode ? (
        <p className="text-body text-slate-600">
          Figures come from charges and bookings the club recorded. Players pay the club directly; the platform collects no
          money.
          {data.source === 'browser' ? ' Added up on this device from the latest records.' : ''}
        </p>
      ) : null}

      <section aria-label="Period figures" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={chargesWord}
          value={peso(cur.charges)}
          icon={Coins}
          tone="ok"
          current={cur.charges}
          previous={prev.charges}
          series={days.map((day) => day.charges)}
        />
        <StatCard
          label="Court hours booked"
          value={cur.hours.toLocaleString('en-PH')}
          icon={CalendarDays}
          current={cur.hours}
          previous={prev.hours}
          series={days.map((day) => day.hours)}
          sub={cur.open_hours > 0 ? `${occupancy}% of open court hours (was ${previousOccupancy}%)` : undefined}
        />
        <StatCard
          label="Bookings"
          value={cur.bookings.toLocaleString('en-PH')}
          icon={BarChart3}
          current={cur.bookings}
          previous={prev.bookings}
          series={days.map((day) => day.bookings)}
        />
        <StatCard
          label="Average booking"
          value={peso(cur.avg_booking)}
          icon={Receipt}
          tone="ink"
          current={cur.avg_booking}
          previous={prev.avg_booking}
        />
        <StatCard
          label="New members"
          value={cur.new_members.toLocaleString('en-PH')}
          icon={Users}
          tone="ok"
          current={cur.new_members}
          previous={prev.new_members}
          series={days.map((day) => day.new_members)}
          sub={`${cur.new_players.toLocaleString('en-PH')} new players without a membership`}
        />
        <StatCard
          label="Cancelled and no-shows"
          value={cur.cancellations.toLocaleString('en-PH')}
          icon={CalendarX2}
          tone="danger"
          current={cur.cancellations}
          previous={prev.cancellations}
          goodWhen="down"
          series={days.map((day) => day.cancellations)}
        />
        <StatCard
          label="Platform commission"
          value={peso(cur.commission)}
          icon={Landmark}
          tone="muted"
          current={cur.commission}
          previous={prev.commission}
          sub="Recorded on court-time charges"
        />
        {data.coaching ? (
          <StatCard
            label="Coach requests"
            value={data.coaching.requests.toLocaleString('en-PH')}
            icon={GraduationCap}
            tone="brand"
            current={data.coaching.requests}
            previous={data.coaching.previous_requests}
            sub={`${data.coaching.accepted.toLocaleString('en-PH')} accepted`}
          />
        ) : null}
      </section>

      <Section title={`${chargesWord} per day`} icon={Coins} id="charges-per-day">
        <BarChart label={`${chargesWord} per day`} points={dayPoints((day) => day.charges)} format={peso} tone="ok" />
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title={`${chargesWord} by type`} icon={PieChart} id="charges-by-type">
          <StackedBar
            label={`${chargesWord} by type`}
            segments={data.charges_by_type.map((row) => ({ key: row.type, label: txTypeLabel[row.type], value: row.amount, tone: typeTone[row.type] }))}
            format={peso}
          />
          {data.charges_by_venue.length > 1 ? (
            <div className="mt-5">
              <h3 className="mb-1 flex items-center gap-2 text-body font-semibold text-slate-600">
                <MapPin size={16} aria-hidden /> By location
              </h3>
              <FactList facts={data.charges_by_venue.map((row) => ({ label: row.name, value: peso(row.amount) }))} />
            </div>
          ) : null}
        </Section>

        <Section title="Bookings" icon={CalendarClock} id="booking-mix">
          <StackedBar
            label="Bookings by status"
            segments={data.bookings_by_status.map((row) => ({
              key: row.status,
              label: bookingStatusLabel[row.status],
              value: row.count,
              tone: statusTone[row.status],
            }))}
            format={(n) => n.toLocaleString('en-PH')}
          />
          <div className="mt-5">
            <FactList
              facts={[
                { label: 'Paid by GCash online', value: data.payment_split.online, strong: true },
                { label: 'Booked at the desk', value: data.payment_split.desk, strong: true },
                {
                  label: 'Share paid online',
                  value: totalSplit ? `${Math.round((data.payment_split.online / totalSplit) * 100)}%` : '—',
                  indent: true,
                },
              ]}
            />
          </div>
        </Section>
      </div>

      <Section
        title="Busiest hours"
        description="Booked court hours by day of the week and time of day, Philippine time."
        icon={Flame}
        id="busiest-hours"
      >
        <HeatGrid
          label="Busiest hours"
          grid={data.busy_hours}
          rowLabels={[...WEEKDAY_SHORT]}
          colLabels={Array.from({ length: 24 }, (_, hour) => hourLabel(hour).replace(':00', ''))}
          format={(n) => (n === 1 ? '1 booking' : `${n} bookings`)}
        />
      </Section>

      <Section
        title="Court use"
        description="Booked hours against the hours each court was open in this period."
        icon={BarChart3}
        id="court-use"
      >
        {data.courts.length === 0 ? (
          <p className="text-body text-muted">No courts yet.</p>
        ) : (
          <div className="space-y-4">
            {data.courts.map((court) => (
              <Meter
                key={court.court_id}
                label={court.venue_name ? `${court.name} · ${court.venue_name}` : court.name}
                value={court.hours}
                max={court.open_hours || 1}
                detail={court.open_hours ? `${hours(court.hours)} · ${occupancyPct(court.hours, court.open_hours)}%` : 'Out of service'}
                tone={court.open_hours ? 'brand' : 'muted'}
              />
            ))}
          </div>
        )}
      </Section>
    </>
  )
}
