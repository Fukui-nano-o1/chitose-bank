-- 未承認の自己紹介(pr_pending/pr_qa_pending/pr_hidden_original/pr_revision_targets)が農家に届く穴を塞ぐ。
-- 2026-08-07 プラポリ一周で発見・たきと指示「やれ」。雇い手 employer_profiles_public（承認済み列だけの
-- ビュー）と同型に揃える＝農家向けは承認済み/台帳安全列だけ返すRPCに集約し、生行RLSを廃止する。

-- ① フル：応募者シート・ロスター詳細・プレビューが使う。未承認列は絶対に返さない。
--    審査中（未承認の自己紹介あり）は農家に見せない＝本文を返さず under_review のみ（2026-07-19の非表示ゲート維持）。
--    本人・運営は審査中でも承認済み内容を見られる（特権）。
create or replace function public.worker_profile_for_farmer(p_worker_id uuid)
returns json language plpgsql security definer set search_path to 'public' as $function$
declare v json; v_priv boolean; v_entitled boolean; v_pending boolean;
begin
  if auth.uid() is null or p_worker_id is null then return null; end if;
  v_priv := (auth.uid() = p_worker_id) or exists (select 1 from public.app_admins a where a.auth_id = auth.uid());
  v_entitled := v_priv or ( not public.is_account_moderated(p_worker_id)
                            and exists (select 1 from public.applications a
                                         where a.worker_id = p_worker_id and a.farmer_id = auth.uid()) );
  if not v_entitled then return null; end if;
  if not v_priv then
    select (nullif(btrim(coalesce(pr_pending,'')),'') is not null
            or (pr_qa_pending is not null and jsonb_typeof(pr_qa_pending)='array'
                and jsonb_array_length(pr_qa_pending) > 0))
      into v_pending from public.worker_profiles where auth_id = p_worker_id;
    if coalesce(v_pending,false) then return json_build_object('under_review', true); end if;
  end if;
  select json_build_object(
    'auth_id', wp.auth_id, 'nickname', wp.nickname, 'pr', wp.pr, 'avatar_url', wp.avatar_url,
    'created_at', wp.created_at, 'residence_city', wp.residence_city, 'transport', wp.transport,
    'farm_experience', wp.farm_experience, 'experienced_tasks', wp.experienced_tasks,
    'physical_level', wp.physical_level, 'pr_qa', wp.pr_qa, 'interests', wp.interests,
    'languages', wp.languages, 'self_declared', wp.self_declared, 'experience_entries', wp.experience_entries
  ) into v from public.worker_profiles wp where wp.auth_id = p_worker_id;
  return v;  -- pr_pending / pr_qa_pending / pr_hidden_original / pr_revision_targets は含めない
end; $function$;
revoke all on function public.worker_profile_for_farmer(uuid) from public, anon;
grant execute on function public.worker_profile_for_farmer(uuid) to authenticated;

-- ② カード：ロスター一覧・チャット一覧が使う。nickname/avatar だけ・資格のある働き手ぶんだけ返す。
create or replace function public.worker_cards_for_farmer(p_worker_ids uuid[])
returns json language plpgsql security definer set search_path to 'public' as $function$
declare v json; v_admin boolean;
begin
  if auth.uid() is null or p_worker_ids is null then return '[]'::json; end if;
  v_admin := exists (select 1 from public.app_admins a where a.auth_id = auth.uid());
  select coalesce(json_agg(json_build_object(
           'auth_id', wp.auth_id, 'nickname', wp.nickname, 'avatar_url', wp.avatar_url)), '[]'::json)
    into v
    from public.worker_profiles wp
   where wp.auth_id = any(p_worker_ids)
     and not public.is_account_moderated(wp.auth_id)
     and ( v_admin
           or exists (select 1 from public.applications a
                       where a.worker_id = wp.auth_id and a.farmer_id = auth.uid()) );
  return v;
end; $function$;
revoke all on function public.worker_cards_for_farmer(uuid[]) from public, anon;
grant execute on function public.worker_cards_for_farmer(uuid[]) to authenticated;

-- ③ 生行RLSを廃止（農家は worker_profiles の行を直接読めなくなる＝未承認列の漏れが機構的に消える）。
--    owner（本人）・admin の SELECT は残す。worker_trust_info 等の SECURITY DEFINER はRLS非依存ので無影響。
drop policy if exists "wp farmer select via application" on public.worker_profiles;
