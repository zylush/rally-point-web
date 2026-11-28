import { STOCK_PHOTOS, type StockPhoto } from '../lib/stockPhotos'

/** "Pexels" or "Unsplash": the site named by the photo's licence. */
function siteName(photo: StockPhoto) {
  return photo.license.replace(/ License$/, '')
}

/** Who took each stand-in photo, under which licence, with a link to its source page. */
export function PhotoCredits() {
  return (
    <div className="space-y-3">
      <p>Sample photos stand in for clubs that have not added their own pictures yet.</p>
      <ul className="divide-y divide-line">
        {STOCK_PHOTOS.map((photo) => (
          <li key={photo.id} className="py-2">
            <span className="block">
              {photo.alt} — photo by {photo.photographer}, {photo.license}
            </span>
            <a
              href={photo.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-link inline-flex min-h-12 items-center"
            >
              {/* One inline wrapper, so the flex link keeps the space before the hidden note. */}
              <span>
                View “{photo.title}” by {photo.photographer} on {siteName(photo)}{' '}
                <span className="sr-only">(opens in a new tab)</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}
