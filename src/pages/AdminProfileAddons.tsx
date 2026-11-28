import { useRef, useState, type FormEvent } from 'react'
import { api } from '../lib/api'
import { ADDON_UNITS, MAX_CLUB_ADDONS, addonPriceLabel, addonProblem, cleanText } from '../lib/clubProfile'
import { focusById, useFocusFirstField, useInlineForm } from '../lib/formFocus'
import { stagger } from '../lib/motion'
import type { AddonUnit, ClubAddon, ClubAddonInput } from '../types'
import { ActiveToggle, FormButtons, HiddenPill, SectionTitle, TextField } from './AdminProfileFields'
import { asNumber, linkStyle, removeStyle, type Run } from './adminProfileShared'

export function AddonsCard({ index, addons, busy, run }: { index: number; addons: ClubAddon[]; busy: string | null; run: Run }) {
  const { editing, open, close } = useInlineForm()
  return (
    <section className="enter-rise card p-4 space-y-3" style={stagger(index)} aria-labelledby="profile-addons">
      <SectionTitle id="profile-addons" hint="Paddle rental, balls, towels and other extras. Players see them on your club page and pay for them at the club.">
        Add-ons
      </SectionTitle>
      {addons.length === 0 ? <p className="text-sm text-slate-600">No add-ons yet.</p> : null}
      <ul className="space-y-2">
        {addons.map((addon) => (
          <li key={addon.id} className="rounded-xl border border-slate-200 p-3">
            {editing === addon.id ? (
              <AddonForm
                addon={addon}
                saving={busy === `addon:${addon.id}`}
                onCancel={close}
                onSave={async (input) => {
                  if (await run(`addon:${addon.id}`, () => api.upsertClubAddon(input), `${input.name.trim()} saved`)) close()
                }}
              />
            ) : (
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">{addon.name}</p>
                  <p className="text-sm text-brand-800">{addonPriceLabel(addon.price, addon.unit)}</p>
                  {addon.description ? <p className="text-sm text-slate-600">{addon.description}</p> : null}
                  <div className="flex flex-wrap gap-x-4">
                    <button type="button" id={`addon-${addon.id}-edit`} className={linkStyle}
                      onClick={() => open(addon.id, `addon-${addon.id}-edit`, 'profile-addons')} aria-label={`Edit ${addon.name}`}>
                      Edit
                    </button>
                    <button type="button" className={removeStyle} disabled={busy !== null}
                      onClick={() => {
                        if (!window.confirm(`Remove ${addon.name}? Players will no longer see it.`)) return
                        void run(`addon:${addon.id}`, () => api.removeClubAddon(addon.id), `${addon.name} removed`)
                          .then((ok) => ok && focusById('profile-addons'))
                      }}
                      aria-label={`Remove ${addon.name}`}>
                      Remove
                    </button>
                  </div>
                </div>
                <HiddenPill shown={addon.is_active} />
              </div>
            )}
          </li>
        ))}
      </ul>
      {editing === 'new' ? (
        <div className="rounded-xl border border-slate-200 p-3">
          <AddonForm
            saving={busy === 'addon:new'}
            onCancel={close}
            onSave={async (input) => {
              if (await run('addon:new', () => api.upsertClubAddon(input), `${input.name.trim()} added`)) close()
            }}
          />
        </div>
      ) : addons.length < MAX_CLUB_ADDONS ? (
        <button type="button" id="addon-add" className="btn-secondary w-full" onClick={() => open('new', 'addon-add', 'profile-addons')}>
          Add an add-on
        </button>
      ) : (
        <p className="text-sm text-slate-600">You have the most add-ons allowed ({MAX_CLUB_ADDONS}). Remove one to add another.</p>
      )}
    </section>
  )
}

function AddonForm({
  addon, saving, onCancel, onSave,
}: {
  addon?: ClubAddon
  saving: boolean
  onCancel: () => void
  onSave: (input: ClubAddonInput) => Promise<void>
}) {
  const [name, setName] = useState<string | null>(addon?.name ?? '')
  const [description, setDescription] = useState<string | null>(addon?.description ?? '')
  const [price, setPrice] = useState<string | null>(addon ? String(addon.price) : '')
  const [unit, setUnit] = useState<AddonUnit>(addon?.unit ?? 'per_hour')
  const [active, setActive] = useState(addon?.is_active ?? true)
  const [problem, setProblem] = useState<string | null>(null)
  const prefix = addon ? `addon-${addon.id}` : 'addon-new'
  const formRef = useRef<HTMLFormElement>(null)
  useFocusFirstField(formRef)

  function submit(event: FormEvent) {
    event.preventDefault()
    const input: ClubAddonInput = {
      id: addon?.id,
      name: name ?? '',
      description: cleanText(description),
      price: asNumber(price) ?? Number.NaN,
      unit,
      is_active: active,
    }
    const found = addonProblem(input)
    setProblem(found)
    if (!found) void onSave(input)
  }

  return (
    <form ref={formRef} className="space-y-3" onSubmit={submit} aria-label={addon ? `Edit ${addon.name}` : 'Add an add-on'}>
      <TextField id={`${prefix}-name`} label="Name" value={name} onChange={setName} placeholder="Paddle rental" max={60} required />
      <div className="grid grid-cols-2 gap-2">
        <TextField id={`${prefix}-price`} label="Price (Php)" value={price} onChange={setPrice} type="number" inputMode="decimal" required />
        <div>
          <label className="label" htmlFor={`${prefix}-unit`}>Charged</label>
          <select id={`${prefix}-unit`} className="input" value={unit} onChange={(event) => setUnit(event.target.value as AddonUnit)}>
            {ADDON_UNITS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
      </div>
      <TextField id={`${prefix}-description`} label="Short description (optional)" value={description} onChange={setDescription} placeholder="Two paddles, ask at the desk" max={200} />
      <ActiveToggle id={`${prefix}-active`} checked={active} onChange={setActive} hint="Turn off when it is not available, without deleting it." />
      {problem ? <p className="text-sm font-semibold text-red-700" role="alert">{problem}</p> : null}
      <FormButtons saving={saving} onCancel={onCancel} label={addon ? 'Save' : 'Add'} />
    </form>
  )
}
