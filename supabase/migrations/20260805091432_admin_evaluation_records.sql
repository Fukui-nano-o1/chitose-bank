-- 客観的評価ページ（#/admin/evaluation・管理者専用・2026-08-05）の読み取りRPC。
-- 思想：評価は「記録から導出した事実」と「当事者が申告したはい/いいえ」だけで組み立てる
--   （reviews v1 の思想＝公開＝客観的事実／ランキング・スコア・レコメンドには使わない＝事実の陳列まで）。
-- 職安法ガード：運営の主観（評価・印象・おすすめ度）は返さない。順位も点数も算出しない。
-- プライバシー：自由記述（reviews.public_comment＝働きぶり／private_memo＝本人だけのメモ）は
--   意図的に返さない。private_memo は「あなた以外には表示されません」と本人に約束している列ので、
--   管理RPCで覗ける形にしない（SECURITY DEFINER はRLSを通り抜けるため、ここで明示的に外す）。
-- 読み取り専用（書き込みは一切しない）。admin_working_jobs と同型：app_admins ゲート＋当事者名を返す。
create or replace function public.admin_evaluation_records()
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_records json;
begin
  if not exists (select 1 from public.app_admins a where a.auth_id = auth.uid()) then
    return json_build_object('ok', false, 'reason', 'not_admin');
  end if;

  select coalesce(json_agg(row order by ord desc nulls last), '[]'::json) into v_records
  from (
    select
      json_build_object(
        'application_id', a.id,
        'job_number', a.job_number,
        'status', a.status,
        'worker_id', a.worker_id,
        'farmer_id', a.farmer_id,
        'worker_name', wp.nickname,
        'farmer_name', ep.nickname,
        'crop', j.crop,
        'task', j.task,
        'prefecture', j.prefecture,
        'city', j.city,
        'date_label', j.date_label,
        'date_start', j.date_start,
        'date_end', j.date_end,
        'agreed_dates', a.agreed_dates,
        -- ① 記録から導出した事実（誰の意見でもない・打刻と操作の時刻そのもの）
        'hired_at', to_char(greatest(a.terms_confirmed_worker_at, a.terms_confirmed_farmer_at) at time zone 'Asia/Tokyo','YYYY/MM/DD HH24:MI'),
        'insurance_prepared_at', to_char(a.insurance_prepared_at at time zone 'Asia/Tokyo','YYYY/MM/DD HH24:MI'),
        'started_at', to_char(a.started_at at time zone 'Asia/Tokyo','YYYY/MM/DD HH24:MI'),
        'farmer_confirmed_start_at', to_char(a.farmer_confirmed_start_at at time zone 'Asia/Tokyo','YYYY/MM/DD HH24:MI'),
        'work_completed_at', to_char(a.work_completed_at at time zone 'Asia/Tokyo','YYYY/MM/DD HH24:MI'),
        'worker_confirmed_end_at', to_char(a.worker_confirmed_end_at at time zone 'Asia/Tokyo','YYYY/MM/DD HH24:MI'),
        'attended', a.attended,
        'auto_started', a.auto_started,
        'started_declared', a.started_declared,
        'ended_declared', a.ended_declared,
        'auto_completed', a.auto_completed,
        'time_corrected', a.time_corrected,
        'worked_minutes', case
          when a.started_at is not null and a.work_completed_at is not null
          then round(extract(epoch from (a.work_completed_at - a.started_at)) / 60)::int
          else null end,
        -- ② 当事者が申告した事実（はい/いいえのみ。自由記述は返さない）
        'review_f2w', (
          select json_build_object(
            'at', to_char(r.created_at at time zone 'Asia/Tokyo','YYYY/MM/DD HH24:MI'),
            'on_time', r.on_time,
            'as_described', r.as_described,
            'followed_instructions', r.followed_instructions,
            'completed_work', r.completed_work,
            'entrust', r.entrust,
            'want_again', r.want_again)
          from public.reviews r
          where r.application_id = a.id and r.direction = 'farmer_to_worker'),
        'review_w2f', (
          select json_build_object(
            'at', to_char(r.created_at at time zone 'Asia/Tokyo','YYYY/MM/DD HH24:MI'),
            'on_time', r.on_time,
            'as_described', r.as_described,
            'safety_care', r.safety_care,
            'completed_work', r.completed_work,
            'want_again', r.want_again)
          from public.reviews r
          where r.application_id = a.id and r.direction = 'worker_to_farmer')
      ) as row,
      coalesce(a.work_completed_at, a.started_at,
               greatest(a.terms_confirmed_worker_at, a.terms_confirmed_farmer_at)) as ord
    from public.applications a
    left join public.jobs j on j.job_number = a.job_number
    left join public.worker_profiles wp on wp.auth_id = a.worker_id
    left join public.employer_profiles ep on ep.auth_id = a.farmer_id
    -- 採用（双方の確認）に到達したマッチ以降だけを対象にする。
    -- 応募中・見送り・失効には「働いた記録」が存在しないため、評価の対象にならない
    where a.status in ('working','completed')
       or (a.terms_confirmed_worker_at is not null and a.terms_confirmed_farmer_at is not null)
  ) t;

  return json_build_object('ok', true, 'records', v_records);
end; $function$;

-- 2026-07-19の規則：作った直後に権限を絞る（未ログインからは実行させない）
revoke all on function public.admin_evaluation_records() from public, anon;
grant execute on function public.admin_evaluation_records() to authenticated;
