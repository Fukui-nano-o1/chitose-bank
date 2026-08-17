-- 掲載取り下げの経緯を記録し、農家・働き手の双方へメール（2026-08-08たきと指示
-- 「掲載取り下げにしよう。該当する農家と働き手には取り下げた旨のメール送信。
--   〇〇の求人を取り下げました。説明文。他の求人をさがす下線にリンク添付」）
--
-- 1) applications.rejected_reason 新設＝見送りの経緯メモ（行動記録の憲法・未カバー(4)の一部を実装）。
--    null=従来の見送り（農家の判断・満員）／'unpublished'=掲載取り下げによる自動見送り。
--    書くのはDB関数のみ（クライアントの直接UPDATEは既にRLSで不可・2026-08-07）
-- 2) unpublish_job：見送り時に rejected_reason='unpublished' を刻む＋
--    働き手メールを指示の型に（件名「〇〇の求人を取り下げました」・説明文・
--    HTML本文で「他の求人をさがす」を下線リンクに）＋農家にも取り下げ確認メール1通
-- 3) my_job_actions に rejected_reason を末尾追加（ステータスページの暗幕「掲載取り下げ」用）。
--    RETURNS TABLEの列変更ので DROP→再作成→権限を張り直す

alter table public.applications add column if not exists rejected_reason text;
comment on column public.applications.rejected_reason is
  '見送り(rejected)の経緯。null=農家の判断・満員など従来型／unpublished=掲載取り下げによる自動見送り。DB関数のみが書く';

create or replace function public.unpublish_job(p_job_number integer)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_count int;
  v_ref text;
  v_title text;
  v_crop text;
  v_task text;
  v_closed uuid[] := '{}';
  r record;
  esc_ref text;
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
     and status = 'open'
  returning crop, task into v_crop, v_task;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    return json_build_object('ok', false, 'reason', 'not_found_or_not_open');
  end if;

  v_title := trim(coalesce(v_crop, '') || ' ' || coalesce(v_task, ''));
  if v_title = '' then v_title := '求人 #' || p_job_number; end if;
  v_ref := public.job_ref(p_job_number, 'worker');
  -- HTMLメールに差し込む値は必ずエスケープ（農園名等は利用者の自由入力＝HTML注入を防ぐ）
  esc_ref := replace(replace(replace(coalesce(v_ref, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');

  for r in
    select a.id, a.worker_id from public.applications a
     where a.job_number = p_job_number
       and public.app_phase(a) in ('applied','interview')
  loop
    update public.applications
       set status = 'rejected', decided_at = coalesce(decided_at, now()), rejected_reason = 'unpublished'
     where id = r.id;
    v_closed := v_closed || r.id;
    begin
      insert into public.messages (application_id, sender_id, body)
      values (r.id, auth.uid(),
        'この求人は、募集主が掲載を取り下げたため募集を終了しました。' ||
        'ご応募いただいたのに、お力になれずすみません。またの機会によろしくお願いします。');
    exception when others then null; end;
    begin
      insert into public.notifications (farmer_id, type, message)
      values (r.worker_id, 'application_declined',
              '求人 #' || p_job_number || '：掲載が取り下げられたため募集を終了しました。今回はご縁がありませんでした');
    exception when others then null; end;
    begin
      perform public.send_user_email(r.worker_id,
        '[chitose-bank] 「' || v_title || '」の求人を取り下げました',
        '■ ' || v_ref || E'\n\n' ||
        '募集主がこの求人（#' || p_job_number || '）の掲載を取り下げたため、募集は終了になりました。' || E'\n' ||
        'あなたの応募もこれで終了です。選考の結果ではなく、掲載の取り下げによる終了です。' || E'\n' ||
        'ご応募いただき、ありがとうございました。' || E'\n\n' ||
        '他の求人をさがす：https://chitose-bank.com/#/search',
        '<p style="font-size:14px;color:#222;margin:0 0 12px;">■ ' || esc_ref || '</p>' ||
        '<p style="font-size:14px;color:#222;line-height:1.9;margin:0 0 16px;">' ||
        '募集主がこの求人（#' || p_job_number || '）の掲載を取り下げたため、募集は終了になりました。<br>' ||
        'あなたの応募もこれで終了です。選考の結果ではなく、掲載の取り下げによる終了です。<br>' ||
        'ご応募いただき、ありがとうございました。</p>' ||
        '<p style="font-size:14px;margin:0;"><a href="https://chitose-bank.com/#/search" ' ||
        'style="color:#00A86B;text-decoration:underline;font-weight:700;">他の求人をさがす</a></p>');
    exception when others then null; end;
  end loop;

  -- 農家（実行した本人）にも取り下げの確認メールを1通（記録が手元に残る形）
  begin
    perform public.send_user_email(auth.uid(),
      '[chitose-bank] 「' || v_title || '」の求人を取り下げました',
      '■ ' || v_ref || E'\n\n' ||
      '求人（#' || p_job_number || '）を一時非公開（掲載の取り下げ）にしました。さがすには表示されません。' || E'\n' ||
      (case when coalesce(array_length(v_closed, 1), 0) > 0
        then '応募中・面接中だった ' || array_length(v_closed, 1) || ' 件の応募は見送りになり、応募者にお知らせしました。採用が決まっている方はそのままです。'
        else '応募中・面接中の応募はありませんでした。採用が決まっている方はそのままです。' end) || E'\n' ||
      '再掲載するときは、お仕事タブの「作成中」から再開し、もう一度審査を通ります。' || E'\n\n' ||
      'お仕事タブを開く：https://chitose-bank.com/#/profile/employer',
      '<p style="font-size:14px;color:#222;margin:0 0 12px;">■ ' || esc_ref || '</p>' ||
      '<p style="font-size:14px;color:#222;line-height:1.9;margin:0 0 16px;">' ||
      '求人（#' || p_job_number || '）を一時非公開（掲載の取り下げ）にしました。さがすには表示されません。<br>' ||
      (case when coalesce(array_length(v_closed, 1), 0) > 0
        then '応募中・面接中だった ' || array_length(v_closed, 1) || ' 件の応募は見送りになり、応募者にお知らせしました。採用が決まっている方はそのままです。'
        else '応募中・面接中の応募はありませんでした。採用が決まっている方はそのままです。' end) || '<br>' ||
      '再掲載するときは、お仕事タブの「作成中」から再開し、もう一度審査を通ります。</p>' ||
      '<p style="font-size:14px;margin:0;"><a href="https://chitose-bank.com/#/profile/employer" ' ||
      'style="color:#00A86B;text-decoration:underline;font-weight:700;">お仕事タブを開く</a></p>');
  exception when others then null; end;

  return json_build_object('ok', true, 'closed', coalesce(array_length(v_closed, 1), 0));
end;
$function$;

-- my_job_actions：rejected_reason を末尾に追加（RETURNS TABLEの列変更ので DROP→再作成）
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
  select
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
  order by j.job_number desc;
$function$;

revoke all on function public.my_job_actions() from public, anon;
grant execute on function public.my_job_actions() to authenticated;
