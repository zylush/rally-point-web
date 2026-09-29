import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { HelpCircle, Mail, Phone, RefreshCw, Send } from 'lucide-react'
import { AppHeader, AppShell, SignOutButton, Toast } from '../components/Shell'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { helpFaqs } from '../lib/helpContent'
import type { InquiryCategory, InquiryStatus, Notification, Role, SupportInquiry } from '../types'
import { fmtDateTime } from '../types'

const contacts: Record<Role, { title: string; body: string; email: string; phone: string }> = {
  member: {
    title: 'Contact staff',
    body: 'Need help with a booking, membership, or payment? Staff can help you at the club or through these channels.',
    email: 'support@rallypointgensan.com',
    phone: '+63 917 555 0100',
  },
  staff: {
    title: 'Contact admin',
    body: 'For operations, account access, or approval questions, contact the admin team.',
    email: 'admin@rallypointgensan.com',
    phone: '+63 917 555 0101',
  },
  admin: {
    title: 'Contact superadmin',
    body: 'For platform, provisioning, or escalation concerns, contact your superadmin or platform owner.',
    email: 'superadmin@rallypointgensan.com',
    phone: '+63 917 555 0102',
  },
}

const inquiryStatuses: { value: InquiryStatus; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'resolved', label: 'Resolved' },
]

export function HelpPage() {
  const { user } = useAuth()
  const role = user?.role ?? 'member'
  const contact = contacts[role]
  const [inquiries, setInquiries] = useState<SupportInquiry[]>([])
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loadingInquiries, setLoadingInquiries] = useState(role !== 'member')
  const [loadingError, setLoadingError] = useState<string | null>(null)
  const [category, setCategory] = useState<InquiryCategory>('booking')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [savingInquiryId, setSavingInquiryId] = useState<string | null>(null)
  const [readingNotificationId, setReadingNotificationId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const loadInquiries = useCallback(async () => {
    if (!user || role === 'member') return
    setLoadingInquiries(true)
    setLoadingError(null)
    try {
      const [rows, updates] = await Promise.all([
        api.inquiries(user.id, role),
        role === 'staff' ? api.notifications(user.id) : Promise.resolve([]),
      ])
      setInquiries(rows)
      setNotifications(updates.filter((notification) => notification.title === 'Inquiry update'))
    } catch (error) {
      setLoadingError(error instanceof Error ? error.message : 'Unable to load inquiries.')
    } finally {
      setLoadingInquiries(false)
    }
  }, [role, user])

  useEffect(() => {
    void loadInquiries()
  }, [loadInquiries])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!user || !subject.trim() || !message.trim()) return
    setSaving(true)
    setToast(null)
    try {
      await api.createInquiry({
        user_id: user.id,
        category,
        subject: subject.trim(),
        message: message.trim(),
      })
      setSubject('')
      setMessage('')
      await loadInquiries()
      setToast('Your inquiry was sent. The team will follow up.')
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Unable to send your inquiry.')
    } finally {
      setSaving(false)
    }
  }

  async function updateInquiry(input: {
    id: string
    status: InquiryStatus
    response?: string
  }) {
    setSavingInquiryId(input.id)
    setToast(null)
    try {
      await api.updateInquiry(input)
      await loadInquiries()
      setToast('Inquiry update saved. Staff will see the update in Help.')
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Unable to update this inquiry.')
    } finally {
      setSavingInquiryId(null)
    }
  }

  async function markUpdateRead(notification: Notification) {
    setReadingNotificationId(notification.id)
    setToast(null)
    try {
      await api.markNotifRead(notification.id)
      setNotifications((current) =>
        current.map((row) => row.id === notification.id ? { ...row, read: true } : row),
      )
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Unable to mark this update as read.')
    } finally {
      setReadingNotificationId(null)
    }
  }

  return (
    <AppShell role={role}>
      <AppHeader title="Help" subtitle="Answers and a direct line to the team" right={<SignOutButton />} />
      <main className="safe-bottom px-4 pt-4 space-y-4">
        <section className="card p-4">
          <div className="flex items-start gap-3">
            <HelpCircle className="text-brand-700 shrink-0 mt-0.5" size={24} aria-hidden />
            <div>
              <h2 className="text-title font-bold text-slate-900">Frequently asked questions</h2>
              <p className="text-body text-slate-600 mt-1">Quick answers for common club questions.</p>
            </div>
          </div>
          <div className="mt-3 divide-y divide-slate-200">
            {helpFaqs.map(({ question, answer }) => (
              <details key={question} className="py-3">
                <summary className="cursor-pointer min-h-12 flex items-center text-subtitle font-semibold text-slate-800">{question}</summary>
                <p className="text-body text-slate-600 pb-1">{answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="card p-4">
          <h2 className="text-title font-bold text-slate-900">{contact.title}</h2>
          <p className="text-body text-slate-600 mt-1">{contact.body}</p>
          <div className="mt-3 grid gap-2">
            <a className="btn-secondary justify-start" href={`mailto:${contact.email}`}><Mail size={18} aria-hidden /> {contact.email}</a>
            <a className="btn-secondary justify-start" href={`tel:${contact.phone.replace(/\s/g, '')}`}><Phone size={18} aria-hidden /> {contact.phone}</a>
          </div>
        </section>

        {role !== 'member' ? (
          <section className="card p-4">
            <h2 className="text-title font-bold text-slate-900">Ask a question or submit an inquiry</h2>
            <p className="text-body text-slate-600 mt-1">Send the details so the right admin team can follow up.</p>
            <form className="mt-4 space-y-3" onSubmit={(event) => void submit(event)}>
              <label className="label" htmlFor="inquiry-category">Category</label>
              <select id="inquiry-category" className="input" value={category} onChange={(event) => setCategory(event.target.value as InquiryCategory)}>
                <option value="booking">Booking or schedule</option>
                <option value="membership">Membership</option>
                <option value="payment">Payment</option>
                <option value="technical">Technical issue</option>
                <option value="other">Other</option>
              </select>
              <label className="label" htmlFor="inquiry-subject">Subject</label>
              <input id="inquiry-subject" className="input" value={subject} onChange={(event) => setSubject(event.target.value)} required maxLength={120} />
              <label className="label" htmlFor="inquiry-message">Your question or details</label>
              <textarea id="inquiry-message" className="input min-h-32" value={message} onChange={(event) => setMessage(event.target.value)} required maxLength={2000} />
              <button type="submit" className="btn-primary w-full" disabled={saving}>
                <Send size={18} aria-hidden /> {saving ? 'Sending…' : 'Send inquiry'}
              </button>
            </form>
          </section>
        ) : null}

        {role === 'staff' ? (
          <section className="card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-title font-bold text-slate-900">Your inquiries</h2>
                <p className="text-body text-slate-600 mt-1">Track your questions and see replies from Admin.</p>
              </div>
              <button
                type="button"
                className="control-feedback inline-flex min-h-12 shrink-0 items-center gap-2 rounded-xl border border-slate-300 px-3 text-body font-semibold text-brand-800"
                onClick={() => void loadInquiries()}
                disabled={loadingInquiries}
              >
                <RefreshCw size={16} aria-hidden />
                Refresh
              </button>
            </div>
            {notifications.some((notification) => !notification.read) ? (
              <div className="mt-3 space-y-2">
                {notifications.filter((notification) => !notification.read).map((notification) => (
                  <div key={notification.id} className="rounded-xl border border-brand-200 bg-brand-50 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-body font-bold text-brand-900">{notification.title}</p>
                        <p className="text-body text-slate-700 mt-1">{notification.body}</p>
                        <p className="text-caption text-slate-500 mt-1">{fmtDateTime(notification.created_at)}</p>
                      </div>
                      <button
                        type="button"
                        className="min-h-11 shrink-0 rounded-lg px-3 text-body font-semibold text-brand-800 underline"
                        disabled={readingNotificationId === notification.id}
                        onClick={() => void markUpdateRead(notification)}
                      >
                        {readingNotificationId === notification.id ? 'Saving…' : 'Mark read'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            {loadingInquiries ? <p className="text-body text-slate-500 mt-3">Loading inquiries…</p> : null}
            {loadingError ? <p role="alert" className="text-body text-red-700 mt-3">{loadingError}</p> : null}
            {!loadingInquiries && !loadingError && inquiries.length === 0 ? (
              <p className="text-body text-slate-600 mt-3">You have not sent any inquiries yet.</p>
            ) : null}
            <div className="mt-3 space-y-3">
              {inquiries.map((inquiry) => (
                <InquirySummary key={inquiry.id} inquiry={inquiry} />
              ))}
            </div>
          </section>
        ) : null}

        {role === 'admin' ? (
          <section className="card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-title font-bold text-slate-900">Inquiry inbox</h2>
                <p className="text-body text-slate-600 mt-1">Review submissions, update status, and send one reply for each inquiry.</p>
              </div>
              <button
                type="button"
                className="control-feedback inline-flex min-h-12 shrink-0 items-center gap-2 rounded-xl border border-slate-300 px-3 text-body font-semibold text-brand-800"
                onClick={() => void loadInquiries()}
                disabled={loadingInquiries}
              >
                <RefreshCw size={16} aria-hidden />
                Refresh
              </button>
            </div>
            {loadingInquiries ? <p className="text-body text-slate-500 mt-3">Loading inquiries…</p> : null}
            {loadingError ? <p role="alert" className="text-body text-red-700 mt-3">{loadingError}</p> : null}
            {!loadingInquiries && !loadingError && inquiries.length === 0 ? (
              <p className="text-body text-slate-600 mt-3">There are no inquiries yet.</p>
            ) : null}
            <div className="mt-3 space-y-3">
              {inquiries.map((inquiry) => (
                <AdminInquiryCard
                  key={inquiry.id}
                  inquiry={inquiry}
                  saving={savingInquiryId === inquiry.id}
                  onSave={(input) => void updateInquiry({ id: inquiry.id, ...input })}
                />
              ))}
            </div>
          </section>
        ) : null}
        <Toast message={toast} />
      </main>
    </AppShell>
  )
}

function InquirySummary({ inquiry }: { inquiry: SupportInquiry }) {
  const statusLabel = inquiryStatuses.find((status) => status.value === inquiry.status)?.label ?? inquiry.status
  return (
    <article className="rounded-xl border border-slate-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-subtitle font-bold text-slate-900">{inquiry.subject}</h3>
        <span className={`pill ${inquiry.status === 'resolved' ? 'pill-ok' : inquiry.status === 'in_progress' ? 'pill-brand' : 'pill-warn'}`}>
          {statusLabel}
        </span>
      </div>
      <p className="text-caption text-slate-500 mt-1">{inquiry.category} · {fmtDateTime(inquiry.created_at)}</p>
      <p className="text-body text-slate-700 mt-2 whitespace-pre-wrap">{inquiry.message}</p>
      {inquiry.response ? (
        <div className="mt-3 rounded-lg bg-brand-50 p-3">
          <p className="text-caption font-bold text-brand-800">Admin reply · {inquiry.responded_at ? fmtDateTime(inquiry.responded_at) : ''}</p>
          <p className="text-body text-slate-800 mt-1 whitespace-pre-wrap">{inquiry.response}</p>
        </div>
      ) : null}
    </article>
  )
}

function AdminInquiryCard({
  inquiry,
  saving,
  onSave,
}: {
  inquiry: SupportInquiry
  saving: boolean
  onSave: (input: { status: InquiryStatus; response?: string }) => void
}) {
  const [status, setStatus] = useState<InquiryStatus>(inquiry.status)
  const [response, setResponse] = useState('')

  useEffect(() => {
    setStatus(inquiry.status)
    setResponse('')
  }, [inquiry])

  const hasNewResponse = !inquiry.response && response.trim().length > 0
  const changed = status !== inquiry.status || hasNewResponse

  return (
    <article className="rounded-xl border border-slate-200 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-subtitle font-bold text-slate-900">{inquiry.subject}</h3>
          <p className="text-caption text-slate-500 mt-1">
            {inquiry.sender?.full_name ?? 'Staff member'} · {inquiry.sender?.email ?? 'No email'} · {inquiry.category} · {fmtDateTime(inquiry.created_at)}
          </p>
        </div>
        <span className={`pill ${inquiry.status === 'resolved' ? 'pill-ok' : inquiry.status === 'in_progress' ? 'pill-brand' : 'pill-warn'}`}>
          {inquiryStatuses.find((item) => item.value === inquiry.status)?.label ?? inquiry.status}
        </span>
      </div>
      <p className="text-body text-slate-700 mt-3 whitespace-pre-wrap">{inquiry.message}</p>
      {inquiry.response ? (
        <div className="mt-3 rounded-lg bg-brand-50 p-3">
          <p className="text-caption font-bold text-brand-800">Reply sent · {inquiry.responded_at ? fmtDateTime(inquiry.responded_at) : ''}</p>
          <p className="text-body text-slate-800 mt-1 whitespace-pre-wrap">{inquiry.response}</p>
        </div>
      ) : null}
      <div className="mt-3 space-y-3">
        <div>
          <label className="label" htmlFor={`inquiry-status-${inquiry.id}`}>Status</label>
          <select
            id={`inquiry-status-${inquiry.id}`}
            className="input"
            value={status}
            onChange={(event) => setStatus(event.target.value as InquiryStatus)}
          >
            {inquiryStatuses.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </div>
        {!inquiry.response ? (
          <div>
            <label className="label" htmlFor={`inquiry-response-${inquiry.id}`}>Admin reply (one reply per inquiry)</label>
            <textarea
              id={`inquiry-response-${inquiry.id}`}
              className="input min-h-24"
              maxLength={2000}
              value={response}
              onChange={(event) => setResponse(event.target.value)}
              placeholder="Write a response for the staff member…"
            />
          </div>
        ) : null}
        <button
          type="button"
          className="btn-primary"
          disabled={saving || !changed}
          onClick={() => onSave({ status, response: hasNewResponse ? response.trim() : undefined })}
        >
          {saving ? 'Saving…' : 'Save update'}
        </button>
        {!changed && !saving ? (
          <p className="text-caption text-slate-500" role="note">
            Choose a different status or write a reply to enable Save update.
          </p>
        ) : null}
      </div>
    </article>
  )
}
