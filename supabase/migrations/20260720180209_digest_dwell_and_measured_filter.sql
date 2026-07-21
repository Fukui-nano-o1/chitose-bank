-- ①計測対象判定：管理者本人＋そのメールエイリアス（+worker/+test等・将来の追加も自動除外）
create or replace function public.is_measured(p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.app_admins a where a.auth_id = p_uid)
     and not exists (
       select 1
         from auth.users u
         join public.app_admins ad on true
         join auth.users adu on adu.id = ad.auth_id
        where u.id = p_uid
          and (u.email = adu.email
               or u.email like split_part(adu.email,'@',1) || '+%@' || split_part(adu.email,'@',2))
     );
$$;

-- ②日次総括：全分析にis_measuredを適用＋滞在時間上位5を追加
create or replace function public.send_daily_auth_digest()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_since timestamptz := now() - interval '24 hours';
  v_week  timestamptz := now() - interval '7 days';
  v_new_count int; v_new_lines text; v_login_count int; v_login_lines text;
  v_app_24h int; v_app_total int; v_jobreq_24h int;
  v_jobs_total int; v_open_now int; v_pending_now int;
  f_users int; f_idok int; f_profile int; f_active int;
  v_jobviews_7d int; v_apps_7d int; v_conv text;
  v_exit_lines text; v_dwell_lines text; v_nsm_total numeric; v_nsm_week numeric;
  v_body text;
begin
  select count(*), coalesce(string_agg('・' || email || '（' ||
           to_char(created_at at time zone 'Asia/Tokyo','MM/DD HH24:MI') || '）',
           E'\n' order by created_at desc), 'なし')
    into v_new_count, v_new_lines from auth.users where created_at >= v_since;
  select count(*), coalesce(string_agg('・' || email || '（' ||
           to_char(last_sign_in_at at time zone 'Asia/Tokyo','MM/DD HH24:MI') || '）',
           E'\n' order by last_sign_in_at desc), 'なし')
    into v_login_count, v_login_lines from auth.users where last_sign_in_at >= v_since;
  select count(*) filter (where created_at >= v_since), count(*)
    into v_app_24h, v_app_total from public.applications;
  select count(*) into v_jobreq_24h from public.notifications
   where type = 'job_pending' and created_at >= v_since;
  select count(*), count(*) filter (where status='open'), count(*) filter (where status='pending')
    into v_jobs_total, v_open_now, v_pending_now from public.jobs;

  -- ファネル（累計・計測対象のみ）
  select count(*) into f_users from auth.users u where public.is_measured(u.id);
  select count(*) into f_idok from public.account_holders h where public.is_measured(h.auth_id);
  select count(distinct x.auth_id) into f_profile from (
    select auth_id from public.worker_profiles where coalesce(nickname,'') <> ''
    union select auth_id from public.employer_profiles where coalesce(nickname,'') <> ''
  ) x where public.is_measured(x.auth_id);
  select count(distinct y.uid) into f_active from (
    select worker_id as uid from public.applications
    union select farmer_id from public.jobs
  ) y where public.is_measured(y.uid);

  -- 転換（7日・計測対象のみ）
  select count(*) into v_jobviews_7d from public.page_events e
   where e.ts >= v_week and e.page_hash like '%/work/job/%' and public.is_measured(e.auth_id);
  select count(*) into v_apps_7d from public.applications a
   where a.created_at >= v_week and public.is_measured(a.worker_id);
  v_conv := case when v_jobviews_7d > 0
    then round(v_apps_7d::numeric / v_jobviews_7d * 100, 1) || '%' else '—' end;

  -- 離脱点＋滞在時間（7日・計測対象のみ・セッション区切り30分）
  with ev as (
    select e.auth_id, e.page_hash, e.ts,
           lead(e.ts) over (partition by e.auth_id order by e.ts) as next_ts
      from public.page_events e
     where e.ts >= v_week and public.is_measured(e.auth_id)
  )
  select
    (select coalesce(string_agg('・' || page_hash || '：' || cnt || '回', E'\n'), 'データなし')
       from (select page_hash, count(*) as cnt from ev
              where next_ts is null or next_ts - ts > interval '30 minutes'
              group by page_hash order by cnt desc limit 5) t1),
    (select coalesce(string_agg('・' || page_hash || '：計' ||
              round(total_s/60.0,1) || '分（平均' || round(avg_s) || '秒/回）', E'\n'), 'データなし')
       from (select page_hash,
                    sum(extract(epoch from (next_ts - ts))) as total_s,
                    avg(extract(epoch from (next_ts - ts))) as avg_s
               from ev
              where next_ts is not null and next_ts - ts <= interval '30 minutes'
              group by page_hash order by total_s desc limit 5) t2)
    into v_exit_lines, v_dwell_lines;

  -- NSM（計測対象のみ）
  select coalesce(sum(dur),0), coalesce(sum(dur) filter (where a.work_completed_at >= v_week),0)
    into v_nsm_total, v_nsm_week
    from (
      select a.*, ((split_part(split_part(j.work_time,'〜',2),':',1)::int * 60
            + split_part(split_part(j.work_time,'〜',2),':',2)::int
            - split_part(split_part(j.work_time,'〜',1),':',1)::int * 60
            - split_part(split_part(j.work_time,'〜',1),':',2)::int) / 60.0) as dur
        from public.applications a
        join public.jobs j on j.job_number = a.job_number
       where a.status = 'completed' and coalesce(a.attended, true)
         and j.work_time ~ '^\d{1,2}:\d{2}〜\d{1,2}:\d{2}'
         and public.is_measured(a.worker_id)
    ) a;

  v_body :=
    '本日の総括（過去24時間）' || E'\n\n' ||
    '■ 応募：' || v_app_24h || '件（累計 ' || v_app_total || '件）' || E'\n' ||
    '■ 求人の審査申請：' || v_jobreq_24h || '件' || E'\n' ||
    '■ 新規登録：' || v_new_count || '件' || E'\n' || v_new_lines || E'\n\n' ||
    '■ ログイン：' || v_login_count || '件' || E'\n' || v_login_lines || E'\n\n' ||
    '―― 在庫 ――' || E'\n' ||
    '公開中：' || v_open_now || '件　審査待ち：' || v_pending_now || '件　総数：' || v_jobs_total || '件' || E'\n\n' ||
    '―― 分析（運営とテスト用は除外） ――' || E'\n' ||
    '🪜 ファネル（累計）：登録 ' || f_users || ' → 本人確認 ' || f_idok ||
      ' → プロフィール ' || f_profile || ' → 初応募/初求人 ' || f_active || E'\n' ||
    '🎯 転換（7日）：求人詳細の閲覧 ' || v_jobviews_7d || '回 → 応募 ' || v_apps_7d ||
      '件（' || v_conv || '）' || E'\n' ||
    '🚪 離脱点（7日・上位5）：' || E'\n' || coalesce(v_exit_lines,'データなし') || E'\n' ||
    '🕰 滞在時間（7日・上位5）：' || E'\n' || coalesce(v_dwell_lines,'データなし') || E'\n' ||
    '⏱ 返した時間：累計 ' || round(v_nsm_total,1) || ' 時間（今週 +' || round(v_nsm_week,1) || 'h）' || E'\n\n' ||
    '（集計時刻：' || to_char(now() at time zone 'Asia/Tokyo','MM/DD HH24:MI') || ' JST）';

  perform public.send_admin_email(
    '[chitose-bank] 本日の総括：応募' || v_app_24h || '件・登録' || v_new_count ||
      '件・返した時間 累計' || round(v_nsm_total,1) || 'h',
    v_body);
end; $$;