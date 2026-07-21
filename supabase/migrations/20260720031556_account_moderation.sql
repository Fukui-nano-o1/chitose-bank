-- アカウントの一時停止／永久追放（2026-07-19）
-- 「両方（最強）」＝アプリ内操作の封鎖＋ログイン封鎖（auth.users.banned_until）。解除は手動のみ。
-- チャット履歴は絶対に消さない（CLAUDE.md 2026-07-19）＝停止は「新規書き込みの拒否＋公開物の非表示」まで。

create table if not exists public.account_moderation (
  auth_id uuid primary key references auth.users(id) on delete cascade,
  state text not null default 'active' check (state in ('active','suspended','banned')),
  reason text,
  moderated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.account_moderation enable row level security;
drop policy if exists "am admin all" on public.account_moderation;
create policy "am admin all" on public.account_moderation for all
  using (exists (select 1 from public.app_admins a where a.auth_id = auth.uid()))
  with check (exists (select 1 from public.app_admins a where a.auth_id = auth.uid()));

-- 判定ヘルパー（SECURITY DEFINER＝RLSを跨いで account_moderation を読む）。停止/追放ならtrue
create or replace function public.is_account_moderated(p_uid uuid)
returns boolean language sql security definer stable set search_path to 'public' as $$
  select exists (select 1 from public.account_moderation m
                  where m.auth_id = p_uid and m.state in ('suspended','banned'));
$$;

-- 管理者による停止／追放／解除。app_admins（運営者本人・+test等）は対象外＝自己封鎖事故を防ぐ
create or replace function public.admin_moderate_account(p_auth_id uuid, p_action text, p_reason text default null)
returns json language plpgsql security definer set search_path to 'public','auth' as $$
declare v_state text;
begin
  if not exists (select 1 from public.app_admins a where a.auth_id = auth.uid()) then
    return json_build_object('ok', false, 'reason', 'not_admin');
  end if;
  if p_action not in ('suspend','ban','unban') then
    return json_build_object('ok', false, 'reason', 'bad_action');
  end if;
  if exists (select 1 from public.app_admins a where a.auth_id = p_auth_id) then
    return json_build_object('ok', false, 'reason', 'cannot_moderate_admin');
  end if;

  v_state := case p_action when 'suspend' then 'suspended' when 'ban' then 'banned' else 'active' end;

  insert into public.account_moderation (auth_id, state, reason, moderated_by, updated_at)
  values (p_auth_id, v_state, p_reason, auth.uid(), now())
  on conflict (auth_id) do update
    set state = excluded.state, reason = excluded.reason, moderated_by = excluded.moderated_by, updated_at = now();

  -- ログイン封鎖：停止/追放はbanned_untilを無期限に、解除はnullに（GoTroが token 発行/更新時に見る）
  update auth.users
     set banned_until = case when p_action = 'unban' then null else 'infinity'::timestamptz end
   where id = p_auth_id;

  return json_build_object('ok', true, 'state', v_state);
end; $$;

-- ── アプリ内操作の封鎖（書き込み拒否） ──
-- チャット新規送信
drop policy if exists "msg insert party" on public.messages;
create policy "msg insert party" on public.messages for insert
  with check (
    sender_id = auth.uid()
    and not public.is_account_moderated(auth.uid())
    and exists (select 1 from public.applications a
                 where a.id = messages.application_id
                   and (a.worker_id = auth.uid() or a.farmer_id = auth.uid())));

-- お気に入り登録（また呼びたい）
drop policy if exists "roster farmer manage" on public.repeat_roster;
create policy "roster farmer manage" on public.repeat_roster for all
  using (farmer_id = auth.uid())
  with check (farmer_id = auth.uid() and not public.is_account_moderated(auth.uid()));

-- 評価の投稿
drop policy if exists "review insert own" on public.reviews;
create policy "review insert own" on public.reviews for insert
  with check (
    reviewer_id = auth.uid()
    and not public.is_account_moderated(auth.uid())
    and exists (select 1 from public.applications a
                 where a.id = reviews.application_id
                   and (a.worker_id = auth.uid() or a.farmer_id = auth.uid())));

-- ── 公開物の非表示 ──
-- 停止/追放された働き手のプロフィールは農家（応募経由）から見えなくする（本人・管理者は従来通り）
drop policy if exists "wp farmer select via application" on public.worker_profiles;
create policy "wp farmer select via application" on public.worker_profiles for select
  using (
    not public.is_account_moderated(worker_profiles.auth_id)
    and exists (select 1 from public.applications a
                 where a.worker_id = worker_profiles.auth_id and a.farmer_id = auth.uid()));

-- 求人一覧：停止/追放された農家の公開求人を除外（farmer_idは露出しない）
create or replace view public.jobs_public as
  select job_number, crop, task, prefecture, city, town, date_label, date_start, date_end,
         headcount, pay_type, hourly_wage, daily_wage, work_time, break_time, nearest_station,
         commute_time, job_exp, notes, belongings, cautions, danger_places, danger_tasks, photos,
         created_at, lat, lng, geo_radius_m, full_pay_guarantee, beginner_ok, instant_approve_repeat,
         opened_at, perks, experienced_preferred
    from public.jobs
   where status = 'open' and not public.is_account_moderated(farmer_id);
revoke all on public.jobs_public from anon, authenticated;
grant select on public.jobs_public to authenticated;

-- 雇い手プロフィール公開ビュー：停止/追放された農家を除外
create or replace view public.employer_profiles_public as
  select auth_id, nickname, pr, avatar_url, has_transport, has_parking, has_commute_allowance,
         has_bonus, employer_pays_supplies, accessory_ok, parking_capacity, commute_allowance_detail,
         transport_area, supplies_cap, intro_path, intro_joy, intro_crops, intro_atmosphere,
         intro_message, owner_comment, staff_count, commitment, unique_point, always_do, break_style,
         interaction_style, place_prefecture, place_city, place_town, created_at
    from public.employer_profiles
   where not public.is_account_moderated(auth_id);
revoke all on public.employer_profiles_public from anon, authenticated;
grant select on public.employer_profiles_public to authenticated;