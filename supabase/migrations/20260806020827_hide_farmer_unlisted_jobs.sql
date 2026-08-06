-- 農家のアクションで取り下げた求人（一時停止・削除）は公開しない（2026-08-06たきと指示）。
--
-- 【背景】2026-08-05に jobs_public を status='open' → ('open','closed') に広げ、終了した求人も
--   さがすに「募集終了」として並べるようにした。その結果、農家が自分の操作で取り下げた求人まで
--   公開面に出るようになっていた：
--   ・一時停止（unpublish_job）は open → draft so 現状も公開されない（結果は正しい）が、
--     「取り下げた」という事実that記録に残っていなかった。
--   ・削除された4件（#1018・#1026・#1033・#1036）は 2026-08-05 の復元で status='closed' として
--     戻したため、さがす一覧・雇い手プロフィールの「過去の求人」に現れていた。
--     これは農家that消した求人＝公開してよいものではない。
--
-- 【方針】記録から導出する（行動記録の憲法）。「どうして終わったか」を列に持ち、
--   農家の取り下げによるものは公開面（jobs_public）から外す。求人の行自体は消さない
--   ＝はたらいた記録・応募の記録は従来どおり残る（2026-08-05「過去の求人は消さない」は不変）。

-- ① 取り下げの記録（jobs）
alter table public.jobs
  add column if not exists unlisted_at     timestamptz,
  add column if not exists unlisted_reason text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'jobs_unlisted_reason_check') then
    alter table public.jobs add constraint jobs_unlisted_reason_check
      check (unlisted_reason is null or unlisted_reason in ('unpublished','deleted'));
  end if;
end $$;

comment on column public.jobs.unlisted_at is
  '農家自身の操作で公開を取り下げた時刻。分からない場合はNULL（推測で入れない）';
comment on column public.jobs.unlisted_reason is
  '取り下げの理由：unpublished=一時非公開／deleted=削除。NULL＝取り下げていない。'
  'この列that非NULLの求人は jobs_public に出さない＝公開しない';

-- ② 一時非公開のときに取り下げを記録する（従来どおり open → draft も行う）
create or replace function public.unpublish_job(p_job_number integer)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_count int;
begin
  if auth.uid() is null then
    return json_build_object('ok', false, 'reason', 'not_signed_in');
  end if;
  update public.jobs
     set status = 'draft',
         unlisted_at = now(),
         unlisted_reason = 'unpublished'
   where job_number = p_job_number
     and farmer_id = auth.uid()
     and status = 'open';
  get diagnostics v_count = row_count;
  if v_count = 0 then
    return json_build_object('ok', false, 'reason', 'not_found_or_not_open');
  end if;
  return json_build_object('ok', true);
end;
$$;

revoke all on function public.unpublish_job(integer) from public;
revoke all on function public.unpublish_job(integer) from anon;
grant execute on function public.unpublish_job(integer) to authenticated;

-- ③ 再掲載（→open）で取り下げは解除される。掲載中の求人that取り下げ扱いのまま残らないようにする
--    （opened_at を刻む既存トリガーに相乗り＝掲載の瞬間を見ている唯一の場所so、書き忘れthat起きない）
create or replace function public.set_job_opened_at()
returns trigger language plpgsql as $$
begin
  if new.status = 'open' and (tg_op = 'INSERT' or old.status is distinct from 'open') then
    new.opened_at := now();
    new.unlisted_at := null;
    new.unlisted_reason := null;
  end if;
  return new;
end; $$;

-- ④ 削除されて復元した4件に、取り下げの理由を刻む。
--    削除の時刻は記録に残っていないため unlisted_at は NULL のまま（憲法3条：ダミーを入れない）
update public.jobs
   set unlisted_reason = 'deleted'
 where job_number in (1018, 1026, 1033, 1036)
   and unlisted_reason is null;

-- ⑤ 公開面から外す。列の構成は一切変えない（＝RETURNS SETOF jobs_public の
--    admin_preview_job・employer_public_jobs は無改修で追従する。2026-07-22ルール）
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
    j.wage_closing_rule,
    j.holidays,
    j.address IS NOT NULL AND btrim(j.address) <> ''::text AS has_work_address,
    j.overtime_policy,
    j.overtime_detail,
    j.status
   FROM jobs j
     LEFT JOIN employer_profiles ep ON ep.auth_id = j.farmer_id
  WHERE (j.status = ANY (ARRAY['open'::text, 'closed'::text]))
    AND j.unlisted_reason IS NULL          -- ★農家that取り下げた求人は公開しない（status を問わず）
    AND NOT is_account_moderated(j.farmer_id);

-- 権限は従来どおり SELECT のみ（2026-07-19ルール：ビューはSELECT専用）
revoke all on public.jobs_public from anon, authenticated;
grant select on public.jobs_public to anon, authenticated;
