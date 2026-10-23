import { useId, type ChangeEvent } from 'react'
import { Camera, ImagePlus } from 'lucide-react'
import type { CourtPhoto } from '../types'
import { MAX_COURT_PHOTOS } from '../types'
import { PHOTO_ACCEPT } from '../lib/photos'

/** A file picker that looks like a big secondary button. */
function PickPhotos({
  label,
  multiple,
  disabled,
  onPick,
}: {
  label: string
  multiple?: boolean
  disabled?: boolean
  onPick: (files: File[]) => void
}) {
  const id = useId()
  function change(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length) onPick(files)
  }
  return (
    <span className="block">
      <input id={id} type="file" accept={PHOTO_ACCEPT} multiple={multiple} disabled={disabled} className="sr-only peer" onChange={change} />
      <label
        htmlFor={id}
        className={`btn-secondary text-sm peer-focus-visible:outline peer-focus-visible:outline-3 peer-focus-visible:outline-brand-600 ${disabled ? 'opacity-60 pointer-events-none' : 'cursor-pointer'}`}
      >
        <ImagePlus size={18} aria-hidden /> {label}
      </label>
    </span>
  )
}

/** Up to 8 photos for one court. The first is the main photo on the public court card. */
export function CourtPhotosEditor({
  courtName,
  photos,
  busy,
  progress,
  onAdd,
  onMakeMain,
  onRemove,
}: {
  courtName: string
  photos: CourtPhoto[]
  busy: boolean
  /** e.g. "Uploading 2 of 3…" while photos upload. */
  progress?: string | null
  onAdd: (files: File[]) => void
  onMakeMain: (photo: CourtPhoto) => void
  onRemove: (photo: CourtPhoto) => void
}) {
  const room = MAX_COURT_PHOTOS - photos.length
  return (
    <div className="space-y-2" aria-label={`Photos of ${courtName}`} role="group">
      <p className="text-xs text-slate-500">
        {photos.length} of {MAX_COURT_PHOTOS} photos. Photos show on your public club page as soon as they are added.
        The first photo is the main one.
      </p>
      {photos.length ? (
        <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {photos.map((photo, index) => (
            <li key={photo.id} className="overflow-hidden rounded-xl border border-slate-200">
              <div className="relative">
                <img src={photo.url} alt={`${courtName} photo ${index + 1}`} className="aspect-[4/3] w-full object-cover" loading="lazy" />
                {index === 0 ? (
                  <span className="absolute left-1 top-1 rounded-md bg-brand-700 px-2 py-0.5 text-xs font-bold text-white">Main photo</span>
                ) : null}
              </div>
              <div className="grid grid-cols-1">
                {index === 0 ? null : (
                  <button
                    type="button"
                    className="min-h-12 text-sm font-semibold text-brand-800 underline"
                    disabled={busy}
                    onClick={() => onMakeMain(photo)}
                    aria-label={`Make photo ${index + 1} the main photo of ${courtName}`}
                  >
                    Make main
                  </button>
                )}
                <button
                  type="button"
                  className="min-h-12 text-sm font-semibold text-red-700 underline"
                  disabled={busy}
                  onClick={() => onRemove(photo)}
                  aria-label={`Remove photo ${index + 1} of ${courtName}`}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-600">No photos yet. Players see a sample picture until you add one.</p>
      )}
      {progress ? <p className="text-sm font-semibold text-brand-800" role="status">{progress}</p> : null}
      {room > 0 ? (
        <PickPhotos label={photos.length ? 'Add more photos' : 'Add photos'} multiple disabled={busy} onPick={(files) => onAdd(files.slice(0, room))} />
      ) : (
        <p className="text-sm text-slate-600">This court has the most photos allowed. Remove one to add another.</p>
      )}
    </div>
  )
}

/** One cover photo for a location, shown at the top of its section on the club page. */
export function VenueCoverEditor({
  venueName,
  cover,
  busy,
  onSet,
  onRemove,
}: {
  venueName: string
  cover: CourtPhoto | null
  busy: boolean
  onSet: (file: File) => void
  onRemove: () => void
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-bold text-slate-700 flex items-center gap-1"><Camera size={16} aria-hidden /> Cover photo</h3>
      {cover ? (
        <img src={cover.url} alt={`Cover photo of ${venueName}`} className="aspect-[16/9] w-full rounded-xl border border-slate-200 object-cover" loading="lazy" />
      ) : (
        <p className="text-sm text-slate-600">No cover photo yet. A good one shows the whole place, like the entrance or all courts.</p>
      )}
      {busy ? <p className="text-sm font-semibold text-brand-800" role="status">Saving the cover photo…</p> : null}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <PickPhotos label={cover ? 'Change cover photo' : 'Add cover photo'} disabled={busy} onPick={(files) => onSet(files[0])} />
        {cover ? (
          <button type="button" className="btn-secondary text-sm" disabled={busy} onClick={onRemove}>
            Remove cover photo
          </button>
        ) : null}
      </div>
    </div>
  )
}
