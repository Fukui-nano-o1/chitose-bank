# Supabase サポート起票文（2026-08-22改訂・Disk IO／pgssに写らない一時ファイル書き込み ~10GB/日）

★この文面をたきとが Supabase ダッシュボード → Support からそのまま貼って提出する
（この環境からはチケットを直接出せない。提出＝PC作業）。
英語本文がそのまま提出用。日本語は社内控え。

★★2026-08-22改訂：初版（08-21）の「PostgREST再構築の内省クエリがtempの犯人」という帰属は
【誤りだった】（24h実測で反証・下記）。初版のまま提出しないこと。この版が正。

Category: Performance / Database
Severity: Medium（サービス断ではない・Disk IO 予算の恒常消費）
Project ref: aegwepgtmwcnwzybpgsh（ap-northeast-1・nano）

---

## Submit this (English)

**Subject: ~10 GB/day of temp-file disk writes from sessions invisible to
pg_stat_statements (platform telemetry?) — cannot enable log_temp_files to
identify (nano, Disk IO budget)**

Project ref: `aegwepgtmwcnwzybpgsh` (ap-northeast-1, nano compute)

**Summary**

We are consuming the Disk IO budget with temporary-file writes that we
cannot attribute from inside the database, because the writing sessions are
excluded from `pg_stat_statements` and `log_temp_files` is superuser-only.

**Measured facts**

- `pg_stat_database` (datname=postgres): lifetime `temp_files` 89,525 /
  `temp_bytes` 285 GB. In a precisely bracketed 24 h window
  (2026-08-21 06:28 UTC → 08-22 06:38 UTC) we measured
  **+2,650 temp files / +10.4 GB**, while WAL for the whole project
  lifetime is only 224 MB and all user tables show `heap_blks_read = 0`.
- `pg_stat_statements` accounts for only **1.95 GB** of temp lifetime —
  **99.3 % of temp writes are invisible to pgss**. Not eviction: the
  relevant entries have `stats_since` in April.
- **No relation in the cluster exceeds 2.4 MB** (total size, all schemas)
  — the regular workload cannot legitimately sort gigabytes.
- `supabase_admin` keeps 4 persistent connections, and
  `set pg_stat_statements.track = none` has been executed 1,800 times
  (once per platform connection setup since April) — i.e. platform
  sessions' statements are untracked by design.
- Global `work_mem` is the nano default **2184 kB**. We measured that a
  single full scan of `pg_stat_statements` (4,900 entries) spills
  **4.7–9.4 MB to temp per execution** — so any periodic platform job
  scanning `pg_stat_*` views would produce exactly this signature.
  10.4 GB/day ÷ ~4.7 MB ≈ ~2,200 executions/day.
- The writes are bursty (a sampled 42 s window showed zero files); we
  could not catch the writer live.
- `ALTER DATABASE postgres SET log_temp_files = '4MB'` →
  `42501 permission denied` — we cannot instrument this ourselves.

**Requests**

1. Please enable `log_temp_files` (e.g. 4 MB threshold) for this project,
   or tell us which platform job/telemetry writes ~10 GB/day of temp files
   here.
2. If it is platform telemetry scanning `pg_stat_statements` /
   `pg_stat_*`, please consider a platform-side `work_mem` raise for those
   sessions (the spill is only ~5–10 MB per execution — a small work_mem
   headroom would eliminate ~10 GB/day of disk writes on nano).
3. Unchanged earlier request: Realtime tenant re-initialization
   (~34×/day) creates/drops daily partitions of `realtime.messages`;
   `extensions.pgrst_ddl_watch` has no schema filter, so PostgREST reloads
   its schema cache ~75×/day although the exposed schema (public,
   56 relations) never changes — each reload rebuilds the connection pool
   and burns CPU (`pg_timezone_names` ~643 ms etc.), and colliding with
   our app's cold-start burst doubles request p50 (measured 12.8 s vs
   6.2 s). Could the watcher skip the `realtime` schema, or the tenant
   idle-timeout be raised? (Note: we no longer claim this is the disk
   writer — our earlier draft attributed the temp writes to the reload
   introspection; our own 24 h measurement falsified that.)

**Mitigation we tried**

`ALTER ROLE authenticator SET work_mem = '16MB'` (2026-08-21) — no effect
on temp writes (the app's own queries never spill; all user-table reads
are fully cached).

Happy to provide the exact measurement queries and timestamps.

---

## 社内控え（日本語・提出しない）

- 24h実測（06:28→06:38 UTC）＝ temp +2,650ファイル・+10.4GB。犯人と目していた
  PostgREST内省クエリは同じ24hで【+1回・+9MB】＝初版の帰属は誤り（訂正済み）。
- 見えない理由＝supabase_admin のプラットフォーム接続（常駐4本）が
  `set pg_stat_statements.track = none` で自分の観測クエリを pgss から外している。
  1,800回のSET＝接続確立ごと（135日で13回/日≒再接続頻度）。
- 算術＝pgss全走査1回で4.7〜9.4MB spill（自分の診断クエリで実測・work_mem 2184kB）。
  10.4GB/日 ÷ 4.7MB ≈ 2,200回/日。クラスタ最大テーブル2.4MBso他にGB級ソートの材料は無い。
- log_temp_files は 42501 で当てられない＝中からの確定は不可能。サポートに
  有効化してもらうのが最短（もしくは supabase CLI の postgres-config で
  当てられるか＝PC作業・要調査）。
- authenticator work_mem=16MB（migration 20260821062823）は無罪の役への薬だったが
  無害so残置（アプリ側の将来の保険）。32MBへの引き上げは【やらない】（意味がない）。
