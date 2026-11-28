import { useState } from 'react'
import { api } from '../lib/api'
import { MAX_CLUB_GALLERY_PHOTOS, captionProblem, cleanText } from '../lib/clubProfile'
import { focusById } from '../lib/formFocus'
import { stagger } from '../lib/motion'
import type { AdminClubProfile } from '../types'
import { PickPhotos } from './AdminPhotos'
import { SectionTitle, TextField } from './AdminProfileFields'
import { fileNote, removeStyle, type Run } from './adminProfileShared'

export function GalleryCard({ index, gallery, busy, run }: { index: number; gallery: AdminClubProfile['gallery']; busy: string | null; run: Run }) {
  const [caption, setCaption] = useState<string | null>('')
  const [progress, setProgress] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const room = MAX_CLUB_GALLERY_PHOTOS - gallery.length

  async function add(files: File[]) {
    const found = captionProblem(caption)
    setProblem(found)
    if (found) return
    const picked = files.slice(0, room)
    const leftOut = files.length - picked.length
    const addedText = picked.length === 1 ? 'Photo added' : `${picked.length} photos added`
    const done = leftOut
      ? `${addedText}. ${leftOut === 1 ? '1 photo was' : `${leftOut} photos were`} left out: the gallery holds ${MAX_CLUB_GALLERY_PHOTOS}.`
      : addedText
    let added = 0
    const ok = await run('gallery', async () => {
      try {
        for (const [position, file] of picked.entries()) {
          setProgress(picked.length > 1 ? `Uploading ${position + 1} of ${picked.length}…` : 'Uploading…')
          await api.addClubPhoto(file, cleanText(caption))
          added += 1
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Could not add the photo'
        throw new Error(added ? `${added} added, then: ${reason}` : reason)
      } finally {
        setProgress(null)
      }
    }, done)
    // Keep the caption after a failure, so it need not be typed again.
    if (ok) setCaption('')
  }

  return (
    <section className="enter-rise card p-4 space-y-3" style={stagger(index)} aria-labelledby="profile-gallery">
      <SectionTitle id="profile-gallery" hint={`${gallery.length} of ${MAX_CLUB_GALLERY_PHOTOS} photos. Show your place: the entrance, the courts, the lounge, a tournament.`}>
        Photo gallery
      </SectionTitle>
      {gallery.length ? (
        <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {gallery.map((photo, position) => (
            <li key={photo.id} className="overflow-hidden rounded-xl border border-slate-200">
              <img src={photo.url} alt={photo.caption ?? `Club photo ${position + 1}`} className="aspect-[4/3] w-full object-cover" loading="lazy" />
              {photo.caption ? <p className="px-2 pt-1 text-xs text-slate-600">{photo.caption}</p> : null}
              <button
                type="button"
                className={`${removeStyle} w-full justify-center`}
                disabled={busy !== null}
                onClick={() => {
                  if (!window.confirm('Remove this photo? Players will no longer see it.')) return
                  void run(`gallery:${photo.id}`, async () => fileNote(await api.removeClubPhoto(photo.id)), 'Photo removed')
                    .then((ok) => ok && focusById('profile-gallery'))
                }}
                aria-label={`Remove club photo ${position + 1}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-600">No photos yet.</p>
      )}
      {progress ? <p className="text-sm font-semibold text-brand-800" role="status">{progress}</p> : null}
      {room > 0 ? (
        <div className="space-y-2">
          <TextField id="gallery-caption" label="Caption for the next photos (optional)" value={caption} onChange={setCaption} placeholder="Our six indoor courts" max={120} />
          {problem ? <p className="text-sm font-semibold text-red-700" role="alert">{problem}</p> : null}
          <PickPhotos label={gallery.length ? 'Add more photos' : 'Add photos'} multiple disabled={busy !== null} onPick={(files) => void add(files)} />
        </div>
      ) : (
        <p className="text-sm text-slate-600">The gallery is full. Remove a photo to add another.</p>
      )}
    </section>
  )
}
