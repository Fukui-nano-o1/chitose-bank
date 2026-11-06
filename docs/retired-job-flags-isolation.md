# Beginner welcome / repeat approval isolation

## Scope

Requested behavior: the two features are absent from the user experience, while source and stored records remain recoverable. This change is based on main after PR #78. It does not include PR #76.

- Active job creation/edit/review, cards and detail highlights no longer render either feature. Experienced-worker preference remains independent and available.
- Original React implementations and text are retained in `src/features/jobs/retiredFlags/`, without imports from the active application.
- The retired named page `repeat_approval` resolves to `worker_preferences`, including saved draft navigation. Legacy numeric step contracts remain unchanged.
- Form serialization retains historical values. Hiding controls must not silently clear existing row data.
- The farmer's roster retains favorite registration/removal and new-job notifications. All current promises of automatic approval are removed from that UI and help.
- Historical automatic chat replies receive a neutral approval presentation only when exact text, application, farmer sender and transaction timestamp match. Original message text, IDs, reporting payloads and unread processing are unchanged. Unknown or human-written text is not globally rewritten.

## Server boundary

The accompanying migration disables repeat autoapproval independently of the frontend. Review its archived definitions, grants, write normalization and outbound-template handling before deployment. Read-only inspection and tests must not be described as production application of the migration.

Old flags in existing jobs and previously approved applications are retained. Normal manual approval remains a distinct action. Do not reset historical application statuses or remove the roster.

## Release constraints

This branch is local only until publication and production changes are authorized. Deploy server isolation before the frontend, so a frontend release failure cannot leave invisible automation active. An old cached client must not be able to reactivate automation through true flag payloads.

Already delivered email and OS push messages cannot be recalled by this change. Existing `messages` rows do not identify system-generated authorship, so the historical presentation adapter intentionally uses a conservative match rather than rewriting all references.

The local Chromium script uses synthetic data and intercepts all network requests, but the current execution environment blocks Chromium's `socket()` startup even with an approved sandbox escalation. Browser execution is not a passed check; run `CHROMIUM_PATH=/usr/bin/chromium node scripts/retired-flags-browser.mjs` in an allowed runtime before release. Actual-component DOM tests cover cards, detail, navigation and chat, but do not replace visual browser QA.

## Verification and rollback

Run the new retirement tests with the existing critical suite, lint, build and typechecks. Confirm old true rows survive unrelated edits, copied/new rows cannot reactivate automation, ordinary approvals still work, and archive definitions are inaccessible to public roles. Validate mobile and desktop forward/back/reload/old-link flows and absence of empty badge gaps.

A rollback is an explicit operation, not a feature switch available to clients. Restore archived definitions and original grants/trigger state only after reviewing later migrations and obtaining release authorization. Restoring automation would change behavior and must not occur as an incidental frontend rollback. The source archive and original data are retained to support that review.

## Separate pre-existing permission observation

Read-only production catalog inspection found effective TRUNCATE table privilege for both `anon` and `authenticated` on `jobs`, `applications`, and `repeat_roster` (six role/table pairs). RLS is enabled, but RLS does not govern TRUNCATE. No inspected `public`/`private` function body contains a TRUNCATE command, and standard PostgREST CRUD does not expose a TRUNCATE operation. Therefore this is excess privilege requiring a separate security review, not proof of a currently executable anonymous Data API exploit. No destructive query was run, and this isolation change does not silently revoke those unrelated grants.

## Local verification outcome

- Full critical suite with `node --test --test-concurrency=4` and the exact `test:critical` file list: **1,280 passed, zero failed/skipped**.
- Database isolation/rollback focused suite: **21 passed**. Independent combined review: **25 passed** before the additional rollback drift tests.
- `npm run lint`: zero errors, 19 warnings. `vite build`: passed. `npm run typecheck`: app and edge checks passed (the repository's configured coverage, not full-app coverage).
- Two default-parallel aggregate attempts hit unrelated asynchronous test races: review effect initialization, and workplace object-URL cleanup. Each passed in focused reruns. A separate draft-test failure was traced to an immediate asserting helper inside a retry wait; the test-only fix polls readiness without increasing timeouts or changing synchronization code. The final bounded-parallel whole suite passed.
- Chromium visual execution remains blocked by this runtime's socket restriction. No production UI, application, notifications, or database mutations were exercised.
