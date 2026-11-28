import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api } from '../lib/api'
import type { CoachBookingRequest, CoachRequestMessage } from '../types'
import { fmtDateTime } from '../types'

export function CoachRequestThread({
  request,
  viewerId,
  otherName,
}: {
  request: CoachBookingRequest
  viewerId: string
  otherName: string
}) {
  const [messages, setMessages] = useState<CoachRequestMessage[]>([])
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setMessages(await api.coachListRequestMessages(request.request_id))
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load this conversation')
    }
  }, [request.request_id])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function send(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await api.coachSendRequestMessage(request.request_id, body)
      setBody('')
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not send your message')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-3" aria-label={`Conversation with ${otherName}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-subtitle font-semibold text-slate-900">Message {otherName}</h3>
        <button type="button" className="btn-compact shrink-0"
          onClick={() => void refresh()}>
          Refresh
        </button>
      </div>
      <p className="text-body text-slate-600">Use this private conversation to agree on a court. This lesson request does not reserve a court or collect payment.</p>
      {error ? <p className="text-body font-semibold text-red-700" role="alert">{error}</p> : null}
      <ol className="max-h-72 space-y-2 overflow-y-auto" aria-live="polite" aria-label="Messages">
        {messages.length === 0 ? <li className="text-body text-slate-600">No messages yet.</li> : null}
        {messages.map((message) => (
          <li key={message.id} className={`rounded-xl p-3 ${message.sender_user_id === viewerId ? 'ml-6 bg-brand-100' : 'mr-6 bg-white'}`}>
            <p className="text-caption font-semibold text-slate-600">
              {message.sender_user_id === viewerId ? 'You' : otherName} · {fmtDateTime(message.created_at)}
            </p>
            <p className="mt-1 whitespace-pre-wrap break-words text-body text-slate-900">{message.body}</p>
          </li>
        ))}
      </ol>
      <form className="space-y-2" onSubmit={(event) => void send(event)}>
        <label className="block text-body font-semibold text-slate-800" htmlFor={`coach-message-${request.request_id}`}>
          Write a message
        </label>
        <textarea id={`coach-message-${request.request_id}`} className="input min-h-24 w-full"
          maxLength={2000} value={body} onChange={(event) => setBody(event.target.value)} required />
        <button type="submit" className="btn-primary w-full" disabled={busy || !body.trim()}>
          {busy ? 'Sending…' : 'Send message'}
        </button>
      </form>
    </section>
  )
}
