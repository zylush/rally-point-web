import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react'

export const PRIVACY_READ_FIRST_ERROR = 'Read to the end of the Privacy Notice first, then tick the box.'
export const PRIVACY_ACK_ERROR = 'Tick the box to confirm you have read the Privacy Notice.'

/** Bottom threshold in pixels so mobile fractional scroll values still unlock cleanly. */
const SCROLL_BOTTOM_TOLERANCE_PX = 24

/** Returns true when a scrollable notice box has reached the end (within fractional scroll tolerance). */
export function hasReachedPrivacyBottom(element: HTMLElement): boolean {
  if (element.clientHeight <= 0) return false
  return element.scrollTop + element.clientHeight >= element.scrollHeight - SCROLL_BOTTOM_TOLERANCE_PX
}

export type PrivacyGateOptions = {
  onUnlock?: () => void
  onCheck?: (checked: boolean) => void
}

export type PrivacyGate = {
  read: boolean
  checked: boolean
  readerOpen: boolean
  checkboxRef: RefObject<HTMLInputElement | null>
  readerRef: RefObject<HTMLDivElement | null>
  setReaderOpen: Dispatch<SetStateAction<boolean>>
  openReaderAndFocus: () => void
  unlock: (options?: { focusCheckbox?: boolean }) => void
  setChecked: (checked: boolean) => void
  validate: (uncheckedError?: string) => string | null
  reset: () => void
}

/** Coordinates inline reading progress, unlock state, focus transitions, and form validation. */
export function usePrivacyGate(options: PrivacyGateOptions = {}): PrivacyGate {
  const [read, setRead] = useState(false)
  const [checked, setCheckedState] = useState(false)
  const [readerOpen, setReaderOpen] = useState(false)
  const checkboxRef = useRef<HTMLInputElement>(null)
  const readerRef = useRef<HTMLDivElement>(null)
  const focusReaderPending = useRef(false)
  const focusCheckboxPending = useRef(false)
  const readRef = useRef(false)
  const checkedRef = useRef(false)
  const readerOpenRef = useRef(false)
  const latestOptions = useRef(options)

  useEffect(() => {
    latestOptions.current = options
  })

  useEffect(() => {
    readRef.current = read
    checkedRef.current = checked
    readerOpenRef.current = readerOpen
  }, [read, checked, readerOpen])

  const unlock = useCallback((unlockOptions?: { focusCheckbox?: boolean }) => {
    if (readRef.current) {
      if (unlockOptions?.focusCheckbox) checkboxRef.current?.focus()
      return
    }
    if (unlockOptions?.focusCheckbox) focusCheckboxPending.current = true
    readRef.current = true
    setRead(true)
    latestOptions.current.onUnlock?.()
  }, [])

  const openReaderAndFocus = useCallback(() => {
    if (readerOpenRef.current && readerRef.current) {
      readerRef.current.focus()
      return
    }
    focusReaderPending.current = true
    readerOpenRef.current = true
    setReaderOpen(true)
  }, [])

  const setChecked = useCallback((next: boolean) => {
    if (next && !readRef.current) return
    checkedRef.current = next
    setCheckedState(next)
    latestOptions.current.onCheck?.(next)
  }, [])

  const reset = useCallback(() => {
    focusReaderPending.current = false
    focusCheckboxPending.current = false
    readRef.current = false
    checkedRef.current = false
    readerOpenRef.current = false
    setRead(false)
    setCheckedState(false)
    setReaderOpen(false)
  }, [])

  const validate = useCallback(
    (uncheckedError = PRIVACY_ACK_ERROR): string | null => {
      if (!readRef.current) {
        openReaderAndFocus()
        return PRIVACY_READ_FIRST_ERROR
      }
      if (!checkedRef.current) {
        checkboxRef.current?.focus()
        return uncheckedError
      }
      return null
    },
    [openReaderAndFocus],
  )

  useEffect(() => {
    if (!readerOpen) return
    const reader = readerRef.current
    if (!reader) return
    if (focusReaderPending.current) {
      focusReaderPending.current = false
      reader.focus()
    }
    if (!readRef.current && hasReachedPrivacyBottom(reader)) {
      readRef.current = true
      setRead(true)
      latestOptions.current.onUnlock?.()
    }
  }, [readerOpen])

  useEffect(() => {
    if (!read || !focusCheckboxPending.current) return
    focusCheckboxPending.current = false
    checkboxRef.current?.focus()
  }, [read])

  return {
    read,
    checked,
    readerOpen,
    checkboxRef,
    readerRef,
    setReaderOpen,
    openReaderAndFocus,
    unlock,
    setChecked,
    validate,
    reset,
  }
}
