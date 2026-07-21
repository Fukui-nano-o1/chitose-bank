-- はじめる前の確認を働き手のみに変更（2026-07-19たきと指示：農家に自分の求人の概要確認は不要）。
-- 従来は双方確認でterms_snapshot（契約条件の凍結）だったが、働き手の確認だけで凍結するよう変更。
-- 農家側の確認打刻(terms_confirmed_farmer_at)は互換のため受け付けは残すが、UIからは呼ばれなくなる
CREATE OR REPLACE FUNCTION public.confirm_terms(p_application_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_worker uuid; v_farmer uuid; v_job int; v_done boolean;
begin
  select worker_id, farmer_id, job_number into v_worker, v_farmer, v_job
    from public.applications where id = p_application_id;
  if v_worker is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;

  if auth.uid() = v_worker then
    update public.applications set terms_confirmed_worker_at = coalesce(terms_confirmed_worker_at, now())
     where id = p_application_id;
  elsif auth.uid() = v_farmer then
    update public.applications set terms_confirmed_farmer_at = coalesce(terms_confirmed_farmer_at, now())
     where id = p_application_id;
  else
    return json_build_object('ok', false, 'reason', 'not_party');
  end if;

  select terms_confirmed_worker_at is not null
    into v_done from public.applications where id = p_application_id;
  if v_done then
    update public.applications a
       set terms_snapshot = coalesce(a.terms_snapshot,
         (select to_jsonb(j) - 'lat' - 'lng' from public.jobs j where j.job_number = v_job)
         || jsonb_build_object('snapshot_at', now()))
     where a.id = p_application_id;
  end if;

  return (select json_build_object('ok', true,
      'worker_confirmed', terms_confirmed_worker_at is not null,
      'farmer_confirmed', terms_confirmed_farmer_at is not null)
    from public.applications where id = p_application_id);
end; $function$;

-- 既存データの整合：働き手確認済みなのにスナップショット未凍結の応募があれば凍結する
UPDATE public.applications a
SET terms_snapshot = (select to_jsonb(j) - 'lat' - 'lng' from public.jobs j where j.job_number = a.job_number)
                     || jsonb_build_object('snapshot_at', now())
WHERE a.terms_confirmed_worker_at IS NOT NULL
  AND a.terms_snapshot IS NULL;