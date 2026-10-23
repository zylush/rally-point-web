import { beforeEach, describe, expect, it } from 'vitest'
import { demoStore } from './demoStore'
import { setActiveClubId } from './clubContext'
import { checkPhotoFile } from './photos'
import { DEMO_DAVAO_CLUB_ID, DEMO_VENUE_ID } from './tenant'

const pic = (n: number) => `data:image/jpeg;base64,${n}`

function firstCourt() {
  const court = demoStore.courts(DEMO_VENUE_ID)[0]
  if (!court) throw new Error('Expected a seeded court')
  return court
}

describe('demo court photos (mirrors the court_photos functions)', () => {
  beforeEach(() => {
    localStorage.clear()
    setActiveClubId(null)
    demoStore.reset()
  })

  it('adds photos in order, shows them on the public club page, and limits a court to 8', () => {
    const court = firstCourt()
    for (let n = 1; n <= 8; n += 1) demoStore.addCourtPhoto(court.id, pic(n))
    expect(() => demoStore.addCourtPhoto(court.id, pic(9))).toThrow('A court can have up to 8 photos')

    const detail = demoStore.publicClubDetail('rally-point-gensan')
    const shown = detail?.venues.flatMap((venue) => venue.courts).find((row) => row.id === court.id)
    expect(shown?.photos).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map(pic))
    // With no location cover, the club card uses the first court's main photo.
    expect(demoStore.publicClubs().find((club) => club.slug === 'rally-point-gensan')?.cover_photo).toBe(pic(1))
  })

  it('moves a photo to the front and removes photos', () => {
    const court = firstCourt()
    demoStore.addCourtPhoto(court.id, pic(1))
    const second = demoStore.addCourtPhoto(court.id, pic(2))
    demoStore.makeMainCourtPhoto(second.id)
    expect(demoStore.listCourtPhotos().map((photo) => photo.url)).toEqual([pic(2), pic(1)])

    demoStore.removeCourtPhoto(second.id)
    expect(demoStore.listCourtPhotos().map((photo) => photo.url)).toEqual([pic(1)])
    expect(() => demoStore.removeCourtPhoto(second.id)).toThrow('photo not found')
  })

  it('keeps one cover per location, which the club card prefers over court photos', () => {
    demoStore.addCourtPhoto(firstCourt().id, pic(1))
    demoStore.setVenueCover(DEMO_VENUE_ID, pic(10))
    demoStore.setVenueCover(DEMO_VENUE_ID, pic(11))
    const covers = demoStore.listCourtPhotos().filter((photo) => photo.court_id === null)
    expect(covers.map((photo) => photo.url)).toEqual([pic(11)])
    expect(demoStore.publicClubs().find((club) => club.slug === 'rally-point-gensan')?.cover_photo).toBe(pic(11))
    expect(demoStore.publicClubDetail('rally-point-gensan')?.venues.find((venue) => venue.id === DEMO_VENUE_ID)?.cover_photo).toBe(pic(11))

    demoStore.setVenueCover(DEMO_VENUE_ID, null)
    expect(demoStore.listCourtPhotos().some((photo) => photo.court_id === null)).toBe(false)
  })

  it("cannot touch another club's courts or photos", () => {
    const court = firstCourt()
    const photo = demoStore.addCourtPhoto(court.id, pic(1))
    setActiveClubId(DEMO_DAVAO_CLUB_ID)
    expect(() => demoStore.addCourtPhoto(court.id, pic(2))).toThrow('court not found')
    expect(() => demoStore.removeCourtPhoto(photo.id)).toThrow('photo not found')
    expect(() => demoStore.setVenueCover(DEMO_VENUE_ID, pic(3))).toThrow('venue not found')
    expect(demoStore.listCourtPhotos()).toEqual([])
  })
})

describe('photo file checks', () => {
  it('accepts JPEG, PNG and WebP under 20 MB and explains anything else', () => {
    expect(() => checkPhotoFile(new File(['x'], 'a.jpg', { type: 'image/jpeg' }))).not.toThrow()
    expect(() => checkPhotoFile(new File(['x'], 'a.gif', { type: 'image/gif' }))).toThrow('Choose a JPEG, PNG or WebP photo')
    const huge = new File(['x'], 'big.png', { type: 'image/png' })
    Object.defineProperty(huge, 'size', { value: 21 * 1024 * 1024 })
    expect(() => checkPhotoFile(huge)).toThrow('This photo is too large. Choose one under 20 MB.')
  })
})
