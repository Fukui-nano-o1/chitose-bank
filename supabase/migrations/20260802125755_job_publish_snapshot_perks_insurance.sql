-- 掲載時スナップショット強化（2026-08-02たきと指示）：公開求人の待遇・保険が
-- employer_profiles の現在値をライブ参照していた問題の根治。
-- ① jobs に insurance_snapshot / profile_snapshot_at を追加
-- ② 転写トリガー trg_job_recruiter_info を拡張：
--    ・BEFORE INSERT OR UPDATE 化（従来はUPDATEのみ＝INSERT直pendingで転写されない穴の補完）
--    ・draft→pending/open 遷移時（またはpending/openでの直INSERT時）に、募集者3項目に加えて
--      待遇 perks（プロフィール10項目を土台に求人固有上書きを重ねた合成・NULLを残さない）と
--      保険 insurance_snapshot（items/notes/snapshot_at）・profile_snapshot_at を確定保存
--    ・pending→open（運営承認）では再取得しない＝申請時の値を維持（従来どおり）
-- ③ 既存 pending/open をバックフィル（closed/draft は触らない・推測補完しない・冪等）
-- ④ jobs_public に insurance_snapshot / profile_snapshot_at を末尾追加。
--    RETURNS SETOF jobs_public の admin_preview_job を同数・同順で更新（2026-07-22ルール）。
--    employer_public_jobs は select jp.* のため自動追従（定義確認済み・変更不要）
-- ⑤ pending/open の必須（perks・insurance_snapshot・募集者3項目）をCHECK制約で担保
--    （部分条件＝closed/draft の NULL は許容。既存行の適合はバックフィル後に検証してから追加）
-- ※ applications.terms_snapshot は to_jsonb(jobs行) 凍結（confirm_terms）のため、新規契約には
--    perks/insurance_snapshot/profile_snapshot_at が自動で含まれる。既存 terms_snapshot は一切触らない。

-- ① 列追加
alter table public.jobs
  add column if not exists insurance_snapshot jsonb,
  add column if not exists profile_snapshot_at timestamptz;

-- ② 転写トリガー拡張
create or replace function public.trg_job_recruiter_info()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_ep public.employer_profiles%rowtype;
begin
  -- draft→pending/open（掲載申請）または pending/open での直INSERT の時だけ発火。
  -- pending→open（運営承認）では再取得しない＝申請時の内容を維持
  if new.status in ('pending','open') and (tg_op = 'INSERT' or coalesce(old.status,'draft') = 'draft') then
    select * into v_ep from public.employer_profiles where auth_id = new.farmer_id;
    if coalesce(btrim(v_ep.recruiter_name),'') = '' or coalesce(btrim(v_ep.recruiter_address),'') = ''
       or coalesce(btrim(v_ep.recruiter_contact),'') = '' then
      raise exception '募集主の氏名（名称）・住所・連絡先の入力が必要です（求人広告の法定表示事項）';
    end if;
    if coalesce(btrim(new.address),'') = '' then
      raise exception '就業場所（番地まで）の入力が必要です（求人広告の法定表示事項）';
    end if;
    new.recruiter_name := v_ep.recruiter_name;
    new.recruiter_address := v_ep.recruiter_address;
    new.recruiter_contact := v_ep.recruiter_contact;
    -- 待遇の確定：プロフィール10項目を土台に、求人固有の上書き（new.perks）を重ねて全キー保存。
    -- 以後プロフィールを変えてもこの求人の待遇は変わらない。
    -- 自由記述3項目は承認済みの列値のみ（texts_pending＝審査中の文は入らない・憲法5条）
    new.perks := jsonb_build_object(
      'has_transport', coalesce(v_ep.has_transport, false),
      'transport_area', coalesce(v_ep.transport_area, ''),
      'has_parking', coalesce(v_ep.has_parking, false),
      'parking_capacity', v_ep.parking_capacity,
      'has_commute_allowance', coalesce(v_ep.has_commute_allowance, false),
      'commute_allowance_detail', coalesce(v_ep.commute_allowance_detail, ''),
      'has_bonus', coalesce(v_ep.has_bonus, false),
      'employer_pays_supplies', coalesce(v_ep.employer_pays_supplies, false),
      'supplies_cap', coalesce(v_ep.supplies_cap, ''),
      'accessory_ok', coalesce(v_ep.accessory_ok, false)
    ) || coalesce(new.perks, '{}'::jsonb);
    -- 保険の確定：申請時点のプロフィール保険を凍結（空でも {items:[]} を保存＝申請時点で申告なしの記録）
    new.insurance_snapshot := jsonb_build_object(
      'items', coalesce(v_ep.insurance_items, '[]'::jsonb),
      'notes', coalesce(v_ep.insurance_notes, '{}'::jsonb),
      'snapshot_at', now()
    );
    new.profile_snapshot_at := now();
  end if;
  return new;
end; $function$;

drop trigger if exists job_recruiter_info on public.jobs;
create trigger job_recruiter_info
  before insert or update on public.jobs
  for each row execute function public.trg_job_recruiter_info();

-- ③ バックフィル（pending/open のみ・profile_snapshot_at が無い行だけ＝冪等。closed/draft は不変）
update public.jobs j
   set perks = jsonb_build_object(
         'has_transport', coalesce(ep.has_transport, false),
         'transport_area', coalesce(ep.transport_area, ''),
         'has_parking', coalesce(ep.has_parking, false),
         'parking_capacity', ep.parking_capacity,
         'has_commute_allowance', coalesce(ep.has_commute_allowance, false),
         'commute_allowance_detail', coalesce(ep.commute_allowance_detail, ''),
         'has_bonus', coalesce(ep.has_bonus, false),
         'employer_pays_supplies', coalesce(ep.employer_pays_supplies, false),
         'supplies_cap', coalesce(ep.supplies_cap, ''),
         'accessory_ok', coalesce(ep.accessory_ok, false)
       ) || coalesce(j.perks, '{}'::jsonb),
       insurance_snapshot = jsonb_build_object(
         'items', coalesce(ep.insurance_items, '[]'::jsonb),
         'notes', coalesce(ep.insurance_notes, '{}'::jsonb),
         'snapshot_at', now()
       ),
       profile_snapshot_at = now()
  from public.employer_profiles ep
 where ep.auth_id = j.farmer_id
   and j.status in ('pending','open')
   and j.profile_snapshot_at is null;

-- ④ jobs_public へ2列を末尾追加（既存定義そのまま＋末尾2列。anonマスクは従来どおり
--    town/recruiter_*/work_address のみ。保険は従来から訪問者にも表示している情報so非マスク）
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
    j.nearest_station,
    j.commute_time,
    j.job_exp,
    j.notes,
    j.belongings,
    j.cautions,
    j.danger_places,
    j.danger_tasks,
    j.photos,
    j.created_at,
    j.lat,
    j.lng,
    j.geo_radius_m,
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
    j.profile_snapshot_at
   FROM jobs j
     LEFT JOIN employer_profiles ep ON ep.auth_id = j.farmer_id
  WHERE j.status = 'open'::text AND NOT is_account_moderated(j.farmer_id);

-- ④-2 admin_preview_job：jobs_public と同数・同順に2列追加（2026-07-22ルール）
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
           j.insurance_snapshot, j.profile_snapshot_at
      from public.jobs j
      left join public.employer_profiles ep on ep.auth_id = j.farmer_id
     where j.job_number = p_job_number;
end;
$function$;

-- ⑤ pending/open の必須をCHECK制約で担保（closed/draft のNULLは許容する部分条件）
alter table public.jobs drop constraint if exists jobs_publish_snapshot_check;
alter table public.jobs add constraint jobs_publish_snapshot_check check (
  status not in ('pending','open')
  or (
    perks is not null
    and insurance_snapshot is not null
    and coalesce(btrim(recruiter_name), '') <> ''
    and coalesce(btrim(recruiter_address), '') <> ''
    and coalesce(btrim(recruiter_contact), '') <> ''
  )
);
