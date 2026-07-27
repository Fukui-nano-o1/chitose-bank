-- 軌跡メールの分割（2026-07-27たきと指示）：総括1通＋軌跡を最大5通に分けて送る
-- 背景：cron失敗中に未集計が積み上がり（+worker/+testで各1,200行超）、復旧後の最初の1通に
-- 全軌跡が入って巨大メールになる恐れがあった。長すぎる本文は読めないうえ送信自体が失敗しうる。
-- 仕様：
--  ・総括（[総括]）＝利用者・滞在・最初/最後のページ・再訪ページ。軌跡が短ければ総括に同梱する
--  ・軌跡が150行を超えたら別便にし、通数は最大5（1通あたり約300行を目安に、超える分は1通を厚くする）
--  ・件名は [軌跡 i/N]。本文の先頭に何行目〜何行目かを書く（順番に読めるように）
--  ・分割送信が途中で失敗しても、集計済みフラグ（summarized）は従来どおり最後に一括で立てる
create or replace function public.summarize_sessions()
returns void language plpgsql security definer set search_path = public as $$
declare
  r record; v_email text; v_traj text; v_stats text;
  v_start timestamptz; v_end timestamptz; v_pages int;
  v_n int; v_parts int; v_chunk int; i int; v_from int; v_to int; v_head text;
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

    -- 迷いの指紋：同一ページへの再訪回数（2回以上のみ）
    select coalesce(string_agg('・' || page_hash || '：' || cnt || '回', E'\n' order by cnt desc), 'なし')
      into v_stats
      from (select page_hash, count(*) as cnt
              from public.page_events
             where auth_id = r.auth_id and not summarized
             group by page_hash having count(*) >= 2) t;

    select email into v_email from auth.users where id = r.auth_id;

    v_n := v_pages;
    -- 分割の通数：150行以下は分けない（0通＝総括に同梱）。超えたら1通300行を目安に最大5通
    v_parts := case when v_n <= 150 then 0
                    else least(5, greatest(1, ceil(v_n / 300.0)::int)) end;

    v_head := '■ 利用者：' || coalesce(v_email,'?') || E'\n' ||
      '■ 滞在：' || to_char(v_start at time zone 'Asia/Tokyo','MM/DD HH24:MI') || '〜' ||
        to_char(v_end at time zone 'Asia/Tokyo','MM/DD HH24:MI') ||
        '（' || (extract(epoch from (v_end - v_start))/60)::int || '分・' || v_pages || 'ページ）' || E'\n' ||
      '■ 最初のページ：' || (select page_hash from public.page_events
           where auth_id = r.auth_id and not summarized order by ts limit 1) || E'\n' ||
      '■ 最後のページ（＝離脱点）：' || (select page_hash from public.page_events
           where auth_id = r.auth_id and not summarized order by ts desc limit 1) || E'\n\n' ||
      '■ 再訪ページ（迷いの候補）：' || E'\n' || v_stats;

    if v_parts = 0 then
      -- 短いセッション：従来どおり総括に軌跡を同梱して1通
      select string_agg(
               to_char(ts at time zone 'Asia/Tokyo','HH24:MI:SS') || '　' || page_hash ||
               coalesce('　（' || dwell_sec || '秒）','　（離脱）'),
               E'\n' order by ts)
        into v_traj
        from (select ts, page_hash,
                     extract(epoch from (lead(ts) over (order by ts) - ts))::int as dwell_sec
                from public.page_events
               where auth_id = r.auth_id and not summarized) s;
      begin
        perform public.send_admin_email(
          '[総括] ' || coalesce(v_email,'?') || '　' || v_pages || 'ページ・' ||
            (extract(epoch from (v_end - v_start))/60)::int || '分',
          v_head || E'\n\n' || '■ 軌跡：' || E'\n' || v_traj);
      exception when others then null; end;
    else
      -- 長いセッション：総括を先に1通（軌跡は別便と明記）→ 軌跡をv_parts通に分けて送る
      begin
        perform public.send_admin_email(
          '[総括] ' || coalesce(v_email,'?') || '　' || v_pages || 'ページ・' ||
            (extract(epoch from (v_end - v_start))/60)::int || '分',
          v_head || E'\n\n' || '■ 軌跡：' || v_pages || '行あるため別便で ' || v_parts || '通に分けて送ります。');
      exception when others then null; end;

      v_chunk := ceil(v_n::numeric / v_parts)::int;
      for i in 1..v_parts loop
        v_from := (i - 1) * v_chunk + 1;
        v_to   := least(i * v_chunk, v_n);
        exit when v_from > v_n;
        select string_agg(line, E'\n' order by rn) into v_traj
          from (select rn, line from (
                  select row_number() over (order by ts) as rn,
                         to_char(ts at time zone 'Asia/Tokyo','HH24:MI:SS') || '　' || page_hash ||
                           coalesce('　（' || dwell_sec || '秒）','　（離脱）') as line
                    from (select ts, page_hash,
                                 extract(epoch from (lead(ts) over (order by ts) - ts))::int as dwell_sec
                            from public.page_events
                           where auth_id = r.auth_id and not summarized) s
                ) x
               where x.rn between v_from and v_to) y;
        begin
          perform public.send_admin_email(
            '[軌跡 ' || i || '/' || v_parts || '] ' || coalesce(v_email,'?'),
            '■ 利用者：' || coalesce(v_email,'?') || E'\n' ||
            '■ 軌跡 ' || v_from || '〜' || v_to || '行目（全' || v_n || '行）' || E'\n\n' || coalesce(v_traj,''));
        exception when others then null; end;
      end loop;
    end if;

    update public.page_events set summarized = true
     where auth_id = r.auth_id and not summarized;
  end loop;
end; $$;
