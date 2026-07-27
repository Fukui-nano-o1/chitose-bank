-- session-summary cron が毎回失敗していたバグの修正（2026-07-27）。
-- ERROR: aggregate function calls cannot contain window function calls
-- 原因：軌跡の string_agg(...) の引数内で lead(ts) over (...) を呼んでいた
-- （Postgresは集約関数の引数にウィンドウ関数を書けない）。20260714103625で導入され、
-- 管理者以外の未集計イベントが存在する時だけループ本体が走るため、一般公開後に顕在化した。
-- 修正：滞在秒（次イベントとの差）をサブクエリで先に計算し、外側で集約する。他は不変。
create or replace function public.summarize_sessions()
returns void language plpgsql security definer set search_path = public as $$
declare
  r record; v_email text; v_traj text; v_stats text;
  v_start timestamptz; v_end timestamptz; v_pages int;
begin
  for r in
    select auth_id from public.page_events
     where not summarized
       and not exists (select 1 from public.app_admins a where a.auth_id = page_events.auth_id)
     group by auth_id
    having max(ts) < now() - interval '30 minutes'
  loop
    select min(ts), max(ts), count(*) into v_start, v_end, v_pages
      from public.page_events where auth_id = r.auth_id and not summarized;

    -- 軌跡（順番どおり・各ページの滞在秒＝次イベントとの差）。lead()はサブクエリ側で計算する
    select string_agg(
             to_char(ts at time zone 'Asia/Tokyo','HH24:MI:SS') || '　' || page_hash ||
             coalesce('　（' || dwell_sec || '秒）','　（離脱）'),
             E'\n' order by ts)
      into v_traj
      from (select ts, page_hash,
                   extract(epoch from (lead(ts) over (order by ts) - ts))::int as dwell_sec
              from public.page_events
             where auth_id = r.auth_id and not summarized) s;

    -- 迷いの指紋：同一ページへの再訪回数（2回以上のみ）
    select coalesce(string_agg('・' || page_hash || '：' || cnt || '回', E'\n' order by cnt desc), 'なし')
      into v_stats
      from (select page_hash, count(*) as cnt
              from public.page_events
             where auth_id = r.auth_id and not summarized
             group by page_hash having count(*) >= 2) t;

    select email into v_email from auth.users where id = r.auth_id;
    begin
      perform public.send_admin_email(
        '[軌跡] ' || coalesce(v_email,'?') || '　' || v_pages || 'ページ・' ||
          (extract(epoch from (v_end - v_start))/60)::int || '分',
        '■ 利用者：' || coalesce(v_email,'?') || E'\n' ||
        '■ 滞在：' || to_char(v_start at time zone 'Asia/Tokyo','HH24:MI') || '〜' ||
          to_char(v_end at time zone 'Asia/Tokyo','HH24:MI') ||
          '（' || (extract(epoch from (v_end - v_start))/60)::int || '分・' || v_pages || 'ページ）' || E'\n' ||
        '■ 最初のページ：' || (select page_hash from public.page_events
             where auth_id = r.auth_id and not summarized order by ts limit 1) || E'\n' ||
        '■ 最後のページ（＝離脱点）：' || (select page_hash from public.page_events
             where auth_id = r.auth_id and not summarized order by ts desc limit 1) || E'\n\n' ||
        '■ 再訪ページ（迷いの候補）：' || E'\n' || v_stats || E'\n\n' ||
        '■ 軌跡：' || E'\n' || v_traj);
    exception when others then null; end;

    update public.page_events set summarized = true
     where auth_id = r.auth_id and not summarized;
  end loop;
end; $$;
