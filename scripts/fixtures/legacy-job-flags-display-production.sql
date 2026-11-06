-- Read-only catalog definitions; no user data.
CREATE OR REPLACE FUNCTION public.approve_application(p_application_id uuid, p_approve boolean)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller uuid; v_farmer uuid; v_worker uuid; v_status text; v_job int; v_new text; v_ref text;
  v_avail jsonb;
  v_link text := 'https://chitose-bank.com/#/profile/worker/approved';
begin
  v_caller := auth.uid();
  if v_caller is null then return json_build_object('ok', false, 'reason', 'not_logged_in'); end if;
  select farmer_id, worker_id, status, job_number, available_dates
    into v_farmer, v_worker, v_status, v_job, v_avail
    from public.applications where id = p_application_id;
  if v_farmer is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_farmer <> v_caller then return json_build_object('ok', false, 'reason', 'not_your_application'); end if;
  if v_status <> 'applied' then return json_build_object('ok', false, 'reason', 'already_decided', 'status', v_status); end if;

  v_new := case when p_approve then 'approved' else 'rejected' end;
  update public.applications
     set status = v_new, decided_at = now(),
         agreed_dates = case when p_approve and v_avail is not null
                              and jsonb_typeof(v_avail) = 'array'
                             then v_avail else agreed_dates end
   where id = p_application_id;
  v_ref := public.job_ref(v_job,'worker');

  if p_approve then
    insert into public.notifications (farmer_id, type, message)
    values (v_worker, 'application_approved',
            '応募が承認されました：求人 #' || v_job || '　チャットで日程を打ち合わせましょう');
    begin
      perform public.send_user_email(v_worker,
        '[chitose-bank] 応募が承認されました：求人 #' || v_job,
        '■ ' || v_ref || E'\n\n' ||
        '応募が承認されました。' ||
        case when v_avail is not null and jsonb_typeof(v_avail) = 'array' then
          E'\nあなたが応募時に選んだ日程で確定しています：' ||
          (select string_agg(to_char(d::date,'MM/DD'), '・' order by d::date)
             from jsonb_array_elements_text(v_avail) d)
        else '' end || E'\n' ||
        'サイト内のチャットで、集合場所などを打ち合わせましょう。' || E'\n\n' ||
        '承認された応募とチャット：' || v_link || public.job_link(v_job));
    exception when others then null; end;
  else
    insert into public.notifications (farmer_id, type, message)
    values (v_worker, 'application_declined',
            '求人 #' || v_job || '：今回はご縁がありませんでした。他の求人もぜひご覧ください');
    begin
      perform public.send_user_email(v_worker,
        '[chitose-bank] 応募の結果について：求人 #' || v_job,
        '■ ' || v_ref || E'\n\n' ||
        '今回はご縁がありませんでした。ご応募ありがとうございました。' || E'\n\n' ||
        '募集の人数や日程の都合による見送りも多くあります。' || E'\n' ||
        'プロフィールを充実させると、承認されやすくなります。' || E'\n\n' ||
        '他の求人を見る：https://chitose-bank.com/#/search');
    exception when others then null; end;
  end if;
  return json_build_object('ok', true, 'status', v_new);
end; $function$
;

CREATE OR REPLACE FUNCTION public.my_farm_jobs()
 RETURNS json
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  with j as (
    select job_number, crop, task, date_label, prefecture, city, pay_type, hourly_wage, daily_wage,
           photos, status, date_start, date_end, work_time, opened_at, holidays,
           headcount, beginner_ok, experienced_preferred, instant_approve_repeat,
           (select count(*) from applications a
              where a.job_number = jobs.job_number
                and a.terms_confirmed_worker_at is not null
                and a.terms_confirmed_farmer_at is not null) as hired_count
    from jobs where farmer_id = auth.uid()
  )
  select json_build_object(
    'jobs', coalesce((select json_agg(to_jsonb(x) order by x.job_number desc) from j x), '[]'::json),
    'q_unanswered', coalesce((select json_object_agg(q.job_number::text, q.cnt) from (
        select job_number, count(*)::int cnt from job_questions
        where job_number in (select job_number from j) and answer is null and hidden = false
        group by job_number) q), '{}'::json)
  );
$function$
;
create view public.jobs_public with (security_invoker=false,security_barrier=true) as  SELECT j.job_number,
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
            WHEN private.can_read_meeting_address(j.job_number) THEN j.address
            ELSE NULL::text
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
    j.labor_insurance_status,
        CASE
            WHEN j.work_video_job_consent IS TRUE THEN j.work_video_url
            ELSE NULL::text
        END AS work_video_url
   FROM jobs j
     LEFT JOIN employer_profiles ep ON ep.auth_id = j.farmer_id
  WHERE (j.status = 'open'::text OR j.status = 'closed'::text AND j.headcount IS NOT NULL AND j.headcount > 0 AND (( SELECT count(*) AS count
           FROM applications a
          WHERE a.job_number = j.job_number AND a.terms_confirmed_worker_at IS NOT NULL AND a.terms_confirmed_farmer_at IS NOT NULL)) >= j.headcount) AND j.unlisted_reason IS NULL AND NOT is_account_moderated(j.farmer_id);


CREATE OR REPLACE FUNCTION public.employer_public_jobs(p_job_number integer)
 RETURNS SETOF jobs_public
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jp.*
    from public.jobs_public jp
   where jp.job_number in (
     select j.job_number from public.jobs j
      where j.farmer_id = (select farmer_id from public.jobs where job_number = p_job_number)
   )
$function$
;