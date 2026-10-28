# Narrow RPC read-authorization update

- `employer_trust_info(uuid)` now rejects a NULL authorization result while
  preserving its existing public/self/application-party behavior and output.
- `job_exists(integer)` now requires an authenticated existing job party
  (owner, any-status applicant, or administrator), and physical job existence.
  Anonymous/unrelated callers receive false even for open jobs. Public discovery
  remains the responsibility of the existing listing APIs.

No tables, views, policies, grants, or other function bodies change. Existing
record-retention behavior for former applicants is retained. No production data
or credentials are included in the synthetic regression fixture.

Migration: `20261028110711_rpc_privacy_fail_closed.sql`.
SHA-256: `4c92fa3769e74dbcd7d7c1f0ceb420537273f027afbad1289eda070d142e8a96`.
This migration has already been applied; this source change records the matching
migration identity. Do not replay it under a different version. Deployment and
merging are separate operations, not authorized by opening this draft PR.

Verification: `node --test scripts/rpc-privacy-db.test.mjs` and `npm run build`
(critical tests, ESLint, Vite/PWA). The SQL tests use PGlite and synthetic rows;
they are not a live-user or HTTP/PostgREST end-to-end test.
