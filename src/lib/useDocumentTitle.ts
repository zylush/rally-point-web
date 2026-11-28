import { useEffect } from 'react'

export const SITE_NAME = 'bRineLy'

/** "Find a court · bRineLy": the page first, so tabs and history stay readable. */
export function documentTitle(title?: string) {
  const page = title?.trim()
  return page && page !== SITE_NAME ? `${page} · ${SITE_NAME}` : SITE_NAME
}

/**
 * Names the browser tab after the page, and puts back the name it had when the page opened once the page goes.
 * The name to restore is taken once, on mount, so a title that changes while the page is open
 * (or the hook running in both a frame and its header) never leaves an in-between name behind.
 */
export function useDocumentTitle(title?: string) {
  // Declared first so it reads the tab name before the effect below changes it.
  useEffect(() => {
    const original = document.title
    return () => {
      document.title = original
    }
  }, [])

  useEffect(() => {
    document.title = documentTitle(title)
  }, [title])
}
