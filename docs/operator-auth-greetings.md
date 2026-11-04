# Operator chat greetings

Prepared against main `25fd34c028fafa2c67e9ed37f9d9697eac802fe0`. Publication and production rollout were explicitly authorized on 2026-11-04. [PR #73](https://github.com/Fukui-nano-o1/chitose-bank/pull/73) contains the reviewed source. The migration was applied at 09:41 UTC under its actual identifier `20261104094114`; the server remains disabled pending the verified frontend deployment. No test messages or backfill were sent.

## Behavior

- New registration means the first successful `account_holders` INSERT, not an OTP request or merely creating an Auth user. It queues one registration event. Existing accounts are not backfilled.
- A login intent comes only from successful `signInWithPassword` or `verifyOtp` results. Profile lookup/retry, password update, session restore, focus, and token refresh do not create login intents.
- Each real Auth session has a signed `session_id`. The server checks the expected user and session against authenticated claims and the live `auth.sessions` row, as well as deletion and moderation state.
- A private event has a unique `(user_id, session_id)` key. Registration and that same session's login therefore produce one registration greeting. Each subsequent distinct session can receive one login greeting. Registration also has user-level uniqueness.
- Restoring the app, finishing registration, going online, or focusing the app drains already-recorded events. A restore retries a login intent only when that exact session has a local pending marker from a prior explicit authentication success.
- Short background retries occur after 1, 5, and 30 seconds. Later focus, online, or reload can resume. Failures do not hold the login UI or undo a successful registration.
- The registration trigger only writes a private queue row. The delivery RPC preserves queued events if chat insertion fails. Chat insertion and the receipt are transactional; an unknown response is safe to retry. Per-account locking serializes devices; unique constraints provide the final duplicate guard.
- Each request drains up to 20 events and requests another retry if more remain. Pending events survive session revocation because they do not cascade from `auth.sessions`.

## Text and names

The user approved these named templates and specified no push notifications:

- Registration: “{{name}}さん、Chitose-bankへようこそ！ こちらは運営とのチャットです。使い方で分からないことや、お困りのことがあれば、こちらからお問い合わせください。”
- Login: “おかえりなさい、{{name}}さん！ お困りのことがあれば、いつでもこのチャットでお知らせください。”

The migration seeds the templates while **enabled remains false and enabled_at remains NULL**. Nameless variants omit only the unavailable name/salutation, retaining the rest of the approved copy. The post-application check confirmed both named templates match the approved copy, delivery remains disabled, and the event queue is empty.

The private configuration supports a named and a nameless template for each event type. A named template contains exactly one `{{name}}`; nameless templates contain none. Names match the operator chat's current priority: worker nickname, then employer nickname. Control characters are removed and names are bounded to 80 characters. Private account-holder legal names, email addresses, and Auth metadata are never fallback names.

New registrants commonly have no worker/employer nickname yet, so they receive the nameless variant derived by omitting the unavailable salutation. The name and rendered body are captured when the event is queued; a later profile edit does not rewrite a pending message. If a named registration greeting is mandatory, this timing needs a separate product decision before activation.

## Default-off gates

1. Browser: `VITE_OPERATOR_GREETINGS_ENABLED` must equal `true`. An omitted flag performs no greeting RPC or local marker write.
2. Server: `private.operator_greeting_config.enabled` defaults to false. Enabling requires an activation timestamp and all four nonblank, bounded templates. The migration stores the approved copy but leaves this gate off and the activation timestamp NULL.

Old sessions are excluded by `enabled_at`. Disabling preserves pending events, but setting a newer activation timestamp on a later rollout excludes earlier pending events. Do not change the timestamp casually.

## Silent greetings, unchanged manual notifications

Delivered greetings use the existing `admin_messages` operator thread and unread/realtime behavior, but **do not enqueue push notifications**. Before inserting the chat row, the delivery subtransaction assigns its UUID to the private event. The existing operator-push trigger checks this inaccessible event linkage and returns without posting to send-push. Both receipt and chat roll back together on failure. No client-controlled suppression flag or session setting is accepted.

Manual operator messages keep their existing push path, and user replies keep their existing notification handling. No email pathway is added. A local synthetic HTTP sink verifies zero push requests for automatic greetings and one for an ordinary manual operator message. The migration refuses to replace the existing push function if its reviewed production definition has drifted.

## Verification and rollout requirements

Local tests use synthetic identities and an isolated PGlite database. They cover default-off configuration, malformed identity, failed auth, explicit password/OTP success, password/profile retries, session restore, duplicate calls, registration overlap, unknown responses, account switches, revoked/old/banned/deleted sessions, private permissions, template names, queue rollback/retry, and the post-registration in-flight race.

PGlite uses one connection: repeated Promise.all calls alone do **not** establish multi-connection contention behavior. Real PostgreSQL 17.11 verification passed 18 scenarios using independent backend connections; see [the concurrency report](verification/operator-greetings-concurrency-20261104.md). Before any approved application, repeat the production schema/ACL/trigger checks for drift, validate the RPC in a disposable Supabase environment with independent sessions, rerun security advisors, and confirm end-to-end operator unread/realtime behavior and absence of automatic push. No live registration or auth was used in this work.

There is an unavoidable browser-observation window: if authentication succeeds but the browser dies before recording the local/server event, that login cannot be recovered by this client-driven design. A lost first Auth response followed by the existing password retry may similarly create an unobserved session. Strict server-level “every Auth login, including closed browsers” needs a separately verified Auth-event integration. Do not describe the current implementation as guaranteed delivery for every server-side authentication.

Apply only this reviewed new migration after authorization. Existing migrations are not replayed. Deploying a default-off build does not activate it. Obtain explicit authorization for publication, migration application, deployment, activation time, and the known reliability boundary before enabling either release phase; text approval is not deployment authorization. Rollback is to disable server configuration and the browser flag, without deleting existing chat history.

## Local verification (2026-11-04)

- `npm run build`: 1,227 critical tests passed, ESLint completed with 0 errors / 19 existing warnings, and the production/PWA build passed.
- Focused greeting tests: 19 passed. Real authentication UI tests: 38 passed.
- `npm run typecheck`: passed its configured scoped app check and the Deno Edge Function check. This is not a full-repository type-safety claim; the repository's `typecheck:full` is a separate existing audit.
- Real PostgreSQL concurrency: 18 scenarios passed against migration SHA256 `2102320a57a8f0b65c254336187c9dbf546d6eb4f9cdf840d974f84b48ce4d4b`, including lock races and silent automatic notifications. The local synthetic cluster was removed.
- `git diff --check`: passed. An independent final review found no must-fix deduplication, authorization, notification, or retry issue.
- One initial parallel full-suite run timed out in an unrelated existing recruiter-page UI test. Its isolated rerun and subsequent full builds passed without altering that test.


## Read-only production preflight (2026-11-04 09:19 UTC)

Metadata only was read from project `aegwepgtmwcnwzybpgsh`; no account rows, chat content, credentials, sessions, or production values were queried. The snapshot is `scripts/fixtures/operator-greeting-preflight-20261104.json`.

- PostgreSQL 17.6; required Auth/profile/chat/account columns and existing private schema are present.
- The new config, event table, and public RPC are absent, confirming this feature has not been applied.
- The operator chat's INSERT triggers are the expected operator-push and user-to-operator handlers. Its history guard is retained.
- The existing push function matches the reviewed source (MD5 `b13e9fafbea826c2e9a3cd2aa13e4169`). The migration checks this before replacing it; it does not alter its existing ACL or the chat table's permissions.
- The current production moderation function writes `account_moderation` then `auth.users.banned_until` in the same transaction; the independent-connection lock-race tests cover that sequence. The inbound-DM handler returns immediately for operator messages, so these greetings do not trigger that email/notification path.
- `auth.sessions.created_at` is nullable in production. Recording a new login now rejects an unknown/null start time as well as pre-activation sessions.
- Security advisors are not clean at baseline: two existing definer-view findings (`jobs_public`, `employer_profiles_public`), mutable search paths, publicly executable definer functions, and disabled leaked-password protection. These predate this unapplied feature and were not modified. The existing public trigger function's execute permissions are also flagged; this change does not expand them. Re-run advisors after any approved application and compare against this baseline. See [Supabase's definer-view guidance](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view).

## Authorized release sequence

1. Review the local commits, approved copy, nameless fallback, silent-push behavior, and browser-before-event limitation. Explicit production authorization was received; all 15 initial GitHub workflows passed before database application.
2. Repeat the read-only metadata snapshot immediately before application. Verify all account/chat triggers, required columns, ACLs, and absence of conflicting greeting objects, not only the push-function checksum. Stop on drift.
3. Apply **only** `20261104094114_operator_auth_greetings.sql` in one transaction after authorization. It adds private config/events, three private helpers, one public invoker RPC, one registration-queue trigger, and the narrow no-push condition to the existing operator-push function. It does not backfill, create an Auth trigger, alter existing chat permissions, or enable delivery. Check that enabled is false, enabled_at is NULL, and no event/message was inserted.
4. Deploy the frontend with the greeting flag omitted/off first. Then verify the intended commit and CI/deployment. If deploying with `VITE_OPERATOR_GREETINGS_ENABLED=true`, keep the server gate off until final activation; calls return disabled and do not create greetings.
5. After approval, activate by setting `enabled_at=clock_timestamp()` and `enabled=true` together on the private singleton, with the browser flag enabled. This is the cutover: old Auth sessions are excluded, while newly completed registrations can queue a welcome. Do not reset the timestamp during routine retries.
6. Verify an explicitly authorized test user's signup, a fresh login, repeated reloads, another genuine login, chat unread/read behavior, and that no automatic push request is queued. Do not use an unsuspecting real user or send test chat without authorization. Check required CI and security-advisor differences before calling the rollout complete.
7. Roll back by setting the server enabled flag false and disabling the browser flag. Do not delete chat history, erase delivery receipts, or replay historical migrations. Leave the silent-greeting filter in place; manual messages continue to push as before.

## Applied migration identity

Only `20261104094114_operator_auth_greetings.sql` was applied. Its SHA256 remains `2102320a57a8f0b65c254336187c9dbf546d6eb4f9cdf840d974f84b48ce4d4b`, exactly the reviewed and concurrency-tested bytes. The original candidate filename `20261104090030_operator_auth_greetings.sql` was removed to avoid replay. The immutable SQL header records its earlier prepared-only state; subsequent explicit release authorization superseded that historical comment. The identity regression test freezes the applied version and bytes.

Immediately before application, required column definitions, table RLS/ACLs, all account/chat triggers and their function hashes, the existing push function and ACL, and the private schema ACL matched the reviewed production snapshot. A difference in displayed `public.` schema qualification was normalized; no semantic drift was found. After application, the config and queue are private with RLS enabled and no anonymous/authenticated table access. The anonymous role cannot execute the public RPC. No events were created while disabled.
