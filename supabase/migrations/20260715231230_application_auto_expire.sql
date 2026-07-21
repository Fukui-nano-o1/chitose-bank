-- 農how★1対策:「返事が来ないまま当日」の根絶。
-- 作業開始日までに未判断(applied)の応募は自動失効し、働き手に丁寧に通知(徒労の最小化)。
-- 農家には前日に督促(判断を放置させない)。既存の毎朝9時cronに相乗り。
create or replace function public.expire_stale_applications()
returns void language plpgsql security definer set search_path = public as $$
declare r record; v_today date := (now() at time zone 'Asia/Tokyo')::date;
begin
  -- 1) 作業開始日を迎えた未判断応募 → 自動失効・働き手へ通知
  for r in
    select a.id, a.worker_id, a.farmer_id, a.job_number, j.date_start
      from public.applications a
      join public.jobs j on j.job_number = a.job_number
     where a.status = 'applied' and j.date_start <= v_today
  loop
    update public.applications set status = 'expired', decided_at = now() where id = r.id;
    insert into public.notifications (farmer_id, type, message)
    values (r.worker_id, 'application_expired',
            '求人 #' || r.job_number || '：判断されないまま作業日を迎えたため、応募は失効しました');
    begin
      perform public.send_user_email(r.worker_id,
        '[chitose-bank] 応募の失効について：求人 #' || r.job_number,
        '求人 #' || r.job_number || ' への応募は、求人者の判断がないまま作業日を迎えたため、' || E'\n' ||
        '自動的に失効しました。お待たせしたまま結果を出せず、申し訳ありません。' || E'\n\n' ||
        'あなたの応募が放置されない仕組みづくりを続けます。' || E'\n' ||
        '他の求人を見る：https://chitose-bank.com/#/search');
    exception when others then null; end;
  end loop;

  -- 2) 作業前日でまだ未判断の応募 → 農家へ督促
  for r in
    select distinct a.farmer_id, a.job_number, j.date_start
      from public.applications a
      join public.jobs j on j.job_number = a.job_number
     where a.status = 'applied' and j.date_start = v_today + 1
  loop
    begin
      perform public.send_user_email(r.farmer_id,
        '[chitose-bank] 応募への返答をお願いします：求人 #' || r.job_number || '（明日開始）',
        '求人 #' || r.job_number || ' に、まだ返答していない応募があります。' || E'\n' ||
        '作業は明日です。承認または見送りの判断をお願いします。' || E'\n' ||
        '判断がないまま作業日を迎えると、応募は自動的に失効します。' || E'\n\n' ||
        'https://chitose-bank.com/#/profile/employer/applicants');
    exception when others then null; end;
  end loop;
end; $$;

-- 毎朝9時（既存completion cronと同時刻・独立ジョブ）
select cron.schedule('application-expire', '5 0 * * *', $$ select public.expire_stale_applications(); $$);