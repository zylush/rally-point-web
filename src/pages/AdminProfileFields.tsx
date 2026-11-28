import type { ReactNode } from 'react'

// Small form pieces shared by the business profile cards.

export function SectionTitle({ id, hint, children }: { id: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      {/* Focusable from code, so focus has somewhere to land when the item it was on is removed. */}
      <h2 id={id} className="font-extrabold" tabIndex={-1}>{children}</h2>
      {hint ? <p className="text-xs text-slate-500 mt-1">{hint}</p> : null}
    </div>
  )
}

/** Waits while any save is running; shows "Saving…" only on the one that is. */
export function SaveButton({ busy, name, children }: { busy: string | null; name: string; children: ReactNode }) {
  const mine = busy === name
  return (
    <button type="submit" className="btn-primary" disabled={busy !== null} aria-busy={mine}>
      {mine ? 'Saving…' : children}
    </button>
  )
}

export function TextField({
  id, label, value, onChange, type = 'text', placeholder, max, required, inputMode, list,
}: {
  id: string
  label: string
  value: string | null
  onChange: (value: string | null) => void
  type?: 'text' | 'tel' | 'email' | 'url' | 'number'
  placeholder?: string
  max?: number
  required?: boolean
  inputMode?: 'decimal' | 'tel' | 'email' | 'url' | 'text'
  list?: string
}) {
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <input
        id={id}
        className="input"
        type={type}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        maxLength={type === 'number' ? undefined : max}
        required={required}
        inputMode={inputMode}
        list={list}
        {...(type === 'number' ? { min: 0, max: 100000, step: '0.01' } : {})}
      />
    </div>
  )
}

export function TextArea({
  id, label, value, onChange, max, rows = 4, placeholder,
}: {
  id: string
  label: string
  value: string | null
  onChange: (value: string | null) => void
  max: number
  rows?: number
  placeholder?: string
}) {
  const length = (value ?? '').length
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <textarea
        id={id}
        className="input"
        rows={rows}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        maxLength={max}
        placeholder={placeholder}
        aria-describedby={`${id}-count`}
      />
      <p id={`${id}-count`} className="mt-1 text-xs text-slate-500">{length.toLocaleString()} of {max.toLocaleString()} characters</p>
    </div>
  )
}

export function ActiveToggle({ id, checked, onChange, hint }: { id: string; checked: boolean; onChange: (value: boolean) => void; hint: string }) {
  return (
    <label htmlFor={id} className="min-h-12 rounded-xl border border-slate-200 px-3 py-2 flex items-center gap-3 text-sm">
      <input id={id} type="checkbox" className="h-5 w-5" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="flex-1">
        <span className="font-semibold">Show on club page</span>
        <span className="block text-xs text-slate-500">{hint}</span>
      </span>
    </label>
  )
}

export function FormButtons({ saving, onCancel, label }: { saving: boolean; onCancel: () => void; label: string }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
      <button type="submit" className="btn-primary" disabled={saving} aria-busy={saving}>{saving ? 'Saving…' : label}</button>
    </div>
  )
}

export function HiddenPill({ shown }: { shown: boolean }) {
  return shown ? null : <span className="pill pill-warn whitespace-nowrap">Hidden</span>
}
