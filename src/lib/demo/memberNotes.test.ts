import { beforeEach, describe, expect, it } from 'vitest'
import { api } from '../api'
import { setActiveClubId } from '../clubContext'
import { demoStore } from '../demoStore'

// Mirrors 20261128100400_member_notes_private.sql: staff notes on a member reach the
// club's admins (member editor, ensure_member_qr) but never the member's own card.
const NOTE = 'Staff only: paid late twice'

function signIn(email: string, password: string) {
  demoStore.logout()
  demoStore.login(email, password)
}

function storedNotes(memberId: string) {
  return demoStore.get().members.find((member) => member.id === memberId)?.notes
}

describe('member notes stay with the club admins', () => {
  beforeEach(() => {
    localStorage.clear()
    demoStore.reset()
    setActiveClubId(null)
    const db = demoStore.get()
    db.members.find((member) => member.id === 'mem_001')!.notes = NOTE
    demoStore.set(db)
  })

  it('gives the member their own card and QR row without the notes', async () => {
    signIn('member@brinely.info', 'member123')
    const card = await api.memberForUser('user_member')
    expect(card).toMatchObject({ id: 'mem_001', full_name: 'Mia Member', notes: null })
    const row = await api.ensureMemberQr('mem_001')
    expect(row.qr_token).toBeTruthy()
    expect(row.notes).toBeNull()
    expect(storedNotes('mem_001')).toBe(NOTE)
  })

  it('does not hand the notes to staff', () => {
    signIn('staff@brinely.info', 'staff123')
    expect(demoStore.ensureMemberQr('mem_001').notes).toBeNull()
    expect(demoStore.memberByUser('user_member')?.notes).toBeNull()
  })

  it('keeps the notes for the club admin, while the member card never carries them', async () => {
    signIn('admin@brinely.info', 'admin123')
    expect((await api.getMember('mem_001'))?.notes).toBe(NOTE)
    expect(demoStore.ensureMemberQr('mem_001').notes).toBe(NOTE)
    expect(demoStore.memberByUser('user_member')?.notes).toBeNull()
    await api.saveMember({ id: 'mem_001', full_name: 'Mia Member', membership_type: 'standard', notes: 'Paid in full' })
    expect((await api.getMember('mem_001'))?.notes).toBe('Paid in full')
  })
})
