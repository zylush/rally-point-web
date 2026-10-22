import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { HelpCircle, Mail, Phone, RefreshCw, Send } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { AppHeader, AppShell, SignOutButton, Toast } from '../components/Shell'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { signedInHelpFaqs } from '../lib/helpContent'
import type { PrivacyNoticeState } from '../lib/privacyNotice'
import type { InquiryCategory, InquiryStatus, Notification, Role, SupportInquiry } from '../types'
import { fmtDateTime } from '../types'

type HelpToast = { message: string; type: 'success' | 'error' }

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
  superadmin: {
    title: 'Platform operations',
    body: 'For cloud infrastructure, database hosting, or payment provider escalations, contact technical ops.',
    email: 'ops@rallypoint.ph',
    phone: '+63 917 555 0199',
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
  const canUseInquiries = role === 'staff' || role === 'admin'
  const [inquiries, setInquiries] = useState<SupportInquiry[]>([])
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loadingInquiries, setLoadingInquiries] = useState(false)
  const [hasLoadedInquiries, setHasLoadedInquiries] = useState(false)
  const [loadingError, setLoadingError] = useState<string | null>(null)
  const [category, setCategory] = useState<InquiryCategory>('booking')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [savingInquiryId, setSavingInquiryId] = useState<string | null>(null)
  const [readingNotificationId, setReadingNotificationId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<'all' | InquiryStatus>('all')
  const [toast, setToast] = useState<HelpToast | null>(null)
  const [toastFadingOut, setToastFadingOut] = useState(false)
  const loadingInquiriesRef = useRef(false)
  const hasLoadedInquiriesRef = useRef(false)
  const inquiryRequestRef = useRef(0)
  const location = useLocation()

  useEffect(() => {
    setToastFadingOut(false)
    if (!toast || toast.type === 'error') return

    const fadeTimer = window.setTimeout(() => setToastFadingOut(true), 4000)
    const dismissTimer = window.setTimeout(() => setToast(null), 4300)
    return () => {
      window.clearTimeout(fadeTimer)
      window.clearTimeout(dismissTimer)
    }
  }, [toast])

  // Staff see the unread-update count before opening "Your inquiries".
  // A failure here only hides the count; opening the section loads and reports errors.
  useEffect(() => {
    if (!user || role !== 'staff') return
    let cancelled = false
    api
      .notifications(user.id)
      .then((updates) => {
        if (!cancelled && !hasLoadedInquiriesRef.current) {
          setNotifications(updates.filter((notification) => notification.title === 'Inquiry update'))
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [role, user])

  // A forced load (Refresh, or after a save) always runs; only the newest load's result is kept.
  const loadInquiries = useCallback(async (force = false) => {
    if (!user || !canUseInquiries) return
    if (!force && (loadingInquiriesRef.current || hasLoadedInquiriesRef.current)) return
    const request = ++inquiryRequestRef.current
    const isLatest = () => request === inquiryRequestRef.current
    loadingInquiriesRef.current = true
    setLoadingInquiries(true)
    setLoadingError(null)
    try {
      const [rows, updates] = await Promise.all([
        api.inquiries(user.id, role),
        role === 'staff' ? api.notifications(user.id) : Promise.resolve([]),
      ])
      if (!isLatest()) return
      setInquiries(rows)
      setNotifications(updates.filter((notification) => notification.title === 'Inquiry update'))
      hasLoadedInquiriesRef.current = true
      setHasLoadedInquiries(true)
    } catch (error) {
      if (!isLatest()) return
      setLoadingError(error instanceof Error ? error.message : 'Unable to load inquiries.')
    } finally {
      if (isLatest()) {
        loadingInquiriesRef.current = false
        setLoadingInquiries(false)
      }
    }
  }, [canUseInquiries, role, user])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!user || !canUseInquiries || !subject.trim() || !message.trim()) return
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
      if (hasLoadedInquiriesRef.current || loadingInquiriesRef.current) await loadInquiries(true)
      setToast({ message: 'Your inquiry was sent. The team will follow up.', type: 'success' })
    } catch (error) {
      setToast({
        message: error instanceof Error ? error.message : 'Unable to send your inquiry.',
        type: 'error',
      })
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
      await loadInquiries(true)
      setToast({ message: 'Inquiry update saved. Staff will see the update in Help.', type: 'success' })
    } catch (error) {
      setToast({
        message: error instanceof Error ? error.message : 'Unable to update this inquiry.',
        type: 'error',
      })
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
      setToast({
        message: error instanceof Error ? error.message : 'Unable to mark this update as read.',
        type: 'error',
      })
    } finally {
      setReadingNotificationId(null)
    }
  }

  const unreadUpdateCount = notifications.filter((notification) => !notification.read).length
  const openInquiryCount = inquiries.filter((inquiry) => inquiry.status === 'open').length

  return (
    <AppShell role={role}>
      <AppHeader title="Help" subtitle="Answers and a direct line to the team" right={<SignOutButton />} />
      <main className="safe-bottom px-4 pt-4 space-y-4">
        <details className="card p-4">
          <summary className="cursor-pointer min-h-12 flex items-center gap-3">
            <HelpCircle className="text-brand-700 shrink-0" size={24} aria-hidden />
            <span className="block">
              <span role="heading" aria-level={2} className="block text-title font-bold text-slate-900">Quick answers</span>
              <span className="block text-body text-slate-600 mt-1">Answers for {role === 'member' ? 'members' : role === 'staff' ? 'Staff' : role === 'admin' ? 'Admins' : 'platform operations'}.</span>
            </span>
          </summary>
          <div className="mt-3 divide-y divide-slate-200">
            {signedInHelpFaqs[role].map(({ question, answer, action }) => (
              <details key={question} className="py-3">
                <summary className="cursor-pointer min-h-12 flex items-center text-subtitle font-semibold text-slate-800">{question}</summary>
                <p className="text-body text-slate-600 pb-1">{answer}</p>
                {action ? (
                  <Link className="mt-2 inline-flex min-h-12 items-center font-semibold text-brand-800 underline" to={action.to}>
                    {action.label}
                  </Link>
                ) : null}
              </details>
            ))}
          </div>
        </details>

        {canUseInquiries ? (
          <details className="card p-4">
            <summary className="cursor-pointer min-h-12 text-title font-bold text-slate-900">
              <span role="heading" aria-level={2}>Ask a question or submit an inquiry</span>
            </summary>
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
          </details>
        ) : null}

        {role === 'staff' ? (
          <details className="card p-4" onToggle={(event) => {
            if (event.currentTarget.open) void loadInquiries()
          }}>
            <summary className="cursor-pointer min-h-12">
              <span role="heading" aria-level={2} className="text-title font-bold text-slate-900">Your inquiries</span>
              {unreadUpdateCount > 0 ? (
                <span className="ml-2 text-body font-semibold text-brand-800">
                  {unreadUpdateCount} unread {unreadUpdateCount === 1 ? 'update' : 'updates'}
                </span>
              ) : null}
            </summary>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-body text-slate-600 mt-1">Track your questions and see replies from Admin.</p>
              </div>
              <button
                type="button"
                className="control-feedback inline-flex min-h-12 shrink-0 items-center gap-2 rounded-xl border border-slate-300 px-3 text-body font-semibold text-brand-800"
                onClick={() => void loadInquiries(true)}
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
          </details>
        ) : null}

        {role === 'admin' ? (
          <details className="card p-4" onToggle={(event) => {
            if (event.currentTarget.open) void loadInquiries()
          }}>
            <summary className="cursor-pointer min-h-12">
              <span role="heading" aria-level={2} className="text-title font-bold text-slate-900">Inquiry inbox</span>
              {hasLoadedInquiries && openInquiryCount > 0 ? (
                <span className="ml-2 text-body font-semibold text-brand-800">
                  {openInquiryCount} open {openInquiryCount === 1 ? 'inquiry' : 'inquiries'}
                </span>
              ) : null}
            </summary>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-body text-slate-600 mt-1">Review submissions, update status, and send one reply for each inquiry.</p>
              </div>
              <button
                type="button"
                className="control-feedback inline-flex min-h-12 shrink-0 items-center gap-2 rounded-xl border border-slate-300 px-3 text-body font-semibold text-brand-800"
                onClick={() => void loadInquiries(true)}
                disabled={loadingInquiries}
              >
                <RefreshCw size={16} aria-hidden />
                Refresh
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2" role="tablist" aria-label="Inquiry status filter">
              {[
                { value: 'all' as const, label: `All (${inquiries.length})` },
                { value: 'open' as const, label: `Open (${inquiries.filter((i) => i.status === 'open').length})` },
                { value: 'in_progress' as const, label: `In Progress (${inquiries.filter((i) => i.status === 'in_progress').length})` },
                { value: 'resolved' as const, label: `Resolved (${inquiries.filter((i) => i.status === 'resolved').length})` },
              ].map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${
                    statusFilter === tab.value
                      ? 'bg-brand-700 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                  onClick={() => setStatusFilter(tab.value)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            {loadingInquiries ? <p className="text-body text-slate-500 mt-3">Loading inquiries…</p> : null}
            {loadingError ? <p role="alert" className="text-body text-red-700 mt-3">{loadingError}</p> : null}
            {!loadingInquiries && !loadingError && inquiries.length === 0 ? (
              <p className="text-body text-slate-600 mt-3">There are no inquiries yet.</p>
            ) : null}
            {!loadingInquiries && !loadingError && inquiries.length > 0 && inquiries.filter((i) => statusFilter === 'all' || i.status === statusFilter).length === 0 ? (
              <p className="text-body text-slate-600 mt-3">No inquiries in this category.</p>
            ) : null}
            <div className="mt-3 space-y-3">
              {inquiries
                .filter((inquiry) => statusFilter === 'all' || inquiry.status === statusFilter)
                .map((inquiry) => (
                  <AdminInquiryCard
                    key={inquiry.id}
                    inquiry={inquiry}
                    saving={savingInquiryId === inquiry.id}
                    onSave={(input) => void updateInquiry({ id: inquiry.id, ...input })}
                  />
                ))}
            </div>
          </details>
        ) : null}

        <details className="card p-4">
          <summary className="cursor-pointer min-h-12 text-title font-bold text-slate-900">
            <span role="heading" aria-level={2}>{contact.title}</span>
          </summary>
          <p className="text-body text-slate-600 mt-1">{contact.body}</p>
          <div className="mt-3 grid gap-2">
            <a className="btn-secondary justify-start" href={`mailto:${contact.email}`}><Mail size={18} aria-hidden /> {contact.email}</a>
            <a className="btn-secondary justify-start" href={`tel:${contact.phone.replace(/\s/g, '')}`}><Phone size={18} aria-hidden /> {contact.phone}</a>
          </div>
        </details>
        {role === 'member' ? (
          <section className="card p-4" aria-labelledby="privacy-notice-help-title">
            <h2 id="privacy-notice-help-title" className="text-title font-bold text-slate-900">
              Privacy Notice
            </h2>
            <p className="mt-1 text-body text-slate-600">
              Learn how we handle your personal information and understand your privacy rights.
            </p>
            <Link
              className="mt-2 inline-flex min-h-12 items-center font-semibold text-brand-800 underline underline-offset-2"
              to="/privacy"
              state={{ from: location.pathname } satisfies PrivacyNoticeState}
            >
              Read the Privacy Notice
            </Link>
          </section>
        ) : null}
        <Toast message={toast?.message ?? null} fadingOut={toastFadingOut} />
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
