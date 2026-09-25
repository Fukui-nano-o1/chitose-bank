-- 実況メール（1操作1通）を廃止し、人ごと・最後の操作から30分たってから
-- まとめて1通にする（2026-09-25たきと裁定）。
-- 記録（event_audit）は今までどおり全部残す。止めるのは1操作1通のメールだけ。
--
-- ★本番へ適用した版は本文の助詞1文字が壊れていた（' さんが ' → ' さんthat '）。
--   このファイルは正しい文字で写経してある（続く 20260925042723 が本番のその1文字を直す）。
--   この環境では、しばしば「が」が "that" に化ける。長い日本語を書いたら必ず grep で確かめる。

-- ① 監査台帳に「まとめメールに載せたか」の旗
alter table public.event_audit add column if not exists mailed boolean not null default false;

-- 既存の記録は「載せ済み」にする
-- （これをしないと、導入した瞬間に過去の全記録が一気にメールになる）
update public.event_audit set mailed = true where not mailed;

-- まだ載せていないぶんだけを引く索引。チャットはまとめの対象外so索引にも入れない
create index if not exists event_audit_unmailed_idx
  on public.event_audit (actor, at)
  where not mailed and table_name <> 'messages';

-- ② trg_firehose からメール送信を外す（監査台帳への記録はそのまま）
--    ★関数の本文は写経せず、現物（pg_get_functiondef）のアンカーから末尾までを置き換える
do $mig$
declare v_def text; v_anchor text; v_pos int;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
   where p.proname = 'trg_firehose' and p.pronamespace = 'public'::regnamespace;
  if v_def is null then raise exception 'trg_firehose not found'; end if;

  if position('summarize_user_actions' in v_def) > 0 then
    raise notice 'trg_firehose: already switched to digest (skip)';
  else
    v_anchor := '  -- ★チャットは実況メールを出さない';
    v_pos := position(v_anchor in v_def);
    if v_pos = 0 then raise exception 'trg_firehose: anchor not found'; end if;

    v_def := left(v_def, v_pos - 1)
      || '  -- ★1操作1通の実況メールは廃止（2026-09-25たきと裁定）。' || E'\n'
      || '  -- 記録は上の監査台帳だけに残し、public.summarize_user_actions() が' || E'\n'
      || '  -- 人ごと・最後の操作から30分たってから、まとめて1通のメールにする。' || E'\n'
      || '  -- app_settings.event_firehose=''false'' でまとめメールも止まる（キルスイッチ）。' || E'\n'
      || '  return coalesce(new, old);' || E'\n'
      || 'end;' || E'\n'
      || '$function$' || E'\n';
    execute v_def;
  end if;
end $mig$;

-- ③ まとめメール（人ごと・離脱後30分）
create or replace function public.summarize_user_actions()
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  r record; v_on boolean;
  v_actor_name text; v_start timestamptz; v_end timestamptz; v_n int;
  v_lines text; v_sub text; v_body text;
  v_shown constant int := 40;   -- 1通に並べる操作の上限。超えたぶんは件数だけ
begin
  -- キルスイッチ（実況メールと同じ旗を使う）
  select value = 'true' into v_on from public.app_settings where key = 'event_firehose';
  if not coalesce(v_on, false) then return; end if;

  -- 送らないと決めた記録は「載せ済み」にして索引をきれいに保つ
  --   ・チャットの本文（2026-08-17たきと指示：実況を出さない）
  --   ・運営自身の操作
  update public.event_audit e set mailed = true
   where not e.mailed
     and (e.table_name = 'messages'
          or (e.actor is not null
              and exists (select 1 from public.app_admins a where a.auth_id = e.actor)));

  for r in
    select e.actor as actor
      from public.event_audit e
     where not e.mailed and e.table_name <> 'messages'
     group by e.actor
    having max(e.at) < now() - interval '30 minutes'
  loop
    select min(e.at), max(e.at), count(*)
      into v_start, v_end, v_n
      from public.event_audit e
     where not e.mailed and e.table_name <> 'messages'
       and e.actor is not distinct from r.actor;

    v_actor_name := case when r.actor is null then '運営/システム'
                         else public.resolve_actor_name(r.actor) end;

    select string_agg(x.line, E'\n\n' order by x.at)
      into v_lines
      from (
        select e.at as at,
          to_char(e.at at time zone 'Asia/Tokyo','HH24:MI') || '　' ||
          case e.table_name
            when 'jobs' then '求人'
            when 'applications' then '応募'
            when 'worker_profiles' then '働き手プロフィール'
            when 'employer_profiles' then '雇い手プロフィール'
            when 'saved_jobs' then 'いいね'
            when 'reviews' then '評価'
            when 'account_holders' then '本人確認情報'
            when 'job_questions' then '求人への質問'
            else e.table_name end
          || 'を'
          || case e.op when 'INSERT' then '追加' when 'UPDATE' then '編集' else '削除' end
          || E'\n'
          || coalesce(
               case when e.op = 'UPDATE' then
                 (select string_agg('　・' || public.jp_col(d.key) || '：' ||
                          public.jp_val(d.value->'old') || ' → ' || public.jp_val(d.value->'new'), E'\n')
                    from jsonb_each(e.diff) d)
               else
                 (select string_agg('　・' || public.jp_col(d.key) || '：' || public.jp_val(d.value), E'\n')
                    from jsonb_each(e.diff) d)
               end,
               '　（表示できる項目なし）') as line
          from public.event_audit e
         where not e.mailed and e.table_name <> 'messages'
           and e.actor is not distinct from r.actor
         order by e.at
         limit v_shown
      ) x;

    v_sub := '[まとめ] ' || v_actor_name || ' の操作 ' || v_n || '件（'
          || to_char(v_start at time zone 'Asia/Tokyo','MM/DD HH24:MI') || '〜'
          || to_char(v_end   at time zone 'Asia/Tokyo','HH24:MI') || '）';

    v_body := v_actor_name || ' さんが '
          || to_char(v_start at time zone 'Asia/Tokyo','MM/DD HH24:MI') || '〜'
          || to_char(v_end   at time zone 'Asia/Tokyo','HH24:MI')
          || ' に ' || v_n || '件の操作をしました。' || E'\n'
          || '（最後の操作から30分たったので、まとめて1通で送っています）' || E'\n\n'
          || coalesce(v_lines, '（表示できる操作なし）')
          || case when v_n > v_shown
                  then E'\n\n' || '…ほか ' || (v_n - v_shown) || '件（すべての記録は管理画面に残っています）'
                  else '' end;

    -- 送れた人だけ「載せ済み」にする（落ちた人は次の回でもう一度試す）
    begin
      perform public.send_admin_email(v_sub, v_body);
      update public.event_audit e set mailed = true
       where not e.mailed and e.table_name <> 'messages'
         and e.actor is not distinct from r.actor;
    exception when others then null;
    end;
  end loop;
end
$fn$;

-- cron 専用（クライアントからは呼べない）
revoke all on function public.summarize_user_actions() from public;
revoke all on function public.summarize_user_actions() from anon;
revoke all on function public.summarize_user_actions() from authenticated;

-- ④ 既にある15分ごとの見張り（session-summary）に足す。新しい cron は増やさない
select cron.alter_job(
  job_id => (select jobid from cron.job where jobname = 'session-summary'),
  command => 'select public.summarize_sessions(); select public.summarize_user_actions();'
);
