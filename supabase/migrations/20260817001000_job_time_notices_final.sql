-- 作業当日の時刻メール・確定仕様（2026-08-17たきと最終指示）
--
-- 【確定した3点】
-- 1. 同じ application_id × mail_type × 宛先 は1回しか送らない
--    ＝記録の主キーから work_date を外した（従来は実働日ごとに1回だった）。
--    ★連続する期間の仕事（1つの応募で何日も働く場合）は、初日にだけ届き2日目以降は届かない。
--      日ごとに届けたい時は、主キーと挿入に work_date を戻すだけで切り替わる（下の注記）。
--    ★宛先（role）は主キーに残す。働き手と農家では文面も送る条件も違い、
--      片方に送ったことで もう片方が送られなくなってはいけないため。
-- 2. 送信成功時刻を記録する
--    send_user_email が返す送信リクエストID（pg_net）を控え、次のcronの回で
--    net._http_response と突き合わせて succeeded_at（受理時刻）と http_status を記録する。
--    ＝「送った（requested_at）」と「相手のメールサーバーに受理された（succeeded_at）」を分けて残す。
-- 3. 時刻の基準は Asia/Tokyo に固定
--    このDBの timezone は UTC。cron は '*/5 * * * *'（間隔）なのでタイムゾーンに依存しない。
--    日付・時刻の判定はすべて (now() at time zone 'Asia/Tokyo') で明示的にJSTへ直してから行う
--    ＝素の current_date / now()::date は使わない（2026-08-06 のUTC日付ズレの教訓）。
--
-- 【段取り】開始60分前 → 開始15分前 → 開始時刻 → 終了予定時刻。
--   終了後の繰り返し督促は作らない（未完了は翌朝9時の既存 M12 が引き継ぐ）。
--
-- 【メールからの導線（固定）】
--   緊急連絡        #/emergency/{application_id}
--   働き手の開始時   #/calendar
--   開始確認（農家） #/calendar/todo/confirm_start
--   終了確認（農家） #/calendar/todo/complete
--   終了確認（働き手）#/calendar/todo/w_review
--   ※application_id を指定して開始確認・完了確認を直接開く専用リンクは現行コードに無い。
--     1タップ直行が必要になった時に新設する（それまでは上の既存ルートで足りる）。

-- ── 記録：application_id × mail_type × 宛先 で1回 ────────────────────────
drop table if exists public.job_time_notices;
create table public.job_time_notices (
  application_id uuid not null references public.applications(id) on delete cascade,
  kind           text not null check (kind in ('before_60','before_15','start','end')),
  role           text not null check (role in ('worker','farmer')),
  work_date      date not null,              -- 送った時の作業日（記録として残す・重複判定には使わない）
  requested_at   timestamptz not null default now(),
  request_id     bigint,                     -- pg_net の送信リクエストID
  succeeded_at   timestamptz,                -- 相手のメールサーバーに受理された時刻
  http_status    int,
  primary key (application_id, kind, role)
);
alter table public.job_time_notices enable row level security;
revoke all on table public.job_time_notices from anon, authenticated;

-- ── 送信結果の取り込み（次の回で突き合わせる） ─────────────────────────────
create or replace function public.resolve_job_time_notice_delivery()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update public.job_time_notices n
     set succeeded_at = r.created,
         http_status  = r.status_code
    from net._http_response r
   where r.id = n.request_id
     and n.request_id is not null
     and n.succeeded_at is null
     and n.http_status is null;
end $$;

revoke all on function public.resolve_job_time_notice_delivery() from public, anon, authenticated;

-- ── 送信本体（cron・5分ごと） ───────────────────────────────────────────
create or replace function public.send_job_time_notices()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
  v_today date; v_now_min int;
  v_start_min int; v_end_min int;
  v_kind text; v_role text; v_target int; v_ins int; v_ok boolean;
  v_to uuid; v_mail jsonb; v_req bigint;
begin
  -- 前回の回で送ったぶんの結果（受理時刻・応答コード）を先に取り込む
  perform public.resolve_job_time_notice_delivery();

  -- ★時刻の基準はJSTに固定（DBのtimezoneはUTC）
  v_today   := (now() at time zone 'Asia/Tokyo')::date;
  v_now_min := (extract(hour   from now() at time zone 'Asia/Tokyo')::int) * 60
             + (extract(minute from now() at time zone 'Asia/Tokyo')::int);

  for r in
    select a.id as app_id, a.worker_id, a.farmer_id, j.work_time,
           a.started_at, a.farmer_confirmed_start_at, a.worker_confirmed_end_at,
           a.work_completed_at, a.attended
      from public.applications a
      join public.jobs j on j.job_number = a.job_number
     where a.status in ('approved','meeting','interview','contracted','working')
       and a.terms_snapshot is not null
       and j.status in ('open','closed')
       and j.work_time ~ '^\d{1,2}:\d{2}'
       and a.work_completed_at is null
       and coalesce(a.attended, true)
       and v_today in (select public.app_work_dates(a.id))
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
      if v_target is null or v_target < 0 then continue; end if;
      if v_kind = 'end' and v_end_min <= v_start_min then continue; end if;
      if v_now_min < v_target or v_now_min >= v_target + 10 then continue; end if;

      foreach v_role in array array['worker','farmer'] loop
        v_ok := case
          when v_kind in ('before_60','before_15') then r.started_at is null
          when v_kind = 'start'  and v_role = 'farmer' then r.farmer_confirmed_start_at is null
          when v_kind = 'end'    and v_role = 'worker' then r.worker_confirmed_end_at is null
          else true
        end;
        if not v_ok then continue; end if;

        v_to := case when v_role = 'worker' then r.worker_id else r.farmer_id end;
        if public.is_account_moderated(v_to) then continue; end if;

        -- 同じ応募・同じ種類・同じ宛先は1回だけ
        -- （日ごとに送りたくなったら、ここと主キーに work_date を戻す）
        insert into public.job_time_notices (application_id, kind, role, work_date)
        values (r.app_id, v_kind, v_role, v_today)
        on conflict do nothing;
        get diagnostics v_ins = row_count;
        if v_ins = 0 then continue; end if;

        v_mail := public.job_time_notice_mail(r.app_id, v_kind, v_role);
        if v_mail is not null then
          begin
            v_req := public.send_user_email(v_to, v_mail->>'subject', v_mail->>'body', v_mail->>'html');
          exception when others then v_req := null; end;
          update public.job_time_notices
             set request_id = v_req
           where application_id = r.app_id and kind = v_kind and role = v_role;
        end if;
      end loop;
    end loop;
  end loop;
end $$;

revoke all on function public.send_job_time_notices() from public, anon, authenticated;
