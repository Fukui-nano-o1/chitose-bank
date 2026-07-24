-- 求人ボックスの展開概要に「応募・承認・採用人数」を出すためのRPC（2026-07-24）。
-- employer_public_jobs と同じ入口（p_job_number が open の求人であること）で、
-- その雇い手の公開求人ごとの応募状況を {job_number: {applied, approved, hired}} のjsonで返す。
-- すべて集計値のみ（誰が応募したかは出さない）。定義は信頼カード（employer_trust_info）と同じ：
--   applied  ＝ 現役の応募（applied/approved/working/completed。rejected/expired除外）
--   approved ＝ 承認以降（approved/working/completed）
--   hired    ＝ 採用成立（両者確認済み＝jobs_public.hired_countと同じ式）
create or replace function public.employer_public_job_counts(p_job_number integer)
 returns json
 language sql
 security definer
 set search_path to 'public'
as $function$
  select coalesce(json_object_agg(t.job_number, t.counts), '{}'::json)
  from (
    select j.job_number,
           json_build_object(
             'applied',  count(a.*) filter (where a.status in ('applied','approved','working','completed')),
             'approved', count(a.*) filter (where a.status in ('approved','working','completed')),
             'hired',    count(a.*) filter (where a.terms_confirmed_worker_at is not null
                                              and a.terms_confirmed_farmer_at is not null)
           ) as counts
      from public.jobs j
      left join public.applications a on a.job_number = j.job_number
     where j.status = 'open'
       and not public.is_account_moderated(j.farmer_id)
       and j.farmer_id = (select farmer_id from public.jobs
                           where job_number = p_job_number and status = 'open')
     group by j.job_number
  ) t;
$function$;

revoke all on function public.employer_public_job_counts(integer) from public;
grant execute on function public.employer_public_job_counts(integer) to authenticated;
