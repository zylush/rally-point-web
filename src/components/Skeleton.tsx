import type { ReactNode } from 'react'

/*
 * Loading placeholders shaped like the content they stand in for, so nothing jumps
 * when it arrives. Wrap a screen's shapes in one `LoadingShapes` (it announces the
 * wait once); every other piece here is silent. Grey `.skeleton` shapes shimmer
 * gently and stand still for people who ask for reduced motion.
 *
 * Class conventions for screens that build their own shapes:
 * - `.skeleton` on any block; its 8px corner beats Tailwind's, so override with `!`
 *   (`rounded-[18px]!` to match a `.card`, `rounded-[16px]!` for a button).
 * - Put `aria-hidden` on the shapes, never `aria-busy` on the wrapper.
 * - When the real content lands, give it `enter-rise` (and `style={stagger(i)}` per
 *   list item, from `src/lib/motion.ts`) so it settles in once.
 */

/**
 * Announces loading to screen readers once; the placeholder shapes inside stay hidden from them.
 * A visible caption repeats the label for sighted people: by default only when they ask for
 * reduced motion (the shapes then stand still, so they no longer look like loading), or always
 * with `caption="always"`. The caption is drawn by CSS from `data-label` and hidden from
 * assistive tech, so the label is announced and found in the page text exactly once.
 * The column uses `gap`, so a hidden caption and the off-screen status take no space.
 */
export function LoadingShapes({
  label,
  caption = 'reduced-motion',
  tone = 'light',
  children,
}: {
  label: string
  caption?: 'always' | 'reduced-motion'
  /** `dark` keeps the caption readable on the dark TV board. */
  tone?: 'light' | 'dark'
  children: ReactNode
}) {
  return (
    <div className="pointer-events-none select-none flex flex-col gap-4">
      <p role="status" className="sr-only">{label}</p>
      {/* Above the shapes, so it stays on screen on a phone when the shapes run past the fold. */}
      <p
        className={`loading-caption text-center text-body font-semibold ${tone === 'dark' ? 'text-slate-300' : 'text-slate-500'}${caption === 'always' ? ' loading-caption-always' : ''}`}
        data-label={label}
        aria-hidden
      />
      {children}
    </div>
  )
}

/** Line box heights (the type scale's line heights) and bar heights (its font sizes). */
const lineSizes = {
  heading: 'h-8 *:h-6', // text-2xl
  title: 'h-[26px] *:h-[18px]', // text-title
  subtitle: 'h-6 *:h-4', // text-subtitle, text-base
  body: 'h-[22px] *:h-[14px]', // text-body
  small: 'h-5 *:h-3.5', // Tailwind text-sm
  caption: 'h-4 *:h-3', // text-caption, text-xs
} as const

export type SkeletonLineSize = keyof typeof lineSizes

/** One line of text: takes the line's full height, with a bar the size of the letters. Width via `className`. */
export function SkeletonLine({ size = 'body', className = 'w-full' }: { size?: SkeletonLineSize; className?: string }) {
  return (
    <div className={`flex items-center ${lineSizes[size]} ${className}`}>
      <div className="skeleton w-full" />
    </div>
  )
}

/** A solid shape (photo, button, tile). Size and corners via `className`. */
export function SkeletonBlock({ className = 'h-24 w-full' }: { className?: string }) {
  return <div className={`skeleton ${className}`} />
}

/** A plain `.card` with the app's usual padding, to hold other shapes. */
export function SkeletonCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card p-4 ${className}`}>{children}</div>
}

/** List rows like the app's `.list-row` cards: a name, a detail line and a short value on the right. */
export function SkeletonRows({ count = 3 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, key) => (
        <div key={key} className="list-row">
          <div className="min-w-0 flex-1">
            <SkeletonLine size="subtitle" className="w-3/5" />
            <SkeletonLine className="w-2/5" />
          </div>
          <SkeletonLine size="subtitle" className="w-16" />
        </div>
      ))}
    </>
  )
}
