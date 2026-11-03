# Chat read acknowledgements

## Scope

Opening a visible conversation acknowledges the received messages displayed at the
bottom and the application status observed in that render. Hidden conversations
and new messages received while reading older history stay unread until visible
at the bottom. Returning to the bottom, focus, polling and explicit retry use the
same acknowledgement path.

`src/features/chat/read/chatReadRecord.js` owns persistence; `ChatView` supplies a
server-fetched, rendered snapshot. Message receipt updates name exact IDs and the
application. Application read tracking uses only the fetched `status_changed_at`:
messages and applications are independently fetched, so a newer message timestamp
must not acknowledge an unseen status. Message read indicators use `messages.read_at`.

Existing rows are inserted with conflict-ignore, then advanced using a conditional
`last_read_at < observed` update. Older delayed requests cannot regress the cursor.
Read-back confirmation and current-session checks precede the unread refresh.
Failed acknowledgements retain history and expose retry. Cache counts come from
the server rather than assuming the whole conversation has no unread events.
Already-started acknowledgements finish their bounded rendered snapshot after
navigation for the same authenticated owner, then notify the inbox to refresh.
Account changes stop further writes and result delivery. Identical polls do not cancel an in-flight acknowledgement; superseded results
cannot overwrite the latest local error/count state.

## Permissions and release boundary

No migration, policy, grant, account gate, or message-body mutation is included.
Existing recipient/participant authorization, own-reader checks and immutable
message history remain necessary. The repository's pre-filing/admin-only guidance
is not removed or interpreted as legally resolved by this fix. Local correction of
existing read-status behavior does not authorize publication or relaxing access.

## Verification

- `node --test scripts/chat-ui.test.mjs scripts/chat-read-db.test.mjs`
- `npm run build`, `npm run typecheck`, `npm run test:checks`, `npm run check:search`

The component tests bundle actual components with synthetic transport data in
JSDOM. SQL tests run the repository unread RPC and message history protection in
PGlite with synthetic rows and modeled existing policies. They exercise ordered
request interleavings, not real multi-connection lock contention. No production
user records are necessary. These tests do not substitute for actual browser QA.

Publication, live-browser validation and live data mutation are separate steps.
If approved for release, this is a frontend-only change; no database apply step.
Rollback is reverting the frontend commit, without rewriting read history.
