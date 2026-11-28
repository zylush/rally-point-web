import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { focusById } from '../lib/formFocus'
import { stagger } from '../lib/motion'
import { SectionTitle } from './AdminProfileFields'
import type { Run } from './adminProfileShared'

/**
 * Picture files nothing uses any more: a delete that did not go through, or an upload that
 * was never saved. They still open from their old links until deleted, so the admin can
 * delete them here. Shown only when there are some (never in the demo, which stores no files).
 */
export function UnusedPicturesCard({ index, busy, run }: { index: number; busy: string | null; run: Run }) {
  const [count, setCount] = useState(0)

  /** Counts the unused files again; null when they could not be listed. */
  const check = useCallback(async (): Promise<number | null> => {
    try {
      const found = (await api.unusedClubPictures()).length
      setCount(found)
      return found
    } catch {
      setCount(0)
      return null
    }
  }, [])

  useEffect(() => {
    void check()
  }, [check])

  if (count === 0) return null

  const files = count === 1 ? '1 old picture file is' : `${count >= 200 ? '200 or more' : count} old picture files are`

  async function deleteThem() {
    let remaining = count
    await run('unused', async () => {
      const result = await api.deleteUnusedClubPictures()
      // The fresh list is what the card shows, so the message follows it too.
      remaining = (await check()) ?? result.left
      if (remaining > 0 && !result.more) {
        throw new Error(`${remaining === 1 ? '1 file' : `${remaining} files`} could not be deleted. Try again later.`)
      }
      return remaining > 0 ? 'More are left: tap the button again.' : undefined
    }, 'Old picture files deleted')
    // Once nothing is left the card goes away, so focus moves to the section above;
    // otherwise it goes back to the button.
    focusById(remaining === 0 ? 'profile-gallery' : 'unused-delete')
  }

  return (
    <section className="enter-rise card p-4 space-y-3" style={stagger(index)} aria-labelledby="profile-unused">
      <SectionTitle id="profile-unused">Old picture files</SectionTitle>
      <p className="text-sm text-slate-700">
        {files} no longer used on your club page or courts: a removal that did not finish, or an upload that was
        never saved. They can still open from their old links until you delete them.
      </p>
      <button type="button" id="unused-delete" className="btn-secondary w-full" disabled={busy !== null} aria-busy={busy === 'unused'} onClick={() => void deleteThem()}>
        {busy === 'unused' ? 'Deleting…' : 'Delete old picture files'}
      </button>
    </section>
  )
}
