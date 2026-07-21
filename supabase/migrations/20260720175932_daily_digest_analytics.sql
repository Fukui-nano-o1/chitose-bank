-- 日次総括を「量の報告」から「詰まりの分析」へ拡張（Q1ファネル・Q2転換率・Q3離脱点・Q4返した時間）
-- 全指標から管理者を除外
create or replace function public.send_daily_auth_digest()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_since timestamptz := now() - interval '24 hours';
  v_week  timestamptz := now() - interval '7 days';
  v_new_count int; v_new_lines text; v_login_count int; v_login_lines text;
  v_app_24h int; v_app_total int; v_jobreq_24h int;
  v_jobs_total int; v_open_now int; v_pending_now int;
  -- 分析
  f_users int; f_idok int; f_profile int; f_active int;
  v_jobviews_7d int; v_apps_7d int; v_conv text;
  v_exit_lines text; v_nsm_total numeric; v_nsm_week numeric;
  v_body text;
begin
  select count(*), coalesce(string_agg('・' || email || '（' ||
           to_char(created_at at time zone 'Asia/Tokyo','MM/DD HH24:MI') || '）',
           E'\n' order by created_at desc), 'なし')
    into v_new_count, v_new_lines
    from auth.users where created_at >= v_since;
  select count(*), coalesce(string_agg('・' || email || '（' ||
           to_char(last_sign_in_at at time zone 'Asia/Tokyo','MM/DD HH24:MI') || '）',
           E'\n' order by last_sign_in_at desc), 'なし')
    into v_login_count, v_login_lines
    from auth.users where last_sign_in_at >= v_since;
  select count(*) filter (where created_at >= v_since), count(*)
    into v_app_24h, v_app_total from public.applications;
  select count(*) into v_jobreq_24h from public.notifications
   where type = 'job_pending' and created_at >= v_since;
  select count(*), count(*) filter (where status='open'), count(*) filter (where status='pending')
    into v_jobs_total, v_open_now, v_pending_now from public.jobs;

  -- Q1 ファネル（累計・管理者除外）：登録→本人確認→プロフィール→初行動
  select count(*) into f_users from auth.users u
   where not exists (select 1 from public.app_admins a where a.auth_id = u.id);
  select count(*) into f_idok from public.account_holders h
   where not exists (select 1 from public.app_admins a where a.auth_id = h.auth_id);
  select count(distinct x.auth_id) into f_profile from (
    select auth_id from public.worker_profiles where coalesce(nickname,'') <> ''
    union select auth_id from public.employer_profiles where coalesce(nickname,'') <> ''
  ) x where not exists (select 1 from public.app_admins a where a.auth_id = x.auth_id);
  select count(distinct y.uid) into f_active from (
    select worker_id as uid from public.applications
    union select farmer_id from public.jobs
  ) y where not exists (select 1 from public.app_admins a where a.auth_id = y.uid);

  -- Q2 転換率（7日・管理者除外）：求人詳細の閲覧回数→応募数
  select count(*) into v_jobviews_7d from public.page_events e
   where e.ts >= v_week and e.page_hash like '%/work/job/%'
     and not exists (select 1 from public.app_admins a where a.auth_id = e.auth_id);
  select count(*) into v_apps_7d from public.applications
   where created_at >= v_week;
  v_conv := case when v_jobviews_7d > 0
    then round(v_apps_7d::numeric / v_jobviews_7d * 100, 1) || '%' else '—' end;

  -- Q3 離脱点（7日・上位5・管理者除外）：セッション最後のページ
  select coalesce(string_agg('・' || page_hash || '：' || cnt || '回', E'\n'), 'データなし')
    into v_exit_lines
    from (
      select page_hash, count(*) as cnt from (
        select e.page_hash, e.ts,
               lead(e.ts) over (partition by e.auth_id order by e.ts) as next_ts
          from public.page_events e
         where e.ts >= v_week
           and not exists (select 1 from public.app_admins a where a.auth_id = e.auth_id)
      ) s
      where next_ts is null or next_ts - ts > interval '30 minutes'
      group by page_hash order by cnt desc limit 5
    ) t;

  -- Q4 NSM：返した時間（完了応募×求人の時間帯から算出・時間単位）
  select coalesce(sum(
           (split_part(split_part(j.work_time,'〜',2),':',1)::int * 60
            + split_part(split_part(j.work_time,'〜',2),':',2)::int
            - split_part(split_part(j.work_time,'〜',1),':',1)::int * 60
            - split_part(split_part(j.work_time,'〜',1),':',2)::int) / 60.0
         ) filter (where true), 0),
         coalesce(sum(
           (split_part(split_part(j.work_time,'〜',2),':',1)::int * 60
            + split_part(split_part(j.work_time,'〜',2),':',2)::int
            - split_part(split_part(j.work_time,'〜',1),':',1)::int * 60
            - split_part(split_part(j.work_time,'〜',1),':',2)::int) / 60.0
         ) filter (where a.work_completed_at >= v_week), 0)
    into v_nsm_total, v_nsm_week
    from public.applications a join public.jobs j on j.job_number = a.job_number
   where a.status = 'completed' and coalesce(a.attended, true)
     and j.work_time ~ '^\d{1,2}:\d{2}〜\d{1,2}:\d{2}';

  v_body :=
    '本日の総括（過去24時間）' || E'\n\n' ||
    '■ 応募：' || v_app_24h || '件（累計 ' || v_app_total || '件）' || E'\n' ||
    '■ 求人の審査申請：' || v_jobreq_24h || '件' || E'\n' ||
    '■ 新規登録：' || v_new_count || '件' || E'\n' || v_new_lines || E'\n\n' ||
    '■ ログイン：' || v_login_count || '件' || E'\n' || v_login_lines || E'\n\n' ||
    '―― 在庫 ――' || E'\n' ||
    '公開中：' || v_open_now || '件　審査待ち：' || v_pending_now || '件　総数：' || v_jobs_total || '件' || E'\n\n' ||
    '―― 分析（管理者除く） ――' || E'\n' ||
    '🪜 ファネル（累計）：登録 ' || f_users || ' → 本人確認 ' || f_idok ||
      ' → プロフィール ' || f_profile || ' → 初応募/初求人 ' || f_active || E'\n' ||
    '🎯 転換（7日）：求人詳細の閲覧 ' || v_jobviews_7d || '回 → 応募 ' || v_apps_7d ||
      '件（' || v_conv || '）' || E'\n' ||
    '🚪 離脱点（7日・セッション最後のページ上位5）：' || E'\n' || v_exit_lines || E'\n' ||
    '⏱ 返した時間：累計 ' || round(v_nsm_total,1) || ' 時間（今週 +' || round(v_nsm_week,1) || 'h）' || E'\n\n' ||
    '（集計時刻：' || to_char(now() at time zone 'Asia/Tokyo','MM/DD HH24:MI') || ' JST）';

  perform public.send_admin_email(
    '[chitose-bank] 本日の総括：応募' || v_app_24h || '件・登録' || v_new_count ||
      '件・返した時間 累計' || round(v_nsm_total,1) || 'h',
    v_body);
end; $$;