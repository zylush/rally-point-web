import { supabase } from './supabase'

/** The public Storage bucket for court and location photos (see the court_photos migration). */
export const PHOTO_BUCKET = 'court-photos'

/** File types an admin can pick. Phones usually hand over JPEG even for HEIC photos. */
export const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp'

const ACCEPTED_TYPES = PHOTO_ACCEPT.split(',')
const MAX_INPUT_BYTES = 20 * 1024 * 1024
/** Matches the bucket's file size limit. */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

export interface PreparedPhoto {
  blob: Blob
  type: 'image/webp' | 'image/jpeg'
  ext: 'webp' | 'jpg'
}

/** Refuses files that are not photos or are far too large, with a message an admin can act on. */
export function checkPhotoFile(file: File) {
  if (!ACCEPTED_TYPES.includes(file.type)) throw new Error('Choose a JPEG, PNG or WebP photo')
  if (file.size > MAX_INPUT_BYTES) throw new Error('This photo is too large. Choose one under 20 MB.')
}

async function decode(file: File): Promise<CanvasImageSource & { width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      /* fall back to an <img> below */
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return img
  } catch {
    throw new Error('This photo could not be opened. Try another one.')
  } finally {
    URL.revokeObjectURL(url)
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality))
}

/**
 * Shrinks a photo in the browser before upload: at most `maxSide` pixels on the
 * longer side, saved as WebP (or JPEG where WebP is not available). Redrawing
 * also drops hidden details such as the GPS location some phones store.
 */
export async function shrinkPhoto(file: File, maxSide = 1600, quality = 0.82): Promise<PreparedPhoto> {
  checkPhotoFile(file)
  const image = await decode(file)
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.width * scale))
  canvas.height = Math.max(1, Math.round(image.height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser cannot prepare photos. Try another browser.')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  if ('close' in image && typeof image.close === 'function') image.close()

  const webp = await toBlob(canvas, 'image/webp', quality)
  const prepared: PreparedPhoto | null = webp?.type === 'image/webp'
    ? { blob: webp, type: 'image/webp', ext: 'webp' }
    : await toBlob(canvas, 'image/jpeg', quality).then((jpeg) => (jpeg ? { blob: jpeg, type: 'image/jpeg' as const, ext: 'jpg' as const } : null))
  if (!prepared) throw new Error('This photo could not be prepared. Try another one.')
  if (prepared.blob.size > MAX_UPLOAD_BYTES) throw new Error('This photo is still too large after shrinking. Try another one.')
  return prepared
}

/** A smaller copy as a data link, for the browser demo, which keeps photos in local storage. */
export async function shrinkPhotoToDataUrl(file: File): Promise<string> {
  const { blob } = await shrinkPhoto(file, 900, 0.72)
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('This photo could not be prepared. Try another one.'))
    reader.readAsDataURL(blob)
  })
}

/** The public link for a stored photo. Demo photos are already data links. */
export function photoUrl(path: string): string {
  if (!supabase || path.startsWith('data:')) return path
  return supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl
}
