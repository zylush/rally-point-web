import { useId } from 'react'
import { Link } from 'react-router-dom'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import { privacyNoticePath } from '../lib/privacyNotice'
import { PRIVACY_NOTICE_UPDATED, corePrivacyNoticeSections } from '../lib/privacyNoticeContent'
import { DEFAULT_CLUB_SLUG } from '../lib/tenant'
import { hasReachedPrivacyBottom, type PrivacyGate } from '../lib/usePrivacyGate'

export type PrivacyAcknowledgementProps = {
  gate: PrivacyGate
  clubSlug?: string
  clubName?: string | null
  label?: string
  describedBy?: string
}

/**
 * Shared inline Privacy Notice reader, scroll-to-unlock acknowledgement checkbox,
 * and new-tab link so form fields stay intact across sign-up, owner requests, and club joins.
 */
export function PrivacyAcknowledgement({
  gate,
  clubSlug,
  clubName = null,
  label = 'I have read and understood the Privacy Notice.',
  describedBy,
}: PrivacyAcknowledgementProps) {
  const readerId = useId()
  const hintId = useId()
  const sections = corePrivacyNoticeSections({
    isGensan: !clubSlug || clubSlug === DEFAULT_CLUB_SLUG,
    name: clubName ?? null,
  })
  const checkboxDescribedBy = [!gate.read ? hintId : null, describedBy].filter(Boolean).join(' ') || undefined

  return (
    <div className="space-y-2.5">
      <div className="rounded-[10px] border border-line bg-white">
        <button
          type="button"
          className="control-feedback flex min-h-12 w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left"
          aria-expanded={gate.readerOpen}
          aria-controls={readerId}
          onClick={() => gate.setReaderOpen((open) => !open)}
        >
          <span className="text-body font-semibold text-ink">Read the Privacy Notice</span>
          <span className="flex shrink-0 items-center gap-2">
            {gate.read ? (
              <span className="pill pill-ok">
                <Check className="h-3.5 w-3.5" aria-hidden />
                Read
              </span>
            ) : (
              <span className="pill pill-brand">
                {gate.readerOpen ? 'Scroll to the end' : 'Required first'}
              </span>
            )}
            {gate.readerOpen ? (
              <ChevronUp className="h-4 w-4 text-muted" aria-hidden />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted" aria-hidden />
            )}
          </span>
        </button>

        {gate.readerOpen ? (
          <div
            id={readerId}
            ref={gate.readerRef}
            role="region"
            aria-label="Privacy Notice text"
            tabIndex={0}
            onScroll={(event) => {
              if (!gate.read && hasReachedPrivacyBottom(event.currentTarget)) {
                gate.unlock()
              }
            }}
            className="max-h-56 space-y-4 overflow-y-auto overscroll-contain border-t border-line px-3 py-3 text-body leading-relaxed text-ink focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-700"
          >
            <p className="text-caption text-muted">Last updated: {PRIVACY_NOTICE_UPDATED}</p>
            <div className="divide-y divide-line">
              {sections.map(({ title, content }) => (
                <div key={title} className="space-y-1.5 py-3 first:pt-0 last:pb-0">
                  <p className="text-subtitle font-semibold text-ink">{title}</p>
                  <div className="text-body leading-relaxed text-ink">{content}</div>
                </div>
              ))}
            </div>
            {!gate.read ? (
              <div className="border-t border-line pt-3">
                <p className="mb-2 text-caption text-muted">
                  You have reached the end of the Privacy Notice.
                </p>
                <button
                  type="button"
                  className="btn-secondary min-h-12 w-full"
                  onClick={() => gate.unlock({ focusCheckbox: true })}
                >
                  Unlock checkbox
                </button>
              </div>
            ) : (
              <p className="border-t border-line pt-3 text-caption font-semibold text-ok">
                End of Privacy Notice — you can now tick the box below.
              </p>
            )}
          </div>
        ) : null}
      </div>

      <label
        className={`flex min-h-12 items-start gap-3 rounded-[10px] border px-3 py-2.5 text-subtitle ${
          gate.read
            ? 'cursor-pointer border-line text-ink has-[:checked]:border-brand-700 has-[:checked]:bg-brand-50'
            : 'cursor-not-allowed border-line bg-canvas text-muted'
        }`}
        onClick={(event) => {
          if (gate.read) return
          event.preventDefault()
          gate.openReaderAndFocus()
        }}
      >
        <input
          ref={gate.checkboxRef}
          type="checkbox"
          className="mt-1 h-5 w-5 shrink-0 disabled:pointer-events-none disabled:opacity-50"
          disabled={!gate.read}
          checked={gate.read ? gate.checked : false}
          aria-describedby={checkboxDescribedBy}
          onChange={(event) => gate.setChecked(event.target.checked)}
        />
        <span>{label}</span>
      </label>

      {!gate.read ? (
        <p id={hintId} className="text-body text-muted">
          Open and scroll to the end of the Privacy Notice above to unlock this box.
        </p>
      ) : null}

      <p className="text-body text-muted">
        Read the full{' '}
        {/* A new tab keeps the details already typed into the form. */}
        <Link
          className="text-link inline-flex min-h-12 items-center"
          to={privacyNoticePath(clubSlug)}
          target="_blank"
          rel="noopener noreferrer"
        >
          Privacy Notice
        </Link>{' '}
        (opens in a new tab).
      </p>
    </div>
  )
}
