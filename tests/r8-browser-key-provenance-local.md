# Frozen r8 browser-key provenance (local evidence review, 2026-09-24)

This report contains no key value, credential, token, or private browser log. It makes no network call and does not alter the frozen package or STOP evidence.

1. The prior local browser bundle at `staging-artifact.local/assets/index-CUS71MsR.js` matches the SHA-256 pinned in frozen r8's `browserKeySource`. Frozen r8's app JavaScript also matches its manifest hash. Each bundle contains exactly one `sb_publishable_` key and the expected `https://iclrvvsiwypxlwrwgqia.supabase.co` URL; the two key strings are byte-equal. The comparison printed only counts and booleans, not the key.
2. The preserved hosted verifier fetched every one of the 20 r8 app files with `cache: 'no-store'` and compared response-byte SHA-256 values to the frozen manifest. Its `served.json` records PASS at Pages commit `558f2fee0be9ae876960e4913928535cd38242ad`.
3. The hosted browser attempt records PASS for existing synthetic member and staff sign-ins at 09:28:45.883–09:28:51.032 UTC and 09:28:58.508–09:29:00.902 UTC. The later approved read-only recovery attributed exactly two new Auth sessions, two session-linked MFA claims, and two refresh tokens to those users and intervals in Rally-Point-Database staging. It found no operational-baseline drift.

Inference: the browser key in frozen r8 functioned with staging for those historical sign-ins. This is stronger than URL co-location alone, but it is **not** a current key-validity check and does not clear the staff-visibility STOP. A replacement local candidate can be prepared only under separate approval; before any deployment, revalidate the target, current key acceptance, baseline, and new artifact. No staging or hosted call was made for this provenance review.
