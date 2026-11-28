import type { PictureCleanup } from '../types'

/**
 * Runs one save; returns true when it worked, so a form can close. When the action
 * resolves to text, that text is added to the `done` message.
 */
export type Run = (key: string, action: () => Promise<unknown>, done: string) => Promise<boolean>

/** The message at the bottom of the screen. Problems are announced straight away. */
export type Notice = { text: string; tone: 'done' | 'problem' }

export const sentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`)

/** A note for the admin when an old picture's file could not be deleted. */
export const fileNote = (cleanup: PictureCleanup) =>
  cleanup.fileLeftBehind ? 'The old picture file could not be deleted, so it may still open from its old link.' : undefined

export const linkStyle = 'inline-flex min-h-12 items-center text-sm font-semibold text-brand-800 underline'
export const removeStyle = 'inline-flex min-h-12 items-center text-sm font-semibold text-red-700 underline'

/** A number field's text as a number, or null when empty. */
export function asNumber(value: string | null) {
  return value == null || value.trim() === '' ? null : Number(value)
}
