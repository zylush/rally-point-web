import { useEffect, useRef } from 'react'
import { isDemoMode, supabase } from './supabase'

const BROADCAST_NAME = 'brinely-club-live'
const DEMO_STORAGE_KEY = 'brinely_demo_v4'

function cleanKeys(keys: Array<string | null | undefined>): string[] {
  return [...new Set(keys.map((key) => key?.trim().toLowerCase()).filter((key): key is string => Boolean(key)))]
}

/**
 * Notifies open club screens (players, staff, public club pages, and floor TVs)
 * that match standings changed, carrying zero player identity or PII.
 */
export function emitClubLiveUpdate(keys: Array<string | null | undefined>) {
  const targets = cleanKeys(keys)
  if (targets.length === 0) return

  if (typeof BroadcastChannel === 'function') {
    try {
      const channel = new BroadcastChannel(BROADCAST_NAME)
      channel.postMessage({ type: 'standings_updated', keys: targets })
      channel.close()
    } catch {
      // Ignore browser channel errors in restricted contexts.
    }
  }

  if (!isDemoMode && supabase && typeof supabase.channel === 'function') {
    for (const key of targets) {
      try {
        const channel = supabase.channel(`club-live:${key}`)
        let done = false
        const cleanup = () => {
          if (done) return
          done = true
          if (typeof supabase?.removeChannel === 'function') {
            void supabase.removeChannel(channel)
          }
        }
        const timer = window.setTimeout(cleanup, 5000)
        channel.subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            void Promise.resolve(
              channel.send({ type: 'broadcast', event: 'standings_updated', payload: { at: Date.now() } }),
            ).finally(() => {
              window.clearTimeout(timer)
              cleanup()
            })
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            window.clearTimeout(timer)
            cleanup()
          }
        })
      } catch {
        // Ignore realtime errors; polling keeps open screens updated.
      }
    }
  }
}

/**
 * Subscribes a live club screen (standings, player view, or TV board) to quiet
 * refresh pulses, tab-wakeup updates, and fallback polling.
 */
export function useClubLiveRefresh(
  keys: Array<string | null | undefined>,
  onRefresh: () => void,
  pollMs = 15000,
) {
  const latestRefresh = useRef(onRefresh)
  useEffect(() => {
    latestRefresh.current = onRefresh
  })

  const keyList = cleanKeys(keys)
  const keySignature = keyList.join('|')

  useEffect(() => {
    if (!keySignature) return
    const activeKeys = new Set(keySignature.split('|'))
    const trigger = () => latestRefresh.current()

    let bc: BroadcastChannel | null = null
    if (typeof BroadcastChannel === 'function') {
      try {
        bc = new BroadcastChannel(BROADCAST_NAME)
        bc.onmessage = (event) => {
          const payload = event.data as { type?: unknown; keys?: unknown } | null
          if (payload?.type !== 'standings_updated') return
          const msgKeys = Array.isArray(payload.keys) ? payload.keys : []
          if (msgKeys.some((key) => typeof key === 'string' && activeKeys.has(key))) {
            trigger()
          }
        }
      } catch {
        bc = null
      }
    }

    const onStorage = (event: StorageEvent) => {
      if (isDemoMode && event.key === DEMO_STORAGE_KEY) trigger()
    }
    window.addEventListener('storage', onStorage)

    const onVisibility = () => {
      if (document.visibilityState === 'visible') trigger()
    }
    document.addEventListener('visibilitychange', onVisibility)

    const channels: ReturnType<NonNullable<typeof supabase>['channel']>[] = []
    if (!isDemoMode && supabase && typeof supabase.channel === 'function') {
      for (const key of activeKeys) {
        try {
          const channel = supabase
            .channel(`club-live:${key}`)
            .on('broadcast', { event: 'standings_updated' }, () => trigger())
            .subscribe()
          channels.push(channel)
        } catch {
          // Fallback polling remains active.
        }
      }
    }

    const timer = pollMs > 0
      ? window.setInterval(() => {
          if (document.visibilityState === 'visible') trigger()
        }, pollMs)
      : null

    return () => {
      if (timer !== null) window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('storage', onStorage)
      if (bc) bc.close()
      if (supabase && typeof supabase.removeChannel === 'function') {
        for (const channel of channels) {
          void supabase.removeChannel(channel)
        }
      }
    }
  }, [keySignature, pollMs])
}
