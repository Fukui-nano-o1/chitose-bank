-- 契約条件スナップショットの凍結条件を再設計（2026-07-19たきと指示）：
-- 働き手の確認だけで凍結は絶対にダメ。凍結トリガー＝働き手の「はじめる前の確認」＋農家の「採用する」タップの両方。
-- terms_confirmed_farmer_at は「農家が採用を決定した時刻」として使う（打合せ・面接はチャットで行い最終決定）
CREATE OR REPLACE FUNCTION public.confirm_terms(p_application_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_worker uuid; v_farmer uuid; v_job int; v_both boolean;
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

  select terms_confirmed_worker_at is not null and terms_confirmed_farmer_at is not null
    into v_both from public.applications where id = p_application_id;
  if v_both then
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

-- 暫定変更（働き手のみ凍結）で作られた片側スナップショットを掃除：両方確認が揃った時に改めて凍結される
UPDATE public.applications
SET terms_snapshot = NULL
WHERE terms_snapshot IS NOT NULL
  AND (terms_confirmed_farmer_at IS NULL OR terms_confirmed_worker_at IS NULL);