-- 完了処理エラー修正（2026-07-19）：job_refがemployer_profilesに存在しないfarm_name列を参照していた
-- （実際の農園名の列はnickname）。complete_work等がjob_ref経由で失敗していた
CREATE OR REPLACE FUNCTION public.job_ref(p_job integer, p_viewer text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_crop text; v_task text; v_farmer uuid; v_farm text; v_title text;
begin
  select crop, task, farmer_id into v_crop, v_task, v_farmer
    from public.jobs where job_number = p_job;
  if v_farmer is null then return '求人 #' || p_job; end if;
  v_title := trim(coalesce(v_crop,'') || ' ' || coalesce(v_task,''));
  if v_title = '' then v_title := '内容未設定'; end if;
  if p_viewer = 'farmer' then
    return 'あなたの求人 #' || p_job || '「' || v_title || '」';
  else
    select nullif(nickname,'') into v_farm from public.employer_profiles where auth_id = v_farmer;
    v_farm := coalesce(v_farm, public.resolve_actor_name(v_farmer), '農家');
    return v_farm || 'さんの求人 #' || p_job || '「' || v_title || '」';
  end if;
end; $function$;