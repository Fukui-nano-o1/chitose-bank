-- 求人の閲覧数（2026-08-21たきと指示「❤️ボタンの左横に👀〇〇(数値)を設置。求人をタップした総数を表示」）。
--
-- 【貯めるのは数だけ】誰that見たかは一切保存しない（job_number と通し数のみ）。
--   ＝個人に紐づくデータを新しく作らない（データ憲法・データ最小化）。閲覧の履歴は従来どおり
--   page_events（運営のみ・30日で削除）の担当で、こちらとは別物。
--   先例：worker_profile_view_counts + count_worker_profile_view（同じ作法を写す）。
--
-- 【数え方】求人の詳細that開かれた時に1つ増やす（＝求人をタップした総数）。
--   ・自分の求人は数えない（自分でめくって増やせない）
--   ・運営（app_admins）は数えない＝見回りthat数字を動かさない（先例と同じ規則）
--   ・訪問者（未ログイン）は数える＝さがすは未ログインでも見られる面so、実際の閲覧を落とさない
--   ・掲載中／終了した求人（jobs_public に出るもの）だけ数える＝下書き・審査中は対象外
--   ・同じ端末で10分以内の開き直しは数えない（フロント lib/searchJobs.countJobView）
--
-- 【書き込みの窓口は1本】テーブルへの直接の書き込みはRLSで塞ぎ（SELECTポリシーだけ置く）、
--   増やすのは SECURITY DEFINER の count_job_view のみ。読みは誰でも（集計値so公開して差し支えない）。
--
-- 【外部キーは張らない】jobs の主キーは id(uuid) で job_number には一意制約that無いため参照できない。
--   求人that消えても数thatが残るthat、過去の求人は消せない（trg_block_delete_past_job）so実害なし。

create table if not exists public.job_view_counts (
  job_number  integer primary key,
  view_count  bigint      not null default 0,
  updated_at  timestamptz not null default now()
);

comment on table public.job_view_counts is
  '求人の閲覧数（集計のみ）。誰that見たかは保存しない。増やすのは count_job_view だけ';

alter table public.job_view_counts enable row level security;

-- 読みは全員（集計値）。書き込みポリシーは置かない＝直接のINSERT/UPDATE/DELETEは全経路で拒否
drop policy if exists "job_view_counts read" on public.job_view_counts;
create policy "job_view_counts read" on public.job_view_counts
  for select using (true);

revoke all on public.job_view_counts from anon, authenticated;
grant select on public.job_view_counts to anon, authenticated;

-- 増やす窓口（唯一）
create or replace function public.count_job_view(p_job_number integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_farmer uuid; v_status text;
begin
  if p_job_number is null then return; end if;
  select j.farmer_id, j.status into v_farmer, v_status
    from public.jobs j where j.job_number = p_job_number;
  if v_farmer is null then return; end if;
  -- 公開面に出る求人だけ（下書き・審査中は数えない）
  if v_status not in ('open','closed') then return; end if;
  -- 自分の求人は数えない／運営の見回りも数えない（先例 count_worker_profile_view と同じ規則）
  if auth.uid() is not null then
    if auth.uid() = v_farmer then return; end if;
    if exists (select 1 from public.app_admins a where a.auth_id = auth.uid()) then return; end if;
  end if;
  insert into public.job_view_counts (job_number, view_count, updated_at)
       values (p_job_number, 1, now())
  on conflict (job_number) do update
    set view_count = public.job_view_counts.view_count + 1, updated_at = now();
end $function$;

revoke all on function public.count_job_view(integer) from public;
grant execute on function public.count_job_view(integer) to anon, authenticated;
