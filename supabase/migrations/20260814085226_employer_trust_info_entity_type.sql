-- 信頼カードのラベルを登録区分で出し分ける（2026-08-14たきと指示
-- 「個人で登録された方は氏名と住所として表示。法人として登録された方は名称と所在地として表示」）。
--
-- 供給：employer_trust_info の返りJSONに entity_type（account_holders.entity_type＝
-- individual/corporate・登録時の区分）を1キー追加。job_employer_trust_info は本関数へ委譲so自動追従
-- ＝求人詳細の農園紹介（訪問者含む）・確認ページ・働き手側プレビューの全部に1箇所で届く。
-- 開示の重さ：区分そのものはラベル（氏名/名称）として画面に出る前提の情報＝新たな個人情報の開示ではない。
-- 本文（氏名・住所の値）の開示範囲は従来どおり不変（anonへのマスクは recruiter_* 側で担保済み）。
-- 変更は json_build_object への1キー追加のみ＝既存キー・権限・閲覧資格（v_ok）は一切不変。

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
    'entity_type', (select ah.entity_type from public.account_holders ah where ah.auth_id = p_farmer_id),
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
