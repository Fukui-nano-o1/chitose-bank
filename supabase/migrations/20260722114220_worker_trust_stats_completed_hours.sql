-- 働き手ハブの「わたしの実績」箱に 完了回数・作業時間 を直接表示するため、本人限定RPCに2項目追加。
-- completed_count＝status=completed かつ欠勤でない応募の数。total_hours＝その求人の work_time
-- （'H:MM〜H:MM'）から算出した実働時間の合計（時）。既存の reviewed_count / want_again_count は不変。
create or replace function public.my_worker_trust_stats()
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_joined timestamptz;
  v_verified timestamptz;
  v_reviewed int;
  v_want int;
  v_completed int;
  v_hours int;
begin
  if auth.uid() is null then
    return json_build_object('ok', false, 'reason', 'not_signed_in');
  end if;

  select created_at into v_joined from auth.users where id = auth.uid();
  select created_at into v_verified from public.account_holders where auth_id = auth.uid();

  select count(*), count(*) filter (where want_again)
    into v_reviewed, v_want
    from public.reviews
   where reviewee_id = auth.uid()
     and direction = 'farmer_to_worker'
     and want_again is not null;

  select count(*) into v_completed
    from public.applications
   where worker_id = auth.uid() and status = 'completed' and attended is distinct from false;

  select coalesce(sum(extract(epoch from (btrim(split_part(j.work_time,'〜',2))::time - btrim(split_part(j.work_time,'〜',1))::time)) / 3600), 0)::int
    into v_hours
    from public.applications a
    join public.jobs j on j.job_number = a.job_number
   where a.worker_id = auth.uid() and a.status = 'completed' and a.attended is distinct from false
     and j.work_time ~ '\d{1,2}:\d{2}〜\d{1,2}:\d{2}';

  return json_build_object(
    'ok', true,
    'joined_at', v_joined,
    'verified_at', v_verified,
    'reviewed_count', coalesce(v_reviewed, 0),
    'want_again_count', coalesce(v_want, 0),
    'completed_count', coalesce(v_completed, 0),
    'total_hours', coalesce(v_hours, 0)
  );
end;
$function$;
