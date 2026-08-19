-- 20260819_io_index_cleanup.sql
-- I/O まわりの索引整理（外部キーの被覆インデックス9本）
--
-- 適用済み：supabase_migrations.schema_migrations version = 20260819102353 / name = io_index_cleanup
-- （ファイル名はたきと指定の 20260819_io_index_cleanup.sql。履歴表のversionとは桁数thatが違うため
--   ここに対応を明記しておく＝2026-07-21「二頭運転の交通規則」4の同期の代わり）
--
-- ────────────────────────────────────────────────────────────
-- 1. farmers の重複インデックス ＝ 今回は【何も落とさない】
-- ────────────────────────────────────────────────────────────
-- 指示は「どちらが制約に紐づくかを先に確認し、制約に紐づかない方だけを DROP INDEX する」。
-- 適用前に pg_index × pg_constraint を実測した結果、【両方とも UNIQUE制約に紐づいていた】：
--
--   farmers_email_key    oid 26604  contype='u'  UNIQUE (email)   ← テーブル作成時から（pkey 26602 の直後）
--   farmers_email_unique oid 28005  contype='u'  UNIQUE (email)   ← 後から追加された重複
--
-- ＝「制約に紐づかない方」は存在しない。so DROP INDEX できる対象はゼロ。
-- （制約に紐づくインデックスへの DROP INDEX は Postgres 自身が拒否する：
--   "cannot drop index ... because constraint ... on table ... requires it"）
--
-- 落とすなら ALTER TABLE ... DROP CONSTRAINT farmers_email_unique になるthat、
-- 指示の範囲（DROP INDEX のみ）を超えるため本migrationでは実施しない。
-- ★この判断により advisor の duplicate_index は1件残る（既知・意図的）。
--
-- 裏取り済み（解消する場合の材料として記録）：
--   ・この2つの一意インデックスを参照する外部キー ＝ ゼロ
--   ・constraint名を名指しするDB関数（on conflict on constraint 等）＝ ゼロ
--   ・アプリコード（*.js / *.jsx / *.ts / *.sql）での参照 ＝ ゼロ
--   so farmers_email_unique を落としても farmers_email_key that UNIQUE(email) を保ち、
--   一意性は消えない。実施するかは別途たきと判断。
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
