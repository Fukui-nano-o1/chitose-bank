-- =============================================================================
-- 悪意あるユーザーのブロック：BAN（account_moderation）の壁を全書き込み経路へ拡張
-- ＋データ抜き取り面の穴を閉じる（2026-08-16）
--
-- 背景：admin_moderate_account は auth.users.banned_until='infinity' でログインを
-- 止めるが、発行済みトークンの有効期間（最大1時間）はDBを直接叩ける。DB側の
-- BANゲート（is_account_moderated）は apply_to_job・messages・reviews・repeat_roster
-- 等10箇所のみで、書き込みRPC約20本とRLS直書き経路が素通りだった。
-- 個別関数に撒くと漏れが再発するため、中央の壁（トリガー）1本で全経路を受ける。
-- =============================================================================

-- ① 中央の壁：停止(suspended)・追放(banned)中のアカウントは、どの経路
--    （RLS直書き・SECURITY DEFINER RPC内部）から書いても拒否する。
--    auth.uid() が NULL（cron・service_role）は通す＝システム処理は止めない。
--    運営(app_admins)は admin_moderate_account が対象化を拒むので常に非該当。
create or replace function public.assert_actor_not_moderated()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is not null and public.is_account_moderated(auth.uid()) then
    raise exception 'アカウントは停止中のため、この操作はできません。運営（t5fki6643qty@gmail.com）までご連絡ください。'
      using errcode = 'P0001';
  end if;
  return new;
end; $$;
revoke all on function public.assert_actor_not_moderated() from public, anon, authenticated;

-- 対象＝利用者のアクションを表す表（INSERT/UPDATEのみ。DELETEは自分のデータの
-- 取り下げso止めない）。意図的な対象外：withdrawal_requests（退会の権利は奪わない）・
-- app_errors（診断の記録）・chat_reads/push_subscriptions/notifications（無害・
-- システム書き込みと交差）・messages/reviews/repeat_roster（既にRLSでBANゲート済み）。
-- トリガー名 trg_a_block_moderated＝BEFOREはアルファベット順発火so既存トリガー
-- （enforce_min_age・trg_wp_*等）より先に走り、無駄な処理の前に止まる。
do $$
declare t text;
begin
  foreach t in array array[
    'applications','pending_applications','job_questions','jobs','job_publish_checks',
    'attendance_events','attendance_corrections','saved_jobs','worker_profiles','employer_profiles',
    'account_holders','farmers','feedback','job_reports','profile_reports','message_reports'
  ] loop
    execute format('drop trigger if exists trg_a_block_moderated on public.%I', t);
    execute format('create trigger trg_a_block_moderated before insert or update on public.%I for each row execute function public.assert_actor_not_moderated()', t);
  end loop;
end $$;

-- ② applications「app worker insert」ポリシーを削除。
--    フロントに applications への直接INSERTはゼロ（全てapply_to_job／
--    create_pending_application経由・grep実測）なのに、このポリシーは
--    apply_to_jobの全検証（BAN・profile_incomplete・dates_required・own_job・
--    job_not_open）を迂回して applied 行を直接作れた＝純粋な攻撃面。
--    復元用の旧定義: create policy "app worker insert" on public.applications
--      for insert with check ((auth.uid() = worker_id) and (status = 'applied'));
drop policy if exists "app worker insert" on public.applications;

-- ③ dests_insert_auth を削除（2026-08-07いちゃもん1・既知未修理の解消）。
--    with_check=true で誰でも偽のsubmitted_by付きの行を注入できた。destsは
--    分割3-AでUIを消した旧事業データ（読み手は管理タブlegacyViewのみ）＝書き込み不要。
--    復元用の旧定義: create policy "dests_insert_auth" on public.dests
--      for insert to authenticated with check (true);
drop policy if exists "dests_insert_auth" on public.dests;

-- ④ employer_profiles_public にBAN除外を追加（今の本番定義を土台に・列は同数同順）。
--    従来は停止・追放中の農家の看板（名前・紹介文・待遇）がログインユーザーに出続けた。
create or replace view public.employer_profiles_public as
select auth_id, nickname, pr, avatar_url,
       has_transport, has_parking, has_commute_allowance, has_bonus,
       employer_pays_supplies, accessory_ok, parking_capacity,
       commute_allowance_detail, transport_area, supplies_cap,
       intro_path, intro_joy, intro_crops, intro_atmosphere, intro_message,
       owner_comment, staff_count, commitment, unique_point, always_do,
       break_style, interaction_style, place_prefecture, place_city, place_town,
       created_at, insurance_items, teaching_style, chat_style, question_style
  from employer_profiles
 where not public.is_account_moderated(auth_id);
-- ビューはSELECT専用（2026-07-19ルール）を再宣言
revoke all on public.employer_profiles_public from anon, authenticated;
grant select on public.employer_profiles_public to authenticated;

-- ⑤ job_employer_profile：BAN農家の除外を追加。
--    求人No.は1000からの連番＝推測容易so、jobs_publicから消えても本RPCの直叩きで
--    BAN農家のプロフィール・募集主3項目（氏名・住所・連絡先）が引けた。
--    変更はWHEREに1条件追加のみ（今の本番定義を土台に・返り値の列は不変）。
create or replace function public.job_employer_profile(p_job_number integer)
 returns table(nickname text, pr text, avatar_url text, has_transport boolean, transport_area text, has_parking boolean, parking_capacity integer, has_commute_allowance boolean, commute_allowance_detail text, has_bonus boolean, employer_pays_supplies boolean, supplies_cap text, accessory_ok boolean, intro_path text, intro_joy text, intro_crops text, intro_atmosphere text, intro_message text, owner_comment text, unique_point text, always_do text, break_style text, interaction_style text, insurance_items jsonb, insurance_notes jsonb, recruiter_name text, recruiter_address text, recruiter_contact text, recruiter_name_kana text, teaching_style text, chat_style text, question_style text)
 language sql
 security definer
 set search_path to 'public'
as $function$
  select
         -- 表示情報（凍結対象外・常に最新でよい）：名前・紹介文・アイコン・人柄
         ep.nickname, ep.pr, ep.avatar_url,
         -- 待遇10項目は掲載時に凍結した jobs.perks から返す（この求人の広告内容そのもの）
         coalesce((j.perks->>'has_transport')::boolean, false),
         coalesce(j.perks->>'transport_area', ''),
         coalesce((j.perks->>'has_parking')::boolean, false),
         (j.perks->>'parking_capacity')::integer,
         coalesce((j.perks->>'has_commute_allowance')::boolean, false),
         coalesce(j.perks->>'commute_allowance_detail', ''),
         coalesce((j.perks->>'has_bonus')::boolean, false),
         coalesce((j.perks->>'employer_pays_supplies')::boolean, false),
         coalesce(j.perks->>'supplies_cap', ''),
         coalesce((j.perks->>'accessory_ok')::boolean, false),
         -- 農園紹介の文章・人柄（凍結対象外）
         ep.intro_path, ep.intro_joy, ep.intro_crops,
         ep.intro_atmosphere, ep.intro_message, ep.owner_comment,
         ep.unique_point, ep.always_do, ep.break_style, ep.interaction_style,
         -- 保険は掲載時に凍結した insurance_snapshot から（現在値への代用は禁止・2026-08-02）
         coalesce(j.insurance_snapshot->'items', '[]'::jsonb),
         coalesce(j.insurance_snapshot->'notes', '{}'::jsonb),
         -- 募集者の法定3項目＋カナも掲載時の凍結値（anonには従来どおりNULL）
         case when coalesce(auth.role(),'anon')='anon' then null::text else j.recruiter_name end,
         case when coalesce(auth.role(),'anon')='anon' then null::text else j.recruiter_address end,
         case when coalesce(auth.role(),'anon')='anon' then null::text else j.recruiter_contact end,
         case when coalesce(auth.role(),'anon')='anon' then null::text else j.recruiter_name_kana end,
         -- 関わり方の追加3問（2026-08-14・凍結対象外＝人柄グループ）
         ep.teaching_style, ep.chat_style, ep.question_style
  from jobs j
  join employer_profiles ep on ep.auth_id = j.farmer_id
  where j.job_number = p_job_number and j.status = 'open'
    and not public.is_account_moderated(j.farmer_id)  -- 停止・追放中の農家は返さない（2026-08-16）
$function$;

-- ⑥ employer_trust_info：BAN農家の除外（本人のみ従来どおり）。
--    「open求人があれば誰でも閲覧可」の入口が、BANでjobs_publicから消えた後も
--    残っていた（jobs直読みのため）。NULLを先に弾く（フェイルオープン規則）。
--    job_employer_trust_info は本関数を内部で呼ぶので自動で同じ壁がかかる。
create or replace function public.employer_trust_info(p_farmer_id uuid)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_ok boolean;
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
begin
  -- 停止・追放中の農家の信頼情報は本人以外に返さない（2026-08-16）
  if public.is_account_moderated(p_farmer_id)
     and (auth.uid() is null or auth.uid() <> p_farmer_id) then
    return json_build_object('ok', false);
  end if;
  v_ok := auth.uid() = p_farmer_id
    or exists (select 1 from public.applications a
                where a.farmer_id = p_farmer_id and a.worker_id = auth.uid())
    or exists (select 1 from public.jobs j
                where j.farmer_id = p_farmer_id and j.status = 'open');  -- 公開求人の農家は誰でも閲覧可
  if not v_ok then return json_build_object('ok', false); end if;

  return (select json_build_object('ok', true,
    'member_since', to_char(u.created_at at time zone 'Asia/Tokyo','YYYY年MM月'),
    'id_checked', exists(select 1 from public.account_holders ah where ah.auth_id = p_farmer_id),
    'entity_type', (select ah.entity_type from public.account_holders ah where ah.auth_id = p_farmer_id),
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
    'active_applied', (select count(*) from public.applications a
                         join public.jobs j on j.job_number = a.job_number
                        where a.farmer_id = p_farmer_id
                          and a.status in ('applied','approved','working','completed')
                          and j.status = 'open'
                          and (coalesce(j.date_end, j.date_start) is null
                               or coalesce(j.date_end, j.date_start) >= v_today)),
    'active_approved', (select count(*) from public.applications a
                          join public.jobs j on j.job_number = a.job_number
                         where a.farmer_id = p_farmer_id
                           and a.status in ('approved','working','completed')
                           and j.status = 'open'
                           and (coalesce(j.date_end, j.date_start) is null
                                or coalesce(j.date_end, j.date_start) >= v_today)),
    'active_hired', (select count(*) from public.applications a
                       join public.jobs j on j.job_number = a.job_number
                      where a.farmer_id = p_farmer_id
                        and a.terms_confirmed_worker_at is not null
                        and a.terms_confirmed_farmer_at is not null
                        and j.status = 'open'
                        and (coalesce(j.date_end, j.date_start) is null
                             or coalesce(j.date_end, j.date_start) >= v_today)),
    'want_again_workers', (select count(*) from public.reviews r
                            where r.reviewee_id = p_farmer_id
                              and r.direction = 'worker_to_farmer' and r.want_again = true),
    'avg_response_hours', (select round(avg(extract(epoch from (decided_at - created_at))/3600)::numeric, 1)
                            from public.applications a
                           where a.farmer_id = p_farmer_id and a.decided_at is not null),
    'avg_approval_hours', (select round(avg(extract(epoch from (decided_at - created_at))/3600)::numeric, 1)
                            from public.applications a
                           where a.farmer_id = p_farmer_id and a.decided_at is not null and a.status <> 'rejected'))
    from auth.users u where u.id = p_farmer_id);
end; $function$;
