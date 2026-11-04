# Operator greeting real PostgreSQL concurrency verification

Verified 2026-11-04 against an isolated, synthetic PostgreSQL 17.11 cluster. No production changes, real user data, actual messages, network HTTP calls, deployments, or migration-history changes occurred.

Migration SHA256: `2102320a57a8f0b65c254336187c9dbf546d6eb4f9cdf840d974f84b48ce4d4b`

## Run

Requires PostgreSQL server/client tools, `libpq`, Python 3, and permission to start a loopback-only listener. No Python third-party dependencies.

```sh
bash scripts/run-operator-greetings-concurrency.sh
```

For a locally extracted PostgreSQL distribution, set `PG_BIN` and `PG_SHARE`. The verification environment used PostgreSQL 17.11 official Debian packages extracted under `/tmp/greeting-postgres/root`, without a system installation:

```sh
PG_BIN=/tmp/greeting-postgres/root/usr/lib/postgresql/17/bin \
PG_SHARE=/tmp/greeting-postgres/root/usr/share/postgresql/17 \
bash scripts/run-operator-greetings-concurrency.sh
```

The runner creates its own temporary cluster, listens only on `127.0.0.1:55439` (override with `TEST_PG_PORT`), rejects non-loopback connections, and stops/removes the cluster on exit. It does not consume production connection variables. The Python test accepts only a port and local username, creates a uniquely named test database, and drops it on exit. Run against a disposable local cluster only, because it creates the `anon`/`authenticated` roles if absent.

The Python test shares the synthetic baseline schema declared before the seed data in `operator-greetings-db.test.mjs`, adds an in-database HTTP-call recorder, and loads the exact reviewed push function from the read-only preflight fixture. Applying the migration therefore executes its unchanged push-function drift guard. There is no actual `pg_net` extension or HTTP implementation.

## Results: 18 scenarios passed

- Eight simultaneous attempts with the same session used eight distinct PostgreSQL backend PIDs and produced exactly one chat.
- Eight distinct sessions logging in simultaneously produced exactly eight chats.
- Login before/during uncommitted registration returned registration-pending; after commit, concurrent retries produced one registration welcome.
- Registration committed first, followed by simultaneous login attempts: registration won and only one welcome was inserted.
- A committed response was deliberately discarded and the client disconnected; concurrent retries produced no duplicate. This models an unknown successful outcome, not a packet-level network fault injection.
- Outer transaction rollback removed both chat and receipt; concurrent retry sent once.
- Registration rollback left no account, greeting event, or chat.
- Disconnect with an open, uncommitted greeting transaction caused server rollback; concurrent retry sent once.
- Synthetic chat-insert failure rolled back its preassigned message receipt, retained a pending event, and concurrent retry drained exactly once.
- Logout, ban, soft-delete, and moderation transactions that owned the lock first caused the blocked greeting to return stale with no chat after those transactions committed (four scenarios).
- Greeting owning its lock first serialized against logout, ban, and moderation, committed one chat before revocation, and rejected later retry as stale (three scenarios).
- All automatic chats generated zero synthetic HTTP/push calls.
- A manual operator chat still generated one synthetic HTTP/push call.

The revocation tests do not rely on arbitrary sleeps to infer overlap: they inspect `pg_stat_activity` and require the other backend to be waiting on a PostgreSQL lock before committing the first transaction.

## Scope and limits

This is a real multi-connection PostgreSQL test, not `Promise.all` against one PGlite instance. The database schema remains synthetic and is not a full production snapshot. Production preflight reported PostgreSQL 17.6; this test ran 17.11. Browser auth events, Supabase Auth/PostgREST behavior, and actual push delivery are outside its scope.

The moderation fixture implements the repository's normal two-write transaction: update `account_moderation` and `auth.users.banned_until` together. The `auth.users` lock serializes that transaction. Arbitrary out-of-band writes only to `account_moderation` are not covered by this guarantee. Normal ban/soft-delete and session deletion races are tested directly.

Unix-domain socket creation failed with `Operation not permitted`, including under a reviewed escalation. No reviewer denial occurred. An explicitly reviewed loopback TCP launch succeeded. Server startup and the test must run in the same execution session in this environment, because background processes do not persist across commands reliably. The checked-in runner handles this lifecycle.

## Connection-isolation hardening recheck

The runner validates a simple local OS username and a port in 1..65535 before connecting, discards every ambient `PG*` variable, and explicitly sets `host=127.0.0.1`, `hostaddr=127.0.0.1`, `sslmode=disable`, and `passfile=/dev/null`. Thus libpq does not load a service selection, ambient password/options, or the user's normal password file.

The complete 18-scenario suite passed again with deliberately invalid synthetic `PGHOSTADDR`, `PGSERVICE`, `PGSERVICEFILE`, `PGOPTIONS`, `PGPASSFILE`, and `PGPASSWORD` values in the environment. A username containing `host=example.com` and an out-of-range port were rejected with argument-parser exit code 2 before connection. PostgreSQL emits harmless warnings that `/dev/null` is not a plain password file; the explicit path prevents fallback to a real password file.

The parent also confirmed through a read-only production inspection that the current moderation function performs both moderation-table and `auth.users.banned_until` writes in the same function transaction, matching the concurrency fixture.
