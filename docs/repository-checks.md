# Repository checks

## Commands

After `npm ci`:

| Command | Contract |
| --- | --- |
| `npm run build` | Existing critical regression tests, lint, production bundle |
| `npm run typecheck` | **Incremental**, strict JS/JSX check, then the existing Edge Function TypeScript check |
| `npm run typecheck:coverage` | Exact checked and unchecked application paths from the compiler graph |
| `npm run typecheck:full` | Full `src/` and `api/` audit; currently fails, and retains a nonzero exit status |
| `npm run test:checks` | Positive/negative tests proving that the type and search checks detect regressions |
| `npm run check:search` | Compare the current search invariants with the reviewed snapshot |

The passing typecheck does **not** mean that the whole application is type-safe. The initial
full audit has 6,015 diagnostics (primarily implicit parameters, missing properties and
component props). Fixing that backlog is a separate migration, not a suppression list.
The full command includes JS, JSX, TS and TSX under `src/` and JS/TS under `api/`, including
the service worker; browser/worker/Node environment separation is also part of that backlog.

## Strict, incremental application coverage

`tsconfig.json` is the allowlist, not an error baseline. `allowJs`, `checkJs`, `strict` and
`noEmit` are enabled; library checks are not skipped. Its initial roots are:

- `src/features/jobs/model/jobStatus.js`: date/status rules shared across job displays.
- `src/features/jobs/search/model.js`: search date ranges and pay calculation.
- `src/lib/jobSearchVisibility.js`: current-time expiry and search inclusion.
- `src/lib/calendarDate.js`: calendar/draft date conversion.
- `src/components/SearchLaneTabs.jsx`: actual JSX props and rendering.

These are five of 258 current `src/` and `api/` source files. All other paths in those two
directories are outside the passing gate for now; `typecheck:coverage` prints their full,
up-to-date list, including any transitive imports. Build configs, `scripts/` fixtures and
`public/` worker artifacts are outside this application gate. They retain their existing
test/lint/build checks. Do not silently drop a root or disable strictness to get green.
To expand coverage, add the canonical owner to `files`, supply narrow JSDoc contracts,
fix its diagnostics, and add a negative proof for the boundary being protected.

The negative tests compile in-memory mutations and consumers: a bad numeric operation,
a wrong JS argument and a wrong JSX prop must fail. They do not edit real source files.
Date arithmetic still accepts both Date objects and numeric timestamps.

## Edge Function TypeScript

`npm run typecheck:edge` uses the real pinned Deno compiler with `--cached-only` and
`supabase/functions/deno.json`. It checks `supabase/functions/*/*.ts` (currently
`send-push/index.ts`), including its actual Deno globals and npm imports. Nothing is executed:
there are no environment secrets, database requests, notifications or deployment in this check.

Deno's `nodeModulesDir: "manual"` consumes the dependencies installed by `npm ci`.
`package-lock.json` is the dependency lock; a separate Deno lock is intentionally disabled.
The exact web-push runtime/type packages and Deno are development dependencies, not browser
runtime additions. The source's `@ts-types` points to the official web-push declarations,
not an ambient `any` shim. An invalid response status is also checked with Deno in the
negative suite. Add any future nested Edge Function entry points to the command when needed.

## Search snapshot review

The fingerprint is a static regression check, not a proof of database authorization or a
live-record count. Do not refresh it simply to make a failing check green. When a canonical
owner moves or an intentional behavior changes, inspect the extracted semantic delta,
update extraction if necessary, run mutation tests, then update the reviewed snapshot.
Historical database counts in the old snapshot were not current invariants and are not
used to validate the application.

## CI and delivery

`Repository checks` runs the incremental/Edge typecheck, negative proofs and search check
on relevant pull requests and main pushes. The full audit is intentionally a visible,
nonzero local diagnostic command until its backlog is addressed; it is not mislabeled as a
passing CI job. Existing critical/lint/build workflows remain in place.

This change needs no migration or data operation. Release only after the duplicate-entry
cleanup base is present. Rollback is a revert of this checks commit; no database or data
rollback is involved. Publication, main merge and deployment are separate steps.
