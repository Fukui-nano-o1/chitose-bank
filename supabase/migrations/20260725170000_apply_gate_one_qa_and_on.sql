-- 応募時プロフィールゲートの調整＋発火（2026-07-25たきと指示）。
-- ①必要条件を「お名前＋経験の質問1つ」に（従来はQ&A5問。編集ページのはじめのガイドと一致させる。
--   顔写真は義務化解除済み＝条件に含めない）
-- ②app_settings.apply_profile_gate を 'true' に＝サーバー側ゲートを発火開始
--   （従来falseで素通りだった。フロントのソフトゲートは従来どおり＝空プロフィールに一呼吸置かせるだけ）
create or replace function public.apply_to_job(p_job_number integer, p_available_dates jsonb default null)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_worker_id uuid; v_farmer_id uuid; v_status text; v_app_id uuid;
  v_nickname text; v_qa_count int := 0; v_under_review boolean; v_revision boolean;
  v_date_start date; v_date_end date; v_is_period boolean; v_avail jsonb;
begin
  v_worker_id := auth.uid();
  if v_worker_id is null then return json_build_object('ok', false, 'reason', 'not_logged_in'); end if;
  if public.is_account_moderated(v_worker_id) then
    return json_build_object('ok', false, 'reason', 'account_suspended');
  end if;

  select farmer_id, status, date_start, date_end into v_farmer_id, v_status, v_date_start, v_date_end from public.jobs where job_number = p_job_number;
  if v_farmer_id is null then return json_build_object('ok', false, 'reason', 'job_not_found'); end if;
  if v_status <> 'open' then return json_build_object('ok', false, 'reason', 'job_not_open'); end if;
  if v_farmer_id = v_worker_id then return json_build_object('ok', false, 'reason', 'own_job'); end if;

  -- 期間求人（date_end有り・単日でない）は「来られる日」の宣言が必須。単日求人は null で従来どおり
  v_is_period := v_date_end is not null and v_date_end <> v_date_start;
  if v_is_period then
    if p_available_dates is null
       or not (p_available_dates = '"any"'::jsonb
               or (jsonb_typeof(p_available_dates) = 'array' and jsonb_array_length(p_available_dates) > 0)) then
      return json_build_object('ok', false, 'reason', 'dates_required');
    end if;
    v_avail := p_available_dates;
  else
    v_avail := null;
  end if;

  select (coalesce(btrim(wp.pr_pending),'') <> ''
          or jsonb_array_length(coalesce(wp.pr_qa_pending,'[]'::jsonb)) > 0),
         wp.pr_submitted_at is null
    into v_under_review, v_revision
    from public.worker_profiles wp where wp.auth_id = v_worker_id;
  if coalesce(v_under_review, false) then
    return json_build_object('ok', false, 'reason', 'profile_under_review', 'revision', coalesce(v_revision, false));
  end if;

  if exists (select 1 from public.app_settings where key = 'apply_profile_gate' and value = 'true') then
    select wp.nickname,
           coalesce((select count(*) from jsonb_array_elements(coalesce(wp.pr_qa,'[]'::jsonb)) e
                      where btrim(coalesce(e->>'a','')) <> ''), 0)
      into v_nickname, v_qa_count
      from public.worker_profiles wp where wp.auth_id = v_worker_id;
    if coalesce(btrim(v_nickname),'') = '' or v_qa_count < 1 then
      return json_build_object('ok', false, 'reason', 'profile_incomplete',
        'has_nickname', coalesce(btrim(v_nickname),'') <> '', 'qa_answered', v_qa_count, 'qa_required', 1);
    end if;
  end if;

  insert into public.applications (job_number, worker_id, farmer_id, status, available_dates)
  values (p_job_number, v_worker_id, v_farmer_id, 'applied', v_avail)
  on conflict (job_number, worker_id) do nothing
  returning id into v_app_id;
  if v_app_id is null then return json_build_object('ok', true, 'already', true); end if;

  begin
    insert into public.messages (application_id, sender_id, body)
    values (v_app_id, v_worker_id, 'あなたの求人に応募しました！プロフィールの確認をお願いします。');
    if exists (select 1 from public.applications a where a.id = v_app_id and a.status = 'approved') then
      insert into public.messages (application_id, sender_id, body)
      values (v_app_id, v_farmer_id, '🌟リピート即決の設定により、応募を自動で承認しました（採用ではありません）。チャットで打ち合わせを進めましょう。');
    end if;
  exception when others then null; end;

  return json_build_object('ok', true, 'application_id', v_app_id);
end; $function$;

insert into public.app_settings (key, value) values ('apply_profile_gate', 'true')
on conflict (key) do update set value = 'true';
