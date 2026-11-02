# Anonymous public job photos

Scope: allow anonymous visitors to download photos actually attached to publicly
listed jobs. Both media buckets remain private. No upload/write permissions, jobs
SELECT permissions, publication rules, or signed URLs are added.

The client continues using Storage `download`, `no-store`, temporary blob URLs,
and account-change invalidation. A missing session may request job photos; Storage
RLS decides access. Consignment still requires a session. No public-URL fallback.

The additive migration removes the helper's blanket anonymous rejection and lets
`anon` use the existing SELECT policy/helper. Its public-listing predicate,
owner/legacy-reference validation, moderation check, and download-only operation
filter are unchanged. Null uid cannot match owner, admin, or applicant exceptions.

## Verification

Synthetic PGlite tests cover public originals, thumbnails, danger photos, approved
legacy references and full closed listings; deny drafts, pending/unlisted listings,
moderated authors, non-public applicant-only listings, forged foreign references,
consignment, listing and signing. Existing owner/admin/member paths remain covered.
Client and real React/JSDOM tests cover anonymous display, refusal without fallback,
logout/private-image removal, account switches, stale requests and blob cleanup.
These are not production HTTP/JWT or physical-device tests.

## Release and rollback

The database migration was applied as `20261102123651` on 2026-11-02, with
its approved SQL bytes retained unchanged. Source publication and frontend
deployment are separate steps. Before any future application, recheck the
exact target history for drift. The SQL also atomically refuses changes unless
the helper definition/owner/ACL, every Storage SELECT/ALL policy, RLS flag and
both private-bucket flags match the reviewed catalog. Table locks protect policy
and bucket checks during application. Obtain approval for this specific SQL
and for source publication/merge/frontend deployment; never push all migrations.
Apply only this additive migration and deploy the client change (either order is
fail-closed until both are present). Verify public-photo requests and denied paths
without reading private user photos.

To stop anonymous access, restore the policy roles to `authenticated` and revoke
anon EXECUTE on `private.can_read_listing_photo(text,text,text)`. Do not revoke
shared schema usage blindly, make buckets public, or restore older broad policies.
Revert the client change separately if needed. Stored user rows and files are not
modified by this migration.

Already downloaded/mounted blob images are not retroactively erased when a job
is unpublished in the same session; new downloads are denied. This is unchanged.

## Read-only application readback

Compare the preflight catalog before applying. After applying, require the helper
`md5(pg_get_functiondef(...))` to be `0dfda5f18c140d9d3e83ea33b3900b5d`,
owner `postgres`, SECURITY DEFINER/STABLE/empty search_path unchanged, and EXECUTE
only for postgres/authenticated/anon (not PUBLIC). The existing photo policy must
have roles `{anon,authenticated}` with its expression unchanged. Normalize those
roles back to `{authenticated}` and the all-SELECT/ALL policy fingerprint must
still be `87f13a7ec4e7cacabbbf3d7a554fdf8a`. Both buckets must remain private and
Storage objects RLS enabled. Compare jobs_public definition/options/ACL and jobs
RLS/policies to the pre-application snapshot: this migration must not change them.
Confirm one new migration-history entry whose exact SQL matches the approved file.
Do not automatically retry if application outcome is uncertain.

Applied SQL SHA256: `8e6013074a480d05c59e05b0c9edf15befc205c1805c8b5f9cb637fe5b15ac3a`.
Do not replay this migration: its one-time preflight deliberately rejects the
already-applied state.
