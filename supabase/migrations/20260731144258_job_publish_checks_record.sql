-- 掲載前の確認（4項目のチェック）を記録として残す（2026-07-30たきと指示）。
-- これまでは画面のstateだけで、押した後はどこにも残らなかった＝「記録の無いアクションボタン」
-- （行動記録の憲法・2026-07-25）に反していた。掲載＝農家の意思決定なので、時刻つきで追記する。
--
-- 設計：
--  ・追記のみの台帳（1掲載＝1行）。同じ求人を出し直せば行が増える＝いつ何に同意したかが全部残る
--  ・items には「その時に画面へ表示していた文言」ごと保存する（後で文言を変えても過去の記録の意味が変わらない）
--  ・当事者は自分の行だけ読める／運営（app_admins）は全部読める／更新・削除は全経路で拒否
create table if not exists public.job_publish_checks (
  id          uuid primary key default gen_random_uuid(),
  job_number  integer not null,
  farmer_id   uuid not null default auth.uid(),
  items       jsonb not null,              -- [{ text: "…", checked: true }, …]
  agreed_at   timestamptz not null default now(),
  created_at  timestamptz not null default now()
);
create index if not exists job_publish_checks_job_idx on public.job_publish_checks (job_number, agreed_at desc);

alter table public.job_publish_checks enable row level security;

-- 本人のみ挿入（自分の求人に対してだけ）
drop policy if exists "jpc owner insert" on public.job_publish_checks;
create policy "jpc owner insert" on public.job_publish_checks
  for insert to authenticated
  with check (
    farmer_id = auth.uid()
    and exists (select 1 from public.jobs j where j.job_number = job_number and j.farmer_id = auth.uid())
  );
-- 本人は自分の記録を読める
drop policy if exists "jpc owner select" on public.job_publish_checks;
create policy "jpc owner select" on public.job_publish_checks
  for select to authenticated using (farmer_id = auth.uid());
-- 運営は全件読める（審査プレビューで確認する）
drop policy if exists "jpc admin select" on public.job_publish_checks;
create policy "jpc admin select" on public.job_publish_checks
  for select to authenticated using (exists (select 1 from public.app_admins a where a.auth_id = auth.uid()));

-- 機構による拒否（二重の壁）：一度記録した同意は誰も書き換えられない・消せない。
-- チャット履歴の凍結（trg_messages_history_lock_upd/del）と同じ作法で、service role も含む全経路を止める
create or replace function public.jpc_history_lock()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  raise exception 'job_publish_checks is append-only (掲載前の確認の記録は変更・削除できません)';
end; $function$;

drop trigger if exists trg_jpc_lock_upd on public.job_publish_checks;
create trigger trg_jpc_lock_upd before update on public.job_publish_checks
  for each row execute function public.jpc_history_lock();
drop trigger if exists trg_jpc_lock_del on public.job_publish_checks;
create trigger trg_jpc_lock_del before delete on public.job_publish_checks
  for each row execute function public.jpc_history_lock();

-- 追記のみを権限でも担保する（新規テーブルの既定付与で authenticated に UPDATE/DELETE まで
-- 付いていたため、SELECT と INSERT だけに絞る。migration 20260731144328 と同内容）
revoke all on public.job_publish_checks from authenticated, anon;
grant select, insert on public.job_publish_checks to authenticated;
