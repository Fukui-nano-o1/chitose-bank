-- 働き手プレビュー・応募者カードの「🌟 実績（このサイトの記録）」ブロック用に、worker_trust_info へ
-- 完了回数・また働きたい数・作業時間を追加（2026-07-23）。my_worker_trust_stats と同じ台帳集計を p_worker_id 版に。
-- 閲覧権限（本人／この働き手が応募した農家のみ）は従来の gate を維持＝越権・公開ではない。
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
  if auth.uid() <> p_worker_id and not exists (
    select 1 from public.applications a
    where a.worker_id = p_worker_id and a.farmer_id = auth.uid()
  ) then
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
