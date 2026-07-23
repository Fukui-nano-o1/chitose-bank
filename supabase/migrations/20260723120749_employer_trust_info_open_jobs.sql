-- 農家プレビューの信頼カードに「掲載中の求人数（open_jobs）」を追加（2026-07-23）。
-- 背景：これまでカードは completed_hires（=完了した受け入れ・応募単位の人数=件数)を「完了N件」と表示していたが、
--   タップで開くボックスは status='open' の求人一覧（employer_public_jobs）を出すため、
--   「完了5件」なのに「公開中の求人が3件」出る＝件数の意味が食い違って見えていた。
--   カードの件数を「掲載中の求人＝open_jobs」に一本化して、ボックス（すべて/公開中/終了タブ）と単位を揃える。
-- completed_hires も empty-state 判定に使うため残す。open_jobs 追加のみで戻り値の型（json）は不変。
CREATE OR REPLACE FUNCTION public.employer_trust_info(p_farmer_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_ok boolean;
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
                         where a.farmer_id = p_farmer_id and a.status = 'completed'
                           and a.attended is true),
    'open_jobs', (select count(*) from public.jobs j
                   where j.farmer_id = p_farmer_id and j.status = 'open'),
    'want_again_workers', (select count(*) from public.reviews r
                            where r.reviewee_id = p_farmer_id
                              and r.direction = 'worker_to_farmer' and r.want_again = true),
    'avg_response_hours', (select round(avg(extract(epoch from (decided_at - created_at))/3600)::numeric, 1)
                            from public.applications a
                           where a.farmer_id = p_farmer_id and a.decided_at is not null))
    from auth.users u where u.id = p_farmer_id);
end; $function$;
