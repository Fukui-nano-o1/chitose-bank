-- 求人の閲覧数（👀）のかさ増しを機構で止める（2026-09-08たきと指示
-- 「掲載した本人が見ても合算しないように。絶対に悪意ある対象はカサ増しするだろう」）。
--
-- 【従来の穴（20260821100036 の count_job_view）】
--   ① ログインしている持ち主・運営は数えないが、【未ログイン（anon）は数えていた】＝本人がログアウトすれば
--      自分の求人の数字を増やせる。RPC は anon から直に叩けるので、スクリプトで無限に増やせる。
--   ② 同じ人の連続閲覧を止めるのは端末側の10分ルール（sessionStorage）だけ＝API直叩きには効かない。
--
-- 【新しい規則】
--   ・数えるのはログイン利用者だけ（anon は数えない・EXECUTE も外す）。持ち主・運営は従来どおり数えない。
--   ・同じアカウントが同じ求人を見ても【30日に1回】しか数えない＝DB側で担保（job_view_marks）。
--     端末の10分ルールは書き込みを減らす前段として残す。
--   ・数えない条件は全部 DB が判定＝UI を迂回しても増やせない（二重の壁）。
--
-- 【job_view_marks＝「この人がこの求人を最近数えたか」の印だけ】
--   ・誰が見たかは持たない：viewer_key＝sha256(auth.uid ‖ 求人番号 ‖ サーバー側の秘密の塩)。
--     uuid も求人との対応も、この表からは戻せない（塩は app_settings＝RLS有効・ポリシー0＝アプリからは読めない）。
--   ・RLS 有効・ポリシー0・権限も剥がす＝クライアントからは読めも書けもしない。書く窓口は count_job_view だけ。
--   ・30日を過ぎた印は毎日の cron（purge-job-view-marks・03:45 UTC）で消す＝印は最長30日しか残らない
--     （プラポリ第3条の閲覧履歴の行「取得から30日で削除」と同じ物差し。ここは履歴ですらなく印だけ）。
--
-- 【既に数えた分】導入前に anon で数えた閲覧（数十件）は、誰の閲覧かを持っていないので分離できない。そのまま残す。

-- 1) 印の表（読めも書けもしない・SECURITY DEFINER の窓口だけが触る）
create table if not exists public.job_view_marks (
  job_number  integer not null,
  viewer_key  text    not null,
  seen_on     date    not null,
  primary key (job_number, viewer_key)
);

comment on table public.job_view_marks is
  '求人の閲覧数の重複防止の印（求人番号×ハッシュ化した閲覧者×最後に数えた日）。誰が見たかは戻せない。触るのは count_job_view と purge_old_job_view_marks だけ';

alter table public.job_view_marks enable row level security;
revoke all on public.job_view_marks from public, anon, authenticated;

-- 2) 秘密の塩（初回だけ生成・既にあれば触らない）
insert into public.app_settings (key, value)
select 'job_view_mark_salt', encode(extensions.gen_random_bytes(32), 'hex')
 where not exists (select 1 from public.app_settings where key = 'job_view_mark_salt');

-- 3) 数える窓口（唯一）を作り直す
create or replace function public.count_job_view(p_job_number integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_farmer uuid;
  v_status text;
  v_salt   text;
  v_key    text;
  v_today  date;
begin
  if p_job_number is null then return; end if;
  -- 未ログインは数えない（ログアウトして自分の求人を増やす道を塞ぐ）
  if auth.uid() is null then return; end if;

  select j.farmer_id, j.status into v_farmer, v_status
    from public.jobs j where j.job_number = p_job_number;
  if v_farmer is null then return; end if;
  -- 公開面に出る求人だけ（下書き・審査中は数えない）
  if v_status not in ('open','closed') then return; end if;
  -- 自分の求人は数えない／運営の見回りも数えない（先例 count_worker_profile_view と同じ規則）
  if auth.uid() = v_farmer then return; end if;
  if exists (select 1 from public.app_admins a where a.auth_id = auth.uid()) then return; end if;

  -- 同じアカウント×同じ求人は30日に1回だけ（印が無い時は失敗側に倒す＝数えない）
  select s.value into v_salt from public.app_settings s where s.key = 'job_view_mark_salt';
  if v_salt is null or v_salt = '' then return; end if;
  v_key   := encode(extensions.digest(auth.uid()::text || ':' || p_job_number::text || ':' || v_salt, 'sha256'), 'hex');
  v_today := (now() at time zone 'Asia/Tokyo')::date;

  insert into public.job_view_marks (job_number, viewer_key, seen_on)
       values (p_job_number, v_key, v_today)
  on conflict (job_number, viewer_key) do update
    set seen_on = excluded.seen_on
    where public.job_view_marks.seen_on <= excluded.seen_on - 30;
  -- 印が新しく置かれた／30日を過ぎて置き直された時だけ FOUND＝それ以外は数えない
  if not found then return; end if;

  insert into public.job_view_counts (job_number, view_count, updated_at)
       values (p_job_number, 1, now())
  on conflict (job_number) do update
    set view_count = public.job_view_counts.view_count + 1, updated_at = now();
end $function$;

revoke all on function public.count_job_view(integer) from public, anon;
grant execute on function public.count_job_view(integer) to authenticated;

-- 4) 30日を過ぎた印の掃除（毎日・失敗は cron_watchdog が見張る）
create or replace function public.purge_old_job_view_marks()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  delete from public.job_view_marks
   where seen_on < (now() at time zone 'Asia/Tokyo')::date - 30;
end;
$$;

revoke all on function public.purge_old_job_view_marks() from public, anon, authenticated;

select cron.schedule('purge-job-view-marks', '45 3 * * *', 'select public.purge_old_job_view_marks();');
