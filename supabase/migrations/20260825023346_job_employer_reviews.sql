-- 求人ページから求人者の評価を引く窓口（2026-08-25たきと指示「保険枠の下に求人者情報を明記。
-- アイコン、名称、代表より、評価」）。
-- 求人ページのクライアントは求人者のauth UIDを知らない（データ憲法：farmer_idは誰にも出さない）ため、
-- 求人No.から引ける窓口を1本足す。作りは job_employer_trust_info と同型＝
--   ①求人から farmer_id を解決（公開中 or 当事者のみ）②既存の reviews_public_badges に委譲。
-- ★開示範囲は広げない：委譲先が auth.uid() を見て従来どおりの資格判定を行う
--   （本人／その農家に応募した働き手／その農家に公開中の求人がある場合＝求人ページの読者はここに該当）。
--   肯定的な選択項目と審査を通った公開コメントだけ、という第8条の形も委譲先のまま。
create or replace function public.job_employer_reviews(p_job_number integer)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_farmer_id uuid;
begin
  select j.farmer_id into v_farmer_id
    from public.jobs j
   where j.job_number = p_job_number
     and (j.status = 'open' or public.is_job_party(p_job_number));
  if v_farmer_id is null then return json_build_object('ok', false, 'reason', 'not_entitled'); end if;
  return public.reviews_public_badges(v_farmer_id, 'worker_to_farmer');
end; $function$;

-- 権限：作成時のPUBLIC自動付与を必ず落としてから配る（2026-08-06の教訓＝from public と from anon の両方）。
-- 未ログインは委譲先が not_entitled を返すため anon に配る意味が無い
revoke all on function public.job_employer_reviews(integer) from public, anon, authenticated;
grant execute on function public.job_employer_reviews(integer) to authenticated;
