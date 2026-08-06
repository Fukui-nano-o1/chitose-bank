-- さがすに「終了した求人」を並べる（2026-08-05たきと指示「さがすページに復元を」＝一覧にも
-- 「終了」として並べる）。過去の求人は消さない方針（同日）の表示側。
--
-- 【変更】jobs_public の対象を status='open' → ('open','closed') に広げ、末尾に status 列を足す。
--   ・closed＝掲載が終わった求人（最終作業日超過の自動クローズ・従来の終わり方）。
--   ・draft／pending は従来どおり出さない（未掲載・審査中は公開面に出さない・法務境界は不変）。
--   ・is_account_moderated の除外も従来どおり。anon へのマスク（町域・募集主・番地）も不変。
--
-- 【なぜ列を足すか】画面が「募集中か終了か」を判別するため。これまでは
--   「jobs_public に無い＝終了」で代用していたが、終了も返すようになるとその代用が使えない。
--
-- 【連動（2026-07-22・2026-07-31のルール）】RETURNS SETOF jobs_public の関数は列を同数・同順に
--   合わせる。employer_public_jobs は select jp.* so自動追従。admin_preview_job だけは列を
--   列挙しているので、ここで status を末尾に足す（合わせ忘れると呼び出し時に 42P13 で全滅する）。
--
-- 【呼び出し側の注意】「jobs_public にあれば募集中」という前提だった箇所は、
--   status='open' の条件を明示すること（さがす箱の件数・玄関の帯）。フロント側で対応済み。

create or replace view public.jobs_public as
 select j.job_number,
    j.crop,
    j.task,
    j.prefecture,
    j.city,
    case when coalesce(auth.role(), 'anon') = 'anon' then null::text else j.town end as town,
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
    (select count(*) from public.applications a
      where a.job_number = j.job_number
        and a.terms_confirmed_worker_at is not null
        and a.terms_confirmed_farmer_at is not null) as hired_count,
    ep.nickname as employer_nickname,
    ep.avatar_url as employer_avatar_url,
    case when coalesce(auth.role(), 'anon') = 'anon' then null::text else j.recruiter_name end as recruiter_name,
    case when coalesce(auth.role(), 'anon') = 'anon' then null::text else j.recruiter_address end as recruiter_address,
    case when coalesce(auth.role(), 'anon') = 'anon' then null::text else j.recruiter_contact end as recruiter_contact,
    case when coalesce(auth.role(), 'anon') = 'anon' then null::text else j.address end as work_address,
    j.insurance_snapshot,
    j.profile_snapshot_at,
    j.pay_method,
    j.pay_timing,
    j.wage_closing_rule,
    j.holidays,
    (j.address is not null and btrim(j.address) <> ''::text) as has_work_address,
    j.overtime_policy,
    j.overtime_detail,
    j.status                                    -- ★末尾に追加（open / closed）
   from public.jobs j
     left join public.employer_profiles ep on ep.auth_id = j.farmer_id
  where j.status in ('open','closed') and not public.is_account_moderated(j.farmer_id);

-- ビューはSELECT専用（2026-07-19の規則）。CREATE OR REPLACE では権限は引き継がれるが、明示しておく
revoke all on public.jobs_public from anon, authenticated;
grant select on public.jobs_public to anon, authenticated;

-- 列を足したので、列を列挙している唯一の関数を同数・同順に合わせる（末尾に j.status）
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
           j.status
      from public.jobs j
      left join public.employer_profiles ep on ep.auth_id = j.farmer_id
     where j.job_number = p_job_number;
end;
$function$;
