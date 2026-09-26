import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { BackButton } from '../components/BackButton'
import { AppHeader, AppShell, LoadingBlock, SignOutButton } from '../components/Shell'
import { api } from '../lib/api'
import type { Profile, Venue } from '../types'

export function AdminVenues() {
  const [venues, setVenues] = useState<Venue[]>([])
  const [staff, setStaff] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [nextVenues, nextStaff] = await Promise.all([
        api.listAllVenues(),
        api.staffAccounts(),
      ])
      setVenues(nextVenues)
      setStaff(nextStaff.filter((account) => account.role === 'staff'))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load venue settings')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  async function createVenue(event: FormEvent) {
    event.preventDefault()
    setBusy('new-venue')
    try {
      await api.upsertVenue({
        name: name.trim(),
        slug: slug.trim().toLowerCase(),
        timezone: 'Asia/Manila',
        open_hour: 6,
        close_hour: 22,
        is_active: true,
      })
      setName('')
      setSlug('')
      setMessage('Venue added')
      await reload()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not add venue')
    } finally {
      setBusy(null)
    }
  }

  async function toggleVenue(venue: Venue) {
    setBusy(venue.id)
    try {
      await api.upsertVenue({ ...venue, is_active: !venue.is_active })
      setMessage(venue.is_active ? 'Venue deactivated; history is retained' : 'Venue activated')
      await reload()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not update venue')
    } finally {
      setBusy(null)
    }
  }

  async function toggleGrant(account: Profile, venue: Venue) {
    const assigned = account.venue_ids?.includes(venue.id) ?? false
    setBusy(`${account.id}:${venue.id}`)
    try {
      await api.setStaffVenueGrant(account.id, venue.id, !assigned)
      setMessage(!assigned ? `${account.full_name} can now work at ${venue.name}` : `Access removed from ${venue.name}`)
      await reload()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not update assignment')
    } finally {
      setBusy(null)
    }
  }

  return (
    <AppShell role="admin">
      <AppHeader title="Venues & staff access" subtitle="Assign operations by venue" right={<SignOutButton />} />
      <main className="safe-bottom px-4 pt-3 space-y-4">
        <div className="flex items-center gap-2">
          <BackButton />
          <p className="text-sm text-slate-500">Rally Point Gensan club</p>
        </div>

        <form className="card p-4 space-y-3" onSubmit={createVenue}>
          <div>
            <h2 className="font-extrabold">Add a venue</h2>
            <p className="text-xs text-slate-500 mt-1">All venues start in Asia/Manila, 06:00–22:00. Deactivate instead of deleting history.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="label" htmlFor="venue-name">Venue name</label>
              <input id="venue-name" className="input" value={name} onChange={(event) => setName(event.target.value)} required />
            </div>
            <div>
              <label className="label" htmlFor="venue-slug">Short slug</label>
              <input id="venue-slug" className="input" value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="gensan-east" required />
            </div>
          </div>
          <button className="btn-primary" type="submit" disabled={busy === 'new-venue'} aria-busy={busy === 'new-venue'}>
            {busy === 'new-venue' ? 'Adding…' : 'Add venue'}
          </button>
        </form>

        {loading ? <LoadingBlock /> : (
          <>
            <section className="card p-4 space-y-2">
              <h2 className="font-extrabold">Venues</h2>
              {venues.map((venue) => (
                <div key={venue.id} className="list-row">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate">{venue.name}</p>
                    <p className="text-xs text-slate-500">{venue.slug} · {venue.timezone} · {venue.open_hour}:00–{venue.close_hour}:00</p>
                  </div>
                  <button type="button" className="btn-secondary text-xs" onClick={() => void toggleVenue(venue)} disabled={busy === venue.id}>
                    {venue.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              ))}
            </section>

            <section className="card p-4 space-y-3">
              <div>
                <h2 className="font-extrabold">Staff venue assignments</h2>
                <p className="text-xs text-slate-500 mt-1">Only already-provisioned staff appear here. Admin access remains club-wide.</p>
              </div>
              {staff.length === 0 ? <p className="text-sm text-slate-500">No provisioned staff accounts.</p> : staff.map((account) => (
                <div key={account.id} className="border-t border-slate-100 pt-3 first:border-0 first:pt-0">
                  <p className="font-semibold text-sm">{account.full_name}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                    {venues.map((venue) => {
                      const checked = account.venue_ids?.includes(venue.id) ?? false
                      const controlBusy = busy === `${account.id}:${venue.id}`
                      return (
                        <label key={venue.id} className="min-h-12 rounded-xl border border-slate-200 px-3 py-2 flex items-center gap-3 text-sm">
                          <input
                            type="checkbox"
                            className="h-5 w-5"
                            checked={checked}
                            disabled={controlBusy || !venue.is_active}
                            onChange={() => void toggleGrant(account, venue)}
                          />
                          <span className="flex-1">{venue.name}</span>
                          {controlBusy ? <span className="text-xs text-slate-400">Saving…</span> : null}
                        </label>
                      )
                    })}
                  </div>
                </div>
              ))}
            </section>
          </>
        )}
      </main>
      {message ? <div className="toast" role="status">{message}</div> : null}
    </AppShell>
  )
}
