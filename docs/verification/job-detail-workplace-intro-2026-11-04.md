# Job detail workplace preview

## Scope

The job detail now places 職場紹介 between the employer row and the beginner / experience / repeat highlights. It uses the existing section divider, a responsive photo mosaic (up to three published photos), the first available public workplace introduction, and a native button to the existing workplace page.

Only the existing `job_workplace` response and `job_employer_profile` public fields supply content. Job photos, avatars, pending profile edits, addresses and contact fields are not substituted. No database migration, write, publication change, or permission change is needed.

The profile text projection is shared with the full workplace page. Loading, failed, unconfigured and empty states stay distinct. Requests and rendered results are scoped to the job and viewer, with cancelled responses ignored. The existing route owner handles repeated taps, back/forward and source scroll restoration.

## Verification

- `npm run build`: passed (1,234 critical tests, lint with 19 existing warnings, production bundle).
- `npm run typecheck`: passed, within the repository's documented incremental scope plus Edge Functions.
- `npm run test:checks`: passed (57 tests).
- `npm run check:search`: passed. The reviewed snapshot adds only UI comparisons for error, loading and ready; no search filter or authorization contract changed.
- Focused tests cover section order, one/two/three-photo layouts, published-path validation, no arbitrary URL fallback, private/pending-field omission, loading/error/empty states, slow and denied photos, repeat activation, direct routes, back/forward, scroll restoration, job switching and account switching.
- Independent code review: no actionable findings.
- Real-browser mobile visual review was not completed: the available browser could not connect to the isolated synthetic localhost preview. Responsive CSS was inspected and DOM behavior tested; no claim of pixel-level or live-production verification is made.

## Release and rollback

This record describes a local change, not permission to publish, merge or deploy. Once authorized, publish and verify the exact final commit through normal repository checks. Rollback is a revert of this UI commit. No database/data rollback is required.
