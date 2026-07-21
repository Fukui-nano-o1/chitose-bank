-- 定時実行を有効化
create extension if not exists pg_cron with schema pg_catalog;

-- 日次ダイジェスト：過去24時間の新規登録・ログインを管理者メールに送る。
-- 送信は send_admin_email 経由（失敗しても握りつぶす・何も壊さない）。
create or replace function public.send_daily_auth_digest()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_since timestamptz := now() - interval '24 hours';
  v_new_count int;
  v_login_count int;
  v_new_lines text;
  v_login_lines text;
  v_body text;
begin
  select count(*), coalesce(string_agg(
           '・' || email || '（' || to_char(created_at at time zone 'Asia/Tokyo', 'MM/DD HH24:MI') || '）',
           E'\n' order by created_at desc), 'なし')
    into v_new_count, v_new_lines
    from auth.users
   where created_at >= v_since;

  select count(*), coalesce(string_agg(
           '・' || email || '（' || to_char(last_sign_in_at at time zone 'Asia/Tokyo', 'MM/DD HH24:MI') || '）',
           E'\n' order by last_sign_in_at desc), 'なし')
    into v_login_count, v_login_lines
    from auth.users
   where last_sign_in_at >= v_since;

  v_body :=
    '過去24時間の利用状況' || E'\n\n' ||
    '■ 新規登録：' || v_new_count || '件' || E'\n' || v_new_lines || E'\n\n' ||
    '■ ログイン：' || v_login_count || '件' || E'\n' || v_login_lines || E'\n\n' ||
    '（集計時刻：' || to_char(now() at time zone 'Asia/Tokyo', 'MM/DD HH24:MI') || ' JST）';

  perform public.send_admin_email(
    '[chitose-bank] 日次レポート：登録' || v_new_count || '件・ログイン' || v_login_count || '件',
    v_body
  );
end;
$$;

-- 毎日 21:00 JST（= 12:00 UTC）に送信。家族テストの活動が夜19-21時に集中しているため、その直後に集計する。
select cron.schedule(
  'daily-auth-digest',
  '0 12 * * *',
  $$ select public.send_daily_auth_digest(); $$
);