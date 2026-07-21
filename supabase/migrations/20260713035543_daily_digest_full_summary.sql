-- 日次ダイジェストを「1日の総括」に拡張：登録・ログイン・応募・求人申請・現在の在庫。
-- cron（毎日21:00 JST）は既存の daily-auth-digest がこの関数を呼ぶ（スケジュール変更不要）。
create or replace function public.send_daily_auth_digest()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_since timestamptz := now() - interval '24 hours';
  v_new_count int;      v_new_lines text;
  v_login_count int;    v_login_lines text;
  v_app_24h int;        v_app_total int;
  v_jobreq_24h int;     v_jobs_total int;
  v_open_now int;       v_pending_now int;
  v_body text;
begin
  -- 新規登録
  select count(*), coalesce(string_agg('・' || email || '（' ||
           to_char(created_at at time zone 'Asia/Tokyo','MM/DD HH24:MI') || '）',
           E'\n' order by created_at desc), 'なし')
    into v_new_count, v_new_lines
    from auth.users where created_at >= v_since;

  -- ログイン
  select count(*), coalesce(string_agg('・' || email || '（' ||
           to_char(last_sign_in_at at time zone 'Asia/Tokyo','MM/DD HH24:MI') || '）',
           E'\n' order by last_sign_in_at desc), 'なし')
    into v_login_count, v_login_lines
    from auth.users where last_sign_in_at >= v_since;

  -- 応募（24時間・累計）
  select count(*) filter (where created_at >= v_since), count(*)
    into v_app_24h, v_app_total
    from public.applications;

  -- 求人の審査申請（pendingになった回数＝job_pending通知を数える）と求人の累計
  select count(*) into v_jobreq_24h
    from public.notifications
   where type = 'job_pending' and created_at >= v_since;
  select count(*),
         count(*) filter (where status = 'open'),
         count(*) filter (where status = 'pending')
    into v_jobs_total, v_open_now, v_pending_now
    from public.jobs;

  v_body :=
    '本日の総括（過去24時間）' || E'\n\n' ||
    '■ 応募：' || v_app_24h || '件（累計 ' || v_app_total || '件）' || E'\n' ||
    '■ 求人の審査申請：' || v_jobreq_24h || '件' || E'\n' ||
    '■ 新規登録：' || v_new_count || '件' || E'\n' || v_new_lines || E'\n\n' ||
    '■ ログイン：' || v_login_count || '件' || E'\n' || v_login_lines || E'\n\n' ||
    '―― 現在の在庫 ――' || E'\n' ||
    '公開中の求人：' || v_open_now || '件　審査待ち：' || v_pending_now || '件　総求人数：' || v_jobs_total || '件' || E'\n\n' ||
    '（集計時刻：' || to_char(now() at time zone 'Asia/Tokyo','MM/DD HH24:MI') || ' JST）';

  perform public.send_admin_email(
    '[chitose-bank] 本日の総括：応募' || v_app_24h || '件・審査申請' || v_jobreq_24h ||
      '件・登録' || v_new_count || '件',
    v_body
  );
end;
$$;

-- 実射：今すぐ1通（cronを待たずに新フォーマットを確認）
select public.send_daily_auth_digest();