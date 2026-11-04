# Hide an empty job-detail workplace introduction

## Scope

After the public profile and workplace-photo reads settle, omit the entire job-detail introduction section when neither a supported public introduction field nor a valid published workplace photo is present. This removes its heading, divider, spacing and detail button. Blank text, unsupported answer values, private or pending fields, and invalid photo paths do not count as content.

Text alone or published photos alone still show the section. Loading and errors retain their existing status and navigation rather than being mistaken for empty data. An unconfigured photo capability with no public text also leaves no empty section. The existing employer links and the dedicated workplace page remain unchanged.

The desktop section navigation re-reads the rendered sections when either workplace read changes status, so an asynchronously removed section leaves no dead navigation link. No database, API, permission, publication or data changes are needed.

## Verification

- Initial local `npm run build`: passed (1,235 critical tests, lint with 19 existing warnings and no errors, production bundle). Release verification after restoring the same reviewed file hashes encountered unrelated UI timeout failures in two default-concurrency runs and a chat acknowledgement timing assertion with bounded concurrency. Exact-commit CI builds and focused reruns are required before release; current results belong in the pull request.
- Focused component and real-search integration tests: passed (8 tests). They cover empty/blank/invalid content, text-only/photo-only content, loading/error states, isolation, section order, desktop navigation updates, job switching and returning from the dedicated page.
- `npm run typecheck`: passed within the documented incremental application and Edge Function coverage.
- `npm run test:checks`: passed (57 tests).
- `npm run check:search`: passed with no snapshot change.
- The CI-only Chromium harness now expects the empty section to be absent at 320, 390 and 1280px, verifies the existing host link and return, and adds text-only/photo-only cases. The first CI run passed all 12 cases, but the empty mobile screenshots captured the hero before route scrolling had settled. The harness now settles fonts and route scrolling before capturing that boundary; the updated screenshots must be reviewed before release. The scenarios have not been executed locally.
- Independent read-only review: no blocking findings; all 8 targeted tests passed independently.

## Release and rollback

Publication and production release are authorized for this change. Publish the reviewed branch, verify the exact pull-request commit and Chromium evidence, then merge and verify the production deployment and served assets. Revert this UI change to roll back; no database or data rollback is required.
