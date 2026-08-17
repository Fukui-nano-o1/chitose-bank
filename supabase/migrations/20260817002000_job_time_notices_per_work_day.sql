-- 時刻メールは「仕事のある日は毎日」送る（2026-08-17たきと指示・確定）
--
-- 直前の版は application_id × 種類 × 宛先 で1回だけにしていたが、それだと連続する期間の
-- 仕事で初日にしか届かない。作業日ごとに当日の連絡が要るのに届かない日があると、
-- 「その日は知らせがなかった」と後から言われる隙になる。
--
-- 【確定】重複しない単位は「1つの応募 × 作業日 × 種類 × 宛先」＝実働日ごとに1回ずつ送る。
--   同じ日に何度cronが走っても1回だけ（記録があるため）。翌日になれば、その日ぶんが新たに送られる。
--   実働日の判定は app_work_dates（agreed_dates優先・休日を除く）＝カレンダーと同じ物差し。
--
-- 送信リクエストID・受理時刻・応答コードの記録は前版のまま（送信成功時刻を残す）。

alter table public.job_time_notices drop constraint job_time_notices_pkey;
alter table public.job_time_notices add primary key (application_id, kind, role, work_date);

comment on table public.job_time_notices is
  '作業当日の時刻メールの送信記録。1つの応募 × 作業日 × 種類 × 宛先 につき1回だけ送る';

-- 送信本体：送信IDの書き戻しを「その日の行」に限定する
-- （作業日を鍵に含めたため、日付で絞らないと他の日の記録まで上書きしてしまう）
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
       and v_today in (select public.app_work_dates(a.id))   -- 今日がその応募の実働日か
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
        -- 役割ごとの発火条件。★開始・完了の記録は「その日」の状態で見る：
        --   期間の仕事では前の日に開始・終了がついているため、それが残っていると
        --   翌日以降がずっと送られなくなる。当日ぶんの記録かどうかで判定する
        v_ok := case
          when v_kind in ('before_60','before_15') then
            r.started_at is null or (r.started_at at time zone 'Asia/Tokyo')::date <> v_today
          when v_kind = 'start' and v_role = 'farmer' then
            r.farmer_confirmed_start_at is null
            or (r.farmer_confirmed_start_at at time zone 'Asia/Tokyo')::date <> v_today
          when v_kind = 'end' and v_role = 'worker' then
            r.worker_confirmed_end_at is null
            or (r.worker_confirmed_end_at at time zone 'Asia/Tokyo')::date <> v_today
          else true
        end;
        if not v_ok then continue; end if;

        v_to := case when v_role = 'worker' then r.worker_id else r.farmer_id end;
        if public.is_account_moderated(v_to) then continue; end if;

        -- 1つの応募 × 作業日 × 種類 × 宛先 につき1回
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
           where application_id = r.app_id and kind = v_kind and role = v_role
             and work_date = v_today;          -- ★その日の行だけを更新する
        end if;
      end loop;
    end loop;
  end loop;
end $$;

revoke all on function public.send_job_time_notices() from public, anon, authenticated;
