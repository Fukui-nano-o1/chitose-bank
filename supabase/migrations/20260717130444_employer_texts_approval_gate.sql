-- 農家プロフィール自由記述の承認ゲート（2026-07-16）：憲法5条「公開は運営ゲート経由のみ」
-- 書き込みは texts_pending(jsonb) に溜まり、運営承認で本公開列へ反映される（働き手pr_pendingと同思想）
alter table public.employer_profiles
  add column texts_pending jsonb not null default '{}'::jsonb,
  add column texts_submitted_at timestamptz;

-- 承認：pendingの各キーを本公開列へ反映してpendingを空にする。キーが無い項目は現状維持、空文字は「消す」として反映
create or replace function public.approve_employer_texts(p_auth_id uuid)
returns json language plpgsql security definer set search_path to 'public' as $$
declare tp jsonb;
begin
  if not exists (select 1 from public.app_admins a where a.auth_id = auth.uid()) then
    return json_build_object('ok', false, 'reason', 'not_admin');
  end if;
  select texts_pending into tp from public.employer_profiles where auth_id = p_auth_id;
  if tp is null or tp = '{}'::jsonb then
    return json_build_object('ok', false, 'reason', 'nothing_pending');
  end if;
  update public.employer_profiles set
    owner_comment            = coalesce(tp->>'owner_comment', owner_comment),
    intro_path               = coalesce(tp->>'intro_path', intro_path),
    intro_joy                = coalesce(tp->>'intro_joy', intro_joy),
    intro_crops              = coalesce(tp->>'intro_crops', intro_crops),
    intro_atmosphere         = coalesce(tp->>'intro_atmosphere', intro_atmosphere),
    intro_message            = coalesce(tp->>'intro_message', intro_message),
    unique_point             = coalesce(tp->>'unique_point', unique_point),
    always_do                = coalesce(tp->>'always_do', always_do),
    break_style              = coalesce(tp->>'break_style', break_style),
    transport_area           = coalesce(tp->>'transport_area', transport_area),
    commute_allowance_detail = coalesce(tp->>'commute_allowance_detail', commute_allowance_detail),
    supplies_cap             = coalesce(tp->>'supplies_cap', supplies_cap),
    texts_pending = '{}'::jsonb,
    texts_submitted_at = null,
    updated_at = now()
  where auth_id = p_auth_id;
  return json_build_object('ok', true);
end; $$;

-- 差し戻し：pendingを破棄（本公開列は変えない）
create or replace function public.reject_employer_texts(p_auth_id uuid)
returns json language plpgsql security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from public.app_admins a where a.auth_id = auth.uid()) then
    return json_build_object('ok', false, 'reason', 'not_admin');
  end if;
  update public.employer_profiles
     set texts_pending = '{}'::jsonb, texts_submitted_at = null
   where auth_id = p_auth_id;
  return json_build_object('ok', true);
end; $$;

revoke all on function public.approve_employer_texts(uuid) from public;
revoke all on function public.approve_employer_texts(uuid) from anon;
grant execute on function public.approve_employer_texts(uuid) to authenticated;
revoke all on function public.reject_employer_texts(uuid) from public;
revoke all on function public.reject_employer_texts(uuid) from anon;
grant execute on function public.reject_employer_texts(uuid) to authenticated;