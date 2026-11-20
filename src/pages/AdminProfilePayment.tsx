import { useRef, useState, type FormEvent } from 'react'
import { api } from '../lib/api'
import { MAX_CLUB_PAYMENT_METHODS, cleanText, paymentMethodProblem } from '../lib/clubProfile'
import { focusById, useFocusFirstField, useInlineForm } from '../lib/formFocus'
import { stagger } from '../lib/motion'
import type { ClubPaymentMethod, ClubPaymentMethodInput } from '../types'
import { PickPhotos } from './AdminPhotos'
import { ActiveToggle, FormButtons, HiddenPill, SaveButton, SectionTitle, TextArea, TextField } from './AdminProfileFields'
import { fileNote, linkStyle, removeStyle, type Run } from './adminProfileShared'

export function PaymentCard({
  index, note, onNoteChange, onSaveNote, methods, busy, run,
}: {
  index: number
  note: string | null
  onNoteChange: (value: string | null) => void
  onSaveNote: (event: FormEvent) => void
  methods: ClubPaymentMethod[]
  busy: string | null
  run: Run
}) {
  const { editing, open, close } = useInlineForm()
  return (
    <section className="enter-rise card p-4 space-y-3" style={stagger(index)} aria-labelledby="profile-payment">
      <SectionTitle id="profile-payment" hint="Players pay you directly. bRineLy does not receive or check these payments.">
        How players pay you
      </SectionTitle>
      <form className="space-y-3" onSubmit={onSaveNote}>
        <TextArea id="profile-payment-note" label="Payment note" value={note} onChange={onNoteChange} max={600} rows={3}
          placeholder="Example: Pay at the desk, or send by GCash and show the receipt when you arrive." />
        <SaveButton busy={busy} name="payment-note">Save payment note</SaveButton>
      </form>

      <h3 className="text-sm font-bold text-slate-700">Payment methods ({methods.length} of {MAX_CLUB_PAYMENT_METHODS})</h3>
      <datalist id="payment-labels">
        {['GCash', 'Maya', 'BPI', 'BDO', 'Bank transfer', 'Cash at the desk'].map((label) => <option key={label} value={label} />)}
      </datalist>
      {methods.length === 0 ? <p className="text-sm text-slate-600">No payment methods yet.</p> : null}
      <ul className="space-y-2">
        {methods.map((method) => (
          <li key={method.id} className="rounded-xl border border-slate-200 p-3 space-y-2">
            {editing === method.id ? (
              <PaymentMethodForm
                method={method}
                saving={busy === `pay:${method.id}`}
                onCancel={close}
                onSave={async (input) => {
                  if (await run(`pay:${method.id}`, () => api.upsertClubPaymentMethod(input), `${input.label.trim()} saved`)) close()
                }}
              />
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">{method.label}</p>
                    {method.account_name ? <p className="text-sm text-slate-600">{method.account_name}</p> : null}
                    {method.account_number ? <p className="text-sm font-semibold tabular-nums">{method.account_number}</p> : null}
                  </div>
                  <HiddenPill shown={method.is_active} />
                </div>
                {method.qr_url ? (
                  <img src={method.qr_url} alt={`${method.label} QR code`} className="mx-auto aspect-square w-full max-w-[12rem] rounded-lg border border-slate-200 bg-white object-contain" loading="lazy" />
                ) : (
                  <p className="text-xs text-slate-500">No QR code. Add a screenshot of your QR code so players can scan it.</p>
                )}
                {busy === `qr:${method.id}` ? <p className="text-sm font-semibold text-brand-800" role="status">Saving the QR code…</p> : null}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <PickPhotos
                    label={method.qr_url ? 'Change QR code' : 'Add QR code'}
                    disabled={busy !== null}
                    onPick={(files) => void run(`qr:${method.id}`, async () => fileNote(await api.setClubPaymentQr(method.id, files[0])), 'QR code saved')}
                  />
                  {method.qr_url ? (
                    <button type="button" className="btn-secondary text-sm" disabled={busy !== null}
                      onClick={() => {
                        if (!window.confirm(`Remove the ${method.label} QR code?`)) return
                        void run(`qr:${method.id}`, async () => fileNote(await api.setClubPaymentQr(method.id, null)), 'QR code removed')
                          .then((ok) => ok && focusById(`pay-${method.id}-edit`))
                      }}>
                      Remove QR code
                    </button>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-x-4">
                  <button type="button" id={`pay-${method.id}-edit`} className={linkStyle}
                    onClick={() => open(method.id, `pay-${method.id}-edit`, 'profile-payment')} aria-label={`Edit ${method.label}`}>
                    Edit
                  </button>
                  <button type="button" className={removeStyle} disabled={busy !== null}
                    onClick={() => {
                      if (!window.confirm(`Remove ${method.label}? Players will no longer see it.`)) return
                      void run(`pay:${method.id}`, async () => fileNote(await api.removeClubPaymentMethod(method.id)), `${method.label} removed`)
                        .then((ok) => ok && focusById('profile-payment'))
                    }}
                    aria-label={`Remove ${method.label}`}>
                    Remove
                  </button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
      {editing === 'new' ? (
        <div className="rounded-xl border border-slate-200 p-3">
          <PaymentMethodForm
            saving={busy === 'pay:new'}
            onCancel={close}
            onSave={async (input) => {
              if (await run('pay:new', () => api.upsertClubPaymentMethod(input), `${input.label.trim()} added`)) close()
            }}
          />
        </div>
      ) : methods.length < MAX_CLUB_PAYMENT_METHODS ? (
        <button type="button" id="pay-add" className="btn-secondary w-full" onClick={() => open('new', 'pay-add', 'profile-payment')}>
          Add a payment method
        </button>
      ) : null}
    </section>
  )
}

function PaymentMethodForm({
  method, saving, onCancel, onSave,
}: {
  method?: ClubPaymentMethod
  saving: boolean
  onCancel: () => void
  onSave: (input: ClubPaymentMethodInput) => Promise<void>
}) {
  const [label, setLabel] = useState<string | null>(method?.label ?? '')
  const [accountName, setAccountName] = useState<string | null>(method?.account_name ?? '')
  const [accountNumber, setAccountNumber] = useState<string | null>(method?.account_number ?? '')
  const [active, setActive] = useState(method?.is_active ?? true)
  const [problem, setProblem] = useState<string | null>(null)
  const prefix = method ? `pay-${method.id}` : 'pay-new'
  const formRef = useRef<HTMLFormElement>(null)
  useFocusFirstField(formRef)

  function submit(event: FormEvent) {
    event.preventDefault()
    const input: ClubPaymentMethodInput = {
      id: method?.id,
      label: label ?? '',
      account_name: cleanText(accountName),
      account_number: cleanText(accountNumber),
      is_active: active,
    }
    const found = paymentMethodProblem(input)
    setProblem(found)
    if (!found) void onSave(input)
  }

  return (
    <form ref={formRef} className="space-y-3" onSubmit={submit} aria-label={method ? `Edit ${method.label}` : 'Add a payment method'}>
      <TextField id={`${prefix}-label`} label="Name" value={label} onChange={setLabel} placeholder="GCash" max={40} required list="payment-labels" />
      <TextField id={`${prefix}-account-name`} label="Account name (optional)" value={accountName} onChange={setAccountName} placeholder="Rally Point Gensan" max={80} />
      <TextField id={`${prefix}-account-number`} label="Number (optional)" value={accountNumber} onChange={setAccountNumber} placeholder="0917 123 4567" max={60} />
      <ActiveToggle id={`${prefix}-active`} checked={active} onChange={setActive} hint="Turn off to hide it for now without deleting it." />
      {problem ? <p className="text-sm font-semibold text-red-700" role="alert">{problem}</p> : null}
      <FormButtons saving={saving} onCancel={onCancel} label={method ? 'Save' : 'Add'} />
    </form>
  )
}
