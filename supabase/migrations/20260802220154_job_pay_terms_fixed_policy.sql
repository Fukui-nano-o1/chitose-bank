-- 賃金支払条件の構造化保存（2026-08-02たきと指示）：
-- 求人画面でハードコード文言として一律表示していた固定支払ポリシー
-- （賃金締切=各作業日／支払時期=各作業日の作業終了後／支払方法=現金手渡し）を、
-- 掲載申請時の確定条件として jobs へ保存し、公開求人〜契約スナップショットまで一気通貫で保持する。
-- 入力UIは解禁しない（封印中の payTiming/payMethod state・「相談して決める」は正式な選択肢として扱わない）。
-- 内部値は現在使用する3つのみ：pay_method='cash'／pay_timing='same_day_after_work'／
-- wage_closing_rule='each_workday'。weekly/monthly/bank_transfer/consult/undecided/other は定義しない
-- （将来必要になった時点で、具体的な締切日・支払日・同意処理を含めて別途設計する）。

-- ① 列追加（enumは使わず text＋CHECK。値域は現行の固定値のみ・NULLはdraft/closed用に許容）
alter table public.jobs
  add column if not exists pay_method text,
  add column if not exists pay_timing text,
  add column if not exists wage_closing_rule text;

alter table public.jobs drop constraint if exists jobs_pay_method_check;
alter table public.jobs add constraint jobs_pay_method_check
  check (pay_method is null or pay_method = 'cash');
alter table public.jobs drop constraint if exists jobs_pay_timing_check;
alter table public.jobs add constraint jobs_pay_timing_check
  check (pay_timing is null or pay_timing = 'same_day_after_work');
alter table public.jobs drop constraint if exists jobs_wage_closing_rule_check;
alter table public.jobs add constraint jobs_wage_closing_rule_check
  check (wage_closing_rule is null or wage_closing_rule = 'each_workday');

-- ② 掲載時スナップショットトリガーを改名＋拡張：trg_job_recruiter_info → trg_job_publish_snapshot
--    （中身は募集者3項目＋待遇perks＋保険snapshot＋支払条件3列＝「掲載時スナップショット」なので名実を一致させる。
--      改名による機能変更はなし。依存＝jobsのトリガーのみ（確認済み）。trg_require_recruiter_info は不変）
create or replace function public.trg_job_publish_snapshot()
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
    -- 賃金支払条件の確定（2026-08-02）：現在は全求人固定ポリシー。
    -- フロントから別値が送られても、この3値へ確定する（入力UIは封印中・固定ポリシーの宣言をデータ化）
    new.pay_method := 'cash';
    new.pay_timing := 'same_day_after_work';
    new.wage_closing_rule := 'each_workday';
  end if;
  return new;
end; $function$;

drop trigger if exists job_recruiter_info on public.jobs;
drop trigger if exists job_publish_snapshot on public.jobs;
create trigger job_publish_snapshot
  before insert or update on public.jobs
  for each row execute function public.trg_job_publish_snapshot();
drop function if exists public.trg_job_recruiter_info();

-- ③ バックフィル：既存の open/pending 求人で既に画面表示されていた固定支払ポリシー
--    （「支払方法：当日現金手渡し」「お支払いは現金手渡し、作業当日のお支払い」の注記）を、
--    構造化された求人条件として保存する移行である（推測補完ではなく表示済み事実の転記）。
--    closed 6件・draft 7件・既存 applications.terms_snapshot 2件は変更しない。冪等
update public.jobs
   set pay_method = 'cash',
       pay_timing = 'same_day_after_work',
       wage_closing_rule = 'each_workday'
 where status in ('pending','open')
   and (pay_method is null or pay_timing is null or wage_closing_rule is null);

-- ④ pending/open の必須をCHECK制約で担保（既存 jobs_publish_snapshot_check を拡張。
--    draft/closed の NULL は許容する部分条件のまま）
alter table public.jobs drop constraint if exists jobs_publish_snapshot_check;
alter table public.jobs add constraint jobs_publish_snapshot_check check (
  status not in ('pending','open')
  or (
    perks is not null
    and insurance_snapshot is not null
    and coalesce(btrim(recruiter_name), '') <> ''
    and coalesce(btrim(recruiter_address), '') <> ''
    and coalesce(btrim(recruiter_contact), '') <> ''
    and pay_method = 'cash'
    and pay_timing = 'same_day_after_work'
    and wage_closing_rule = 'each_workday'
  )
);

-- ⑤ jobs_public へ3列を末尾追加（公開求人条件ので anonマスクなし＝従来のマスク対象
--    town/recruiter_*/work_address は不変）。admin_preview_job も同数・同順で更新（2026-07-22ルール）。
--    employer_public_jobs は select jp.* のため自動追従（変更不要・確認済み）
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
    j.profile_snapshot_at,
    j.pay_method,
    j.pay_timing,
    j.wage_closing_rule
   FROM jobs j
     LEFT JOIN employer_profiles ep ON ep.auth_id = j.farmer_id
  WHERE j.status = 'open'::text AND NOT is_account_moderated(j.farmer_id);

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
           j.pay_method, j.pay_timing, j.wage_closing_rule
      from public.jobs j
      left join public.employer_profiles ep on ep.auth_id = j.farmer_id
     where j.job_number = p_job_number;
end;
$function$;
