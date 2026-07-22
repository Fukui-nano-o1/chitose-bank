-- 求人Q&A（第10弾）：求人詳細・確認ページの「質問」タブで使う公開質問。
-- ※このオブジェクト群は本番へ先行適用済み（supabase_migrations に version 20260722143457 として記録済み）。
--   本ファイルは repo とのズレを解消するための写経（二頭運転の交通規則・2026-07-21）。冪等形なので再適用も安全。
-- 読み取り：hidden=false は誰でも（authenticated）／自分の質問・その求人の農家・運営は hidden も閲覧可。
-- 書き込みは必ずRPC経由（ask_job_question / answer_job_question / admin_hide_question）。NG検査（電話/メール/URL）はDB側。

create table if not exists public.job_questions (
  id uuid primary key default gen_random_uuid(),
  job_number integer not null,
  asker_id uuid not null,
  question text not null,
  answer text,
  answered_at timestamptz,
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.job_questions enable row level security;

drop policy if exists "jq read" on public.job_questions;
create policy "jq read" on public.job_questions for select to authenticated
using (
  hidden = false
  or asker_id = auth.uid()
  or exists (select 1 from public.jobs j where j.job_number = job_questions.job_number and j.farmer_id = auth.uid())
  or exists (select 1 from public.app_admins a where a.auth_id = auth.uid())
);

-- NG検査（電話番号・メールアドレス・URL・空・500字超を拒否）
create or replace function public.jq_ng_check(p text)
 returns text
 language plpgsql
 immutable
as $function$
begin
  if p is null or btrim(p) = '' then return '内容が空です'; end if;
  if char_length(p) > 500 then return '500文字以内でお願いします'; end if;
  if p ~ '0\d{1,4}[-‐−ー\s]?\d{1,4}[-‐−ー\s]?\d{3,4}' then
    return '電話番号は記載できません（連絡はサイト内でお願いします）'; end if;
  if p ~* '[a-z0-9._%+-]+@[a-z0-9.-]+' then
    return 'メールアドレスは記載できません'; end if;
  if p ~* 'https?://|www\.' then return 'URLは記載できません'; end if;
  return null;
end; $function$;

-- 質問する（open求人のみ・自分の求人は不可・NG検査→job_questions挿入→農家へ通知/メールM22）
create or replace function public.ask_job_question(p_job integer, p_question text)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_farmer uuid; v_err text; v_id uuid;
begin
  if auth.uid() is null then return json_build_object('ok',false,'reason','not_logged_in'); end if;
  select farmer_id into v_farmer from public.jobs
   where job_number = p_job and status = 'open';
  if v_farmer is null then return json_build_object('ok',false,'reason','not_open'); end if;
  if v_farmer = auth.uid() then return json_build_object('ok',false,'reason','own_job'); end if;
  v_err := public.jq_ng_check(p_question);
  if v_err is not null then return json_build_object('ok',false,'reason','ng','message',v_err); end if;
  insert into public.job_questions (job_number, asker_id, question)
  values (p_job, auth.uid(), btrim(p_question)) returning id into v_id;
  insert into public.notifications (farmer_id, type, message)
  values (v_farmer, 'job_question', 'あなたの求人 #' || p_job || ' に質問が届きました');
  begin
    perform public.send_user_email(v_farmer,
      '[chitose-bank] 質問が届きました：あなたの求人 #' || p_job,
      '■ ' || public.job_ref(p_job,'farmer') || E'\n\n' ||
      '■ 質問：' || E'\n' || btrim(p_question) || E'\n\n' ||
      '回答は求人ページの「質問」タブからできます。' || E'\n' ||
      '回答は他の閲覧者にも公開され、同じ質問を減らせます。' ||
      public.job_link(p_job));
  exception when others then null; end;
  return json_build_object('ok', true, 'id', v_id);
end; $function$;

-- 回答する（その求人の農家のみ・NG検査→回答保存→質問者へ通知/メールM23）
create or replace function public.answer_job_question(p_id uuid, p_answer text)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_job int; v_asker uuid; v_farmer uuid; v_err text;
begin
  select q.job_number, q.asker_id, j.farmer_id into v_job, v_asker, v_farmer
    from public.job_questions q join public.jobs j on j.job_number = q.job_number
   where q.id = p_id;
  if v_job is null then return json_build_object('ok',false,'reason','not_found'); end if;
  if v_farmer <> auth.uid() then return json_build_object('ok',false,'reason','not_yours'); end if;
  v_err := public.jq_ng_check(p_answer);
  if v_err is not null then return json_build_object('ok',false,'reason','ng','message',v_err); end if;
  update public.job_questions set answer = btrim(p_answer), answered_at = now() where id = p_id;
  insert into public.notifications (farmer_id, type, message)
  values (v_asker, 'job_question_answered', '求人 #' || v_job || '：質問に回答がつきました');
  begin
    perform public.send_user_email(v_asker,
      '[chitose-bank] 質問に回答がつきました：求人 #' || v_job,
      '■ ' || public.job_ref(v_job,'worker') || E'\n\n' ||
      '■ あなたの質問への回答：' || E'\n' || btrim(p_answer) ||
      public.job_link(v_job));
  exception when others then null; end;
  return json_build_object('ok', true);
end; $function$;

-- 非表示スイッチ（運営のみ）
create or replace function public.admin_hide_question(p_id uuid, p_hidden boolean)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not exists (select 1 from public.app_admins a where a.auth_id = auth.uid()) then
    return json_build_object('ok',false,'reason','not_admin');
  end if;
  update public.job_questions set hidden = p_hidden where id = p_id;
  return json_build_object('ok', true);
end; $function$;
