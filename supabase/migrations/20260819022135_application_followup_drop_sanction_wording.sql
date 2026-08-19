-- 応募未回答の督促メールから、規約に根拠のない制裁の予告を削除する（2026-08-19 たきと裁定）。
--
-- 問題：48h/60h/72h のメールが「利用規約に基づく利用制限の審査対象」等と断定していたが、
--   規約に根拠がない。第11条1は利用制限に「本規約に違反した」ことを要件とし、第9条の禁止事項
--   19号に応募への未回答は無い。むしろ第6条2は無応答を「作業開始日に自動失効で処理する」正常な
--   想定内と定めている。メールを成立させるために規約へ禁止事項を足す（B案）は却下された。
-- 方針：制裁の予告を消し、事実＋行動依頼までに落とす。第9条・Terms v2.5・Privacy v4.0は変更しない。
-- 変更しないもの：12/24/36時間の文面、送信時刻（12/24/36/48/60/72）、cron application-followups、
--   督促機能そのもの、新たな制裁制度（作らない）。
-- ★過去のmigrationは編集しない（履歴は歴史）。本migrationで CREATE OR REPLACE する。

create or replace function public.application_followup_mail(p_app uuid, p_stage integer)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $f1$
declare
  v_job int; v_ref text; v_subject text; v_lead text;
  v_link text := 'https://chitose-bank.com/#/profile/employer/applicants';
begin
  select job_number into v_job from public.applications where id = p_app;
  if v_job is null then return null; end if;
  v_ref := public.job_ref(v_job, 'farmer');

  if p_stage = 12 then
    v_subject := '[chitose-bank] 応募への回答をお待ちしています｜12時間経過';
    v_lead := '応募から12時間が経過しました。まだ対応状況が確認できていません。'
           || '応募者が回答を待っています。内容をご確認ください。';
  elsif p_stage = 24 then
    v_subject := '[chitose-bank]【要対応】応募から24時間が経過しています';
    v_lead := '応募から24時間が経過しました。応募者への回答が確認できていません。'
           || '承認・見送り・保留・対応済みのいずれかを選択してください。';
  elsif p_stage = 36 then
    v_subject := '[chitose-bank]【要対応】36時間未回答です｜ご対応ください';
    v_lead := '応募から36時間が経過しています。現在も回答が確認できていません。'
           || '応募者を長時間待たせる状態となっています。速やかに対応状況を更新してください。';
  elsif p_stage = 48 then
    v_subject := '[chitose-bank]【重要】48時間未回答です｜早急にご対応ください';
    v_lead := '応募から48時間が経過しました。回答のない状態が続いています。'
           || '求人を掲載する以上、届いた応募への対応をお願いします。';
  elsif p_stage = 60 then
    v_subject := '[chitose-bank]【重要】応募から60時間が経過しています';
    v_lead := '応募から60時間が経過しました。現在も回答が確認できていません。'
           || '応募者への回答をお願いします。';
  elsif p_stage = 72 then
    v_subject := '[chitose-bank]【重要】応募から72時間が経過しています';
    v_lead := '応募から72時間が経過しています。応募者への回答をお願いします。';
  else
    return null;
  end if;

  return jsonb_build_object(
    'subject', v_subject,
    'body', '■ ' || v_ref || E'\n\n' || v_lead || E'\n\n' ||
            '未対応の応募を見る：' || E'\n' || v_link || public.job_link(v_job));
end $f1$;

create or replace function public.send_application_followups()
returns void
language plpgsql
security definer
set search_path to 'public'
as $f2$
declare
  r record; v_hours numeric; v_stage int; v_due int; v_mail jsonb; v_ins int;
begin
  for r in
    select a.id as app_id, a.farmer_id, a.job_number, a.created_at
      from public.applications a
      join public.jobs j on j.job_number = a.job_number
     where a.status = 'applied'
       and a.held_at is null and a.handled_at is null
       and a.created_at <= now() - interval '12 hours'
  loop
    v_hours := extract(epoch from (now() - r.created_at)) / 3600.0;

    v_due := null;
    foreach v_stage in array array[12,24,36,48,60,72] loop
      if v_hours >= v_stage then v_due := v_stage; end if;
    end loop;
    if v_due is null then continue; end if;

    foreach v_stage in array array[12,24,36,48,60,72] loop
      exit when v_stage >= v_due;
      insert into public.application_followup_notices (application_id, stage_hours, sent)
      values (r.app_id, v_stage, false) on conflict do nothing;
    end loop;

    insert into public.application_followup_notices (application_id, stage_hours, sent)
    values (r.app_id, v_due, true) on conflict do nothing;
    get diagnostics v_ins = row_count;
    if v_ins = 0 then continue; end if;

    v_mail := public.application_followup_mail(r.app_id, v_due);
    if v_mail is not null then
      begin
        perform public.send_user_email(r.farmer_id, v_mail->>'subject', v_mail->>'body');
      exception when others then null; end;
    end if;

    if v_due = 72 then
      begin
        perform public.notify_admins('application_no_reply_72h',
          '72時間未回答：求人 #' || r.job_number);
        perform public.send_admin_email(
          '[chitose-bank][運営] 72時間未回答の応募：求人 #' || r.job_number,
          '求人 #' || r.job_number || ' の応募が72時間未回答です。' || E'\n' ||
          '応募の受付：' || to_char(r.created_at at time zone 'Asia/Tokyo','YYYY/MM/DD HH24:MI') || E'\n\n' ||
          '仕事中ページ：https://chitose-bank.com/#/admin/working' || E'\n' ||
          '求人ページ：https://chitose-bank.com/#/work/job/' || r.job_number);
      exception when others then null; end;
    end if;
  end loop;
end $f2$;
