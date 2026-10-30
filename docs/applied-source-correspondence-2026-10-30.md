# Applied guard source correspondence — 2026-10-30

This change saves the exact source of **three already-applied** database migrations.
It does not apply migrations, change the frontend, or establish complete repository/database parity.

## Applied batch

The version is the actual server history identifier, not the earlier local candidate timestamp.
Files under `supabase/migrations/` are byte-identical to the corresponding single stored SQL
statement, verified using read-only migration metadata on 2026-10-30 at 09:58 UTC.

| Version | Source file | State |
| --- | --- | --- |
| 20261030064218 | `20261030064218_guard_first_hiring_confirmation.sql` | Applied; source retained here |
| 20261030070800 | `20261030070800_guard_operator_chat_history.sql` | Applied; source retained here |
| 20261030082026 | `20261030082026_guard_publication_check_owner.sql` | Applied; source retained here |

The SHA-256 values and superseded candidate filenames are in
[`applied-guards-20261030.json`](../scripts/fixtures/applied-guards-20261030.json).
`applied-migration-history.test.mjs` checks exact bytes, unique names and absence of replay aliases.
This is a frozen source check, **not a live database query or proof of all migration history**.
Use the commit containing this document as the consolidated source reference; source saving,
main merge and database application are distinct states.

## Not part of this applied batch

- The separate no-show appeal proposal is not applied or included in this change. Do not infer
  deployment from the existence of a local candidate. Its application/publication needs its own decision.
- Earlier RPC privacy work remains tracked separately in PR #54. Its applied history entry is
  `20261028110711_rpc_privacy_fail_closed` (read-only history match confirmed on the same date).
  This change does not merge that PR or certify its source integration.
- PR #45 is not included. Do not merge or replay a broad held branch to reproduce these three guards.
- Historical unknown correspondences remain governed by
  [`historical-migration-reconciliation-2026-10-21.md`](historical-migration-reconciliation-2026-10-21.md).

## Safe handling

1. Do **not** run a directory-wide migration push, apply these files again, or repair server history
   merely because the files are newly added to main. They are already applied on the verified target.
2. Before a future database change, read that target's actual history and compare version/name/SQL
   identity. Stop on missing, duplicated or mismatched entries; source merge is not permission to write DB.
3. Preserve applied SQL bytes and identifiers. Any new correction requires a separately reviewed
   migration. A source revert must not automatically restore a less restrictive database definition.
4. These files assume the known preceding schema. They are not a fresh-install bootstrap script.
5. Repository PR checks run local synthetic tests and builds. No reviewed workflow or package script
   auto-applies SQL; hosting integration can still build a preview or main deployment on source changes.

## Validation scope

The three focused synthetic suites are registered in `test:critical` and run by `npm run build`.
They verify allowed/refused actions and replay behavior without production credentials, real records,
email or push delivery. PGlite uses one connection: these tests do not prove real concurrent sessions,
HTTP/JWT handling, or device behavior. Private live catalog snapshots and audit records are not included.
