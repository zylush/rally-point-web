import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Building2, Coins, Landmark, MapPin, PhoneCall, ReceiptText, Trophy } from 'lucide-react'
import { LoadingShapes, SkeletonBlock, SkeletonLine } from '../components/Skeleton'
import {
  BarChart,
  FactList,
  Meter,
  PeriodSwitch,
  Section,
  SortableTable,
  StackedBar,
  StatCard,
  type Tone,
} from '../components/dashboard'
import { api } from '../lib/api'
import { parsePeriod, rangeLabel, type AnalyticsPeriod, type PlatformAnalytics } from '../lib/analytics'
import type { ClubStatus, OwnerCallStatus } from '../types'
import { peso } from '../types'

const clubStatusLabel: Record<ClubStatus, string> = { active: 'Active', provisioning: 'In setup', suspended: 'Suspended' }
const clubStatusTone: Record<ClubStatus, Tone> = { active: 'ok', provisioning: 'warn', suspended: 'muted' }
const requestStatusLabel: Record<OwnerCallStatus, string> = { new: 'Waiting for a call', called: 'Called', closed: 'Closed' }
const requestStatusTone: Record<OwnerCallStatus, Tone> = { new: 'warn', called: 'brand', closed: 'muted' }

function shortDay(day: string) {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function count(n: number) {
  return n.toLocaleString('en-PH')
}

function Loading() {
  return (
    <LoadingShapes label="Loading platform analytics…">
      <div className="space-y-4" aria-hidden>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((key) => (
            <div key={key} className="card p-4">
              <SkeletonLine className="w-3/5" />
              <div className="mt-2 flex h-9 items-center">
                <div className="skeleton h-7 w-2/5" />
              </div>
              <SkeletonBlock className="mt-3 h-10 w-full" />
            </div>
          ))}
        </div>
        <SkeletonBlock className="h-64 w-full rounded-[12px]!" />
      </div>
    </LoadingShapes>
  )
}

/**
 * Platform-wide figures over a period. Built only from the audited platform
 * functions, and only from totals: no member, player or contact details.
 */
export function PlatformAnalyticsView() {
  const [params, setParams] = useSearchParams()
  const period = parsePeriod(params.get('period'))
  const [data, setData] = useState<PlatformAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (days: AnalyticsPeriod) => {
    setLoading(true)
    setError(null)
    try {
      setData(await api.platformAnalytics(days))
    } catch (loadError) {
      setError(loadError instanceof Error && loadError.message ? loadError.message : 'Could not load platform analytics.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(period)
  }, [load, period])

  return (
    <div className="space-y-5">
      <PeriodSwitch
        value={period}
        onChange={(next) =>
          setParams(
            (current) => {
              const copy = new URLSearchParams(current)
              copy.set('period', String(next))
              return copy
            },
            { replace: true },
          )
        }
        rangeText={data ? rangeLabel(data.period) : undefined}
      />
      {error ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-red-50 p-4 text-base font-semibold text-red-800">
          {error}
          <button type="button" className="btn-secondary min-h-12 w-auto! px-4" onClick={() => void load(period)}>
            Try again
          </button>
        </div>
      ) : null}
      {!data ? (
        loading ? <Loading /> : null
      ) : (
        <div className={`space-y-5 transition-opacity ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
          <Figures data={data} />
        </div>
      )}
    </div>
  )
}

function Figures({ data }: { data: PlatformAnalytics }) {
  const { current: cur, previous: prev, by_day: days } = data
  const points = (pick: (day: PlatformAnalytics['by_day'][number]) => number) =>
    days.map((day) => ({ key: day.day, label: shortDay(day.day), value: pick(day) }))
  const topGross = data.top_clubs[0]?.gross ?? 0

  return (
    <>
      <p className="text-body text-slate-600">
        Figures come from charges the clubs recorded. Players pay the clubs directly, so this is not collected money.
      </p>
      {data.ledger_capped ? (
        <p role="status" className="rounded-2xl bg-amber-50 p-4 text-body font-semibold text-amber-900">
          Showing the latest 1,000 ledger lines, so the earliest days of this period may be missing.
        </p>
      ) : null}

      <section aria-label="Period figures" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Commission recorded"
          value={peso(cur.commission)}
          icon={Landmark}
          tone="ok"
          current={cur.commission}
          previous={prev.commission}
          series={days.map((day) => day.commission)}
        />
        <StatCard
          label="Court charges recorded"
          value={peso(cur.gross)}
          icon={Coins}
          current={cur.gross}
          previous={prev.gross}
          series={days.map((day) => day.gross)}
        />
        <StatCard
          label="New clubs"
          value={count(cur.new_clubs)}
          icon={Building2}
          tone="ink"
          current={cur.new_clubs}
          previous={prev.new_clubs}
          series={days.map((day) => day.new_clubs)}
        />
        <StatCard
          label="Owner requests"
          value={count(cur.requests)}
          icon={PhoneCall}
          tone="warn"
          current={cur.requests}
          previous={prev.requests}
          series={days.map((day) => day.requests)}
        />
      </section>

      <Section title="Commission per day" icon={Landmark} id="commission-per-day">
        <BarChart label="Commission per day" points={points((day) => day.commission)} format={peso} tone="ok" />
      </Section>

      <Section title="Court charges per day" icon={ReceiptText} id="charges-per-day">
        <BarChart label="Court charges per day" points={points((day) => day.gross)} format={peso} />
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Top clubs" description="By court charges recorded in this period." icon={Trophy} id="top-clubs">
          {data.top_clubs.length === 0 ? (
            <p className="text-body text-muted">No charges recorded in this period.</p>
          ) : (
            <div className="space-y-4">
              {data.top_clubs.slice(0, 8).map((club) => (
                <Meter
                  key={club.club_id}
                  label={club.name}
                  value={club.gross}
                  max={topGross || 1}
                  detail={`${peso(club.gross)} · commission ${peso(club.commission)}`}
                />
              ))}
            </div>
          )}
        </Section>

        <Section title="Clubs" icon={Building2} id="clubs-by-status">
          <StackedBar
            label="Clubs by status"
            segments={data.clubs_by_status.map((row) => ({
              key: row.status,
              label: clubStatusLabel[row.status],
              value: row.count,
              tone: clubStatusTone[row.status],
            }))}
            format={count}
          />
        </Section>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Owner requests" description="Requests received in this period, by where they stand now." icon={PhoneCall} id="request-funnel">
          <StackedBar
            label="Owner requests by status"
            segments={data.requests_by_status.map((row) => ({
              key: row.status,
              label: requestStatusLabel[row.status],
              value: row.count,
              tone: requestStatusTone[row.status],
            }))}
            format={count}
          />
        </Section>

        <Section title="Where requests come from" icon={MapPin} id="request-cities">
          {data.requests_by_city.length === 0 ? (
            <p className="text-body text-muted">No owner requests in this period.</p>
          ) : (
            <FactList facts={data.requests_by_city.slice(0, 10).map((row) => ({ label: row.city, value: count(row.count) }))} />
          )}
        </Section>
      </div>

      {data.top_clubs.length > 0 ? (
        <Section title="Every club this period" icon={Coins} id="club-table">
          <SortableTable
            caption="Court charges and commission per club in this period"
            rows={data.top_clubs}
            rowKey={(club) => club.club_id}
            initialSort={{ key: 'gross', dir: 'desc' }}
            columns={[
              { key: 'name', header: 'Club', render: (club) => <span className="font-semibold text-ink">{club.name}</span>, sortValue: (club) => club.name },
              { key: 'lines', header: 'Charges', align: 'right', render: (club) => count(club.lines), sortValue: (club) => club.lines },
              { key: 'gross', header: 'Court charges', align: 'right', render: (club) => peso(club.gross), sortValue: (club) => club.gross },
              { key: 'commission', header: 'Commission', align: 'right', render: (club) => peso(club.commission), sortValue: (club) => club.commission },
            ]}
          />
        </Section>
      ) : null}
    </>
  )
}
