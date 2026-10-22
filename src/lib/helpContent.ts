import type { Role } from '../types'

export const helpFaqs = [
  {
    question: 'How do I book a court?',
    answer:
      'Open Book from the menu, choose a date, court, and time, then complete payment. Your booking is confirmed after payment.',
  },
  {
    question: 'How do I check in?',
    answer:
      'Show your My QR code to staff when you arrive. Staff can also look you up by member ID.',
  },
  {
    question: 'Can I cancel or change a booking?',
    answer:
      'Please contact the club as soon as possible. Staff will check the booking status and available options.',
  },
  {
    question: 'How do I renew my membership?',
    answer:
      'Open your Account or membership card and choose Renew. Contact staff if your membership details need correcting.',
  },
  {
    question: 'What are the club hours?',
    answer:
      'Courts can be booked any time, 24 hours a day, every day (Philippine time). A booking ends by midnight. Availability can change during events and maintenance.',
  },
] as const

type HelpAction = { label: string; to: string }

// Members get the same answers as the login page, plus a link where one helps.
const memberActions: Partial<Record<(typeof helpFaqs)[number]['question'], HelpAction>> = {
  'How do I book a court?': { label: 'Go to Book', to: '/member/book' },
  'How do I check in?': { label: 'Open My QR', to: '/member/pass' },
  'How do I renew my membership?': { label: 'Open Account', to: '/member/profile' },
}

export const signedInHelpFaqs: Record<
  Role,
  readonly {
    question: string
    answer: string
    action?: HelpAction
  }[]
> = {
  member: helpFaqs.map((faq) => ({ ...faq, action: memberActions[faq.question] })),
  staff: [
    {
      question: 'Where can I check in a member?',
      answer: 'Use Check in to look up a member and help them check in.',
      action: { label: 'Go to Check in', to: '/staff/checkin' },
    },
    {
      question: 'Where can I check the schedule?',
      answer: 'Open Schedule to review the court schedule.',
      action: { label: 'Open Schedule', to: '/staff/board' },
    },
    {
      question: 'Where can I review court status?',
      answer: 'Open Courts to review the courts and their current status.',
      action: { label: 'Open Courts', to: '/staff/courts' },
    },
    {
      question: 'How do I follow up on an inquiry?',
      answer:
        'Submit a question in Help. Your inquiries section shows its status and any Admin reply.',
    },
  ],
  admin: [
    {
      question: 'Where can I review bookings?',
      answer: 'Open Bookings to review club bookings.',
      action: { label: 'Open Bookings', to: '/admin/bookings' },
    },
    {
      question: 'Where can I manage club operations?',
      answer: 'Open Floor to access the club operations workspace.',
      action: { label: 'Open Floor', to: '/admin/ops' },
    },
    {
      question: 'Where can I check the schedule?',
      answer: 'Open Schedule to review the court schedule.',
      action: { label: 'Open Schedule', to: '/admin/board' },
    },
    {
      question: 'How do I respond to a Staff inquiry?',
      answer:
        'Open Inquiry inbox in Help to review inquiries, update status, and send one reply per inquiry.',
    },
  ],
  superadmin: [
    {
      question: 'Where can I review platform activity?',
      answer: 'Open Overview to access the superadmin workspace.',
      action: { label: 'Open Overview', to: '/superadmin' },
    },
    {
      question: 'Who do I contact about platform operations?',
      answer:
        'Use the Platform operations contact details in Help for cloud infrastructure, database hosting, or payment provider escalations.',
    },
  ],
}
