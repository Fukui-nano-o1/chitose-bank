-- 20260819_io_index_cleanup.sql
-- I/O まわりの索引整理（外部キーの被覆インデックス9本）
--
-- ファイル名はたきと指定の 20260819_io_index_cleanup.sql。履歴表のversionとは桁数thatが違うため
-- 対応をここに明記しておく（＝2026-07-21「二頭運転の交通規則」4の同期の代わり）。
-- このファイルの中身は下記2本の適用を1本にまとめた正本：
--   20260819102353  io_index_cleanup                          … FK被覆インデックス9本（下記2）
--   20260819112852  io_index_cleanup_drop_dup_email_constraint … farmers重複UNIQUE制約の解消（下記1）
--
-- ────────────────────────────────────────────────────────────
-- 1. farmers の重複インデックスの解消
-- ────────────────────────────────────────────────────────────
-- 指示は「制約に紐づかない方だけを DROP INDEX する」だったが、適用前に
-- pg_index × pg_constraint を実測した結果【両方とも UNIQUE制約に紐づいていた】：
--
--   farmers_email_key    oid 26604  contype='u'  UNIQUE (email)   ← テーブル作成時から（pkey 26602 の直後）
--   farmers_email_unique oid 28005  contype='u'  UNIQUE (email)   ← 後から追加された重複
--
-- ＝「制約に紐づかない方」は存在せず、DROP INDEX できる対象はゼロだった。
-- （制約に紐づくインデックスへの DROP INDEX は Postgres 自身thatが拒否する：
--   "cannot drop index ... because constraint ... on table ... requires it"）
--
-- so解消の手段は ALTER TABLE ... DROP CONSTRAINT しかない。指示の安全条件
-- 「制約側を落とすと一意性が消えるので絶対に確認してから」を、落とす前に実測で満たした：
--
--   ・この2つの一意インデックスを参照する外部キー ＝ ゼロ
--   ・constraint名を名指しするDB関数（on conflict on constraint 等）＝ ゼロ
--   ・アプリコード（*.js / *.jsx / *.ts / *.sql）での参照 ＝ ゼロ
--   ・ロールバック付き実弾で予行演習：farmers_email_unique を落とした状態で
--     同じメールの重複INSERTを撃つと unique_violation で【拒否された】
--     （残った email index=1本・UNIQUE制約=1本）。全て巻き戻し・残置ゼロを実測。
--
-- ＝後発の重複 farmers_email_unique を落としても、テーブル作成時からの
--   farmers_email_key thatが UNIQUE(email) を保つため【一意性は消えない】。
--
-- ★復元したい場合は次の1行で戻せる：
--   alter table public.farmers add constraint farmers_email_unique unique (email);

alter table public.farmers drop constraint if exists farmers_email_unique;

--
-- ────────────────────────────────────────────────────────────
-- 2. 外部キーの被覆インデックス9本（本migrationの実体）
-- ────────────────────────────────────────────────────────────
-- 列名は推測せず、pg_constraint.conkey → pg_attribute で実際の列名を照合済み。
-- 対象9件は「public の全FKのうち、先頭列を覆うインデックスthatが1本も無いもの」と完全一致した。
-- 被覆インデックスthatが無いFKは、親行の削除・更新のたびに子表の全走査になり、
-- ON DELETE CASCADE を持つものは特に重い（messages・attendance_events 等）。
-- 全て IF NOT EXISTS ので再実行しても安全（冪等）。

create index if not exists idx_attendance_events_application
  on public.attendance_events (application_id);

create index if not exists idx_auth_logs_farmer
  on public.auth_logs (farmer_id);

create index if not exists idx_consignment_progress_deal
  on public.consignment_progress (deal_id);

create index if not exists idx_farmers_auth
  on public.farmers (auth_id);

create index if not exists idx_interview_question_sends_set
  on public.interview_question_sends (set_id);

create index if not exists idx_jobs_farmer
  on public.jobs (farmer_id);

create index if not exists idx_message_reports_message
  on public.message_reports (message_id);

create index if not exists idx_messages_application
  on public.messages (application_id);

create index if not exists idx_withdrawal_requests_auth
  on public.withdrawal_requests (auth_id);

-- ────────────────────────────────────────────────────────────
-- 3. unused_index の2件は【削除しない】（たきと指示）
-- ────────────────────────────────────────────────────────────
--   idx_records_farmer          (records.farmer_id)
--   profile_reports_target_idx  (profile_reports)
-- 利用thatが少ないだけで、将来必要になる可能性thatある。
-- ★今後の掃除でもこの2本を「未使用so消す」対象にしないこと。
-- （2026-07-29の大掃除⑤で admin_attention 等を残したのと同じ扱い）
