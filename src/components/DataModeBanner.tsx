import { dataMode, type DataMode } from '../lib/dataMode'

const copy: Record<Exclude<DataMode, 'live'>, { label: string; text: string }> = {
  demo: {
    label: 'Demo site.',
    text: 'The clubs, courts and bookings here are made up and stay in this browser. Don’t pay anything.',
  },
  test: {
    label: 'Test site.',
    text: 'The clubs, courts and prices here are for testing and are not real. Don’t send any GCash payment.',
  },
}

/**
 * A plain line across the top of every page outside production, so nobody mistakes sample
 * clubs for real ones or pays a test club's QR code. It cannot be closed.
 */
export function DataModeBanner({ mode = dataMode() }: { mode?: DataMode }) {
  if (mode === 'live') return null
  const { label, text } = copy[mode]
  return (
    <div role="note" aria-label="About this site" className="border-b-2 border-amber-400 bg-amber-100 px-4 py-2 text-center text-subtitle text-amber-950">
      <span className="font-extrabold">{label}</span> {text}
    </div>
  )
}
