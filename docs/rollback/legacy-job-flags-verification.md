# Database isolation: verification and release notes

## Local deliverables

- Migration: `supabase/migrations/20261105215520_isolate_legacy_job_flags.sql` (created with the Supabase CLI).
- Synthetic PostgreSQL tests: `scripts/legacy-job-flags-db.test.mjs`.
- Explicit rollback: `docs/rollback/restore-legacy-job-flags.sql`.
- Catalog-read function/view fixtures: `scripts/fixtures/legacy-job-flags-*-production.sql` and `legacy-job-flags-production.sql`. These contain definitions, not production records.

No production data, schema, notification or permission changes were made during implementation.

## Boundary

The migration takes write-conflicting locks on jobs and applications and commits atomically. It archives six old function definitions as inert text in an inaccessible schema; no archived function is executable. Public, anon, authenticated and service_role lose all access to the archive schema/tables. Tables additionally have RLS enabled without public policies.

`instant_approve` is disabled and its old function becomes an invoker no-op. New/copied jobs normalize both retired booleans to false, including privileged writer paths; existing jobs keep their stored values through all updates. No existing job, application status, roster membership, historical message or notification is rewritten. The archive and disabled code remain after rollback as well.

The public jobs view, employer-public-jobs through that view, farmer card RPC and party-detail RPC return false booleans without changing column types/shapes. Owner jobs reads remain raw for edit/sync version comparison. Anonymous geography, meeting-address restrictions, consent-gated video and view security options remain intact. Old cached pages and owner-edit clients may still render their own old controls or retained local values; they cannot restore server autoapproval. Updating the frontend is required for the complete new presentation.

Application eligibility, ordinary application mail, roster opt-out/new-job notification and manual employer approval remain separate. Repeat-specific application chat, worker confirmation wording and new-job email promotion are isolated. Delivered messages cannot be recalled. Pending pg_net payloads with legacy autoapproval wording make the migration fail closed without deleting them.

## Tests

The PGlite test reconstructs catalog-read application, notification, roster, copy and display functions with synthetic tables and inert mail storage. It covers:

1. Fail-closed function, RPC ACL, application write-policy, view-security and pending-mail preflight drift.
2. Exact retained row snapshots before/after migration.
3. Archive no-access and no callable historical functions.
4. Public/owner/party display, unrelated-party denial and retained privacy behavior.
5. Existing true job plus roster member remains applied; duplicate retry is no-write.
6. Anon/worker/other owner/application-admin direct writes and worker self-approval do not bypass RLS or RPC identity checks; the real owner can still manually approve.
7. Frozen existing values, normalized new rows, service-role copy return and source preservation.
8. Privileged insert with accidentally re-enabled old trigger remains applied because its function is also inert.
9. Ordinary roster notices survive without automatic-approval promises.
10. Rollback refuses later function/ACL/view-option/isolation-helper/trigger-state drift, then restores definitions/effective grants/view and trigger state without rewriting current records.

PGlite is single-session. A separate real PostgreSQL 17 service test now exercises multiple simultaneous psql clients against a dedicated synthetic database. CI run 42165257983, job 127720122254 passed on PR head ef17ef79ef43d704969c7a43dde8ea3135269ad9: an old transaction drains before the migration lock proceeds, a queued old-client application remains applied afterward, concurrent duplicates create one application/message/mail, concurrent owner edits retain old flags, copied rows are inactive, and manual approval still works. Evidence: https://github.com/Fukui-nano-o1/chitose-bank/actions/runs/42165257983/job/127720122254 . This is a focused database proof, not proof that every historical application trigger has been replayed.

## Production read-only observations

At inspection, only the existing trigger function performed repeat-flag-driven approval. No cron command directly named instant approval, repeat roster or approve_application. Pending pg_net payload count matching the three legacy promotion/approval phrases was zero. This is a point-in-time check; the migration checks the queue again at release.

Application RLS was enabled with two SELECT policies and no write policy. Manual approval remains through the existing identity-checked RPC. The legacy trigger functions had broad EXECUTE grants; the migration revokes those grants from public/anon/authenticated/service_role while retaining trigger execution semantics. No unrelated application/table policy is widened.

Separate existing issue: effective TRUNCATE privilege exists for anon/authenticated on jobs, applications and repeat_roster. RLS does not govern TRUNCATE. No inspected public/private function contained a TRUNCATE command, and normal PostgREST CRUD does not offer TRUNCATE. This is excess privilege, not a demonstrated anonymous API exploit. No destructive test or unrelated revoke is included.

## Release and rollback

Obtain explicit release authorization. Reinspect catalog preflight, run the focused and aggregate tests and complete browser QA. Apply only the new migration, not historical migrations, before the frontend release. Migration failure means rollback the transaction and investigate; do not weaken preflight or remove old data to make it pass.

A frontend rollback must not silently reactivate automation. `restore-legacy-job-flags.sql` is a separately authorized behavior change: it restores the old future-application automation and original effective grants, disables the new normalization trigger, and restores the old presentation view. It checks installed function hashes/ACLs, view hash/options, the isolation helper hash and both trigger definitions/enabled states first, refusing later drift. It does not backfill approvals, change previous decisions or restore true flags to newly created rows. Historical source/archives and existing true values stay preserved throughout.
