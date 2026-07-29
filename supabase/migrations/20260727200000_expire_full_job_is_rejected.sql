-- 満員の求人で残った応募は「失効」ではなく「見送り」にする（2026-07-27たきと報告）
--
-- 経緯：採用で定員に達した瞬間に残りを見送りにする処理は confirm_terms に入れた（同日）。
-- だが、その処理が入る前に採用された求人（#1055 等）では、残った応募が判断されないまま
-- 日程を迎え、この関数で「失効」になっていた。働き手の面では失効＝「応募中のまま終わった」
-- 表示になるため、満員で採用漏れした人が「応募中」に見えていた。
--
-- 対処：失効させる直前に「その求人が満員か」を見て、満員なら status='rejected'（見送り）として
-- 記録し、文面も募集終了のものにする。二重の網（採用時＝confirm_terms／日程到来時＝ここ）。
-- 満員でない求人はこれまでどおり失効（＝求人者が判断しなかった事実を残す）。
create or replace function public.expire_stale_applications()
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare r record;
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
  v_now timestamptz := now();
begin
  -- 0) 最終作業日を過ぎた求人の自動クローズ
  update public.jobs set status = 'closed'
   where status = 'open' and coalesce(date_end, date_start) < v_today;

  -- 1) 失効／見送り：クローズ済み求人＋開始時刻を過ぎた単日求人の、判断が完結していない応募
  --    （applied=承認判断なし／approved等で未採用=採用判断なし。採用済みは除外）
  for r in
    select a.id, a.worker_id, a.job_number,
           (j.headcount is not null and j.headcount > 0
            and (select count(*) from public.applications x
                  where x.job_number = a.job_number
                    and x.terms_confirmed_worker_at is not null
                    and x.terms_confirmed_farmer_at is not null) >= j.headcount) as job_filled
      from public.applications a join public.jobs j on j.job_number = a.job_number
     where a.status in ('applied','approved','meeting','interview')
       and a.terms_confirmed_farmer_at is null
       and (
         j.status = 'closed'
         or (
           coalesce(j.date_end, j.date_start) = j.date_start   -- 単日
           and j.work_time ~ '^\d{1,2}:\d{2}'
           and v_now >= ((j.date_start::text || ' ' ||
                 split_part(j.work_time,'〜',1) || ':00')::timestamp
                 at time zone 'Asia/Tokyo')
         )
       )
  loop
    if r.job_filled then
      -- 満員＝採用漏れ。運営の判断ではなく「募集人数に達したことによる終了」と明示する（職安法・あっせん回避）
      update public.applications set status = 'rejected', decided_at = now() where id = r.id;
      insert into public.notifications (farmer_id, type, message)
      values (r.worker_id, 'application_declined',
              '求人 #' || r.job_number || '：募集人数に達したため終了しました。今回はご縁がありませんでした');
      begin
        perform public.send_user_email(r.worker_id,
          '[chitose-bank] 募集終了のお知らせ：求人 #' || r.job_number,
          '■ ' || public.job_ref(r.job_number,'worker') || E'\n\n' ||
          'この求人は、予定していた採用人数に達したため募集を終了しました。' || E'\n' ||
          '今回はご縁がありませんでした。ご応募いただき、ありがとうございました。' || E'\n\n' ||
          '※ 選考の結果ではなく、募集人数に達したことによる終了です。' || E'\n\n' ||
          '他の求人を見る：https://chitose-bank.com/#/search');
      exception when others then null; end;
    else
      update public.applications set status = 'expired', decided_at = now() where id = r.id;
      insert into public.notifications (farmer_id, type, message)
      values (r.worker_id, 'application_expired',
              '求人 #' || r.job_number || '：判断がないまま作業の開始を迎えたため、応募は失効しました');
      begin
        perform public.send_user_email(r.worker_id,
          '[chitose-bank] 応募の失効について：求人 #' || r.job_number,
          '■ ' || public.job_ref(r.job_number,'worker') || E'\n\n' ||
          '求人者の判断がないまま作業の開始を迎えたため、応募は自動的に失効しました。' || E'\n' ||
          'お待たせしたまま結果を出せず、申し訳ありません。' || E'\n\n' ||
          'あなたの応募が放置されない仕組みづくりを続けます。' || E'\n' ||
          '他の求人を見る：https://chitose-bank.com/#/search');
      exception when others then null; end;
    end if;
  end loop;

  -- 2) 前日督促（1日1回だけ：9時台の実行時のみ送る）
  if extract(hour from now() at time zone 'Asia/Tokyo') = 9 then
    for r in
      select distinct a.farmer_id, a.job_number
        from public.applications a join public.jobs j on j.job_number = a.job_number
       where a.status = 'applied' and j.date_start = v_today + 1
    loop
      begin
        perform public.send_user_email(r.farmer_id,
          '[chitose-bank] 応募への返答をお願いします：求人 #' || r.job_number || '（明日開始）',
          '■ ' || public.job_ref(r.job_number,'farmer') || E'\n\n' ||
          'まだ返答していない応募があります。作業は明日です。' || E'\n' ||
          '承認または見送りの判断をお願いします。' || E'\n\n' ||
          'https://chitose-bank.com/#/profile/employer/applicants');
      exception when others then null; end;
    end loop;
  end if;
end; $function$;
