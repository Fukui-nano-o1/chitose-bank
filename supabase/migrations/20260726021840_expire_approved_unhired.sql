-- 失効の対象拡張（2026-07-26たきと指示「期限切れの求人は面接の回答から削除」の根本対処）：
-- 従来cronは applied（未承認）のみ失効させ、「承認したが採用に至らないまま作業日到来」の
-- approved応募が永久に残り、面接の回答/面接の質問/採用の用件を出し続けていた。
-- 失効の定義（CLAUDE.md「判断なきまま作業開始日到来」）どおり、未採用（terms_confirmed_farmer_atなし）の
-- approved/meeting/interview も失効対象に拡張。採用済み（terms_confirmed_farmer_atあり）は絶対に失効させない。
-- （DBには2026-07-26にMCP直接適用＋即時実行済み：#1054/#1055の未採用2件がexpired化・採用済みは無傷を確認）
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

  -- 1) 失効：クローズ済み求人＋開始時刻を過ぎた単日求人の、判断が完結していない応募
  --    （applied=承認判断なし／approved等で未採用=採用判断なし。採用済みは除外）
  for r in
    select a.id, a.worker_id, a.job_number
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
