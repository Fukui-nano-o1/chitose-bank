-- 雇い手プロフィール刷新：Airbnbホスト3問の農家版＋作業中の関わり方＋信頼情報RPC
alter table public.employer_profiles
  add column if not exists unique_point text,       -- うちの畑・農園のユニークなところ
  add column if not exists always_do text,          -- 働きに来た人に、いつもしていること
  add column if not exists break_style text,        -- 休憩とお茶はどうしてる？
  add column if not exists interaction_style text;  -- together / explain_then_leave / on_call

-- 農家の信頼情報（自動計算・応募関係者or本人のみ）：利用年数・本人確認・受入完了・🌟・返答速度
create or replace function public.employer_trust_info(p_farmer_id uuid)
returns json language plpgsql security definer set search_path = public as $$
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
                           and coalesce(a.attended, true)),
    'want_again_workers', (select count(*) from public.reviews r
                            where r.reviewee_id = p_farmer_id
                              and r.direction = 'worker_to_farmer' and r.want_again = true),
    'avg_response_hours', (select round(avg(extract(epoch from (decided_at - created_at))/3600)::numeric, 1)
                            from public.applications a
                           where a.farmer_id = p_farmer_id and a.decided_at is not null))
    from auth.users u where u.id = p_farmer_id);
end; $$;
grant execute on function public.employer_trust_info(uuid) to authenticated;