-- 未回答の応募への段階督促（2026-08-16たきと指示・12/24/36/48/60/72時間の6段）
--
-- 【文面】件名・本文はたきと指定のものをそのまま使う。既存メールと同じ構造に合わせて
--   「■ 求人の参照名」を先頭に、末尾に応募者ページへのリンクを添える（どの求人か分かるようにするため）。
--
-- 【0時間について】表の「0時間・応募が届きました」は既存の M02（trg_notify_application）が担っている
--   （応募者カード・自己紹介つきのHTMLメール）。件名を変えると mail_registry の M02 パターンが外れるため、
--   0時間は M02 を正とし、指定文の趣旨（自身で判断すること・サイト外で連絡した場合も状況を更新すること）を
--   M02 の本文に足す（別ファイル 20260816142000）。
--
-- 【止まる条件】status が applied でなくなる（承認・見送り・取消・失効）／保留（held_at）／
--   対応済み（handled_at）。作業前日の督促（M07）と自動失効は従来どおり別に働く。
--
-- 【48時間以降の利用制限の告知について（記録）】
--   実装前に「利用規約に応募への回答義務・未回答を理由とする措置の条文が無い」ことを報告し、
--   たきと裁定で【指定どおりそのまま送る】と決定（2026-08-16）。規約本文は変更していない。
--   後日、第6条に回答義務・第11条に未回答の扱いを足す場合は、この文面がその条文の裏付けを得る。
--
-- 【取りこぼしの扱い】cronが止まっていて複数段を一度に跨いだ時は、該当する【最も進んだ1通だけ】を送り、
--   飛ばした段は sent=false で記録する（同じ人の受信箱に督促が何通も同時に届かないようにする）。

create table if not exists public.application_followup_notices (
  application_id uuid not null references public.applications(id) on delete cascade,
  stage_hours    int  not null check (stage_hours in (12,24,36,48,60,72)),
  sent           boolean not null default true,   -- false＝追い越しで飛ばした段（送っていない記録）
  sent_at        timestamptz not null default now(),
  primary key (application_id, stage_hours)
);
alter table public.application_followup_notices enable row level security;
revoke all on table public.application_followup_notices from anon, authenticated;

-- 文面の唯一のソース（送信とプレビューで共用）
create or replace function public.application_followup_mail(p_app uuid, p_stage int)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
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
           || '求人を掲載する以上、届いた応募への対応をお願いします。'
           || '72時間未回答となった場合、利用規約に基づく利用制限の審査対象となります。';
  elsif p_stage = 60 then
    v_subject := '[chitose-bank]【重要】あと12時間です｜利用制限の対象となる場合があります';
    v_lead := '応募から60時間が経過しました。現在も回答が確認できていません。'
           || 'あと12時間で72時間未回答となります。対応状況が更新されない場合、'
           || '利用規約に基づき求人機能の利用制限を行う場合があります。';
  elsif p_stage = 72 then
    v_subject := '[chitose-bank]【最終通知】72時間未回答｜利用制限の審査対象となりました';
    v_lead := '応募から72時間が経過しました。応募者への回答が確認できていません。'
           || '本件は利用規約に基づく利用制限の審査対象となりました。'
           || '未対応の応募をご確認のうえ、直ちに対応状況を更新してください。';
  else
    return null;
  end if;

  return jsonb_build_object(
    'subject', v_subject,
    'body', '■ ' || v_ref || E'\n\n' || v_lead || E'\n\n' ||
            '未対応の応募を見る：' || E'\n' || v_link || public.job_link(v_job));
end $$;

revoke all on function public.application_followup_mail(uuid, int) from public, anon, authenticated;

-- 送信本体（cron・毎時）
create or replace function public.send_application_followups()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record; v_hours numeric; v_stage int; v_due int; v_mail jsonb; v_ins int;
begin
  for r in
    select a.id as app_id, a.farmer_id, a.job_number, a.created_at
      from public.applications a
      join public.jobs j on j.job_number = a.job_number
     where a.status = 'applied'
       and a.held_at is null and a.handled_at is null    -- 保留・対応済みが付いたら止まる
       and a.created_at <= now() - interval '12 hours'
  loop
    v_hours := extract(epoch from (now() - r.created_at)) / 3600.0;

    -- いま到達している最も進んだ段
    v_due := null;
    foreach v_stage in array array[12,24,36,48,60,72] loop
      if v_hours >= v_stage then v_due := v_stage; end if;
    end loop;
    if v_due is null then continue; end if;

    -- 追い越して未記録のまま残っている下位の段は「送らなかった記録」として残す
    foreach v_stage in array array[12,24,36,48,60,72] loop
      exit when v_stage >= v_due;
      insert into public.application_followup_notices (application_id, stage_hours, sent)
      values (r.app_id, v_stage, false) on conflict do nothing;
    end loop;

    insert into public.application_followup_notices (application_id, stage_hours, sent)
    values (r.app_id, v_due, true) on conflict do nothing;
    get diagnostics v_ins = row_count;
    if v_ins = 0 then continue; end if;      -- 送信済み

    v_mail := public.application_followup_mail(r.app_id, v_due);
    if v_mail is not null then
      begin
        perform public.send_user_email(r.farmer_id, v_mail->>'subject', v_mail->>'body');
      exception when others then null; end;
    end if;

    -- 72時間＝審査対象。運営にも知らせる（審査するのは運営なので、届かないと通知がただの脅しになる）
    if v_due = 72 then
      begin
        perform public.notify_admins('application_no_reply_72h',
          '72時間未回答：求人 #' || r.job_number || '（利用制限の審査対象）');
        perform public.send_admin_email(
          '[chitose-bank][運営] 72時間未回答の応募：求人 #' || r.job_number,
          '求人 #' || r.job_number || ' の応募が72時間未回答のため、審査対象になりました。' || E'\n' ||
          '応募の受付：' || to_char(r.created_at at time zone 'Asia/Tokyo','YYYY/MM/DD HH24:MI') || E'\n\n' ||
          '仕事中ページ：https://chitose-bank.com/#/admin/working' || E'\n' ||
          '求人ページ：https://chitose-bank.com/#/work/job/' || r.job_number);
      exception when others then null; end;
    end if;
  end loop;
end $$;

revoke all on function public.send_application_followups() from public, anon, authenticated;

-- 確認用：運営が自分宛に6段の見本を受け取る（記録は残さない）
create or replace function public.admin_preview_application_followups(p_to uuid, p_app uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_app uuid; v_stage int; v_mail jsonb; v_n int := 0;
begin
  if auth.uid() is not null
     and not exists (select 1 from public.app_admins a where a.auth_id = auth.uid()) then
    return jsonb_build_object('ok', false, 'reason', 'not_admin');
  end if;

  v_app := p_app;
  if v_app is null then
    select id into v_app from public.applications order by created_at desc limit 1;
  end if;
  if v_app is null then return jsonb_build_object('ok', false, 'reason', 'no_sample'); end if;

  foreach v_stage in array array[12,24,36,48,60,72] loop
    v_mail := public.application_followup_mail(v_app, v_stage);
    if v_mail is not null then
      perform public.send_user_email(p_to, v_mail->>'subject',
        '※これは確認用の送信です（実際の督促ではありません）。' || E'\n' ||
        '※経過：' || v_stage || '時間' || E'\n' ||
        '――――――――――' || E'\n\n' || (v_mail->>'body'));
      v_n := v_n + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'sent', v_n, 'application_id', v_app);
end $$;

revoke all on function public.admin_preview_application_followups(uuid, uuid) from public, anon, authenticated;

-- メール番号（件名パターンは互いに含まれない文字列にする）
insert into public.mail_registry (code, subject_pattern, priority, label) values
  ('M34', '応募への回答をお待ちしています',   100, '応募への回答をお待ちしています（12時間）'),
  ('M35', '応募から24時間が経過しています',   100, '応募から24時間（要対応）'),
  ('M36', '36時間未回答です',                 100, '36時間未回答（要対応）'),
  ('M37', '48時間未回答です',                 100, '48時間未回答（重要）'),
  ('M38', 'あと12時間です',                   100, 'あと12時間（利用制限の予告）'),
  ('M39', '72時間未回答',                     100, '72時間未回答（最終通知）')
on conflict (code) do nothing;

-- 毎時。失効cron（10分）とずらして25分に置く
select cron.schedule('application-followups', '25 * * * *',
                     'select public.send_application_followups();');
