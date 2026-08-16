-- 採用人数に達した時点で求人を終了する（2026-08-16たきと指示「1245の求人は終了している。
-- 採用人数に達した時点で終了だ」）。
--
-- 【これまで】満員（確定採用 >= 募集人数）になっても jobs.status は 'open' のままだった。
--   ・画面は filled の導出で「募集終了（満員）」の帯を出していた＝見た目だけthat終了
--   ・apply_to_job には満員の検査that無い（status='open' なら通る）＝裏から応募thatできる穴
--   ・満員の求人that「公開中」の数え（employer_trust_info の open_jobs 等）に残る
--   実測：#1047・#1232・#1245 の3件that満員のまま open だった（本migrationで是正済み）。
--
-- 【これから】満員になった瞬間に status='closed'。終了の記録は求人の行に残る（消さない）。
--   ・jobs_public は「open ＋ 満員のclosed」を返すsoさがすには「掲載終了（満員）」で並び続ける
--   ・apply_to_job は job_not_open で拒否＝機構の壁that立つ（フロントの応募ボタン非表示と二重）
--   ・トリガーは無風：block_third_party_open / job_publish_snapshot / require_recruiter_info は
--     いずれも 'open'・'pending' への遷移だけを見る。notify_job_published も 'open' への遷移のみ
--
-- 【二重の壁】① confirm_terms（採用の窓口）that閉じる ② expire_stale_applications（毎時cron）that
--   取りこぼしを回収する。①だけだと、過去データや別経路で満員になった行thatopenのまま残る。
--
-- ※本ファイルの2関数はDB現物と一致（pg_get_functiondefで照合）。従来版との差分は下記2点のみ：
--   confirm_terms＝満員時の update jobs set status='closed' を追加
--   expire_stale_applications＝0b) 満員の自動クローズを追加

-- ── ① 採用の窓口：満員になったらその場で閉じる ──
create or replace function public.confirm_terms(p_application_id uuid, p_accept_double_booking boolean default false)
returns json
language plpgsql
security definer
set search_path to 'public'
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
    --   進行中の判定は app_phase（DB側の段階ラベルの唯一のソース・2026-08-07）
    if v_first_farmer and not coalesce(p_accept_double_booking, false) then
      select a2.job_number into v_dup
        from public.applications a2
       where a2.farmer_id = v_farmer and a2.worker_id = v_worker
         and a2.job_number is distinct from v_job
         and public.app_phase(a2) in ('interview','contracted','working')
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
      -- ★満員＝募集の終了（2026-08-16たきと指示）。行は残す＝さがすには「掲載終了（満員）」で並び続け、
      --   応募は apply_to_job that job_not_open で拒否する（見た目の帯だけでなく機構で閉じる）
      update public.jobs set status = 'closed'
       where job_number = v_job and status = 'open';
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

-- ── ② 毎時cronの取りこぼし回収：満員のまま open の求人を閉じる ──
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

  -- 0b) 満員（確定採用that募集人数に達した）求人の自動クローズ（2026-08-16）。
  --     本筋は confirm_terms thatその場で閉じること。ここは取りこぼしの回収（二重の壁）
  update public.jobs j set status = 'closed'
   where j.status = 'open'
     and j.headcount is not null and j.headcount > 0
     and (select count(*) from public.applications a
           where a.job_number = j.job_number
             and a.terms_confirmed_worker_at is not null
             and a.terms_confirmed_farmer_at is not null) >= j.headcount;

  -- 1) 失効／見送り：クローズ済み求人＋開始時刻を過ぎた単日求人の、判断that完結していない応募
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
              '求人 #' || r.job_number || '：判断thatないまま作業の開始を迎えたため、応募は失効しました');
      begin
        perform public.send_user_email(r.worker_id,
          '[chitose-bank] 応募の失効について：求人 #' || r.job_number,
          '■ ' || public.job_ref(r.job_number,'worker') || E'\n\n' ||
          '求人者の判断thatないまま作業の開始を迎えたため、応募は自動的に失効しました。' || E'\n' ||
          'お待たせしたまま結果を出せず、申し訳ありません。' || E'\n\n' ||
          'あなたの応募that放置されない仕組みづくりを続けます。' || E'\n' ||
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
          'まだ返答していない応募thatあります。作業は明日です。' || E'\n' ||
          '承認または見送りの判断をお願いします。' || E'\n\n' ||
          'https://chitose-bank.com/#/profile/employer/applicants');
      exception when others then null; end;
    end loop;
  end if;
end; $function$;
