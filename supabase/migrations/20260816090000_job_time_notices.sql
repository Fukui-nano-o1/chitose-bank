-- 作業当日の時刻メール4通（2026-08-16たきと指示「開始1時間前／15分前／開始時刻／終了時刻」）
--
-- 【設計】
-- ・文面と構造は既存 M10（まもなく作業開始）を踏襲＝「■ 求人の参照名（勤務時間）」＋要件＋リンク。
--   1時間前の文面は M10 の現行文をそのまま引き継ぐ（見え方を変えない）。
-- ・15分刻みを扱うため cron を毎時→5分ごとに変更。旧 job-start-reminder（毎時）は
--   unschedule する（1時間前が二重に飛ぶため）。関数 send_job_start_reminders は
--   消さずに残す＝元に戻したい時は cron.schedule し直すだけ。
-- ・二重送信の防止と送信の記録＝job_time_notices（応募×実働日×種類でユニーク）。
--   行動記録の憲法：送った事実は記録に残す。記録があるからcronが多重に走っても1回しか送らない。
-- ・送る日＝app_work_dates（agreed_dates優先／無ければ求人期間・休日を除く）＝実働日だけ。
--   カレンダーや二重予約の判定と同じ「実働日」の物差しを使う（サイト内に2種類作らない）。
-- ・送る相手＝採用の実体がある当事者のみ（terms_snapshot あり）＝M10と同じ門。
-- ・日またぎ（終了 <= 開始）の求人は終了メールを送らない＝憶測で時刻を作らない
--   （job_scheduled_minutes が日またぎを null に倒すのと同じ考え方）。

-- ── 1) 送信の記録（＝二重送信防止の判定材料） ───────────────────────────────
create table if not exists public.job_time_notices (
  application_id uuid not null references public.applications(id) on delete cascade,
  work_date      date not null,
  kind           text not null check (kind in ('before_60','before_15','start','end')),
  sent_at        timestamptz not null default now(),
  primary key (application_id, work_date, kind)
);
-- バックエンド専用（ポリシー0枚＝APIからは読めも書けもしない）
alter table public.job_time_notices enable row level security;
revoke all on table public.job_time_notices from anon, authenticated;

-- ── 2) メール本文の唯一のソース（送信とプレビューで共用） ───────────────────
-- 返り値 jsonb {subject, body}。呼ぶのは下の2関数だけ＝文面が2箇所に分裂しない。
create or replace function public.job_time_notice_mail(p_app uuid, p_kind text, p_role text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_job int; v_wt text; v_link text; v_head text; v_ref text;
  v_subject text; v_body text;
begin
  select a.job_number, j.work_time into v_job, v_wt
    from public.applications a join public.jobs j on j.job_number = a.job_number
   where a.id = p_app;
  if v_job is null then return null; end if;

  v_link := 'https://chitose-bank.com/#/emergency/' || p_app;
  v_ref  := public.job_ref(v_job, p_role);
  v_head := '■ ' || v_ref || '（' || coalesce(v_wt,'時間未設定') || '）' || E'\n\n';

  if p_kind = 'before_60' then
    -- 既存M10の文面をそのまま引き継ぐ
    if p_role = 'worker' then
      v_subject := '[chitose-bank] まもなく作業開始：求人 #' || v_job || '（' || v_wt || '）';
      v_body := v_head ||
        '作業が約1時間後に始まります。' || E'\n\n' ||
        '遅れそう・行けない・体調がすぐれない——そんな時は、下のリンクから' || E'\n' ||
        'そのまま緊急連絡を送れます（農家さんに即時に届きます）：' || E'\n' || v_link || E'\n\n' ||
        '・持ち物と集合場所は、確認カードでもう一度ご確認ください。' || E'\n' ||
        '・熱中症にご注意ください。水分を持って出かけましょう。';
    else
      v_subject := '[chitose-bank] まもなく作業開始：あなたの求人 #' || v_job || '（' || v_wt || '）';
      v_body := v_head ||
        '作業が約1時間後に始まります。' || E'\n\n' ||
        '中止・延期などの緊急連絡は、下のリンクからそのまま送れます' || E'\n' ||
        '（働き手に即時に届きます）：' || E'\n' || v_link || E'\n\n' ||
        '・作業内容・安全の説明の準備をお願いします。';
    end if;

  elsif p_kind = 'before_15' then
    if p_role = 'worker' then
      v_subject := '[chitose-bank] まもなく開始（15分前）：求人 #' || v_job || '（' || v_wt || '）';
      v_body := v_head ||
        '作業開始まで、あと約15分です。' || E'\n\n' ||
        '遅れそうな時は、下のリンクからそのまま緊急連絡を送れます' || E'\n' ||
        '（農家さんに即時に届きます）：' || E'\n' || v_link || E'\n\n' ||
        '・集合場所が分からない時も、この緊急連絡から知らせられます。';
    else
      v_subject := '[chitose-bank] まもなく開始（15分前）：あなたの求人 #' || v_job || '（' || v_wt || '）';
      v_body := v_head ||
        '作業開始まで、あと約15分です。' || E'\n\n' ||
        '中止・延期などの緊急連絡は、下のリンクからそのまま送れます' || E'\n' ||
        '（働き手に即時に届きます）：' || E'\n' || v_link || E'\n\n' ||
        '・働き手が到着したら、開始の確認をお願いします。';
    end if;

  elsif p_kind = 'start' then
    if p_role = 'worker' then
      v_subject := '[chitose-bank] 作業開始の時間です：求人 #' || v_job || '（' || v_wt || '）';
      v_body := v_head ||
        '作業開始の時間になりました。' || E'\n\n' ||
        '開始は自動で記録されます（ボタンを押す必要はありません）。' || E'\n\n' ||
        '遅れている・行けない時は、下のリンクからそのまま緊急連絡を送れます' || E'\n' ||
        '（農家さんに即時に届きます）：' || E'\n' || v_link || E'\n\n' ||
        '・水分補給と安全にご注意ください。';
    else
      v_subject := '[chitose-bank] 作業開始の時間です：あなたの求人 #' || v_job || '（' || v_wt || '）';
      v_body := v_head ||
        '作業開始の時間になりました。' || E'\n\n' ||
        '働き手が現場に来て作業が始まったら、「作業の開始を確認」を押してください：' || E'\n' ||
        'https://chitose-bank.com/#/calendar/todo/confirm_start' || E'\n\n' ||
        '・来なかった場合の記録も、同じ画面からできます。' || E'\n' ||
        '・緊急連絡はこちら：' || E'\n' || v_link;
    end if;

  elsif p_kind = 'end' then
    if p_role = 'worker' then
      v_subject := '[chitose-bank] 作業終了の時間です：求人 #' || v_job || '（' || v_wt || '）';
      v_body := v_head ||
        '作業終了の予定時刻になりました。お疲れさまでした。' || E'\n\n' ||
        '作業が終わったら、終了の確認と農家さんの評価をお願いします：' || E'\n' ||
        'https://chitose-bank.com/#/profile/worker/approved' || E'\n\n' ||
        '・本日ぶんの賃金は、作業終了後にその場で現金で受け取ります（全求人共通の支払条件です）。' || E'\n' ||
        '・受け取れていない・話が違うときは、下のリンクから連絡できます：' || E'\n' || v_link;
    else
      v_subject := '[chitose-bank] 作業終了の時間です：あなたの求人 #' || v_job || '（' || v_wt || '）';
      v_body := v_head ||
        '作業終了の予定時刻になりました。お疲れさまでした。' || E'\n\n' ||
        '・本日ぶんの賃金を、その場で現金でお渡しください（全求人共通の支払条件です）。' || E'\n\n' ||
        '・作業が終わったら、完了の記録と働き手の評価をお願いします：' || E'\n' ||
        'https://chitose-bank.com/#/profile/employer/applicants';
    end if;

  else
    return null;
  end if;

  return jsonb_build_object('subject', v_subject, 'body', v_body);
end $$;

revoke all on function public.job_time_notice_mail(uuid, text, text) from public, anon, authenticated;

-- ── 3) 送信本体（cron・5分ごと） ─────────────────────────────────────────
create or replace function public.send_job_time_notices()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
  v_today date;
  v_now_min int;
  v_start_min int; v_end_min int;
  v_kind text; v_target int; v_ins int;
  v_mail jsonb;
begin
  v_today   := (now() at time zone 'Asia/Tokyo')::date;
  v_now_min := (extract(hour   from now() at time zone 'Asia/Tokyo')::int) * 60
             + (extract(minute from now() at time zone 'Asia/Tokyo')::int);

  for r in
    select a.id as app_id, a.worker_id, a.farmer_id, j.work_time
      from public.applications a
      join public.jobs j on j.job_number = a.job_number
     where a.status in ('approved','meeting','interview','contracted','working')
       and a.terms_snapshot is not null           -- ★採用の実体：契約記録がある者のみ（M10と同じ門）
       and j.status in ('open','closed')          -- 掲載終了後も契約は生きている
       and j.work_time ~ '^\d{1,2}:\d{2}'
       and v_today in (select public.app_work_dates(a.id))  -- 実働日だけ
  loop
    v_start_min := split_part(split_part(r.work_time,'〜',1),':',1)::int * 60
                 + split_part(split_part(r.work_time,'〜',1),':',2)::int;
    v_end_min := null;
    if split_part(r.work_time,'〜',2) ~ '^\d{1,2}:\d{2}' then
      v_end_min := split_part(split_part(r.work_time,'〜',2),':',1)::int * 60
                 + split_part(split_part(r.work_time,'〜',2),':',2)::int;
    end if;

    foreach v_kind in array array['before_60','before_15','start','end'] loop
      v_target := case v_kind
        when 'before_60' then v_start_min - 60
        when 'before_15' then v_start_min - 15
        when 'start'     then v_start_min
        when 'end'       then v_end_min
      end;
      -- 対象外：時刻が取れない／前日にはみ出す／日またぎ（終了<=開始）は送らない
      if v_target is null or v_target < 0 then continue; end if;
      if v_kind = 'end' and v_end_min <= v_start_min then continue; end if;
      -- 発火は「その時刻を過ぎてから10分以内」＝5分cronで必ず1回は拾える。
      -- 取りこぼしても次のtickが拾い、記録で二重送信は起きない
      if v_now_min < v_target or v_now_min >= v_target + 10 then continue; end if;

      insert into public.job_time_notices (application_id, work_date, kind)
      values (r.app_id, v_today, v_kind)
      on conflict do nothing;
      get diagnostics v_ins = row_count;
      if v_ins = 0 then continue; end if;   -- 送信済み

      v_mail := public.job_time_notice_mail(r.app_id, v_kind, 'worker');
      if v_mail is not null then
        perform public.send_user_email(r.worker_id, v_mail->>'subject', v_mail->>'body');
      end if;
      v_mail := public.job_time_notice_mail(r.app_id, v_kind, 'farmer');
      if v_mail is not null then
        perform public.send_user_email(r.farmer_id, v_mail->>'subject', v_mail->>'body');
      end if;
    end loop;
  end loop;
end $$;

revoke all on function public.send_job_time_notices() from public, anon, authenticated;

-- ── 4) 確認用の送信（運営が自分宛に4種×2役の見本を受け取る・記録は残さない） ──
create or replace function public.admin_preview_job_time_notices(p_to uuid, p_app uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_app uuid; v_kind text; v_role text; v_mail jsonb; v_n int := 0;
begin
  if auth.uid() is not null
     and not exists (select 1 from public.app_admins a where a.auth_id = auth.uid()) then
    return jsonb_build_object('ok', false, 'reason', 'not_admin');
  end if;

  v_app := p_app;
  if v_app is null then
    select a.id into v_app
      from public.applications a join public.jobs j on j.job_number = a.job_number
     where a.terms_snapshot is not null and j.work_time ~ '^\d{1,2}:\d{2}'
     order by a.created_at desc limit 1;
  end if;
  if v_app is null then return jsonb_build_object('ok', false, 'reason', 'no_sample'); end if;

  foreach v_kind in array array['before_60','before_15','start','end'] loop
    foreach v_role in array array['worker','farmer'] loop
      v_mail := public.job_time_notice_mail(v_app, v_kind, v_role);
      if v_mail is not null then
        perform public.send_user_email(p_to, v_mail->>'subject',
          '※これは確認用の送信です（実際の予定ではありません）。' || E'\n' ||
          '※宛先の別：' || case when v_role='worker' then '働き手に届く文面' else '農家に届く文面' end || E'\n' ||
          '――――――――――' || E'\n\n' || (v_mail->>'body'));
        v_n := v_n + 1;
      end if;
    end loop;
  end loop;

  return jsonb_build_object('ok', true, 'sent', v_n, 'application_id', v_app);
end $$;

revoke all on function public.admin_preview_job_time_notices(uuid, uuid) from public, anon, authenticated;

-- ── 5) メール番号（send_user_email が件名から自動で付ける） ────────────────
-- M10（まもなく作業開始）は既存so触らない。M31〜M33を追加。
-- 件名パターンは互いに含まれない文字列にすること（like '%pattern%' の取り違え防止）
insert into public.mail_registry (code, subject_pattern, priority, label) values
  ('M31', 'まもなく開始（15分前）', 100, 'まもなく開始（15分前）'),
  ('M32', '作業開始の時間です',     100, '作業開始の時間です'),
  ('M33', '作業終了の時間です',     100, '作業終了の時間です')
on conflict (code) do nothing;

-- ── 6) cron：毎時→5分ごとに差し替え ─────────────────────────────────────
-- 旧 job-start-reminder（毎時・1時間前のみ）は止める。関数は残置＝戻したい時は
-- select cron.schedule('job-start-reminder','0 * * * *','select public.send_job_start_reminders();');
select cron.unschedule('job-start-reminder')
 where exists (select 1 from cron.job where jobname = 'job-start-reminder');

select cron.schedule('job-time-notices', '*/5 * * * *', 'select public.send_job_time_notices();');
