import { DEFAULT_CLUB_SLUG } from './tenant'

/** Where links into the Privacy Notice say "come back here". */
export type PrivacyNoticeState = { from?: string }

/** Link to the Privacy Notice for one club; the default club needs no parameter. */
export function privacyNoticePath(clubSlug?: string) {
  return clubSlug && clubSlug !== DEFAULT_CLUB_SLUG
    ? `/privacy?club=${encodeURIComponent(clubSlug)}`
    : '/privacy'
}
