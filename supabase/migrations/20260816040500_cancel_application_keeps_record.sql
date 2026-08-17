-- 応募の取り消しを「行の削除」から「取り消しの記録」に（2026-08-16たきと報告
-- 「応募の取り消しができない。messages are immutable history」の根治）
--
-- 【原因】apply_to_job が応募直後にチャットへ自動メッセージを入れるようになり（2026-08-15〜）、
-- cancel_application の DELETE が messages のCASCADE削除→凍結トリガー
-- （trg_messages_history_lock_del・2026-07-19絶対遵守）に必ず当たって失敗していた。
-- 【方針】削除をやめる：status='canceled'＋canceled_at で記録として残す
-- （行動記録の憲法・未カバー(4)「取消の経緯」の実装でもある。チャット履歴も自然に守られる）。
-- 再応募は従来どおり可能にする＝UNIQUEを「取り消し済みを除く部分ユニーク」に置き換える。
-- 綴りは既存フロントの過去の応募フィルタに合わせ 'canceled'（L1つ）で統一。

-- 1) status の値域に 'canceled' を追加
alter table public.applications drop constraint applications_status_check;
alter table public.applications add constraint applications_status_check
  check (status = any (array['applied','approved','meeting','interview','contracted','working',
                             'completed','rejected','expired','canceled']));

-- 2) 取り消しの時刻（アクション＝タイムスタンプ）
alter table public.applications add column if not exists canceled_at timestamptz;
comment on column public.applications.canceled_at is '働き手が応募を取り消した時刻（status=canceled とセット）';

-- 3) UNIQUE(job_number, worker_id) → 取り消し済みを除く部分ユニーク
--    （取り消し→再応募の流れを従来どおり可能に。rejected/expiredは従来どおり再応募を塞ぐ＝挙動不変）
alter table public.applications drop constraint applications_job_number_worker_id_key;
create unique index applications_job_worker_active_key
  on public.applications (job_number, worker_id) where status <> 'canceled';

-- 4) apply_to_job：ON CONFLICT の照合先を部分ユニークに合わせる（他は不変・全文再掲）
create or replace function public.apply_to_job(p_job_number integer, p_available_dates jsonb default null::jsonb)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_worker_id uuid; v_farmer_id uuid; v_status text; v_app_id uuid;
  v_nickname text; v_qa_count int := 0;
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
  -- 求人者(農家)が停止・追放中なら、その求人は募集終了として扱う（2026-08-16）
  if public.is_account_moderated(v_farmer_id) then return json_build_object('ok', false, 'reason', 'job_not_open'); end if;
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

  -- ★(a) 自由記述の審査待ち（pr_pending / pr_qa_pending）では応募を止めない。
  --   未承認の本文は農家に見えない（worker_profile_for_farmer が under_review を返す）＝公開はしていない。
  --   審査を「応募の関所」にすると、承認があるまで応募できず、待っている間の保存で審査がやり直しになる。

  if exists (select 1 from public.app_settings where key = 'apply_profile_gate' and value = 'true') then
    -- ★(b) 答えの数は「承認済み(pr_qa)＋審査待ち(pr_qa_pending)」で数える＝本人が答えた事実を見る。
    --   同じ質問に両方あっても二重に数えない（質問文で重複を除く）
    select wp.nickname,
           coalesce((select count(distinct e->>'q')
                       from jsonb_array_elements(
                              coalesce(wp.pr_qa, '[]'::jsonb) || coalesce(wp.pr_qa_pending, '[]'::jsonb)) e
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
  on conflict (job_number, worker_id) where status <> 'canceled' do nothing
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

-- 5) app_phase：'canceled' をそのまま返す（フロントの appPhaseKey と必ず両方揃える・2026-08-07規則）
create or replace function public.app_phase(a applications)
returns text
language sql
immutable parallel safe
as $function$
  select case
    when a.status in ('applied','rejected','expired','completed','working','canceled') then a.status
    when a.terms_confirmed_worker_at is not null and a.terms_confirmed_farmer_at is not null then 'contracted'
    else 'interview'
  end
$function$;

-- 6) cancel_application：削除→記録（通知・農家メールは従来どおり。取り消しの事実はチャットにも投函）
create or replace function public.cancel_application(p_application_id uuid)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_worker uuid; v_farmer uuid; v_status text; v_job int; v_name text;
begin
  select worker_id, farmer_id, status, job_number into v_worker, v_farmer, v_status, v_job
    from public.applications where id = p_application_id;
  if v_worker is null then return json_build_object('ok', false, 'reason','not_found'); end if;
  if v_worker <> auth.uid() then return json_build_object('ok', false, 'reason','not_yours'); end if;
  if v_status = 'canceled' then return json_build_object('ok', true, 'already', true); end if;
  if v_status <> 'applied' then
    return json_build_object('ok', false, 'reason','already_decided', 'status', v_status);
  end if;
  update public.applications
     set status = 'canceled', canceled_at = now()
   where id = p_application_id;
  begin
    insert into public.messages (application_id, sender_id, body)
    values (p_application_id, v_worker, '応募を取り消しました。');
  exception when others then null; end;
  v_name := public.resolve_actor_name(v_worker);
  insert into public.notifications (farmer_id, type, message)
  values (v_farmer, 'application_cancelled',
          '応募が取り消されました：求人 #' || v_job || '　' || v_name || 'さん');
  begin
    perform public.send_user_email(v_farmer,
      '[chitose-bank] 応募の取り消し：求人 #' || v_job,
      '■ ' || public.job_ref(v_job,'farmer') || E'\n\n' ||
      v_name || 'さんが応募を取り消しました。' || E'\n' ||
      '（承認前の取り消しのため、対応は不要です）' || public.job_link(v_job));
  exception when others then null; end;
  return json_build_object('ok', true);
end; $function$;

-- 7) my_job_actions：同じ求人に「取り消し済み＋再応募」が並んだ時は最新の応募だけ返す
--    （ステータスページは求人1件=カード1枚・React keyもjob_number＝重複行を作らない）
drop function if exists public.my_job_actions();
create function public.my_job_actions()
returns table(
  job_number integer,
  crop text,
  task text,
  photos jsonb,
  date_start date,
  date_end date,
  town text,
  job_status text,
  liked boolean,
  application_id uuid,
  application_status text,
  applied_at timestamptz,
  terms_confirmed_worker_at timestamptz,
  terms_confirmed_farmer_at timestamptz,
  available_dates jsonb,
  agreed_dates jsonb,
  rejected_reason text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select distinct on (j.job_number)
    j.job_number, j.crop, j.task, j.photos, j.date_start, j.date_end, j.town, j.status as job_status,
    (s.job_number is not null) as liked,
    a.id as application_id, a.status as application_status, a.created_at as applied_at,
    a.terms_confirmed_worker_at, a.terms_confirmed_farmer_at, a.available_dates, a.agreed_dates,
    a.rejected_reason
  from public.jobs j
  left join public.saved_jobs   s on s.job_number = j.job_number and s.worker_id = auth.uid()
  left join public.applications a on a.job_number = j.job_number and a.worker_id = auth.uid()
  where auth.uid() is not null
    and j.farmer_id <> auth.uid()
    and (s.job_number is not null or a.id is not null)
  order by j.job_number desc, a.created_at desc nulls last;
$function$;

revoke all on function public.my_job_actions() from public, anon;
grant execute on function public.my_job_actions() to authenticated;
