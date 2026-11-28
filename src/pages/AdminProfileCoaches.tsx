import { useRef, useState, type FormEvent } from 'react'
import { api } from '../lib/api'
import { MAX_CLUB_COACHES, cleanText, coachProblem } from '../lib/clubProfile'
import { focusById, useFocusFirstField, useInlineForm } from '../lib/formFocus'
import { stagger } from '../lib/motion'
import type { ClubCoach, ClubCoachInput } from '../types'
import { peso } from '../types'
import { PickPhotos } from './AdminPhotos'
import { ActiveToggle, FormButtons, HiddenPill, SectionTitle, TextArea, TextField } from './AdminProfileFields'
import { asNumber, fileNote, linkStyle, removeStyle, type Run } from './adminProfileShared'

export function CoachesCard({ index, coaches, busy, run }: { index: number; coaches: ClubCoach[]; busy: string | null; run: Run }) {
  const { editing, open, close } = useInlineForm()
  return (
    <section className="enter-rise card p-4 space-y-3" style={stagger(index)} aria-labelledby="profile-coaches">
      <SectionTitle id="profile-coaches" hint="Only show a coach’s phone number, link or photo if the coach agreed to share it publicly.">
        Coaches
      </SectionTitle>
      {coaches.length === 0 ? <p className="text-sm text-slate-600">No coaches listed yet.</p> : null}
      <ul className="space-y-2">
        {coaches.map((coach) => (
          <li key={coach.id} className="rounded-xl border border-slate-200 p-3 space-y-2">
            {editing === coach.id ? (
              <CoachForm
                coach={coach}
                saving={busy === `coach:${coach.id}`}
                onCancel={close}
                onSave={async (input) => {
                  if (await run(`coach:${coach.id}`, () => api.upsertClubCoach(input), `${input.full_name.trim()} saved`)) close()
                }}
              />
            ) : (
              <>
                <div className="flex items-start gap-3">
                  {coach.photo_url ? (
                    <img src={coach.photo_url} alt={`Photo of ${coach.full_name}`} className="h-16 w-16 shrink-0 rounded-full object-cover" loading="lazy" />
                  ) : (
                    <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs text-slate-500">No photo</span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{coach.full_name}</p>
                    {coach.headline ? <p className="text-sm text-slate-600">{coach.headline}</p> : null}
                    {coach.hourly_rate != null ? <p className="text-sm text-brand-800">{peso(coach.hourly_rate)} per hour</p> : null}
                  </div>
                  <HiddenPill shown={coach.is_active} />
                </div>
                {busy === `coach-photo:${coach.id}` ? <p className="text-sm font-semibold text-brand-800" role="status">Saving the photo…</p> : null}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <PickPhotos
                    label={coach.photo_url ? 'Change photo' : 'Add photo'}
                    disabled={busy !== null}
                    onPick={(files) => void run(`coach-photo:${coach.id}`, async () => fileNote(await api.setClubCoachPhoto(coach.id, files[0])), 'Photo saved')}
                  />
                  {coach.photo_url ? (
                    <button type="button" className="btn-secondary text-sm" disabled={busy !== null}
                      onClick={() => {
                        if (!window.confirm(`Remove the photo of ${coach.full_name}?`)) return
                        void run(`coach-photo:${coach.id}`, async () => fileNote(await api.setClubCoachPhoto(coach.id, null)), 'Photo removed')
                          .then((ok) => ok && focusById(`coach-${coach.id}-edit`))
                      }}>
                      Remove photo
                    </button>
                  ) : null}
                </div>
                <CoachAccountLink coach={coach} busy={busy} run={run} />
                <div className="flex flex-wrap gap-x-4">
                  <button type="button" id={`coach-${coach.id}-edit`} className={linkStyle}
                    onClick={() => open(coach.id, `coach-${coach.id}-edit`, 'profile-coaches')} aria-label={`Edit ${coach.full_name}`}>
                    Edit
                  </button>
                  <button type="button" className={removeStyle} disabled={busy !== null}
                    onClick={() => {
                      if (!window.confirm(`Remove ${coach.full_name} from your coaches?`)) return
                      void run(`coach:${coach.id}`, async () => fileNote(await api.removeClubCoach(coach.id)), `${coach.full_name} removed`)
                        .then((ok) => ok && focusById('profile-coaches'))
                    }}
                    aria-label={`Remove ${coach.full_name}`}>
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
          <CoachForm
            saving={busy === 'coach:new'}
            onCancel={close}
            onSave={async (input) => {
              if (await run('coach:new', () => api.upsertClubCoach(input), `${input.full_name.trim()} added`)) close()
            }}
          />
        </div>
      ) : coaches.length < MAX_CLUB_COACHES ? (
        <button type="button" id="coach-add" className="btn-secondary w-full" onClick={() => open('new', 'coach-add', 'profile-coaches')}>
          Add a coach
        </button>
      ) : (
        <p className="text-sm text-slate-600">You have the most coaches allowed ({MAX_CLUB_COACHES}). Remove one to add another.</p>
      )}
    </section>
  )
}

function CoachAccountLink({ coach, busy, run }: { coach: ClubCoach; busy: string | null; run: Run }) {
  const [editing, setEditing] = useState(false)
  const [email, setEmail] = useState<string | null>('')
  const saving = busy === `coach-account:${coach.id}`

  if (!editing) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-slate-600">
          {coach.account_user_id ? 'Coach sign-in is linked.' : 'No coach sign-in linked.'}
        </p>
        <div className="flex flex-wrap gap-x-4">
          <button type="button" className={linkStyle} disabled={busy !== null}
            onClick={() => setEditing(true)}>
            {coach.account_user_id ? 'Change linked account' : 'Link coach account'}
          </button>
          {coach.account_user_id ? (
            <button type="button" className={removeStyle} disabled={busy !== null}
              onClick={() => {
                if (!window.confirm(`Remove coach sign-in access for ${coach.full_name}?`)) return
                void run(`coach-account:${coach.id}`, () => api.linkClubCoachAccount(coach.id, null), 'Coach sign-in unlinked')
              }}>
              Unlink account
            </button>
          ) : null}
        </div>
      </div>
    )
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const address = email?.trim() ?? ''
    if (!address) return
    void run(`coach-account:${coach.id}`, () => api.linkClubCoachAccount(coach.id, address), 'Coach sign-in linked')
      .then((ok) => {
        if (ok) {
          setEmail('')
          setEditing(false)
        }
      })
  }

  return (
    <form className="space-y-2" onSubmit={submit} aria-label={`Link sign-in for ${coach.full_name}`}>
      <TextField id={`coach-${coach.id}-account-email`} label="Coach's confirmed sign-up email"
        value={email} onChange={setEmail} type="email" max={254} required />
      <p className="text-sm text-slate-600">The coach must sign up and confirm this email before you link it.</p>
      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={saving || busy !== null}>
          {saving ? 'Linking…' : 'Link account'}
        </button>
        <button type="button" className="btn-secondary" disabled={busy !== null} onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function CoachForm({
  coach, saving, onCancel, onSave,
}: {
  coach?: ClubCoach
  saving: boolean
  onCancel: () => void
  onSave: (input: ClubCoachInput) => Promise<void>
}) {
  const [fullName, setFullName] = useState<string | null>(coach?.full_name ?? '')
  const [headline, setHeadline] = useState<string | null>(coach?.headline ?? '')
  const [bio, setBio] = useState<string | null>(coach?.bio ?? '')
  const [rate, setRate] = useState<string | null>(coach?.hourly_rate != null ? String(coach.hourly_rate) : '')
  const [phone, setPhone] = useState<string | null>(coach?.contact_phone ?? '')
  const [link, setLink] = useState<string | null>(coach?.contact_url ?? '')
  const [active, setActive] = useState(coach?.is_active ?? true)
  const [problem, setProblem] = useState<string | null>(null)
  const prefix = coach ? `coach-${coach.id}` : 'coach-new'
  const formRef = useRef<HTMLFormElement>(null)
  useFocusFirstField(formRef)

  function submit(event: FormEvent) {
    event.preventDefault()
    const input: ClubCoachInput = {
      id: coach?.id,
      full_name: fullName ?? '',
      headline: cleanText(headline),
      bio: cleanText(bio),
      hourly_rate: asNumber(rate),
      contact_phone: cleanText(phone),
      contact_url: cleanText(link),
      is_active: active,
    }
    const found = coachProblem(input)
    setProblem(found)
    if (!found) void onSave(input)
  }

  return (
    <form ref={formRef} className="space-y-3" onSubmit={submit} aria-label={coach ? `Edit ${coach.full_name}` : 'Add a coach'}>
      <TextField id={`${prefix}-name`} label="Name" value={fullName} onChange={setFullName} placeholder="Coach Ana Reyes" max={80} required />
      <TextField id={`${prefix}-headline`} label="Short line (optional)" value={headline} onChange={setHeadline} placeholder="Beginners and kids · Weekends" max={120} />
      <TextField id={`${prefix}-rate`} label="Rate per hour, Php (optional)" value={rate} onChange={setRate} type="number" inputMode="decimal" />
      <TextArea id={`${prefix}-bio`} label="About the coach (optional)" value={bio} onChange={setBio} max={1000} rows={3} />
      <TextField id={`${prefix}-phone`} label="Phone players can call (optional)" value={phone} onChange={setPhone} type="tel" placeholder="0917 123 4567" max={24} />
      <TextField id={`${prefix}-link`} label="Facebook or Messenger link (optional)" value={link} onChange={setLink} type="url" placeholder="https://m.me/coachana" max={300} />
      <ActiveToggle id={`${prefix}-active`} checked={active} onChange={setActive} hint="Turn off while the coach is away, without deleting them." />
      {problem ? <p className="text-sm font-semibold text-red-700" role="alert">{problem}</p> : null}
      <FormButtons saving={saving} onCancel={onCancel} label={coach ? 'Save' : 'Add'} />
    </form>
  )
}
