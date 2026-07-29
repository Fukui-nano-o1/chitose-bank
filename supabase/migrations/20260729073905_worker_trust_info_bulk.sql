-- 応募者の信頼情報を1回でまとめて引く（2026-07-29たきと指示「C＝一括RPC」）
--
-- これまで：農家お仕事タブは応募者1人につき worker_trust_info を1回ずつ叩いていた。
-- 同時に投げてはいるが、応募者が20人いれば20本の往復が同時に走る＝接続を食い、遅い端末ほど詰まる。
-- これから：worker_trust_info_bulk(uuid[]) で1回。中は集合演算なので人数が増えても1パス。
--
-- ★権限は1件版と同じ規則を「1人ずつ」適用する（まとめたから緩む、を絶対に起こさない）：
--   本人、または その働き手から応募を受けた農家 だけが引ける。
--   権限の無い働き手は返り値に現れない（存在の有無も返さない）。
--
-- ついでに1件版の穴を塞ぐ（下記）。1件版が開いたままでは一括版を締めても意味が無いため。

-- ── 穴の修理：未ログイン(anon)に他人の信頼情報が返っていた ──
-- 旧: if auth.uid() <> p_worker_id and not exists (...) then 拒否
--     未ログインでは auth.uid() が NULL なので「NULL <> uuid」＝NULL、条件全体がNULL＝偽と評価され、
--     拒否に入らずそのまま値を返していた（フェイルオープン）。実機で再現確認済み。
--     返っていたのは 登録日・本人確認日・評価件数・また呼びたい件数・完了件数・稼働時間。
--     ＝データ憲法「稼働回数など個人を特定しうる生の数値」に触れる。
-- 新: auth.uid() is null を先に弾く。ログイン済みの正当な呼び出し側の挙動は一切変わらない。
create or replace function public.worker_trust_info(p_worker_id uuid)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_joined timestamptz; v_verified timestamptz;
  v_reviewed int; v_want int; v_completed int; v_hours int;
begin
  if auth.uid() is null or (auth.uid() <> p_worker_id and not exists (
    select 1 from public.applications a
    where a.worker_id = p_worker_id and a.farmer_id = auth.uid()
  )) then
    return json_build_object('ok', false, 'reason', 'not_entitled');
  end if;

  select created_at into v_joined from auth.users where id = p_worker_id;
  select created_at into v_verified from public.account_holders where auth_id = p_worker_id;

  select count(*), count(*) filter (where want_again)
    into v_reviewed, v_want
    from public.reviews
   where reviewee_id = p_worker_id
     and direction = 'farmer_to_worker'
     and want_again is not null;

  select count(*) into v_completed
    from public.applications
   where worker_id = p_worker_id and status = 'completed' and attended is distinct from false;

  select coalesce(sum(extract(epoch from (btrim(split_part(j.work_time,'〜',2))::time - btrim(split_part(j.work_time,'〜',1))::time)) / 3600), 0)::int
    into v_hours
    from public.applications a
    join public.jobs j on j.job_number = a.job_number
   where a.worker_id = p_worker_id and a.status = 'completed' and a.attended is distinct from false
     and j.work_time ~ '\d{1,2}:\d{2}〜\d{1,2}:\d{2}';

  return json_build_object('ok', true, 'joined_at', v_joined, 'verified_at', v_verified,
    'reviewed_count', coalesce(v_reviewed, 0), 'want_again_count', coalesce(v_want, 0),
    'completed_count', coalesce(v_completed, 0), 'total_hours', coalesce(v_hours, 0));
end;
$function$;

-- ── 一括版 ──
-- 返り値は { "<worker_id>": {ok,joined_at,verified_at,reviewed_count,want_again_count,
--            completed_count,total_hours}, ... }。権限の無いidはキーごと現れない。
create or replace function public.worker_trust_info_bulk(p_worker_ids uuid[])
returns json
language sql
stable
security definer
set search_path to 'public'
as $function$
  with req as (
    select distinct t.id
      from unnest(coalesce(p_worker_ids, '{}'::uuid[])) as t(id)
     where t.id is not null
  ),
  -- 1件版と同じ規則を1人ずつ。auth.uid() is null を先に弾く（フェイルオープン防止）
  allowed as (
    select r.id as worker_id
      from req r
     where auth.uid() is not null
       and (r.id = auth.uid()
            or exists (select 1 from public.applications a
                        where a.worker_id = r.id and a.farmer_id = auth.uid()))
  ),
  rv as (
    select r.reviewee_id as worker_id,
           count(*)::int as reviewed_count,
           (count(*) filter (where r.want_again))::int as want_again_count
      from public.reviews r
      join allowed al on al.worker_id = r.reviewee_id
     where r.direction = 'farmer_to_worker' and r.want_again is not null
     group by r.reviewee_id
  ),
  done as (
    -- 完了件数は応募行のみで数え、稼働時間は求人の勤務時間が「H:MM〜H:MM」形式のものだけ足す
    -- （1件版と同じ。left join＋caseなので、求人が引けない応募も完了件数には残る）
    select a.worker_id,
           count(*)::int as completed_count,
           coalesce(sum(
             case when j.work_time ~ '\d{1,2}:\d{2}〜\d{1,2}:\d{2}'
               then extract(epoch from (btrim(split_part(j.work_time,'〜',2))::time
                                      - btrim(split_part(j.work_time,'〜',1))::time)) / 3600
               else 0 end
           ), 0)::int as total_hours
      from public.applications a
      join allowed al on al.worker_id = a.worker_id
      left join public.jobs j on j.job_number = a.job_number
     where a.status = 'completed' and a.attended is distinct from false
     group by a.worker_id
  )
  select coalesce(json_object_agg(al.worker_id::text, json_build_object(
           'ok', true,
           'joined_at',   (select u.created_at from auth.users u where u.id = al.worker_id),
           'verified_at', (select h.created_at from public.account_holders h where h.auth_id = al.worker_id),
           'reviewed_count',   coalesce(rv.reviewed_count, 0),
           'want_again_count', coalesce(rv.want_again_count, 0),
           'completed_count',  coalesce(dn.completed_count, 0),
           'total_hours',      coalesce(dn.total_hours, 0)
         )), '{}'::json)
    from allowed al
    left join rv on rv.worker_id = al.worker_id
    left join done dn on dn.worker_id = al.worker_id;
$function$;

-- 未ログインには渡さない（関数内でも弾いているが、入口でも閉じる＝二重の壁）
revoke all on function public.worker_trust_info_bulk(uuid[]) from public, anon;
grant execute on function public.worker_trust_info_bulk(uuid[]) to authenticated;
