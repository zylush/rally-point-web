import type {
  CoachBookingRequest,
  CoachBookingSlot,
  CoachProfileAccess,
  CoachRequestMessage,
  PublicCoachListing,
} from '../../types'
import { DEFAULT_CLUB_SLUG } from '../tenant'
import { activeClubId, clubRoleFor } from './access'
import { uid } from './common'
import { activePublicClubBySlug } from './leaderboard'
import type { DemoDB } from './model'
import { load, save } from './persistence'

type SlotInput = {
  id?: string
  coach_id: string
  starts_at: string
  ends_at: string
  lesson_type: 'private' | 'group'
  pricing_model: 'per_student' | 'per_session'
  rate: number
  max_students: number
}

function linkedCoach(db: DemoDB, coachId: string) {
  const coach = db.clubCoaches?.find((row) => row.id === coachId && row.account_user_id === db.sessionUserId)
  if (!coach) throw new Error('Coach profile not found')
  return coach
}

function activeRequests(db: DemoDB, slotId: string) {
  return (db.coachBookingRequests ?? []).filter((row) =>
    row.slot_id === slotId && (row.status === 'requested' || row.status === 'accepted'),
  )
}

function addNotification(db: DemoDB, clubId: string, userId: string | null | undefined, title: string, body: string) {
  if (!userId) return
  db.notifications.unshift({
    id: uid('notice'),
    club_id: clubId,
    user_id: userId,
    title,
    body,
    read: false,
    created_at: new Date().toISOString(),
  })
}

function requestById(db: DemoDB, requestId: string) {
  const request = db.coachBookingRequests?.find((row) => row.request_id === requestId)
  if (!request) throw new Error('Coaching request not found')
  return request
}

function canAccessRequest(db: DemoDB, request: CoachBookingRequest) {
  if (request.player_user_id === db.sessionUserId) return true
  return db.clubCoaches?.some((coach) =>
    coach.id === request.coach_id && coach.account_user_id === db.sessionUserId,
  ) ?? false
}

export const coachingOperations = {
  linkClubCoachAccount(coachId: string, email: string | null) {
    const db = load()
    const clubId = activeClubId(db)
    if (clubRoleFor(db, db.sessionUserId, clubId) !== 'admin') throw new Error('admin access required')
    const coach = db.clubCoaches?.find((row) => row.id === coachId && row.club_id === clubId)
    if (!coach) throw new Error('coach not found')
    const activeRequestsExist = (db.coachBookingRequests ?? []).some((row) =>
      row.coach_id === coachId && (row.status === 'requested' || row.status === 'accepted'),
    )
    if (email?.trim()) {
      const profile = db.profiles.find((row) => row.email.toLowerCase() === email.trim().toLowerCase())
      if (!profile) throw new Error('No existing account uses that email. Ask the coach to sign up first.')
      if (coach.account_user_id !== profile.id && activeRequestsExist) {
        throw new Error('Cancel or finish active coaching requests before changing this account')
      }
      if (db.clubCoaches?.some((row) =>
        row.id !== coachId && row.club_id === clubId && row.account_user_id === profile.id,
      )) throw new Error('That account is already linked to another coach profile in this club')
      coach.account_user_id = profile.id
      save(db)
      return
    }
    if (coach.account_user_id && activeRequestsExist) {
      throw new Error('Cancel or finish active coaching requests before changing this account')
    }
    if (!email?.trim()) {
      coach.account_user_id = null
      save(db)
      return
    }
  },

  coachMyProfiles(): CoachProfileAccess[] {
    const db = load()
    return (db.clubCoaches ?? []).flatMap((coach) => {
      if (coach.account_user_id !== db.sessionUserId) return []
      const club = db.clubs.find((row) => row.id === coach.club_id)
      if (!club) return []
      return [{
        coach_id: coach.id,
        club_id: coach.club_id,
        club_slug: club.slug,
        club_name: club.name,
        full_name: coach.full_name,
        headline: coach.headline,
        bio: coach.bio,
        hourly_rate: coach.hourly_rate,
        photo_path: coach.photo_path,
        is_active: coach.is_active,
        booking_policy: coach.booking_policy ?? null,
      }]
    })
  },

  coachSetBookingPolicy(coachId: string, policy: string) {
    const db = load()
    const coach = linkedCoach(db, coachId)
    const cleaned = policy.trim()
    if (cleaned.length > 2000) throw new Error('Booking policy is limited to 2,000 characters')
    coach.booking_policy = cleaned || null
    save(db)
  },

  coachListMySlots(): CoachBookingSlot[] {
    const db = load()
    const profiles = db.clubCoaches?.filter((row) => row.account_user_id === db.sessionUserId) ?? []
    return (db.coachBookingSlots ?? []).filter((slot) => profiles.some((coach) => coach.id === slot.coach_id))
      .map((slot) => {
        const coach = profiles.find((row) => row.id === slot.coach_id)
        if (!coach) throw new Error('Coach profile not found')
        const club = db.clubs.find((row) => row.id === slot.club_id)
        return {
          ...slot,
          coach_name: coach.full_name,
          club_name: club?.name ?? '',
          active_students: activeRequests(db, slot.slot_id).reduce((sum, row) => sum + row.student_count, 0),
        }
      })
      .sort((a, b) => b.starts_at.localeCompare(a.starts_at))
  },

  coachUpsertBookingSlot(input: SlotInput): CoachBookingSlot {
    const db = load()
    const coach = linkedCoach(db, input.coach_id)
    if (!coach.is_active) throw new Error('This coach profile is not active')
    const start = new Date(input.starts_at)
    const end = new Date(input.ends_at)
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start || start <= new Date()) {
      throw new Error('Choose a future time with an end after its start')
    }
    if (!['private', 'group'].includes(input.lesson_type)
      || !['per_student', 'per_session'].includes(input.pricing_model)
      || !Number.isFinite(input.rate) || input.rate < 0 || input.rate > 100000
      || !Number.isInteger(input.max_students) || input.max_students < 1 || input.max_students > 16
      || (input.lesson_type === 'private' && input.max_students !== 1)
      || (input.lesson_type === 'group' && input.max_students < 2)) {
      throw new Error('Check the lesson type, price and group size')
    }
    const slots = (db.coachBookingSlots ??= [])
    if (slots.some((row) => row.coach_id === input.coach_id && row.is_open
      && row.slot_id !== input.id
      && new Date(row.starts_at) < end && start < new Date(row.ends_at))) {
      throw new Error('This time overlaps another open coach slot')
    }
    if (input.id) {
      const slot = slots.find((row) => row.slot_id === input.id && row.coach_id === input.coach_id)
      if (!slot) throw new Error('Coach slot not found')
      if (activeRequests(db, slot.slot_id).length) throw new Error('A slot with active requests cannot be changed')
      Object.assign(slot, {
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        lesson_type: input.lesson_type,
        pricing_model: input.pricing_model,
        rate: input.rate,
        max_students: input.max_students,
      })
      save(db)
      return { ...slot, coach_name: coach.full_name }
    }
    const slot: CoachBookingSlot = {
      slot_id: uid('coach-slot'),
      coach_id: coach.id,
      club_id: coach.club_id,
      coach_name: coach.full_name,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      lesson_type: input.lesson_type,
      pricing_model: input.pricing_model,
      rate: input.rate,
      max_students: input.max_students,
      is_open: true,
      active_students: 0,
    }
    slots.push(slot)
    save(db)
    return { ...slot }
  },

  coachSetBookingSlotOpen(slotId: string, isOpen: boolean): CoachBookingSlot {
    const db = load()
    const slot = (db.coachBookingSlots ?? []).find((row) => row.slot_id === slotId)
    if (!slot) throw new Error('Coach slot not found')
    const coach = linkedCoach(db, slot.coach_id)
    if (isOpen && (!coach.is_active || new Date(slot.starts_at) <= new Date())) {
      throw new Error('An inactive coach or a past time cannot be opened')
    }
    if (!isOpen && activeRequests(db, slotId).length) throw new Error('A slot with active requests cannot be closed')
    if (isOpen && (db.coachBookingSlots ?? []).some((row) =>
      row.coach_id === slot.coach_id && row.slot_id !== slotId && row.is_open
      && new Date(row.starts_at) < new Date(slot.ends_at)
      && new Date(slot.starts_at) < new Date(row.ends_at),
    )) throw new Error('This time overlaps another open coach slot')
    slot.is_open = isOpen
    save(db)
    return { ...slot, coach_name: coach.full_name }
  },

  memberListCoachSlots(from: string, until: string): CoachBookingSlot[] {
    const db = load()
    const clubId = activeClubId(db)
    if (clubRoleFor(db, db.sessionUserId, clubId) !== 'member') {
      throw new Error('Join this club as a player to book a coach')
    }
    const start = new Date(from)
    const end = new Date(until)
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
      throw new Error('Choose a valid date range')
    }
    return (db.coachBookingSlots ?? []).filter((slot) => {
      if (slot.club_id !== clubId || !slot.is_open) return false
      const coach = db.clubCoaches?.find((row) => row.id === slot.coach_id && row.is_active)
      if (!coach || new Date(slot.starts_at) < start || new Date(slot.starts_at) >= end || new Date(slot.starts_at) <= new Date()) return false
      const requests = activeRequests(db, slot.slot_id)
      if (requests.some((row) => row.status === 'requested')) return false
      return requests.reduce((sum, row) => sum + row.student_count, 0) < slot.max_students
    }).map((slot) => {
      const coach = db.clubCoaches?.find((row) => row.id === slot.coach_id)
      if (!coach) throw new Error('Coach profile not found')
      const students = activeRequests(db, slot.slot_id).reduce((sum, row) => sum + row.student_count, 0)
      return {
        ...slot,
        coach_name: coach.full_name,
        coach_headline: coach.headline,
        coach_photo_url: coach.photo_url,
        remaining_students: slot.max_students - students,
        booking_policy: coach.booking_policy ?? null,
      }
    }).sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  },

  memberRequestCoachSlot(input: {
    slot: CoachBookingSlot
    student_count: number
    message: string
  }): CoachBookingRequest {
    const db = load()
    const clubId = activeClubId(db)
    if (clubRoleFor(db, db.sessionUserId, clubId) !== 'member') throw new Error('Join this club as a player to book a coach')
    const slot = (db.coachBookingSlots ?? []).find((row) => row.slot_id === input.slot.slot_id && row.club_id === clubId)
    const coach = slot && db.clubCoaches?.find((row) => row.id === slot.coach_id && row.is_active)
    if (!slot || !coach || !slot.is_open || new Date(slot.starts_at) <= new Date()) {
      throw new Error('This coach time is no longer available')
    }
    const count = input.student_count
    if (!Number.isInteger(count) || count < 1 || count > slot.max_students || (slot.lesson_type === 'private' && count !== 1)) {
      throw new Error('Choose a valid number of players for this lesson')
    }
    const requests = activeRequests(db, slot.slot_id)
    if (requests.some((row) => row.player_user_id === db.sessionUserId)) {
      throw new Error('You already have an active request for this coach time')
    }
    if (requests.some((row) => row.status === 'requested')) {
      throw new Error('This coach time is waiting for another player’s request to be decided')
    }
    const occupied = requests.reduce((sum, row) => sum + row.student_count, 0)
    if (occupied + count > slot.max_students) throw new Error('Not enough places remain for this group')
    const message = input.message.trim()
    if (message.length > 600) throw new Error('The note is limited to 600 characters')
    const profile = db.profiles.find((row) => row.id === db.sessionUserId)
    if (!profile) throw new Error('Your account profile is not available')
    const durationHours = (new Date(slot.ends_at).getTime() - new Date(slot.starts_at).getTime()) / 3600000
    const amount = Math.round((slot.pricing_model === 'per_student'
      ? slot.rate * count * durationHours
      : slot.rate) * 100) / 100
    const request: CoachBookingRequest = {
      request_id: uid('coach-request'),
      slot_id: slot.slot_id,
      club_id: clubId,
      coach_id: coach.id,
      coach_name: coach.full_name,
      player_user_id: profile.id,
      player_name: profile.full_name,
      player_email: profile.email,
      starts_at: slot.starts_at,
      ends_at: slot.ends_at,
      lesson_type: slot.lesson_type,
      pricing_model: slot.pricing_model,
      rate: slot.rate,
      student_count: count,
      quoted_amount: amount,
      message: message || null,
      status: 'requested',
      created_at: new Date().toISOString(),
    }
    ;(db.coachBookingRequests ??= []).push(request)
    save(db)
    return { ...request }
  },

  coachListMyRequests(): CoachBookingRequest[] {
    const db = load()
    const coachIds = new Set((db.clubCoaches ?? [])
      .filter((row) => row.account_user_id === db.sessionUserId)
      .map((row) => row.id))
    return (db.coachBookingRequests ?? []).filter((row) => !!row.coach_id && coachIds.has(row.coach_id))
      .map((row) => ({ ...row }))
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  },

  memberListMyCoachRequests(): CoachBookingRequest[] {
    const db = load()
    const clubId = activeClubId(db)
    if (clubRoleFor(db, db.sessionUserId, clubId) !== 'member') throw new Error('Join this club as a player to see coach requests')
    return (db.coachBookingRequests ?? []).filter((row) =>
      row.club_id === clubId && row.player_user_id === db.sessionUserId,
    ).map((row) => ({ ...row })).sort((a, b) => b.created_at.localeCompare(a.created_at))
  },

  coachRespondToBookingRequest(requestId: string, accept: boolean) {
    const db = load()
    const request = requestById(db, requestId)
    linkedCoach(db, request.coach_id ?? '')
    if (request.status !== 'requested') throw new Error('This coaching request has already been decided')
    request.status = accept ? 'accepted' : 'declined'
    request.updated_at = new Date().toISOString()
    addNotification(db, request.club_id, request.player_user_id,
      accept ? 'Lesson request accepted' : 'Lesson request declined',
      accept ? 'Your coach accepted the time. Message them to agree on a court.'
        : 'Your coach declined the requested time. You can choose another available time.',
    )
    save(db)
  },

  memberCancelCoachRequest(requestId: string) {
    const db = load()
    const request = requestById(db, requestId)
    if (request.player_user_id !== db.sessionUserId) throw new Error('Coaching request not found')
    if (request.status !== 'requested' && request.status !== 'accepted') throw new Error('This coaching request can no longer be cancelled')
    request.status = 'cancelled'
    request.updated_at = new Date().toISOString()
    save(db)
  },

  coachSendRequestMessage(requestId: string, body: string): CoachRequestMessage {
    const db = load()
    const request = requestById(db, requestId)
    if (!canAccessRequest(db, request)) throw new Error('Coaching request not found')
    const text = body.trim()
    if (text.length < 1 || text.length > 2000) throw new Error('Message must be 1 to 2,000 characters')
    const message: CoachRequestMessage = {
      id: uid('coach-message'),
      request_id: requestId,
      sender_user_id: db.sessionUserId ?? '',
      body: text,
      created_at: new Date().toISOString(),
    }
    ;(db.coachRequestMessages ??= []).push(message)
    const otherUser = request.player_user_id === db.sessionUserId ? null : request.player_user_id
    addNotification(db, request.club_id, otherUser, 'New coaching message', 'You have a new message about a lesson request.')
    save(db)
    return { ...message }
  },

  coachListRequestMessages(requestId: string): CoachRequestMessage[] {
    const db = load()
    const request = requestById(db, requestId)
    if (!canAccessRequest(db, request)) throw new Error('Coaching request not found')
    return (db.coachRequestMessages ?? []).filter((row) => row.request_id === requestId)
      .map((row) => ({ ...row })).sort((a, b) => a.created_at.localeCompare(b.created_at))
  },

  /** Mirrors public.list_public_coaches: active coaches and open future lesson slots across active clubs. */
  listPublicCoaches(options?: { clubSlug?: string | null; from?: string; until?: string }): PublicCoachListing[] {
    const db = load()
    const now = new Date()
    const start = options?.from ? new Date(options.from) : now
    const end = options?.until ? new Date(options.until) : new Date(now.getTime() + 30 * 86400000)
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
      throw Object.assign(new Error('Choose a valid date range'), { code: '22023' })
    }
    const minStart = start > now ? start : now
    const maxUntil = new Date(minStart.getTime() + 90 * 86400000)
    const cappedEnd = end < maxUntil ? end : maxUntil
    const slugFilter = options?.clubSlug?.trim().toLowerCase() || null

    const clubs = db.clubs
      .filter((club) => activePublicClubBySlug(db, club.slug))
      .filter((club) => !slugFilter || club.slug.toLowerCase() === slugFilter)
      .sort((a, b) =>
        (a.slug === DEFAULT_CLUB_SLUG ? 0 : 1) - (b.slug === DEFAULT_CLUB_SLUG ? 0 : 1)
        || a.name.localeCompare(b.name),
      )

    const listings: PublicCoachListing[] = []
    for (const club of clubs) {
      const account = db.clubAccounts.find((row) => row.club_id === club.id)
      const coaches = (db.clubCoaches ?? [])
        .filter((coach) => coach.club_id === club.id && coach.is_active)
        .slice()
        .sort((a, b) =>
          (a.position - b.position)
          || a.created_at.localeCompare(b.created_at)
          || a.id.localeCompare(b.id),
        )
      for (const coach of coaches) {
        const slots = (db.coachBookingSlots ?? [])
          .filter((slot) => {
            if (slot.club_id !== club.id || slot.coach_id !== coach.id || !slot.is_open) return false
            const slotStart = new Date(slot.starts_at)
            if (slotStart < minStart || slotStart >= cappedEnd) return false
            const requests = activeRequests(db, slot.slot_id)
            if (requests.some((row) => row.status === 'requested')) return false
            const occupied = requests.reduce((sum, row) => sum + row.student_count, 0)
            return occupied < slot.max_students
          })
          .map((slot) => {
            const occupied = activeRequests(db, slot.slot_id).reduce((sum, row) => sum + row.student_count, 0)
            return {
              slot_id: slot.slot_id,
              starts_at: slot.starts_at,
              ends_at: slot.ends_at,
              lesson_type: slot.lesson_type,
              pricing_model: slot.pricing_model,
              rate: slot.rate,
              max_students: slot.max_students,
              remaining_students: slot.max_students - occupied,
            }
          })
          .sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.slot_id.localeCompare(b.slot_id))

        listings.push({
          id: coach.id,
          full_name: coach.full_name,
          headline: coach.headline,
          bio: coach.bio,
          hourly_rate: coach.hourly_rate,
          contact_phone: coach.contact_phone,
          contact_url: coach.contact_url,
          photo_url: coach.photo_url ?? null,
          booking_policy: coach.booking_policy ?? null,
          accepts_requests: Boolean(coach.account_user_id),
          club: {
            id: club.id,
            slug: club.slug,
            name: club.name,
            city: account?.city ?? null,
          },
          slots,
        })
      }
    }
    return listings
  },
}
