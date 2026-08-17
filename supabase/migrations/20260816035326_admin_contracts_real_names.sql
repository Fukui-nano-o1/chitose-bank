-- 契約スナップショット一覧（管理タブ）の当事者名を本名に（2026-08-14たきと指摘「なってないぞ」）。
-- 契約の記録＝雇用の法定手続きの文脈ので、当事者はニックネームでなく本名で示す（2026-07-30裁定(B)と整合）。
-- 優先順：①スナップショットに凍結された本名（party_names・2026-08-02以降の契約）
--        ②本人確認情報の現在値（account_holders.full_name＝凍結前の旧契約の代替・contract_party_nameと同じ倒し方）
--        ③ニックネーム（本名が無い場合の最後の砦・表示がー にならないため）
-- 管理者専用RPC（app_adminsゲート）＝運営は本人確認台帳を扱う立場ので本名表示は開示範囲の拡大ではない。
-- 実測：#1053（凍結前の旧契約）の働き手名が本名と一致・ニックネームと不一致。フロント変更なし（同じキー名）。
CREATE OR REPLACE FUNCTION public.admin_list_contracts()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (select 1 from public.app_admins a where a.auth_id = auth.uid()) then
    return json_build_object('ok', false, 'reason', 'not_admin');
  end if;
  return coalesce((
    select json_agg(json_build_object(
      'application_id', a.id,
      'job_number', a.job_number,
      'status', a.status,
      'worker_id', a.worker_id,
      'farmer_id', a.farmer_id,
      'worker_name', coalesce(
        nullif(btrim(a.terms_snapshot #>> '{party_names,worker}'), ''),
        nullif(btrim(ah_w.full_name), ''),
        wp.nickname),
      'farmer_name', coalesce(
        nullif(btrim(a.terms_snapshot #>> '{party_names,farmer}'), ''),
        nullif(btrim(ah_f.full_name), ''),
        ep.nickname),
      'worker_confirmed_at', to_char(a.terms_confirmed_worker_at at time zone 'Asia/Tokyo','YYYY/MM/DD HH24:MI'),
      'farmer_confirmed_at', to_char(a.terms_confirmed_farmer_at at time zone 'Asia/Tokyo','YYYY/MM/DD HH24:MI'),
      'snapshot_at', to_char((a.terms_snapshot->>'snapshot_at')::timestamptz at time zone 'Asia/Tokyo','YYYY/MM/DD HH24:MI'),
      'snapshot', a.terms_snapshot
    ) order by (a.terms_snapshot->>'snapshot_at')::timestamptz desc)
    from public.applications a
    left join public.worker_profiles wp on wp.auth_id = a.worker_id
    left join public.employer_profiles ep on ep.auth_id = a.farmer_id
    left join public.account_holders ah_w on ah_w.auth_id = a.worker_id
    left join public.account_holders ah_f on ah_f.auth_id = a.farmer_id
    where a.terms_snapshot is not null
  ), '[]'::json);
end; $function$;
