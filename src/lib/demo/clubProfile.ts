import type {
  AdminClubProfile,
  ClubAddon,
  ClubAddonInput,
  ClubCoach,
  ClubCoachInput,
  ClubGalleryPhoto,
  ClubPaymentMethod,
  ClubPaymentMethodInput,
  ClubProfileFields,
  PublicClubProfile,
} from '../../types'
import {
  MAX_CLUB_ADDONS,
  MAX_CLUB_COACHES,
  MAX_CLUB_GALLERY_PHOTOS,
  MAX_CLUB_PAYMENT_METHODS,
  addonProblem,
  captionProblem,
  cleanText,
  coachProblem,
  emptyClubProfile,
  normalizeProfile,
  paymentMethodProblem,
  profileProblem,
} from '../clubProfile'
import { activeClubId, clubRoleFor } from './access'
import { uid } from './common'
import type { DemoDB } from './model'
import { load, save } from './persistence'

/** Mirrors private.require_club_admin: the active club, when the signed-in person is its admin. */
function adminClub(db: DemoDB) {
  const clubId = activeClubId(db)
  if (clubRoleFor(db, db.sessionUserId, clubId) !== 'admin') throw new Error('admin access required')
  return clubId
}

/** Browser storage is small; a full demo gets a clear message instead of a crash. */
function saveWithPictures(db: DemoDB) {
  try {
    save(db)
  } catch {
    throw new Error('The demo has no room for more pictures. Remove some first.')
  }
}

function byPosition<T extends { position: number; created_at: string }>(a: T, b: T) {
  return a.position - b.position || a.created_at.localeCompare(b.created_at)
}

function nextPosition(rows: { position: number }[]) {
  return rows.length ? Math.max(...rows.map((row) => row.position)) + 1 : 0
}

function fail(problem: string | null) {
  if (problem) throw new Error(problem)
}

function profileFor(db: DemoDB, clubId: string): ClubProfileFields {
  const row = db.clubProfiles?.find((profile) => profile.club_id === clubId)
  return row ? normalizeProfile(row) : emptyClubProfile()
}

/** Mirrors get_public_club_profile for a club already known to be taking bookings. */
export function publicClubProfileFor(db: DemoDB, clubId: string): PublicClubProfile {
  const mine = <T extends { club_id: string }>(rows: T[] | undefined) => (rows ?? []).filter((row) => row.club_id === clubId)
  return {
    ...profileFor(db, clubId),
    payment_methods: mine(db.clubPaymentMethods).filter((row) => row.is_active).sort(byPosition)
      .map(({ id, label, account_name, account_number, qr_url }) => ({ id, label, account_name, account_number, qr_url })),
    addons: mine(db.clubAddons).filter((row) => row.is_active).sort(byPosition)
      .map(({ id, name, description, price, unit }) => ({ id, name, description, price, unit })),
    coaches: mine(db.clubCoaches).filter((row) => row.is_active).sort(byPosition)
      .map(({ id, full_name, headline, bio, hourly_rate, contact_phone, contact_url, photo_url }) => ({
        id, full_name, headline, bio, hourly_rate, contact_phone, contact_url, photo_url,
      })),
    gallery: mine(db.clubGallery).sort(byPosition).map(({ id, url, caption }) => ({ id, url, caption })),
  }
}

/** Mirrors the admin_* club profile functions: same rules and messages. Pictures are data links. */
export const clubProfileOperations = {
  clubProfile(): AdminClubProfile {
    const db = load()
    const clubId = adminClub(db)
    const mine = <T extends { club_id: string; position: number; created_at: string }>(rows: T[] | undefined) =>
      (rows ?? []).filter((row) => row.club_id === clubId).sort(byPosition)
    return {
      profile: profileFor(db, clubId),
      addons: mine(db.clubAddons),
      coaches: mine(db.clubCoaches),
      payment_methods: mine(db.clubPaymentMethods),
      gallery: mine(db.clubGallery),
    }
  },

  updateClubProfile(fields: ClubProfileFields): ClubProfileFields {
    const db = load()
    const clubId = adminClub(db)
    fail(profileProblem(fields))
    const saved = normalizeProfile(fields)
    const rows = (db.clubProfiles ??= [])
    const current = rows.find((row) => row.club_id === clubId)
    if (current) Object.assign(current, saved, { updated_at: new Date().toISOString() })
    else rows.push({ ...saved, club_id: clubId, updated_at: new Date().toISOString() })
    save(db)
    return saved
  },

  upsertClubAddon(input: ClubAddonInput): ClubAddon {
    const db = load()
    const clubId = adminClub(db)
    fail(addonProblem(input))
    const addons = (db.clubAddons ??= [])
    const mine = addons.filter((row) => row.club_id === clubId)
    const name = input.name.trim()
    if (mine.some((row) => row.id !== input.id && row.name.toLowerCase() === name.toLowerCase())) {
      throw new Error('This club already has an add-on with that name')
    }
    const values = { name, description: cleanText(input.description), price: input.price, unit: input.unit, is_active: input.is_active }
    if (input.id) {
      const current = mine.find((row) => row.id === input.id)
      if (!current) throw new Error('add-on not found')
      Object.assign(current, values)
      save(db)
      return { ...current }
    }
    if (mine.length >= MAX_CLUB_ADDONS) throw new Error(`A club can list up to ${MAX_CLUB_ADDONS} add-ons`)
    const row: ClubAddon = { id: uid('addon'), club_id: clubId, ...values, position: nextPosition(mine), created_at: new Date().toISOString() }
    addons.push(row)
    save(db)
    return { ...row }
  },

  removeClubAddon(addonId: string): void {
    const db = load()
    const clubId = adminClub(db)
    const before = db.clubAddons?.length ?? 0
    db.clubAddons = (db.clubAddons ?? []).filter((row) => !(row.id === addonId && row.club_id === clubId))
    if (db.clubAddons.length === before) throw new Error('add-on not found')
    save(db)
  },

  upsertClubCoach(input: ClubCoachInput): ClubCoach {
    const db = load()
    const clubId = adminClub(db)
    fail(coachProblem(input))
    const coaches = (db.clubCoaches ??= [])
    const mine = coaches.filter((row) => row.club_id === clubId)
    const values = {
      full_name: input.full_name.trim(),
      headline: cleanText(input.headline),
      bio: cleanText(input.bio),
      hourly_rate: input.hourly_rate,
      contact_phone: cleanText(input.contact_phone),
      contact_url: cleanText(input.contact_url),
      is_active: input.is_active,
    }
    if (input.id) {
      const current = mine.find((row) => row.id === input.id)
      if (!current) throw new Error('coach not found')
      Object.assign(current, values)
      save(db)
      return { ...current }
    }
    if (mine.length >= MAX_CLUB_COACHES) throw new Error(`A club can list up to ${MAX_CLUB_COACHES} coaches`)
    const row: ClubCoach = {
      id: uid('coach'), club_id: clubId, ...values, photo_path: null, photo_url: null,
      position: nextPosition(mine), created_at: new Date().toISOString(),
    }
    coaches.push(row)
    save(db)
    return { ...row }
  },

  /** A null url clears the photo. */
  setClubCoachPhoto(coachId: string, url: string | null): void {
    const db = load()
    const clubId = adminClub(db)
    const coach = db.clubCoaches?.find((row) => row.id === coachId && row.club_id === clubId)
    if (!coach) throw new Error('coach not found')
    coach.photo_path = url ? `demo/${uid('pic')}` : null
    coach.photo_url = url
    saveWithPictures(db)
  },

  removeClubCoach(coachId: string): void {
    const db = load()
    const clubId = adminClub(db)
    const before = db.clubCoaches?.length ?? 0
    db.clubCoaches = (db.clubCoaches ?? []).filter((row) => !(row.id === coachId && row.club_id === clubId))
    if (db.clubCoaches.length === before) throw new Error('coach not found')
    save(db)
  },

  upsertClubPaymentMethod(input: ClubPaymentMethodInput): ClubPaymentMethod {
    const db = load()
    const clubId = adminClub(db)
    fail(paymentMethodProblem(input))
    const methods = (db.clubPaymentMethods ??= [])
    const mine = methods.filter((row) => row.club_id === clubId)
    const values = {
      label: input.label.trim(),
      account_name: cleanText(input.account_name),
      account_number: cleanText(input.account_number),
      is_active: input.is_active,
    }
    if (input.id) {
      const current = mine.find((row) => row.id === input.id)
      if (!current) throw new Error('payment method not found')
      Object.assign(current, values)
      save(db)
      return { ...current }
    }
    if (mine.length >= MAX_CLUB_PAYMENT_METHODS) {
      throw new Error(`A club can list up to ${MAX_CLUB_PAYMENT_METHODS} payment methods`)
    }
    const row: ClubPaymentMethod = {
      id: uid('pay'), club_id: clubId, ...values, qr_path: null, qr_url: null,
      position: nextPosition(mine), created_at: new Date().toISOString(),
    }
    methods.push(row)
    save(db)
    return { ...row }
  },

  /** A null url clears the QR code. */
  setClubPaymentQr(methodId: string, url: string | null): void {
    const db = load()
    const clubId = adminClub(db)
    const method = db.clubPaymentMethods?.find((row) => row.id === methodId && row.club_id === clubId)
    if (!method) throw new Error('payment method not found')
    method.qr_path = url ? `demo/${uid('pic')}` : null
    method.qr_url = url
    saveWithPictures(db)
  },

  removeClubPaymentMethod(methodId: string): void {
    const db = load()
    const clubId = adminClub(db)
    const before = db.clubPaymentMethods?.length ?? 0
    db.clubPaymentMethods = (db.clubPaymentMethods ?? []).filter((row) => !(row.id === methodId && row.club_id === clubId))
    if (db.clubPaymentMethods.length === before) throw new Error('payment method not found')
    save(db)
  },

  addClubPhoto(url: string, caption: string | null): ClubGalleryPhoto {
    const db = load()
    const clubId = adminClub(db)
    const gallery = (db.clubGallery ??= [])
    const mine = gallery.filter((row) => row.club_id === clubId)
    if (mine.length >= MAX_CLUB_GALLERY_PHOTOS) throw new Error(`The gallery holds up to ${MAX_CLUB_GALLERY_PHOTOS} photos`)
    fail(captionProblem(caption))
    const id = uid('gallery')
    const row: ClubGalleryPhoto = {
      id, club_id: clubId, path: `demo/${id}`, url, caption: cleanText(caption),
      position: nextPosition(mine), created_at: new Date().toISOString(),
    }
    gallery.push(row)
    saveWithPictures(db)
    return { ...row }
  },

  removeClubPhoto(photoId: string): void {
    const db = load()
    const clubId = adminClub(db)
    const before = db.clubGallery?.length ?? 0
    db.clubGallery = (db.clubGallery ?? []).filter((row) => !(row.id === photoId && row.club_id === clubId))
    if (db.clubGallery.length === before) throw new Error('photo not found')
    save(db)
  },
}
