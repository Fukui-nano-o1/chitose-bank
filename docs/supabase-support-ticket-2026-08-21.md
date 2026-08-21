# Supabase サポート起票文（2026-08-21・Disk IO／PostgREST schema reload storm）

★この文面をたきとが Supabase ダッシュボード → Support からそのまま貼って提出する
（この環境からはチケットを直接出せない。提出＝PC作業）。
英語本文がそのまま提出用。日本語は社内控え。

Category: Performance / Database
Severity: Medium（サービス断ではない・Disk IO 予算の恒常消費）
Project ref: aegwepgtmwcnwzybpgsh（ap-northeast-1・nano）

---

## Submit this (English)

**Subject: Realtime partition DDL triggers ~75 unnecessary PostgREST schema
cache reloads per day, spilling ~1.9 GB/day to temp files (Disk IO budget)**

Project ref: `aegwepgtmwcnwzybpgsh` (ap-northeast-1, nano compute)

**Summary**

Realtime tenant re-initialization creates/drops daily partitions of
`realtime.messages`. The `extensions.pgrst_ddl_watch` event trigger has no
schema filter, so each partition DDL fires `NOTIFY pgrst` and PostgREST
rebuilds its schema cache — even though our only exposed schema is `public`
and the cache content never changes.

**Measured (from pg_stat_statements / pg_stat_database / project logs)**

- Realtime tenant init: ~34/day → `NOTIFY pgrst`: ~175/day → actual schema
  cache reloads: ~75/day. Cache is always 56 relations (public only, realtime
  partitions are not in the cache) — i.e. the reloads are no-ops.
- Each reload runs PostgREST's function-introspection query
  (`with f as ( -- CTE with sane arg_modes ...`), which spills a constant
  **9,104 kB to temp files per call** under the nano default
  `work_mem = 2184kB`. Plus `SELECT name FROM pg_timezone_names`
  (~643 ms avg) and a connection-pool teardown/rebuild (~73/day).
- Cumulative: `pg_stat_database` shows **temp_files 86,599 / temp_bytes
  254 GB** (≈1.9 GB/day) against only 224 MB of WAL — temp spill from these
  reloads is our dominant disk writer, and we believe it is what consumes
  the nano Disk IO budget (we have received Disk IO warnings). All user
  tables show `heap_blks_read = 0` (reads fully cached), so this is not
  application read traffic.
- Side effect measured earlier: when a reload collides with our app's
  cold-start request burst, request p50 roughly doubles
  (12.8 s vs 6.2 s for the same 21-request burst).

**Mitigation we applied (2026-08-21)**

`ALTER ROLE authenticator SET work_mem = '16MB'` — this should stop the
spill, but the ~75/day no-op reloads themselves (CPU + pool rebuild) remain.

**Questions / requests**

1. Can `pgrst_ddl_watch` be filtered so DDL on the `realtime` schema (daily
   partition maintenance) does not trigger PostgREST schema reloads? The
   trigger is platform-managed, so we have deliberately not modified it.
2. Alternatively, can the Realtime tenant idle-timeout be raised (or the
   tenant kept warm) so it does not re-initialize ~34×/day?
3. Is there a recommended supported configuration for this situation on
   small compute? We'd rather not fork platform-managed objects.

Happy to provide the full measurement queries/log excerpts.

---

## 社内控え（日本語・提出しない）

- 因果：Realtime テナント再初期化 → realtime.messages の日次パーティション
  DDL → pgrst_ddl_watch（スキーマ絞り込み無し）→ NOTIFY pgrst →
  PostgREST 再構築 75回/日（中身は常に56 Relations＝無意味な再読込）。
- 各再構築の内省クエリが work_mem 2184kB を超え **毎回 9,104KB を temp に
  spill**。累計 temp 254GB・86,599ファイル ≈ 1.9GB/日 ＝ Disk IO 警告の本丸
  （WAL は224MBしかない・ユーザー表の実ディスク読みはゼロ）。
- 緩和として authenticator の work_mem を 16MB に（2026-08-21 適用・
  migration authenticator_work_mem_16mb）。ただし再構築75回/日そのものは
  1回も減っていない＝根本はSupabase側。この起票がその根本への道。
- 測定の元データ：CLAUDE.md「2026-08-18 Speed-2A」ブロック＋
  「2026-08-21 Disk IO測定」ブロック。
