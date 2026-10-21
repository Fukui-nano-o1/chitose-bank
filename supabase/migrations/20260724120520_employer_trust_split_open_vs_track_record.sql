-- 信頼カードの「公開中」と「実績」の混同を解消（2026-07-24）。
-- 背景：カードは open_jobs（公開中の求人数）を「実績：N件」と表示していたため、
--   終了求人ゼロ・受け入れゼロの雇い手でも「実績：5件」と見えていた。
-- 修正：件数の意味を過去の求人ボックス（すべて/公開中/終了タブ）と1対1に揃える。
--   ・open_jobs   ＝ 公開中（status='open' かつ 日程がまだ過ぎていない）→ ボックスの「公開中」タブと同じ集合
--   ・ended_jobs  ＝ 実績（status='open' かつ coalesce(date_end,date_start) < 今日JST）→「終了（過去の実績）」タブと同じ集合
--   ・completed_hires ＝ 受け入れ人数。完了報告済み（completed+attended）のうち、
--       進行中の求人（open かつ 日程が来ていない/日程なし）に紐づく分は除外＝「終了した求人の採用数」に限定
-- 判定日はフロント（ymdLocal）と同じJSTの暦日。json戻り値にキー追加のみ（型は不変・呼び出し側は既存キーそのまま読める）。
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
    'want_again_workers', (select count(*) from public.reviews r
                            where r.reviewee_id = p_farmer_id
                              and r.direction = 'worker_to_farmer' and r.want_again = true),
    'avg_response_hours', (select round(avg(extract(epoch from (decided_at - created_at))/3600)::numeric, 1)
                            from public.applications a
                           where a.farmer_id = p_farmer_id and a.decided_at is not null))
    from auth.users u where u.id = p_farmer_id);
end; $function$;
