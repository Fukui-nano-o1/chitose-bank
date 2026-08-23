-- 労働条件の明示・未記録4項目の実装（2026-08-21たきと指示「実装」）。Task #0の調査結果に基づく設計：
--   ①就業の場所・業務の【変更の範囲】＝求人入力（求人ごとに違う実態がある唯一の項目・既定は「変更なし」）
--   ②【労災・雇用保険の適用】＝プロフィール入力（事業所の属性＝受動喫煙と同じ枠・掲載時に凍結）
--   ③【契約の更新の有無と基準】＝入力させない固定ポリシー（このサイトの契約は期間満了で終了・
--     続きは新たな応募→承認＝承認制の憲法。全求人で答えが1つしかないため、支払条件と同じ型で凍結）
--   ④【退職に関する事項（解雇の事由含む）】＝標準文で固定（農家に法律文を書かせない・全求人共通）
-- いずれも掲載時に jobs へ凍結 → terms_snapshot（to_jsonbで自動包含）→ 労働条件通知書へ流れる。
--
-- ★凍結は既存の trg_job_publish_snapshot を書き換えず、後から発火する別トリガーで行う（合成方式）。
--   BEFOREトリガーは名前のアルファベット順で発火する＝ 'job_publish_snapshot' < 'job_publish_zscope'
--   なのでスナップショットの後に走る。名前を変える時はこの順序を壊さないこと。

-- ── 列の追加 ──
alter table public.jobs
  add column if not exists place_change_scope text,
  add column if not exists task_change_scope text,
  add column if not exists contract_renewal text,
  add column if not exists retirement_terms text,
  add column if not exists labor_insurance_status text;

-- 労災・雇用保険の申告（事業所の属性）。
-- ★consignment_profiles にも同じ列を足すこと：EmployerProfileEdit は同じpayloadを
--   雇い手レーンと委託レーンの両テーブルへ upsert するため、片方に無いと委託側の保存が落ちる（2026-08-19の教訓）
alter table public.employer_profiles add column if not exists labor_insurance_status text;
alter table public.consignment_profiles add column if not exists labor_insurance_status text;

-- ── 掲載時の凍結トリガー（snapshotの後に発火・条件は snapshot と同一） ──
create or replace function public.trg_job_publish_zscope()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_lis text;
begin
  -- draft→pending/open（掲載申請・即公開）または pending/open での直INSERT の時だけ発火。
  -- pending→open（運営承認）では再処理しない＝trg_job_publish_snapshot と同じ条件
  if new.status in ('pending','open') and (tg_op = 'INSERT' or coalesce(old.status,'draft') = 'draft') then
    -- ①変更の範囲：未選択は「変更なし」に倒す（何も選ばなくても嘘にならない側＝働き手に最も有利な約束）
    new.place_change_scope := coalesce(nullif(btrim(new.place_change_scope), ''), '変更なし');
    new.task_change_scope  := coalesce(nullif(btrim(new.task_change_scope), ''), '変更なし');
    -- ③契約の更新：固定ポリシー（構造上、全求人で答えが1つ。入力欄を作ると間違いを選べてしまうだけ）
    new.contract_renewal := '更新なし（作業期間の満了で契約は終了します。ふたたび働く場合は、新しい応募と募集主の承認による新しい契約になります）';
    -- ④退職に関する事項：標準文（掲載前チェックリストで内容を見せて同意→凍結）
    new.retirement_terms := '契約は作業期間の満了により終了します。期間の途中で辞める場合は、できるだけ早く募集主に申し出てください。無断欠勤が続く場合や、安全のための指示に従わないなど、やむを得ない事由がある場合には、募集主は法令に定める手続きに従って契約を解除することがあります。';
    -- ②労災・雇用保険：プロフィールの申告を凍結（未申告はNULLのまま＝通知書は「記録にありません」と正直に出す。
    --   掲載は止めない＝既存の農家の再掲載を塞がない。必須化するかは別途判断）
    select nullif(btrim(ep.labor_insurance_status), '') into v_lis
      from public.employer_profiles ep where ep.auth_id = new.farmer_id;
    new.labor_insurance_status := v_lis;
  end if;
  return new;
end; $function$;

drop trigger if exists job_publish_zscope on public.jobs;
create trigger job_publish_zscope
  before insert or update on public.jobs
  for each row execute function public.trg_job_publish_zscope();

-- ── jobs_public：末尾に5列追加（今の本番定義を土台＝anonマスクは一切触らない・2026-08-14の教訓） ──
-- 5列とも求人票の明示事項＝訪問者にも見せる（マスク不要）
create or replace view public.jobs_public as
 SELECT j.job_number,
    j.crop,
    j.task,
    j.prefecture,
    j.city,
        CASE
            WHEN COALESCE(auth.role(), 'anon'::text) = 'anon'::text THEN NULL::text
            ELSE j.town
        END AS town,
    j.date_label,
    j.date_start,
    j.date_end,
    j.headcount,
    j.pay_type,
    j.hourly_wage,
    j.daily_wage,
    j.work_time,
    j.break_time,
        CASE
            WHEN COALESCE(auth.role(), 'anon'::text) = 'anon'::text THEN NULL::text
            ELSE j.nearest_station
        END AS nearest_station,
    j.commute_time,
    j.job_exp,
    j.notes,
    j.belongings,
    j.cautions,
    j.danger_places,
    j.danger_tasks,
    j.photos,
    j.created_at,
        CASE
            WHEN COALESCE(auth.role(), 'anon'::text) = 'anon'::text THEN round(j.lat, 2)
            ELSE j.lat
        END AS lat,
        CASE
            WHEN COALESCE(auth.role(), 'anon'::text) = 'anon'::text THEN round(j.lng, 2)
            ELSE j.lng
        END AS lng,
        CASE
            WHEN COALESCE(auth.role(), 'anon'::text) = 'anon'::text THEN
            CASE
                WHEN j.lat IS NULL THEN NULL::integer
                ELSE GREATEST(COALESCE(j.geo_radius_m, 500), 3000)
            END
            ELSE j.geo_radius_m
        END AS geo_radius_m,
    j.full_pay_guarantee,
    j.beginner_ok,
    j.instant_approve_repeat,
    j.opened_at,
    j.perks,
    j.experienced_preferred,
    ( SELECT count(*) AS count
           FROM applications a
          WHERE a.job_number = j.job_number AND a.terms_confirmed_worker_at IS NOT NULL AND a.terms_confirmed_farmer_at IS NOT NULL) AS hired_count,
    ep.nickname AS employer_nickname,
    ep.avatar_url AS employer_avatar_url,
        CASE
            WHEN COALESCE(auth.role(), 'anon'::text) = 'anon'::text THEN NULL::text
            ELSE j.recruiter_name
        END AS recruiter_name,
        CASE
            WHEN COALESCE(auth.role(), 'anon'::text) = 'anon'::text THEN NULL::text
            ELSE j.recruiter_address
        END AS recruiter_address,
        CASE
            WHEN COALESCE(auth.role(), 'anon'::text) = 'anon'::text THEN NULL::text
            ELSE j.recruiter_contact
        END AS recruiter_contact,
        CASE
            WHEN COALESCE(auth.role(), 'anon'::text) = 'anon'::text THEN NULL::text
            ELSE j.address
        END AS work_address,
    j.insurance_snapshot,
    j.profile_snapshot_at,
    j.pay_method,
    j.pay_timing,
    j.wage_closing_rule,
    j.holidays,
    j.address IS NOT NULL AND btrim(j.address) <> ''::text AS has_work_address,
    j.overtime_policy,
    j.overtime_detail,
    j.status,
        CASE
            WHEN COALESCE(auth.role(), 'anon'::text) = 'anon'::text THEN array_remove(ARRAY[
            CASE
                WHEN j.town IS NOT NULL AND btrim(j.town) <> ''::text THEN 'town'::text
                ELSE NULL::text
            END,
            CASE
                WHEN j.nearest_station IS NOT NULL AND btrim(j.nearest_station) <> ''::text THEN 'nearest_station'::text
                ELSE NULL::text
            END,
            CASE
                WHEN j.recruiter_name IS NOT NULL AND btrim(j.recruiter_name) <> ''::text THEN 'recruiter_name'::text
                ELSE NULL::text
            END,
            CASE
                WHEN j.recruiter_address IS NOT NULL AND btrim(j.recruiter_address) <> ''::text THEN 'recruiter_address'::text
                ELSE NULL::text
            END,
            CASE
                WHEN j.recruiter_contact IS NOT NULL AND btrim(j.recruiter_contact) <> ''::text THEN 'recruiter_contact'::text
                ELSE NULL::text
            END], NULL::text)
            ELSE ARRAY[]::text[]
        END AS masked_fields,
    j.place_change_scope,
    j.task_change_scope,
    j.contract_renewal,
    j.retirement_terms,
    j.labor_insurance_status
   FROM jobs j
     LEFT JOIN employer_profiles ep ON ep.auth_id = j.farmer_id
  WHERE (j.status = 'open'::text OR j.status = 'closed'::text AND j.headcount IS NOT NULL AND j.headcount > 0 AND (( SELECT count(*) AS count
           FROM applications a
          WHERE a.job_number = j.job_number AND a.terms_confirmed_worker_at IS NOT NULL AND a.terms_confirmed_farmer_at IS NOT NULL)) >= j.headcount) AND j.unlisted_reason IS NULL AND NOT is_account_moderated(j.farmer_id);

-- ビューはSELECT専用（2026-07-19規則）
revoke all on public.jobs_public from anon, authenticated;
grant select on public.jobs_public to anon, authenticated;

-- ── admin_preview_job：jobs_public に列を足したら同数・同順で連動更新（2026-07-22ルール・42P13の予防） ──
create or replace function public.admin_preview_job(p_job_number integer)
 returns setof jobs_public
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not exists (select 1 from public.app_admins a where a.auth_id = auth.uid()) then
    return;
  end if;
  return query
    select j.job_number, j.crop, j.task, j.prefecture, j.city, j.town,
           j.date_label, j.date_start, j.date_end, j.headcount,
           j.pay_type, j.hourly_wage, j.daily_wage, j.work_time, j.break_time,
           j.nearest_station, j.commute_time, j.job_exp, j.notes, j.belongings, j.cautions,
           j.danger_places, j.danger_tasks, j.photos, j.created_at,
           j.lat, j.lng, j.geo_radius_m,
           j.full_pay_guarantee, j.beginner_ok, j.instant_approve_repeat,
           j.opened_at, j.perks, j.experienced_preferred,
           (select count(*) from public.applications a
             where a.job_number = j.job_number
               and a.terms_confirmed_worker_at is not null
               and a.terms_confirmed_farmer_at is not null) as hired_count,
           ep.nickname, ep.avatar_url,
           j.recruiter_name, j.recruiter_address, j.recruiter_contact, j.address,
           j.insurance_snapshot, j.profile_snapshot_at,
           j.pay_method, j.pay_timing, j.wage_closing_rule,
           j.holidays,
           (j.address is not null and btrim(j.address) <> ''),
           j.overtime_policy, j.overtime_detail,
           j.status,
           array[]::text[],
           j.place_change_scope,
           j.task_change_scope,
           j.contract_renewal,
           j.retirement_terms,
           j.labor_insurance_status
      from public.jobs j
      left join public.employer_profiles ep on ep.auth_id = j.farmer_id
     where j.job_number = p_job_number;
end;
$function$;
