/**
 * Map links for a club location. Both need no API key or account:
 * directions open Google Maps, and the embedded map is OpenStreetMap's own embed page.
 */

type Place = {
  address?: string | null
  city?: string | null
  latitude?: number | null
  longitude?: number | null
}

const hasPin = (place: Place): place is Place & { latitude: number; longitude: number } =>
  typeof place.latitude === 'number' && typeof place.longitude === 'number'

/** Address and city as one line, without repeating the city. */
export function placeLine(place: Pick<Place, 'address' | 'city'>) {
  return [place.address, place.city]
    .map((part) => part?.trim())
    .filter((part, index, all): part is string => !!part && all.indexOf(part) === index)
    .join(', ')
}

/** Directions to the map pin, or a search for the address; null when neither is set. */
export function directionsUrl(place: Place) {
  if (hasPin(place)) {
    return `https://www.google.com/maps/dir/?api=1&destination=${place.latitude},${place.longitude}`
  }
  const line = placeLine(place)
  return line ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(line)}` : null
}

/** An OpenStreetMap embed centred on the pin; null without a pin. */
export function mapEmbedUrl(place: Place) {
  if (!hasPin(place)) return null
  const d = 0.004
  const bbox = [place.longitude - d, place.latitude - d, place.longitude + d, place.latitude + d]
    .map((n) => n.toFixed(6))
    .join(',')
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${place.latitude},${place.longitude}`
}
