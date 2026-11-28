import { beforeEach, describe, expect, it } from 'vitest'
import { api } from '../api'
import { setActiveClubId } from '../clubContext'
import { demoStore } from '../demoStore'
import { DEMO_VENUE_ID } from '../tenant'

// Mirrors 20261128100500_desk_walkin_checks.sql: the same limits, tidying and messages.
const guest = { full_name: 'Guest', purpose: 'Day pass', amount: 350, venue_id: DEMO_VENUE_ID, created_by: 'user_staff' }

function counts() {
  const db = demoStore.get()
  return { walkins: db.walkins.length, transactions: db.transactions.length }
}

describe('desk walk-in checks', () => {
  beforeEach(() => {
    localStorage.clear()
    demoStore.reset()
    setActiveClubId(null)
  })

  it.each([
    [{ amount: -1 }, 'Amount must be between 0 and 100,000 pesos'],
    [{ amount: -0.01 }, 'Amount must be between 0 and 100,000 pesos'],
    [{ amount: 100000.01 }, 'Amount must be between 0 and 100,000 pesos'],
    [{ amount: Number.NaN }, 'Amount must be between 0 and 100,000 pesos'],
    [{ amount: Number.POSITIVE_INFINITY }, 'Amount must be between 0 and 100,000 pesos'],
    [{ full_name: '   ' }, "Please enter the guest's full name"],
    [{ full_name: '​‮\t' }, "Please enter the guest's full name"],
    [{ full_name: 'a'.repeat(81) }, 'Full name is limited to 80 characters'],
    [{ phone: '9'.repeat(25) }, 'Phone is limited to 24 characters'],
    [{ purpose: 'p'.repeat(201) }, 'Purpose is limited to 200 characters'],
  ])('refuses %o and records nothing', async (change, message) => {
    const before = counts()
    await expect(api.createWalkIn({ ...guest, ...change })).rejects.toThrow(message)
    expect(counts()).toEqual(before)
  })

  it('tidies the name, phone and purpose, and records one walk-in charge', async () => {
    const row = await api.createWalkIn({
      ...guest,
      full_name: '  Juan \t dela   Cruz ',
      phone: ' 0917 123 4567 ',
      purpose: '  Day   pass ',
    })
    expect(row).toMatchObject({ full_name: 'Juan dela Cruz', phone: '0917 123 4567', purpose: 'Day pass', amount: 350 })
    const charge = demoStore.get().transactions.find((tx) => tx.description === 'Walk-in: Juan dela Cruz — Day pass')
    expect(charge).toMatchObject({ amount: 350, type: 'walk_in', venue_id: DEMO_VENUE_ID })
  })

  it('drops hidden characters, treats an empty phone as none, and allows a free visit', async () => {
    const row = await api.createWalkIn({ ...guest, full_name: 'Ana​ Lim‮', phone: '', purpose: '', amount: 0 })
    expect(row).toMatchObject({ full_name: 'Ana Lim', phone: null, purpose: '', amount: 0 })
  })

  it('accepts the limits themselves, counting characters as the database does', async () => {
    await expect(api.createWalkIn({
      ...guest, full_name: 'a'.repeat(80), phone: '9'.repeat(24), purpose: 'p'.repeat(200), amount: 100000,
    })).resolves.toMatchObject({ amount: 100000 })
    // 80 emoji are 80 characters (160 UTF-16 units); 81 are too many.
    await expect(api.createWalkIn({ ...guest, full_name: '😀'.repeat(80) })).resolves.toMatchObject({ purpose: 'Day pass' })
    await expect(api.createWalkIn({ ...guest, full_name: '😀'.repeat(81) })).rejects.toThrow('Full name is limited to 80 characters')
  })
})
