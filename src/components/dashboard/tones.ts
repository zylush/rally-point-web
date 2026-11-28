/**
 * The one tone → class map every dashboard piece uses, so a "warn" chip, bar, dot and
 * number all mean the same colour. Class strings are written out in full so Tailwind
 * finds them. Flat fills only: no gradients, glows or shadows.
 */
export type Tone = 'brand' | 'ok' | 'warn' | 'danger' | 'ink' | 'muted'

export interface ToneClasses {
  /** Icon chip: pale background, strong foreground. */
  chip: string
  /** Text and `currentColor` drawings (sparklines). */
  text: string
  /** Solid fill for bars, meters and legend dots. */
  fill: string
  /** A darker fill for the bar under the pointer or focus. */
  fillStrong: string
  /** A count pill. */
  pill: string
}

export const TONES: Record<Tone, ToneClasses> = {
  brand: {
    chip: 'bg-brand-50 text-brand-700',
    text: 'text-brand-700',
    fill: 'bg-brand-700',
    fillStrong: 'bg-brand-900',
    pill: 'pill-brand',
  },
  ok: {
    chip: 'bg-green-50 text-ok',
    text: 'text-ok',
    fill: 'bg-ok',
    fillStrong: 'bg-green-900',
    pill: 'pill-ok',
  },
  warn: {
    chip: 'bg-amber-50 text-warn',
    text: 'text-warn',
    fill: 'bg-warn',
    fillStrong: 'bg-amber-900',
    pill: 'pill-warn',
  },
  danger: {
    chip: 'bg-red-50 text-danger',
    text: 'text-danger',
    fill: 'bg-danger',
    fillStrong: 'bg-red-900',
    pill: 'bg-red-100 text-red-900',
  },
  ink: {
    chip: 'bg-slate-100 text-ink',
    text: 'text-ink',
    fill: 'bg-ink',
    fillStrong: 'bg-brand-700',
    pill: 'pill-muted',
  },
  muted: {
    chip: 'bg-slate-100 text-muted',
    text: 'text-muted',
    fill: 'bg-slate-400',
    fillStrong: 'bg-slate-600',
    pill: 'pill-muted',
  },
}

/** Whole-percent share of a total, 0 when the total is 0. */
export function sharePct(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 100) : 0
}
