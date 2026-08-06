-- 後追い記録：キリトの #1054（7/21）・#1056（7/24）を採用・完了として記録し直す
-- （2026-08-05たきと指示「1の採用・完了として記録し直してほしい」）。
--
-- 【なぜ記録がなかったか】どちらも、実際には作業が行われたのに、アプリ上で採用（雇い手の確認）が
--   記録されないまま作業開始時刻を迎え、cron（expire_stale_applications）が失効させていた。
--   ＝「働いた事実はあるのに記録がない」状態。記録は事実に合わせて残す（行動記録の憲法）。
--   #1054：7/20 22:06 に承認済み → 7/26 11:18 に失効（承認時刻 decided_at も失効時刻で上書きされた）
--   #1056：承認の記録なし（applied のまま）→ 7/24 16:10 に失効
--   ※ 同じ人の #1028 は完了に戻さない。作業日が 2026-12-10〜16（未来）で、7/22 の完了は
--     実態と合わないため（2026-07-25 の一括取り消しは、この行については妥当だった）。
--
-- 【何を入れ、何を空のままにするか】記録にない時刻を作らないための線引き：
--   入れる  … status=completed／attended=true（働いた事実）
--             terms_confirmed_farmer_at＝採用（求人の作業開始時刻。遅くともこの時点で成立していた）
--             work_completed_at＝完了（求人の作業終了時刻）
--             decided_at … #1054 は監査台帳に残る本来の承認時刻に戻す。#1056 は承認の記録が
--                          無いので採用時刻に合わせる
--   空のまま… started_at（打刻）／farmer_confirmed_start_at／worker_confirmed_end_at
--             ＝打刻は行われていない。入れれば遅刻判定が動いてしまうため、
--               「記録なし」に倒す（憶測で遅刻にも時間どおりにもしない・2026-08-05の数え方の規約）。
--             terms_snapshot（契約の凍結）も作らない。当時の契約書面は存在せず、
--               後から賃金条件つきの契約記録を作文しないため。
--   時刻は求人の日程と勤務時間（jobs.date_start / work_time）から出す＝憶測ではなく記録からの導出。
--
-- 【実行者】監査台帳（event_audit）に運営（ADMIN_EMAIL）の操作として残るよう、
--   request.jwt.claims を運営に設定してから更新する。actor が null（＝出どころ不明）のまま
--   記録を書き換えない。管理者なので firehose の実況メールは飛ばない（働き手にも通知は送らない
--   ＝2週間前の作業に「お疲れさまでした」を今さら送らない）。
do $$
declare
  v_admin uuid;
  v_worker uuid;
  v_n int;
begin
  select a.auth_id into v_admin from public.app_admins a
    join auth.users u on u.id = a.auth_id where u.email = 't5fki6643qty@gmail.com';
  select auth_id into v_worker from public.worker_profiles where nickname = 'キリト';
  if v_admin is null or v_worker is null then
    raise exception '運営または対象の働き手を特定できませんでした（admin=% worker=%）', v_admin, v_worker;
  end if;
  perform set_config('request.jwt.claims',
    json_build_object('role','authenticated','sub',v_admin)::text, true);

  update public.applications a
     set status = 'completed',
         attended = true,
         terms_confirmed_farmer_at = (j.date_start::text || ' ' ||
           to_char(public.job_scheduled_start(j.work_time),'HH24:MI'))::timestamp at time zone 'Asia/Tokyo',
         work_completed_at = (j.date_start::text || ' ' ||
           (regexp_match(j.work_time, '(\d{1,2}:\d{2})〜(\d{1,2}:\d{2})'))[2])::timestamp at time zone 'Asia/Tokyo',
         decided_at = case a.job_number
           when 1054 then timestamptz '2026-07-20 13:06:47+00'  -- 監査台帳に残る本来の承認時刻
           else (j.date_start::text || ' ' ||
             to_char(public.job_scheduled_start(j.work_time),'HH24:MI'))::timestamp at time zone 'Asia/Tokyo'
         end
    from public.jobs j
   where j.job_number = a.job_number
     and a.worker_id = v_worker
     and a.job_number in (1054, 1056)
     and a.status = 'expired';   -- 失効している行だけ＝二重適用しても増えない
  get diagnostics v_n = row_count;
  if v_n <> 2 then
    raise exception '2件のはずが % 件でした（対象の状態が想定と違う）', v_n;
  end if;
end $$;
