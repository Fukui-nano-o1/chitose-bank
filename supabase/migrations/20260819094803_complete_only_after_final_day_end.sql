-- 完了は「最終作業日の仕事が終わってから」だけ（2026-08-19たきと指示）
--
-- たきと指摘：「完了ラベルを貼るのは最終日の仕事が終わった時だけ。7/10〜20の17時に終了する
-- 仕事なら、7/20の17:00にチャットは完了。ねっこ農園さんの仕事はまだ終えていない」
--
-- 起きていたこと：complete_work は「作業開始日を過ぎたか」しか見ていなかった。
-- #1232（作業日 8/18・8/20・8/21・8/24・8/31／6:00〜9:00）が、まだ 8/19 の時点で
-- 完了になっていた（実測：work_completed_at 2026-08-19 14:19 JST・auto_completed=false
-- ＝農家が手で記録した）。自動完了（auto_complete_work）の方は最終作業日の終了時刻を
-- 正しく見ていたので、手で押した時だけ壁が無かった。
--
-- 直し：期限の計算を app_work_due_at に集約し、3か所が同じ物差しを使う。
--   1. complete_work        … 期限前は拒否（機構の壁）
--   2. auto_complete_work   … 同じ計算を自前で持っていたので、helperに置き換え（挙動は不変）
--   3. my_todo_items        … 「バイトの評価」「仕事の評価」が並ぶ条件を日付→期限（時刻込み）に
-- フロントの isFinalWorkDayReached も同じ読み方に揃える（片方だけ変えると
-- 「画面には出るのにDBが拒む」の食い違いが出る＝最賃の壁の教訓）。

-- 期限＝最終作業日 ＋ 勤務時間の終了時刻（読めなければその日の23:59）。JSTで組み立てる。
-- 働く日が分からない求人は null＝期限を作らない（憶測で閉じない・7日ルールが受け持つ）
create or replace function public.app_work_due_at(p_app uuid)
returns timestamptz
language sql
stable
security definer
set search_path to 'public'
as $function$
  with a as (
    select (select max(d) from public.app_work_dates(p_app) d) as last_wd,
           (select j.work_time from public.applications ap
              join public.jobs j on j.job_number = ap.job_number where ap.id = p_app) as wt
  ),
  t as (
    select last_wd,
           substring(coalesce(wt,'') from '^[[:space:]]*([0-9]{1,2}:[0-9]{2})') as s_txt,
           substring(coalesce(wt,'') from '([0-9]{1,2}:[0-9]{2})[[:space:]]*$')  as e_txt
      from a
  ),
  m as (
    select last_wd,
           case when e_txt is null then null
                else split_part(e_txt,':',1)::int * 60 + split_part(e_txt,':',2)::int end as emin,
           case when s_txt is null then -1
                else split_part(s_txt,':',1)::int * 60 + split_part(s_txt,':',2)::int end as smin
      from t
  ),
  hm as (
    -- 終了が読めて、開始より後で、時刻として正しい時だけ採用する（auto_complete_work と同じ規則）
    select last_wd,
           case when emin is not null and emin > smin and emin <= 23*60+59 then emin / 60 else 23 end as hh,
           case when emin is not null and emin > smin and emin <= 23*60+59 then emin % 60 else 59 end as mm
      from m
  )
  select case when last_wd is null then null
              else ((last_wd::text || ' ' || lpad(hh::text,2,'0') || ':' || lpad(mm::text,2,'0'))::timestamp)
                   at time zone 'Asia/Tokyo' end
    from hm;
$function$;

revoke all on function public.app_work_due_at(uuid) from public, anon, authenticated;

-- 自動完了：同じ計算を自前で持っていたぶんを helper に置き換える（挙動は不変）
create or replace function public.auto_complete_work()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_now timestamptz := now(); r record; v_due timestamptz; v_n int := 0;
begin
  for r in
    select a.id from public.applications a where a.status = 'working'
  loop
    v_due := public.app_work_due_at(r.id);
    if v_due is null then continue; end if; -- 働く日が分からない＝憶測で閉じない
    if v_now >= v_due then
      update public.applications
         set status = 'completed', auto_completed = true,
             work_completed_at = coalesce(work_completed_at, v_due)
       where id = r.id and status = 'working';
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$function$;

-- complete_work：開始日チェック（作業開始日を過ぎたか）を、期限チェック（最終作業日の
-- 終了時刻を過ぎたか）に差し替える。本体は日本語のメール文面を含むので書き写さず、
-- いまの定義を読んで該当箇所だけ置き換える（写経ミスと文字化けを構造的に防ぐ）
do $$
declare src text; p1 text; p2 text; old_block text; new_block text;
begin
  select pg_get_functiondef(p.oid) into src from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='complete_work';
  old_block :=
'  select date_start into v_date_start from public.jobs where job_number = v_job;
  if v_date_start is not null and v_date_start > (now() at time zone ''Asia/Tokyo'')::date then
    return json_build_object(''ok'', false, ''reason'',''この求人の作業開始日（'' || to_char(v_date_start, ''MM/DD'') || ''）はまだ先です。作業日を迎えてから完了を記録してください'');
  end if;';
  if position(old_block in src) = 0 then return; end if;   -- 既に適用済み
  p1 := 'この仕事はまだ終わっていません。最終作業日（';
  p2 := '）を過ぎてから完了を記録してください';
  new_block :=
'  v_due := public.app_work_due_at(p_application_id);
  if v_due is not null and now() < v_due then
    return json_build_object(''ok'', false, ''reason'', ' ||
      quote_literal(p1) || ' || to_char(v_due at time zone ''''Asia/Tokyo'''', ''''MM/DD HH24:MI'''') || ' || quote_literal(p2) || ');
  end if;';
  src := replace(src, old_block, new_block);
  src := replace(src, 'v_auto boolean; v_att boolean;', 'v_auto boolean; v_att boolean; v_due timestamptz;');
  execute src;
end $$;

-- my_todo_items：「バイトの評価」（農家）と「仕事の評価」（働き手）が並ぶ条件を、
-- 最終作業日の【日付】から【終了時刻】に変える（完了の壁と同じ物差し）
do $$
declare src text; hit int;
begin
  select pg_get_functiondef(p.oid) into src from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='my_todo_items';
  hit := (length(src) - length(replace(src, 'today >= coalesce(last_wd, today)', '')))
         / length('today >= coalesce(last_wd, today)');
  if hit = 0 then return; end if;                          -- 既に適用済み
  if hit <> 2 then raise exception '差し替え箇所が2つではない: %', hit; end if;
  src := replace(src, 'today >= coalesce(last_wd, today)', 'now() >= coalesce(public.app_work_due_at(id), now())');
  execute src;
end $$;
