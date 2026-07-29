-- 使われていないDBオブジェクトの削除（2026-07-29たきと指示「⑤DB 12件」）
--
-- ★DROPは戻せない。復元できるようにするため、削除前の定義をこのファイルの末尾に
--   全文コメントで残す（コピーして貼れば復元できる形）。データは3テーブルとも0行だった。
--
-- 削除の根拠（削除直前に再確認したもの・すべて0）：
--   ① コード（src / api / supabase/functions）からの参照
--   ② 他のDB関数の本体からの参照（pg_get_functiondef を全走査）
--   ③ cron.job のコマンドからの参照
--   ④ ビューの依存（pg_depend → pg_rewrite）
--   ⑤ トリガー／イベントトリガーへの紐付け（rls_auto_enable のような取りこぼしを防ぐため確認）
--
-- 【公開ボードの残骸】2026-07-24の分割3-Aで公開ボード・データ入力・五年計画のUIを
--   削除した際、DB側を「別途判断」として残していたぶん。
--     board_crop_names / board_crop_summary / board_dest_summary / board_region_list
--     public_summary（5農家以上のみ返す集計ビュー）
--   ※ records / dests / market_stats テーブルは削除しない。管理タブのlegacyViewと
--     OnboardingModalがまだ読んでいる（生きている）。
--
-- 【接続先を失っていた関数】
--     public_farmers_count … 2026-07-29の掃除①でフロントの唯一の呼び出し元を削除した
--       （起動のたびに叩いて、誰も読まないstateに入れていた）
--     job_meeting_address … 集合場所の住所をログイン時のみ返すRPC。UIから外れていた
--     farmer_hiring_stats … 農家の採用実績（未経験/経験ありの内訳）。UIから外れていた
--     admin_analytics_series … 30日ぶんの指標（新規/求人閲覧/応募/完了/稼働時間）。
--       app_admins限定。管理画面が未実装で、どこからも呼ばれていない
--     feedback_daily_summary … 直近24時間のフィードバック集計テキスト。
--       日次ダイジェストに載せる想定だったが、send_daily_auth_digest 等からの参照は無い
--   ※上の2つ（admin_analytics_series / feedback_daily_summary）は
--     「たきとがSQLエディタから手で叩いている」可能性をコード検査では否定できない。
--     必要になったら末尾のコメントから復元すること。
--
-- 【空テーブル】いずれも0行・参照ゼロ
--     calendar_notes（カレンダーのメモ。機能が未実装のまま）
--     error_logs（旧エラーログ。現役は app_errors ＝172行あり、こちらは削除しない）
--     mail_failures（メール送信失敗の記録。書き込む処理が無い）

drop function if exists public.board_crop_names();
drop function if exists public.board_crop_summary();
drop function if exists public.board_dest_summary();
drop function if exists public.board_region_list();
drop view if exists public.public_summary;

drop function if exists public.public_farmers_count();
drop function if exists public.job_meeting_address(integer);
drop function if exists public.farmer_hiring_stats(uuid);
drop function if exists public.admin_analytics_series(integer);
drop function if exists public.feedback_daily_summary();

drop table if exists public.calendar_notes;
drop table if exists public.error_logs;
drop table if exists public.mail_failures;

-- ════════════════════════════════════════════════════════════════════════
-- 復元用：削除前の定義（2026-07-29時点の現物）
-- ════════════════════════════════════════════════════════════════════════
/*
CREATE OR REPLACE FUNCTION public.board_crop_names()
 RETURNS TABLE(crop text) LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select crop from records
  where crop is not null and crop <> ''
  group by crop having count(distinct farmer_id) >= 5
$function$;

CREATE OR REPLACE FUNCTION public.board_crop_summary()
 RETURNS TABLE(crop text, farmer_count bigint, med_rev numeric, med_cost numeric, med_profit numeric, med_rate numeric)
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  with per_farmer as (
    select r.crop, r.farmer_id,
      sum(r.boxes * r.ppb) as rev,
      sum(coalesce((select sum((c->>'a')::numeric) from jsonb_array_elements(r.costs) as c), 0)) as cost
    from records r
    where r.crop is not null and r.crop <> ''
    group by r.crop, r.farmer_id
  )
  select crop, count(*) as farmer_count,
    percentile_cont(0.5) within group (order by rev) as med_rev,
    percentile_cont(0.5) within group (order by cost) as med_cost,
    percentile_cont(0.5) within group (order by rev - cost) as med_profit,
    percentile_cont(0.5) within group (order by case when rev>0 then round(cost/rev*100) else 0 end) as med_rate
  from per_farmer group by crop
  having count(*) >= 5;   -- ★5農家未満はDB側で除外。そもそも返さない
$function$;

CREATE OR REPLACE FUNCTION public.board_dest_summary()
 RETURNS TABLE(dest_id text, farmer_count bigint, med_rev numeric, med_cost numeric, med_rate numeric)
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  with per_farmer as (
    select r.dest_id, r.farmer_id,
      sum(r.boxes * r.ppb) as rev,
      sum(coalesce((select sum((c->>'a')::numeric) from jsonb_array_elements(r.costs) as c), 0)) as cost
    from records r
    where r.dest_id is not null
    group by r.dest_id, r.farmer_id
  )
  select dest_id, count(*) as farmer_count,
    percentile_cont(0.5) within group (order by rev) as med_rev,
    percentile_cont(0.5) within group (order by cost) as med_cost,
    percentile_cont(0.5) within group (order by case when rev>0 then round(cost/rev*100) else 0 end) as med_rate
  from per_farmer group by dest_id
  having count(*) >= 5;
$function$;

CREATE OR REPLACE FUNCTION public.board_region_list()
 RETURNS TABLE(municipality text, farmer_count bigint)
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select municipality, count(*) as farmer_count
  from farmers
  where municipality is not null and municipality <> ''
  group by municipality having count(*) >= 5
$function$;

create or replace view public.public_summary as
 WITH base AS (
   SELECT r.crop, r.dest_id, f.experience_tier, r.farmer_id,
     r.boxes * r.ppb AS revenue,
     COALESCE((SELECT sum((c.value ->> 'a'::text)::numeric) FROM jsonb_array_elements(r.costs) c(value)), 0::numeric) AS expense,
     r.boxes * r.ppb - COALESCE((SELECT sum((c.value ->> 'a'::text)::numeric) FROM jsonb_array_elements(r.costs) c(value)), 0::numeric) AS profit,
     CASE WHEN (r.boxes * r.ppb) > 0::numeric
       THEN COALESCE((SELECT sum((c.value ->> 'a'::text)::numeric) FROM jsonb_array_elements(r.costs) c(value)), 0::numeric) / (r.boxes * r.ppb) * 100::numeric
       ELSE 0::numeric END AS expense_ratio
   FROM records r JOIN farmers f ON f.auth_id = r.farmer_id
 )
 SELECT crop, dest_id, experience_tier,
   count(DISTINCT farmer_id) AS farmer_count,
   percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (revenue::double precision)) AS median_revenue,
   percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (expense::double precision)) AS median_expense,
   percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (profit::double precision)) AS median_profit,
   percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (expense_ratio::double precision)) AS median_expense_ratio,
   percentile_cont(0.25::double precision) WITHIN GROUP (ORDER BY (profit::double precision)) AS q25_profit,
   percentile_cont(0.75::double precision) WITHIN GROUP (ORDER BY (profit::double precision)) AS q75_profit
 FROM base GROUP BY crop, dest_id, experience_tier
 HAVING count(DISTINCT farmer_id) >= 5;
-- ※ビューを作り直したら CLAUDE.md（2026-07-19）のとおり
--   REVOKE ALL ON public.public_summary FROM anon, authenticated;
--   GRANT SELECT ON public.public_summary TO authenticated;  を忘れないこと

CREATE OR REPLACE FUNCTION public.public_farmers_count()
 RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$ select count(*)::int from farmers $function$;

CREATE OR REPLACE FUNCTION public.job_meeting_address(p_job_number integer)
 RETURNS TABLE(address text) LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select j.address from jobs j
  where j.job_number = p_job_number
    and j.status = 'open'
    and auth.uid() is not null;   -- ★ログインしている時だけ返す。非ログインは0行。
$function$;

CREATE OR REPLACE FUNCTION public.farmer_hiring_stats(p_farmer_id uuid)
 RETURNS json LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT json_build_object(
    'hired_total', count(*),
    'hired_beginner', count(*) FILTER (WHERE worker_exp_snapshot = '未経験'),
    'hired_experienced', count(*) FILTER (WHERE worker_exp_snapshot = '経験あり')
  )
  FROM applications
  WHERE farmer_id = p_farmer_id
    AND status IN ('approved','meeting','interview','contracted','working','completed');
$function$;

CREATE OR REPLACE FUNCTION public.admin_analytics_series(p_days integer DEFAULT 30)
 RETURNS TABLE(d date, new_users integer, job_views integer, apps integer, completions integer, nsm_hours numeric)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  with days as (
    select generate_series(
      (now() at time zone 'Asia/Tokyo')::date - (p_days - 1),
      (now() at time zone 'Asia/Tokyo')::date, '1 day')::date as d
  )
  select
    days.d,
    coalesce((select count(*) from auth.users u
       where (u.created_at at time zone 'Asia/Tokyo')::date = days.d
         and public.is_measured(u.id)), 0)::int,
    coalesce((select count(*) from public.page_events e
       where (e.ts at time zone 'Asia/Tokyo')::date = days.d
         and e.page_hash like '%/work/job/%' and public.is_measured(e.auth_id)), 0)::int,
    coalesce((select count(*) from public.applications a
       where (a.created_at at time zone 'Asia/Tokyo')::date = days.d
         and public.is_measured(a.worker_id)), 0)::int,
    coalesce((select count(*) from public.applications a
       where a.status='completed' and coalesce(a.attended,true)
         and (a.work_completed_at at time zone 'Asia/Tokyo')::date = days.d
         and public.is_measured(a.worker_id)), 0)::int,
    coalesce((select sum((split_part(split_part(j.work_time,'〜',2),':',1)::int * 60
            + split_part(split_part(j.work_time,'〜',2),':',2)::int
            - split_part(split_part(j.work_time,'〜',1),':',1)::int * 60
            - split_part(split_part(j.work_time,'〜',1),':',2)::int) / 60.0)
       from public.applications a join public.jobs j on j.job_number = a.job_number
       where a.status='completed' and coalesce(a.attended,true)
         and j.work_time ~ '^\d{1,2}:\d{2}〜\d{1,2}:\d{2}'
         and (a.work_completed_at at time zone 'Asia/Tokyo')::date = days.d
         and public.is_measured(a.worker_id)), 0)
  from days
  where exists (select 1 from public.app_admins a where a.auth_id = auth.uid())
  order by days.d;
$function$;

CREATE OR REPLACE FUNCTION public.feedback_daily_summary()
 RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select coalesce(string_agg('・' || page_hash || '：' || cnt || '件', E'\n' order by cnt desc), 'なし')
    from (select page_hash, count(*) as cnt from public.feedback
           where created_at >= now() - interval '24 hours'
           group by page_hash limit 10) t;
$function$;

-- 空テーブル3つ（いずれも0行。RLSポリシーも併記）
create table public.calendar_notes (
  auth_id uuid not null, note_date date not null, note text not null,
  updated_at timestamp with time zone default now() not null );
alter table public.calendar_notes enable row level security;
create policy "cal notes owner" on public.calendar_notes for all to authenticated
  using (auth_id = auth.uid()) with check (auth_id = auth.uid());

create table public.error_logs (
  id uuid default gen_random_uuid() not null, user_email text,
  error_type text not null, error_message text not null,
  error_context text, page text, created_at timestamp with time zone default now() );
alter table public.error_logs enable row level security;
create policy "admin_only" on public.error_logs for all
  using ((auth.jwt() ->> 'email') = 't5fki6643qty@gmail.com');

create table public.mail_failures (
  id bigint not null, at timestamp with time zone default now() not null,
  recipient uuid, subject text, error text );
alter table public.mail_failures enable row level security;
create policy "mailfail admin read" on public.mail_failures for select to authenticated
  using (exists (select 1 from app_admins a where a.auth_id = auth.uid()));
*/
