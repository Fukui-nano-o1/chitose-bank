-- 採用確定の督促メールのリンクを採用するページへ（2026-08-07・たきと指示「器と機能の役割は一つに絞れ」）
-- ※DB適用済み（schema_migrations 20260806174452・apply_migration経由）の正本。
-- メールの役割＝呼ぶ（外にいる人を、決める場所へ連れてくる）。決める場所＝採用するページ
-- （#/calendar/todo/hire・採用実行の唯一の窓口）。従来のリンク先（応募者ページ）は「見る」器で、
-- 呼ばれた先で実行できなかった。変更は承認済み督促のURL1行のみ（applied督促の行き先は
-- 応募者ページのまま＝承認の実行窓口はそこにあるため正しい）。土台は現本番定義（20260806165333適用分）。

create or replace function public.expire_stale_applications()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare r record;
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
  v_now timestamptz := now();
  v_lost text := '';
  v_lost_n int := 0;
begin
  -- 0) 最終作業日を過ぎた求人の自動クローズ
  update public.jobs set status = 'closed'
   where status = 'open' and coalesce(date_end, date_start) < v_today;

  -- 1) 失効／見送り：クローズ済み求人＋開始時刻を過ぎた単日求人の、判断が完結していない応募
  for r in
    select a.id, a.worker_id, a.job_number, a.status as app_status,
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
           coalesce(j.date_end, j.date_start) = j.date_start
           and j.work_time ~ '^\d{1,2}:\d{2}'
           and v_now >= ((j.date_start::text || ' ' ||
                 split_part(j.work_time,'〜',1) || ':00')::timestamp
                 at time zone 'Asia/Tokyo')
         )
       )
  loop
    if r.job_filled then
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
    -- ★2026-08-06追加：承認まで進んでいた応募の自動終了は、運営への通知対象に積む
    --（働いた実態があった可能性の瞬間。#1054・#1056＝承認済みのまま失効し記録が消えた型）
    if r.app_status in ('approved','meeting','interview') then
      v_lost_n := v_lost_n + 1;
      v_lost := v_lost || '・求人 #' || r.job_number || '／応募ID ' || r.id
             || case when r.job_filled then '（満員により見送り）' else '（判断なく失効）' end || E'\n';
    end if;
  end loop;

  -- ★2026-08-06追加：承認済みの自動終了があれば運営へ1通（実行1回につき最大1通・個人名は載せない）
  if v_lost_n > 0 then
    begin
      perform public.send_admin_email(
        '[chitose-bank] 承認済みの応募が自動終了しました（' || v_lost_n || '件・記録漏れの確認を）',
        '承認まで進んでいた応募が、採用の確定がないまま自動で終了しました。' || E'\n' ||
        '実際に作業が行われていた場合、はたらいた記録が残っていません（#1054・#1056の型）。' || E'\n' ||
        '実態を確認し、必要であれば記録の修復を判断してください。' || E'\n\n' ||
        v_lost || E'\n' ||
        '確認：https://chitose-bank.com/#/admin/working');
    exception when others then null; end;
  end if;

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
    -- ★2026-08-06追加：承認済み・採用未確定にも前日督促（採用の押し忘れを失効の前日に拾う）
    -- リンク先は採用するページ＝採用実行の唯一の窓口（2026-08-07変更・呼ぶ先と決める場所を同じに）
    for r in
      select distinct a.farmer_id, a.job_number
        from public.applications a join public.jobs j on j.job_number = a.job_number
       where a.status = 'approved' and a.terms_confirmed_farmer_at is null
         and j.date_start = v_today + 1
    loop
      begin
        perform public.send_user_email(r.farmer_id,
          '[chitose-bank] 採用の確定をお願いします：求人 #' || r.job_number || '（明日開始）',
          '■ ' || public.job_ref(r.job_number,'farmer') || E'\n\n' ||
          '承認済みのまま、採用が確定していない応募があります。作業は明日です。' || E'\n' ||
          'このままにすると応募は自動で失効し、はたらいた記録も残りません。' || E'\n' ||
          '採用の確定、または見送りの判断をお願いします。' || E'\n\n' ||
          'https://chitose-bank.com/#/calendar/todo/hire');
      exception when others then null; end;
    end loop;
  end if;
end; $function$;
