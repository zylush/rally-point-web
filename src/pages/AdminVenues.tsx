import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { BackButton } from '../components/BackButton'
import { AppHeader, AppShell, LoadingBlock, SignOutButton } from '../components/Shell'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import type { Court, CourtInput, CourtPhoto, Profile, Venue, VenueLocationInput } from '../types'
import { openingHoursLabel, peso } from '../types'
import { directionsUrl, mapEmbedUrl, placeLine } from '../lib/maps'
import { CourtPhotosEditor, VenueCoverEditor } from './AdminPhotos'

const DEFAULT_COURT_RATE = 500

/** Returns true when saved, so the form can close. */
type SaveCourt = (input: CourtInput, busyKey: string) => Promise<boolean>
type SaveLocation = (input: VenueLocationInput) => Promise<boolean>

/** Photo actions for venue covers and courts. */
interface PhotoActions {
  /** Null when photos cannot be loaded (for example before the photo update reaches this database). */
  photos: CourtPhoto[] | null
  progress: Record<string, string>
  addCourtPhotos: (court: Court, files: File[]) => void
  makeMain: (photo: CourtPhoto) => void
  removeCourtPhoto: (photo: CourtPhoto, courtName: string) => void
  setCover: (venue: Venue, file: File | null) => void
}

export function AdminVenues() {
  const { activeClub } = useAuth()
  const [venues, setVenues] = useState<Venue[]>([])
  const [courts, setCourts] = useState<Court[]>([])
  const [staff, setStaff] = useState<Profile[]>([])
  const [photos, setPhotos] = useState<CourtPhoto[] | null>(null)
  const [progress, setProgress] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [nextVenues, nextCourts, nextStaff, nextPhotos] = await Promise.all([
        api.listAllVenues(),
        api.listCourts(),
        api.staffAccounts(),
        // Photos are optional here: the rest of the page works without them.
        api.listCourtPhotos().catch(() => null),
      ])
      setVenues(nextVenues)
      setCourts(nextCourts)
      setPhotos(nextPhotos)
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
        open_hour: 0,
        close_hour: 24,
        is_active: true,
      })
      setName('')
      setSlug('')
      setMessage('Venue added. Add its courts so players can book it.')
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

  const saveCourt: SaveCourt = async (input, busyKey) => {
    setBusy(busyKey)
    try {
      const saved = await api.upsertCourt(input)
      setMessage(input.id ? `${saved.name} saved` : `${saved.name} added`)
      await reload()
      return true
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save the court')
      return false
    } finally {
      setBusy(null)
    }
  }

  const saveLocation: SaveLocation = async (input) => {
    setBusy(`location:${input.venue_id}`)
    try {
      await api.updateVenueLocation(input)
      setMessage('Location saved')
      await reload()
      return true
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save the location')
      return false
    } finally {
      setBusy(null)
    }
  }

  const reloadPhotos = useCallback(async () => {
    setPhotos(await api.listCourtPhotos().catch(() => null))
  }, [])

  async function addCourtPhotos(court: Court, files: File[]) {
    const key = `photo:${court.id}`
    setBusy(key)
    let added = 0
    try {
      for (const [index, file] of files.entries()) {
        setProgress((now) => ({ ...now, [key]: files.length > 1 ? `Uploading ${index + 1} of ${files.length}…` : 'Uploading…' }))
        await api.addCourtPhoto(court.id, file)
        added += 1
      }
      setMessage(added === 1 ? `Photo added to ${court.name}` : `${added} photos added to ${court.name}`)
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Could not add the photo'
      setMessage(added ? `${added} added, then: ${reason}` : reason)
    } finally {
      setProgress((now) => {
        const rest = { ...now }
        delete rest[key]
        return rest
      })
      setBusy(null)
      await reloadPhotos()
    }
  }

  async function runPhotoAction(key: string, action: () => Promise<void>, done: string) {
    setBusy(key)
    try {
      await action()
      setMessage(done)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not update the photo')
    } finally {
      setBusy(null)
      await reloadPhotos()
    }
  }

  const photoActions: PhotoActions = {
    photos,
    progress,
    addCourtPhotos: (court, files) => void addCourtPhotos(court, files),
    makeMain: (photo) => void runPhotoAction(`photo:${photo.court_id}`, () => api.makeMainCourtPhoto(photo.id), 'Main photo changed'),
    removeCourtPhoto: (photo, courtName) => {
      if (!window.confirm(`Remove this photo of ${courtName}? Players will no longer see it.`)) return
      void runPhotoAction(`photo:${photo.court_id}`, () => api.removeCourtPhoto(photo.id), 'Photo removed')
    },
    setCover: (venue, file) => {
      if (!file && !window.confirm(`Remove the cover photo of ${venue.name}?`)) return
      void runPhotoAction(`cover:${venue.id}`, () => api.setVenueCover(venue.id, file), file ? 'Cover photo saved' : 'Cover photo removed')
    },
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
      <AppHeader title="Venues & courts" subtitle="Venues, their courts, and staff access" right={<SignOutButton />} />
      <main className="safe-bottom px-4 pt-3 space-y-4">
        <div className="flex items-center gap-2">
          <BackButton />
          <p className="text-sm text-slate-500">{activeClub?.name ?? 'Your club'}</p>
        </div>

        <form className="card p-4 space-y-3" onSubmit={createVenue}>
          <div>
            <h2 className="font-extrabold">Add a venue</h2>
            <p className="text-xs text-slate-500 mt-1">Venues are open for booking 24 hours, in Philippine time. Deactivate instead of deleting history.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="label" htmlFor="venue-name">Venue name</label>
              <input id="venue-name" className="input" value={name} onChange={(event) => setName(event.target.value)} required />
            </div>
            <div>
              <label className="label" htmlFor="venue-slug">Short slug</label>
              <input id="venue-slug" className="input" value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="downtown" required />
            </div>
          </div>
          <button className="btn-primary" type="submit" disabled={busy === 'new-venue'} aria-busy={busy === 'new-venue'}>
            {busy === 'new-venue' ? 'Adding…' : 'Add venue'}
          </button>
        </form>

        {loading ? <LoadingBlock /> : (
          <>
            {venues.map((venue) => (
              <VenueCard
                key={venue.id}
                venue={venue}
                courts={courts.filter((court) => court.venue_id === venue.id)}
                busy={busy}
                onToggleVenue={() => void toggleVenue(venue)}
                onSaveCourt={saveCourt}
                onSaveLocation={saveLocation}
                photoActions={photoActions}
              />
            ))}

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

function VenueCard({
  venue,
  courts,
  busy,
  onToggleVenue,
  onSaveCourt,
  onSaveLocation,
  photoActions,
}: {
  venue: Venue
  courts: Court[]
  busy: string | null
  onToggleVenue: () => void
  onSaveCourt: SaveCourt
  onSaveLocation: SaveLocation
  photoActions: PhotoActions
}) {
  const [adding, setAdding] = useState(false)
  const [photosOpenId, setPhotosOpenId] = useState<string | null>(null)
  const { photos } = photoActions
  const cover = photos?.find((photo) => photo.venue_id === venue.id && !photo.court_id) ?? null
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingLocation, setEditingLocation] = useState(false)
  const place = placeLine(venue)
  const directions = directionsUrl(venue)
  const mapUrl = mapEmbedUrl(venue)
  const inService = courts.filter((court) => court.status !== 'maintenance').length
  const headingId = `venue-${venue.id}-title`

  return (
    <section className="card p-4 space-y-3" aria-labelledby={headingId}>
      <div className="space-y-2">
        <div>
          <h2 id={headingId} className="font-extrabold">{venue.name}</h2>
          <p className="text-xs text-slate-500">
            {venue.slug} · Philippine time · {openingHoursLabel(venue.open_hour, venue.close_hour)}{venue.is_active ? '' : ' · Inactive'}
          </p>
        </div>
        <button type="button" className="btn-secondary text-sm" onClick={onToggleVenue} disabled={busy === venue.id}>
          {venue.is_active ? `Deactivate ${venue.name}` : `Activate ${venue.name}`}
        </button>
      </div>

      <div>
        <h3 className="text-sm font-bold text-slate-700">Location</h3>
        {editingLocation ? (
          <LocationForm
            venue={venue}
            saving={busy === `location:${venue.id}`}
            onCancel={() => setEditingLocation(false)}
            onSave={async (input) => {
              if (await onSaveLocation(input)) setEditingLocation(false)
            }}
          />
        ) : (
          <div className="mt-1 space-y-2">
            <p className="text-sm text-slate-700">
              {place || 'No address yet. Players see the club’s city until you add one.'}
            </p>
            <div className="flex flex-wrap gap-x-4">
              {directions ? (
                <a className="inline-flex min-h-12 items-center text-sm font-semibold text-brand-800 underline" href={directions} target="_blank" rel="noopener noreferrer">
                  Check on Google Maps
                </a>
              ) : null}
              <button type="button" className="inline-flex min-h-12 items-center text-sm font-semibold text-brand-800 underline" onClick={() => setEditingLocation(true)}>
                {place || mapUrl ? 'Edit location' : 'Add address and map pin'}
              </button>
            </div>
            {mapUrl ? null : place ? <p className="text-xs text-slate-500">Add a map pin so players see a map.</p> : null}
          </div>
        )}
      </div>

      {photos ? (
        <VenueCoverEditor
          venueName={venue.name}
          cover={cover}
          busy={busy === `cover:${venue.id}`}
          onSet={(file) => photoActions.setCover(venue, file)}
          onRemove={() => photoActions.setCover(venue, null)}
        />
      ) : (
        <p className="text-xs text-slate-500">Photos are not available yet on this system.</p>
      )}

      <div>
        <h3 className="text-sm font-bold text-slate-700">Courts</h3>
        {inService === 0 ? (
          <p className="mt-1 text-sm font-semibold text-amber-800" role="note">
            {courts.length === 0
              ? 'No courts yet. Players cannot book this venue until you add one.'
              : 'Every court here is out of service. Players cannot book this venue.'}
          </p>
        ) : null}
        <ul className="mt-2 space-y-2">
          {courts.map((court) => (
            <li key={court.id} className="rounded-xl border border-slate-200 p-3">
              {editingId === court.id ? (
                <CourtForm
                  venue={venue}
                  court={court}
                  saving={busy === `court:${court.id}`}
                  onCancel={() => setEditingId(null)}
                  onSave={async (input) => {
                    if (await onSaveCourt(input, `court:${court.id}`)) setEditingId(null)
                  }}
                />
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold truncate">{court.name}</p>
                    <p className="text-sm text-slate-600">{peso(court.hourly_rate)} per hour</p>
                    {court.member_rate != null ? (
                      <p className="text-sm text-brand-800">Members {peso(court.member_rate)} per hour</p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <CourtStatusPill court={court} />
                    <button
                      type="button"
                      className="btn-secondary min-w-[4.5rem] text-sm"
                      onClick={() => { setAdding(false); setEditingId(court.id) }}
                      aria-label={`Edit ${court.name}`}
                    >
                      Edit
                    </button>
                  </div>
                </div>
              )}
              {photos && editingId !== court.id ? (
                <CourtPhotosToggle
                  court={court}
                  photos={photos.filter((photo) => photo.court_id === court.id)}
                  open={photosOpenId === court.id}
                  onToggle={() => setPhotosOpenId(photosOpenId === court.id ? null : court.id)}
                  busy={busy === `photo:${court.id}`}
                  photoActions={photoActions}
                />
              ) : null}
            </li>
          ))}
        </ul>
      </div>

      {adding ? (
        <div className="rounded-xl border border-slate-200 p-3">
          <CourtForm
            venue={venue}
            saving={busy === `new-court:${venue.id}`}
            onCancel={() => setAdding(false)}
            onSave={async (input) => {
              if (await onSaveCourt(input, `new-court:${venue.id}`)) setAdding(false)
            }}
          />
        </div>
      ) : (
        <button type="button" className="btn-secondary w-full" onClick={() => { setEditingId(null); setAdding(true) }}>
          Add a court to {venue.name}
        </button>
      )}
    </section>
  )
}

function LocationForm({
  venue,
  saving,
  onCancel,
  onSave,
}: {
  venue: Venue
  saving: boolean
  onCancel: () => void
  onSave: (input: VenueLocationInput) => Promise<void>
}) {
  const [address, setAddress] = useState(venue.address ?? '')
  const [city, setCity] = useState(venue.city ?? '')
  const [latitude, setLatitude] = useState(venue.latitude != null ? String(venue.latitude) : '')
  const [longitude, setLongitude] = useState(venue.longitude != null ? String(venue.longitude) : '')
  const id = `venue-${venue.id}-location`
  const asNumber = (value: string) => (value.trim() === '' ? null : Number(value))

  function submit(event: FormEvent) {
    event.preventDefault()
    void onSave({
      venue_id: venue.id,
      address: address.trim() || null,
      city: city.trim() || null,
      latitude: asNumber(latitude),
      longitude: asNumber(longitude),
    })
  }

  return (
    <form className="mt-2 space-y-3" onSubmit={submit} aria-label={`Location of ${venue.name}`}>
      <div>
        <label className="label" htmlFor={`${id}-address`}>Street address</label>
        <input id={`${id}-address`} className="input" value={address} onChange={(e) => setAddress(e.target.value)} maxLength={200} placeholder="Building, street, barangay" />
      </div>
      <div>
        <label className="label" htmlFor={`${id}-city`}>City</label>
        <input id={`${id}-city`} className="input" value={city} onChange={(e) => setCity(e.target.value)} maxLength={80} placeholder="General Santos City" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label" htmlFor={`${id}-lat`}>Latitude</label>
          <input id={`${id}-lat`} className="input" type="number" inputMode="decimal" step="any" min={-90} max={90} value={latitude} onChange={(e) => setLatitude(e.target.value)} placeholder="6.1164" />
        </div>
        <div>
          <label className="label" htmlFor={`${id}-lng`}>Longitude</label>
          <input id={`${id}-lng`} className="input" type="number" inputMode="decimal" step="any" min={-180} max={180} value={longitude} onChange={(e) => setLongitude(e.target.value)} placeholder="125.1716" />
        </div>
      </div>
      <p className="text-xs text-slate-500">
        For the map pin, open Google Maps, press and hold (or right-click) on the courts, and copy the two numbers shown.
        Leave both empty for no map.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving} aria-busy={saving}>
          {saving ? 'Saving…' : 'Save location'}
        </button>
      </div>
    </form>
  )
}

function CourtPhotosToggle({
  court,
  photos,
  open,
  onToggle,
  busy,
  photoActions,
}: {
  court: Court
  photos: CourtPhoto[]
  open: boolean
  onToggle: () => void
  busy: boolean
  photoActions: PhotoActions
}) {
  return (
    <div className="mt-1">
      <button
        type="button"
        className="inline-flex min-h-12 items-center text-sm font-semibold text-brand-800 underline"
        aria-expanded={open}
        onClick={onToggle}
      >
        {open ? `Hide photos of ${court.name}` : `Photos of ${court.name} (${photos.length})`}
      </button>
      {open ? (
        <CourtPhotosEditor
          courtName={court.name}
          photos={photos}
          busy={busy}
          progress={photoActions.progress[`photo:${court.id}`]}
          onAdd={(files) => photoActions.addCourtPhotos(court, files)}
          onMakeMain={photoActions.makeMain}
          onRemove={(photo) => photoActions.removeCourtPhoto(photo, court.name)}
        />
      ) : null}
    </div>
  )
}

function CourtStatusPill({ court }: { court: Court }) {
  if (court.status === 'maintenance') return <span className="pill pill-warn whitespace-nowrap">Out of service</span>
  if (court.status === 'occupied') return <span className="pill pill-brand whitespace-nowrap">In use</span>
  return <span className="pill pill-ok whitespace-nowrap">In service</span>
}

function CourtForm({
  venue,
  court,
  saving,
  onCancel,
  onSave,
}: {
  venue: Venue
  court?: Court
  saving: boolean
  onCancel: () => void
  onSave: (input: CourtInput) => Promise<void>
}) {
  const [name, setName] = useState(court?.name ?? '')
  const [rate, setRate] = useState(String(court?.hourly_rate ?? DEFAULT_COURT_RATE))
  const [memberRate, setMemberRate] = useState(court?.member_rate != null ? String(court.member_rate) : '')
  const [inService, setInService] = useState(court ? court.status !== 'maintenance' : true)
  const idPrefix = court ? `court-${court.id}` : `new-court-${venue.id}`

  function submit(event: FormEvent) {
    event.preventDefault()
    void onSave({
      id: court?.id,
      venue_id: venue.id,
      name,
      hourly_rate: Number(rate),
      member_rate: memberRate.trim() === '' ? null : Number(memberRate),
      in_service: inService,
    })
  }

  return (
    <form className="space-y-3" onSubmit={submit} aria-label={court ? `Edit ${court.name}` : `Add a court to ${venue.name}`}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label className="label" htmlFor={`${idPrefix}-name`}>Court name</label>
          <input
            id={`${idPrefix}-name`}
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={40}
            required
            placeholder="Court 3"
          />
        </div>
        <div>
          <label className="label" htmlFor={`${idPrefix}-rate`}>Hourly rate (Php)</label>
          <input
            id={`${idPrefix}-rate`}
            className="input"
            type="number"
            inputMode="decimal"
            min={0}
            max={100000}
            step="0.01"
            value={rate}
            onChange={(event) => setRate(event.target.value)}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor={`${idPrefix}-member-rate`}>Member rate (Php, optional)</label>
          <input
            id={`${idPrefix}-member-rate`}
            className="input"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={memberRate}
            onChange={(event) => setMemberRate(event.target.value)}
            placeholder="Same as hourly rate"
          />
        </div>
      </div>
      <label className="min-h-12 rounded-xl border border-slate-200 px-3 py-2 flex items-center gap-3 text-sm">
        <input type="checkbox" className="h-5 w-5" checked={inService} onChange={(event) => setInService(event.target.checked)} />
        <span className="flex-1">
          <span className="font-semibold">In service</span>
          <span className="block text-xs text-slate-500">Out-of-service courts cannot be booked. Bookings already made stay.</span>
        </span>
      </label>
      <p className="text-xs text-slate-500">
        Players with an active membership pay the member rate. Leave it empty to charge everyone the hourly rate.
        A new rate applies to bookings made from now on.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="btn-primary" disabled={saving} aria-busy={saving}>
          {saving ? 'Saving…' : court ? 'Save court' : 'Add court'}
        </button>
      </div>
    </form>
  )
}
