-- 農家プレビューの信頼カードに「承認までの時間」を追加（2026-07-30）。
-- 既存 avg_response_hours は「応募への返答」＝判断（承認/見送り両方）までの平均時間。
-- 追加 avg_approval_hours は「承認までの時間」＝承認した応募に限った平均時間。
--   ・承認の判定：decided_at が入っていて status が 'rejected' でない応募
--     （approved/working/completed と、承認後に採用されず失効した expired を含む＝承認自体は発生済み）
--   ・見送り（rejected）は除外
-- job_employer_trust_info は employer_trust_info を呼ぶだけなので変更不要（両画面へ自動反映）。
-- json戻り値へのキー追加のみ。既存キー・型・権限は不変。
CREATE OR REPLACE FUNCTION public.employer_trust_info(p_farmer_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ok boolean;
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
begin
  v_ok := auth.uid() = p_farmer_id
    or exists (select 1 from public.applications a
                where a.farmer_id = p_farmer_id and a.worker_id = auth.uid())
    or exists (select 1 from public.jobs j
                where j.farmer_id = p_farmer_id and j.status = 'open');  -- 公開求人の農家は誰でも閲覧可
  if not v_ok then return json_build_object('ok', false); end if;

  return (select json_build_object('ok', true,
    'member_since', to_char(u.created_at at time zone 'Asia/Tokyo','YYYY年MM月'),
    'id_checked', exists(select 1 from public.account_holders ah where ah.auth_id = p_farmer_id),
    'completed_hires', (select count(*) from public.applications a
                          join public.jobs j on j.job_number = a.job_number
                         where a.farmer_id = p_farmer_id and a.status = 'completed'
                           and a.attended is true
                           and not (j.status = 'open'
                                    and (coalesce(j.date_end, j.date_start) is null
                                         or coalesce(j.date_end, j.date_start) >= v_today))),
    'open_jobs', (select count(*) from public.jobs j
                   where j.farmer_id = p_farmer_id and j.status = 'open'
                     and (coalesce(j.date_end, j.date_start) is null
                          or coalesce(j.date_end, j.date_start) >= v_today)),
    'ended_jobs', (select count(*) from public.jobs j
                    where j.farmer_id = p_farmer_id and j.status = 'open'
                      and coalesce(j.date_end, j.date_start) < v_today),
    'active_applied', (select count(*) from public.applications a
                         join public.jobs j on j.job_number = a.job_number
                        where a.farmer_id = p_farmer_id
                          and a.status in ('applied','approved','working','completed')
                          and j.status = 'open'
                          and (coalesce(j.date_end, j.date_start) is null
                               or coalesce(j.date_end, j.date_start) >= v_today)),
    'active_approved', (select count(*) from public.applications a
                          join public.jobs j on j.job_number = a.job_number
                         where a.farmer_id = p_farmer_id
                           and a.status in ('approved','working','completed')
                           and j.status = 'open'
                           and (coalesce(j.date_end, j.date_start) is null
                                or coalesce(j.date_end, j.date_start) >= v_today)),
    'active_hired', (select count(*) from public.applications a
                       join public.jobs j on j.job_number = a.job_number
                      where a.farmer_id = p_farmer_id
                        and a.terms_confirmed_worker_at is not null
                        and a.terms_confirmed_farmer_at is not null
                        and j.status = 'open'
                        and (coalesce(j.date_end, j.date_start) is null
                             or coalesce(j.date_end, j.date_start) >= v_today)),
    'want_again_workers', (select count(*) from public.reviews r
                            where r.reviewee_id = p_farmer_id
                              and r.direction = 'worker_to_farmer' and r.want_again = true),
    'avg_response_hours', (select round(avg(extract(epoch from (decided_at - created_at))/3600)::numeric, 1)
                            from public.applications a
                           where a.farmer_id = p_farmer_id and a.decided_at is not null),
    'avg_approval_hours', (select round(avg(extract(epoch from (decided_at - created_at))/3600)::numeric, 1)
                            from public.applications a
                           where a.farmer_id = p_farmer_id and a.decided_at is not null and a.status <> 'rejected'))
    from auth.users u where u.id = p_farmer_id);
end; $function$;
