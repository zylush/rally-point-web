import type { ClubAccount, Transaction } from '../../types'
import { todayISO, uid } from './common'
import type { DemoDB } from './model'

/** Court time gets a platform ledger line. Walk-ins and membership fees stay with the club. */
export const COMMISSION_TYPES: ReadonlyArray<Transaction['type']> = ['booking', 'court_rental', 'extension']
/** Charges that pay the flat booking fee. An extension adds time to a booking that already paid it. */
export const BOOKING_FEE_TYPES: ReadonlyArray<Transaction['type']> = ['booking', 'court_rental']
/** The percentage fee is retired; every club starts at 0 (migration 20261127110000). */
export const DEFAULT_COMMISSION_RATE = 0
/** Every club starts with no booking fee until the superadmin sets one. */
export const DEFAULT_BOOKING_FEE = 0

/** Rounds to the centavo, half away from zero (matches Postgres numeric rounding for amounts). */
export function round2(value: number) {
  return Math.round((value + Number.EPSILON * Math.sign(value)) * 100) / 100
}

/** The account every club gets automatically (mirrors the clubs insert trigger). */
export function defaultClubAccount(clubId: string, isActive: boolean, now = todayISO()): ClubAccount {
  return {
    club_id: clubId,
    status: isActive ? 'active' : 'provisioning',
    commission_rate: DEFAULT_COMMISSION_RATE,
    booking_fee: DEFAULT_BOOKING_FEE,
    city: null,
    address: null,
    contact_email: null,
    contact_phone: null,
    created_at: now,
    updated_at: now,
  }
}

/**
 * The platform fee on one charge, as the transactions trigger works it out: the club's flat
 * fee for a booking or desk rental (none for an extension), plus any retired percentage still
 * set, never more than the charge itself.
 */
export function platformFee(type: Transaction['type'], amount: number, account: { booking_fee?: number; commission_rate?: number } | undefined) {
  const fee = BOOKING_FEE_TYPES.includes(type) ? account?.booking_fee ?? DEFAULT_BOOKING_FEE : 0
  const rate = account?.commission_rate ?? DEFAULT_COMMISSION_RATE
  return { fee, rate, amount: Math.min(amount, round2(fee + round2((amount * rate) / 100))) }
}

/**
 * Mirrors the transactions trigger: a court-time charge records one ledger line with the
 * club's current fee. Recorded charges are not collected money.
 */
export function recordCommission(db: DemoDB, tx: Transaction) {
  if (!tx.club_id || !COMMISSION_TYPES.includes(tx.type) || !(tx.amount > 0)) return
  if (db.commissions.some((line) => line.transaction_id === tx.id)) return
  const account = db.clubAccounts.find((row) => row.club_id === tx.club_id)
  const charged = platformFee(tx.type, tx.amount, account)
  db.commissions.unshift({
    id: uid('commission'),
    club_id: tx.club_id,
    venue_id: tx.venue_id ?? null,
    transaction_id: tx.id,
    gross_amount: tx.amount,
    commission_rate: charged.rate,
    booking_fee: charged.fee,
    commission_amount: charged.amount,
    club_net_amount: round2(tx.amount - charged.amount),
    verification_status: tx.verification_status ?? 'unverified',
    created_at: tx.created_at || todayISO(),
  })
}

/** Records a charge (newest first or last, as each caller already did) and its commission line. */
export function recordTransaction(db: DemoDB, tx: Transaction, position: 'first' | 'last' = 'last'): Transaction {
  const row: Transaction = { ...tx, verification_status: tx.verification_status ?? 'unverified' }
  if (position === 'first') db.transactions.unshift(row)
  else db.transactions.push(row)
  recordCommission(db, row)
  return row
}
