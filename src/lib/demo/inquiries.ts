import type { InquiryCategory, InquiryStatus, SupportInquiry } from '../../types'
import { DEMO_CLUB_ID } from '../tenant'
import { todayISO, uid } from './common'
import { load, save } from './persistence'

function currentActor(db: ReturnType<typeof load>) {
  return db.profiles.find((profile) => profile.id === db.sessionUserId)
}

export const inquiryOperations = {
  createInquiry(input: {
    user_id: string
    category: InquiryCategory
    subject: string
    message: string
  }): SupportInquiry {
    const db = load()
    const actor = currentActor(db)
    if (!actor || actor.id !== input.user_id || !['staff', 'admin'].includes(actor.role)) {
      throw new Error('Only staff and admins can submit inquiries for their own account')
    }
    const subject = input.subject.trim()
    const message = input.message.trim()
    if (!['booking', 'membership', 'payment', 'technical', 'other'].includes(input.category)
      || subject.length < 1 || subject.length > 120 || message.length < 1 || message.length > 2000) {
      throw new Error('Invalid inquiry details')
    }
    const inquiry: SupportInquiry = {
      id: uid('inq'),
      club_id: DEMO_CLUB_ID,
      user_id: actor.id,
      category: input.category,
      subject,
      message,
      status: 'open',
      created_at: todayISO(),
    }
    db.inquiries.unshift(inquiry)
    save(db)
    return inquiry
  },
  inquiriesForUser(userId: string): SupportInquiry[] {
    const db = load()
    const actor = currentActor(db)
    if (!actor || actor.role !== 'staff' || actor.id !== userId) {
      throw new Error('Staff can only view their own inquiries')
    }
    return db.inquiries
      .filter((inquiry) => inquiry.club_id === DEMO_CLUB_ID && inquiry.user_id === userId)
      .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
      .map((inquiry) => ({ ...inquiry, sender: db.profiles.find((profile) => profile.id === inquiry.user_id) }))
  },
  allInquiries(): SupportInquiry[] {
    const db = load()
    const actor = currentActor(db)
    if (!actor || actor.role !== 'admin') throw new Error('Only admins can view all inquiries')
    return db.inquiries
      .filter((inquiry) => inquiry.club_id === DEMO_CLUB_ID)
      .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
      .map((inquiry) => ({ ...inquiry, sender: db.profiles.find((profile) => profile.id === inquiry.user_id) }))
  },
  respondToInquiry(input: { id: string; status: InquiryStatus; response?: string }): SupportInquiry {
    const db = load()
    const actor = currentActor(db)
    if (!actor || actor.role !== 'admin') throw new Error('Only admins can update inquiries')
    if (!['open', 'in_progress', 'resolved'].includes(input.status)) throw new Error('Invalid inquiry status')
    const inquiry = db.inquiries.find((row) => row.id === input.id && row.club_id === DEMO_CLUB_ID)
    if (!inquiry) throw new Error('Inquiry not found')
    const response = input.response?.trim()
    if (response && inquiry.responded_at) throw new Error('This inquiry already has an Admin response')
    if (response && response.length > 2000) throw new Error('Response must be 2000 characters or fewer')
    if (inquiry.status === input.status && !response) return inquiry

    inquiry.status = input.status
    if (response) {
      inquiry.response = response
      inquiry.responded_by = actor.id
      inquiry.responded_at = todayISO()
    }
    const statusLabel = input.status.replace('_', ' ')
    const replyNote = response ? ` Admin reply: ${response}` : ''
    db.notifications.unshift({
      id: uid('notif'),
      club_id: inquiry.club_id,
      venue_id: null,
      user_id: inquiry.user_id,
      title: 'Inquiry update',
      body: `Your inquiry "${inquiry.subject}" is now ${statusLabel}.${replyNote}`,
      read: false,
      created_at: todayISO(),
    })
    save(db)
    return inquiry
  },
}
