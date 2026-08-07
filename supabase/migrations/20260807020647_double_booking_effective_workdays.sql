-- 二重予約判定の精度バグを修理（2026-08-06 バグ狩り③で再現確認）。
-- 旧：confirm_terms の double_booked 判定that、求人票の生の date_start..date_end 範囲重複だけを見て、
--   実際の稼働日（applications.agreed_dates）も holidays も参照していなかった。
--   ＝同じ働き手を2つの期間求人（同範囲）に、重ならない実働日（A=+10 / B=+14）で合意させても
--     double_booked を誤って返し、正当な採用（別々の日に同じ人を雇う）に毎回警告that出ていた。
-- 新：応募の【実働日集合】の積で判定する。実働日集合＝
--   agreed_dates（非空配列）thatあればその日付／無ければ求人範囲 date_start..date_end／
--   いずれからも holidays（jobs.holidays）を除く。
-- フロント lib/hire.js findDoubleBookingJob も同じ式に揃えた（同日変更・nodeでparity検算済み）。
-- 検証済み（ロールバック付き実弾）：非重複の実働日=通過（誤警告解消）／重複=double_booked（壁維持）／
--   受諾ありで進める／holidayで除外した日は重複扱いにならない。

-- 応募1件の実働日を返す内部ヘルパー（SECURITY DEFINER・クライアントからは呼ばせない）。
create or replace function public.app_work_dates(p_app uuid)
 returns setof date language sql stable security definer set search_path to 'public'
as $function$
  with a as (
    select ap.agreed_dates, j.date_start, j.date_end, j.holidays
      from public.applications ap
      join public.jobs j on j.job_number = ap.job_number
     where ap.id = p_app
  ),
  hol as (
    select d::date as hd
      from a, lateral (select case when jsonb_typeof(a.holidays)='array' then a.holidays else '[]'::jsonb end as h) hh,
           jsonb_array_elements_text(hh.h) d
  ),
  days as (
    select d::date as wd
      from a, jsonb_array_elements_text(a.agreed_dates) d
     where jsonb_typeof(a.agreed_dates)='array' and jsonb_array_length(a.agreed_dates) > 0
    union all
    select gs::date
      from a, generate_series(a.date_start, coalesce(a.date_end, a.date_start), interval '1 day') gs
     where not (jsonb_typeof(a.agreed_dates)='array' and jsonb_array_length(a.agreed_dates) > 0)
       and a.date_start is not null
  )
  select distinct wd from days
   where wd not in (select hd from hol);
$function$;

revoke all on function public.app_work_dates(uuid) from public;

create or replace function public.confirm_terms(p_application_id uuid, p_accept_double_booking boolean default false)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare v_worker uuid; v_farmer uuid; v_job int; v_both boolean;
        v_first_farmer boolean := false; v_farmer_name text; v_title text;
        v_headcount int; v_hired int; v_filled boolean := false;
        v_closed uuid[] := '{}'; v_ref text; r record;
        v_dup int;
begin
  select worker_id, farmer_id, job_number into v_worker, v_farmer, v_job
    from public.applications where id = p_application_id;
  if v_worker is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;

  if auth.uid() = v_worker then
    update public.applications set terms_confirmed_worker_at = coalesce(terms_confirmed_worker_at, now())
     where id = p_application_id;
  elsif auth.uid() = v_farmer then
    select terms_confirmed_farmer_at is null into v_first_farmer
      from public.applications where id = p_application_id;
    -- ★二重予約の壁（2026-08-06）：初回確定・受諾なしの時だけ調べて拒否。
    --   実働日集合（agreed_dates優先／無ければ範囲・holidays除外）の積that空でなければ重複。
    if v_first_farmer and not coalesce(p_accept_double_booking, false) then
      select a2.job_number into v_dup
        from public.applications a2
       where a2.farmer_id = v_farmer and a2.worker_id = v_worker
         and a2.job_number is distinct from v_job
         and a2.status in ('approved','meeting','interview','contracted','working')
         and exists (
           select 1
             from public.app_work_dates(p_application_id) d1
             join public.app_work_dates(a2.id) d2 on d1 = d2
         )
       limit 1;
      if v_dup is not null then
        return json_build_object('ok', false, 'reason', 'double_booked', 'dup_job', v_dup);
      end if;
    end if;
    update public.applications set terms_confirmed_farmer_at = coalesce(terms_confirmed_farmer_at, now())
     where id = p_application_id;
  else
    return json_build_object('ok', false, 'reason', 'not_party');
  end if;

  select terms_confirmed_worker_at is not null and terms_confirmed_farmer_at is not null
    into v_both from public.applications where id = p_application_id;
  if v_both then
    update public.applications a
       set terms_snapshot = coalesce(a.terms_snapshot,
         (select to_jsonb(j) - 'lat' - 'lng' from public.jobs j where j.job_number = v_job)
         || jsonb_build_object('snapshot_at', now()))
     where a.id = p_application_id;
  end if;

  if v_first_farmer then
    begin
      select nullif(btrim(ep.nickname), '') into v_farmer_name
        from public.employer_profiles ep where ep.auth_id = v_farmer;
      v_farmer_name := coalesce(v_farmer_name, '農家');
      select nullif(btrim(concat_ws(' ', j.crop, j.task)), '') into v_title
        from public.jobs j where j.job_number = v_job;
      v_title := coalesce(v_title, '求人 #' || v_job);

      insert into public.messages (application_id, sender_id, body)
      values (p_application_id, v_farmer,
        '🎉 採用が決定しました！「' || v_title || '」でよろしくお願いします。当日までの確認は、このチャットで行いましょう。');

      perform public.send_user_email(v_worker,
        '[chitose-bank] 採用が決定しました',
        v_farmer_name || 'さんの求人「' || v_title || '」(#' || v_job || ')に採用されました。' || E'\n\n' ||
        '■ ここからの流れ：' || E'\n' ||
        '作業日までにチャットで最終確認（集合場所・持ち物・時間）→ 当日作業 → 終了後にお互いを評価します。' || E'\n\n' ||
        '▶ チャットを開く：https://chitose-bank.com/#/chat/' || p_application_id);
    exception when others then null; end;
  end if;

  if v_first_farmer then
    select j.headcount into v_headcount from public.jobs j where j.job_number = v_job;
    select count(*) into v_hired from public.applications a
      where a.job_number = v_job
        and a.terms_confirmed_worker_at is not null
        and a.terms_confirmed_farmer_at is not null;
    if v_headcount is not null and v_headcount > 0 and v_hired >= v_headcount then
      v_filled := true;
      v_ref := public.job_ref(v_job, 'worker');
      for r in
        select a.id, a.worker_id from public.applications a
         where a.job_number = v_job
           and a.id <> p_application_id
           and a.status in ('applied','approved','meeting','interview')
           and not (a.terms_confirmed_worker_at is not null and a.terms_confirmed_farmer_at is not null)
      loop
        update public.applications
           set status = 'rejected', decided_at = coalesce(decided_at, now())
         where id = r.id;
        v_closed := v_closed || r.id;
        begin
          insert into public.messages (application_id, sender_id, body)
          values (r.id, v_farmer,
            'この求人は、予定していた人数の採用が決まったため募集を終了しました。' ||
            'ご応募いただいたのに、お力になれずすみません。またの機会によろしくお願いします。');
        exception when others then null; end;
        begin
          insert into public.notifications (farmer_id, type, message)
          values (r.worker_id, 'application_declined',
                  '求人 #' || v_job || '：募集人数に達したため終了しました。今回はご縁がありませんでした');
        exception when others then null; end;
        begin
          perform public.send_user_email(r.worker_id,
            '[chitose-bank] 募集終了のお知らせ：求人 #' || v_job,
            '■ ' || v_ref || E'\n\n' ||
            'この求人は、予定していた採用人数に達したため募集を終了しました。' || E'\n' ||
            '今回はご縁がありませんでした。ご応募いただき、ありがとうございました。' || E'\n\n' ||
            '※ 選考の結果ではなく、募集人数に達したことによる終了です。' || E'\n\n' ||
            '他の求人を見る：https://chitose-bank.com/#/search');
        exception when others then null; end;
      end loop;
    end if;
  end if;

  return (select json_build_object('ok', true,
      'worker_confirmed', terms_confirmed_worker_at is not null,
      'farmer_confirmed', terms_confirmed_farmer_at is not null,
      'filled', v_filled,
      'closed_ids', to_jsonb(v_closed))
    from public.applications where id = p_application_id);
end; $function$;

revoke all on function public.confirm_terms(uuid, boolean) from public;
revoke execute on function public.confirm_terms(uuid, boolean) from anon;
grant execute on function public.confirm_terms(uuid, boolean) to authenticated, service_role;
