-- 二重予約のDB壁（2026-08-06 実機一周②）：confirm_terms に「明示の受諾なしなら拒否」を追加。
-- 従来はフロントの警告のみ（lib/hire.js findDoubleBookingJob）＝APIを直接叩けば素通りだった。
-- 判定式はフロントと同一（2026-08-06「式は必ずDBとフロントの両方を揃える」）：
--   同じ農家×同じ働き手の別応募が CHAT_ELIGIBLE_STATUSES（approved/meeting/interview/contracted/working）
--   にあり、両求人の date_start〜date_end（end無しは単日）が重なる場合。
-- 掛かるのは【農家の初回確定時のみ】（働き手の内容確認・2回目以降の冪等呼び出しには掛からない）。
-- p_accept_double_booking=true で通れる＝警告を読んで進む道は残す（警告の機構化であって禁止ではない。
-- 同日の朝夕2求人など正当な重なりがあるため）。フロント3窓口（応募者シート・採用するページ・チャット）は
-- 警告表示後に true を渡す（同日変更）。
-- シグネチャ変更のため旧1引数版はDROP（内部呼び出しゼロを確認済み）。
-- 検証済み（ロールバック付き実弾）：受諾なし=double_booked＋dup_job／受諾あり=ok／確定後の再呼び出し=ok／
-- 働き手の確認=ok／anon実行不可。

drop function if exists public.confirm_terms(uuid);

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
    -- ★二重予約の壁（2026-08-06）：初回確定・受諾なしの時だけ調べて拒否
    if v_first_farmer and not coalesce(p_accept_double_booking, false) then
      select j2.job_number into v_dup
        from public.applications a2
        join public.jobs j  on j.job_number  = v_job
        join public.jobs j2 on j2.job_number = a2.job_number
       where a2.farmer_id = v_farmer and a2.worker_id = v_worker
         and a2.job_number is distinct from v_job
         and a2.status in ('approved','meeting','interview','contracted','working')
         and j.date_start is not null and j2.date_start is not null
         and j.date_start <= coalesce(j2.date_end, j2.date_start)
         and j2.date_start <= coalesce(j.date_end, j.date_start)
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

  -- 採用決定（農家の初回タップ）：働き手へチャット＋メールをセット送信（2026-07-19）
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

  -- 採用人数に達したら、残りの応募を見送りにする（2026-07-27）
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

-- 権限：PUBLIC自動付与とdefault privilegesのanon付与の両方を外す（authenticatedのみ・
-- 当事者ゲートは関数内＝二重の壁）。★教訓の追補：Supabaseはdefault privilegesで関数作成時に
-- anon/authenticatedへ明示的にEXECUTEを付与するため、「from public」だけではanonに残る。
-- 必ず from public と from anon の両方をrevokeすること（本番では anon revoke を同日別クエリで適用済み）
revoke all on function public.confirm_terms(uuid, boolean) from public;
revoke execute on function public.confirm_terms(uuid, boolean) from anon;
grant execute on function public.confirm_terms(uuid, boolean) to authenticated, service_role;
