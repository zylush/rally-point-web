import type { CSSProperties } from 'react'

/** Delay for the `enter-rise` entrance, so a list settles in order. Capped so long lists never wait. */
export function stagger(index: number): CSSProperties {
  return { '--stagger': Math.min(index, 8) } as CSSProperties
}
