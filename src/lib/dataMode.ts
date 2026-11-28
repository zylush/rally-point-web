import { isDemoMode } from './supabase'

export type DataMode = 'demo' | 'test' | 'live'

/**
 * What this build shows: the seeded browser demo, a hosted test (staging) database, or the
 * production one. `VITE_DATA_TARGET` is set by vite.config.ts for hosted builds; only an
 * explicit "Production" counts as live, so an unknown target is labelled a test site.
 */
export function dataMode(demo: boolean = isDemoMode, target: unknown = import.meta.env.VITE_DATA_TARGET): DataMode {
  if (demo) return 'demo'
  return target === 'Production' ? 'live' : 'test'
}
