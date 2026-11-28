import { useEffect, useRef, type RefObject } from 'react'

/** Controls that Tab can reach inside a dialog. */
const FOCUSABLE =
  'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex]:not([tabindex="-1"])'

type ModalDialogOptions = {
  /** The element with role="dialog". Tab stays inside it. */
  dialogRef: RefObject<HTMLElement | null>
  /** Gets focus when the dialog opens. */
  initialFocusRef: RefObject<HTMLElement | null>
  /** Runs on Escape. The caller decides whether the dialog may close right now. */
  onEscape: () => void
  /** Gets focus back when the dialog closes. Without it, focus returns to whatever had it before. */
  returnFocusRef?: RefObject<HTMLElement | null>
  /** Stops the page behind the dialog from scrolling. */
  lockScroll?: boolean
}

/**
 * Makes an open dialog modal: the app behind it (#root) is inert, Tab stays inside,
 * Escape calls `onEscape`, and focus goes back where it was when the dialog closes.
 * Render the dialog outside #root (a portal to document.body) so it is not made inert too.
 */
export function useModalDialog(open: boolean, options: ModalDialogOptions) {
  // The key listener is added once per opening and reads the newest options from here.
  // Re-running the effect on every render would pull focus back to the first field while
  // the person types.
  const latest = useRef(options)
  useEffect(() => {
    latest.current = options
  })

  useEffect(() => {
    if (!open) return
    const { dialogRef, initialFocusRef, returnFocusRef, lockScroll } = latest.current
    // Note where focus was before moving it, so it can go back there on close.
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const trigger = returnFocusRef ? returnFocusRef.current : active
    const appRoot = document.getElementById('root')
    const wasInert = appRoot?.inert ?? false
    const previousOverflow = document.body.style.overflow
    if (appRoot) appRoot.inert = true
    if (lockScroll) document.body.style.overflow = 'hidden'
    initialFocusRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        latest.current.onEscape()
        return
      }
      if (event.key !== 'Tab') return

      const dialog = dialogRef.current
      const focusable = dialog?.querySelectorAll<HTMLElement>(FOCUSABLE)
      if (!focusable?.length) {
        event.preventDefault()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const current = document.activeElement
      if (!dialog?.contains(current)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      } else if (event.shiftKey && current === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && current === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      if (appRoot) appRoot.inert = wasInert
      if (lockScroll) document.body.style.overflow = previousOverflow
      if (trigger?.isConnected) trigger.focus()
    }
  }, [open])
}
