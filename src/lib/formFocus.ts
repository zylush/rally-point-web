import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

/**
 * Which inline form is open (an item's id, or 'new' for the add form), with keyboard focus
 * kept in step. Closing a form returns focus to the button that opened it. That button is
 * found by id, because it is usually drawn again only once the form has closed; when it is
 * gone (for example the list is now full), focus goes to `fallbackId` instead.
 */
export function useInlineForm() {
  const [editing, setEditing] = useState<string | null>(null)
  const returnTo = useRef<{ id: string; fallbackId?: string } | null>(null)

  useEffect(() => {
    if (editing !== null || !returnTo.current) return
    const { id, fallbackId } = returnTo.current
    returnTo.current = null
    ;(document.getElementById(id) ?? (fallbackId ? document.getElementById(fallbackId) : null))?.focus()
  }, [editing])

  const open = useCallback((formId: string, openerId: string, fallbackId?: string) => {
    returnTo.current = { id: openerId, fallbackId }
    setEditing(formId)
  }, [])
  const close = useCallback(() => setEditing(null), [])
  return { editing, open, close }
}

/** Moves focus to the first field of a form as soon as it opens. */
export function useFocusFirstField(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('input, select, textarea')?.focus()
  }, [ref])
}

/** Moves focus to an element by id; used when the control that had focus is gone, as after a removal. */
export function focusById(id: string) {
  document.getElementById(id)?.focus()
}
