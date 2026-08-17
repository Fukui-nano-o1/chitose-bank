-- 退会時に、退会農家の公開中/審査中の求人を掲載終了に（2026-08-07・退会後の余波X4への対処）
--
-- 【穴】process_withdrawal は jobs を消さない（過去求人＝証跡so消さない・trg_block_delete_past_job）。
-- 農家が退会してもopen求人が jobs_public に残り、応募を受け付け続けうる（雇い手は不在なのに）。
-- ★third_party_publish_allowed は既に'true'（届出完了・第三者公開解禁済み）＝一般農家がopen求人を
--   持てる現在の状態so、これは将来リスクでなく今そこにある穴。
-- 【対処】退会時に farmer_id=退会者 の status in ('open','pending') を 'closed' に更新（掲載終了）。
--   行は消さない＝過去求人の証跡は残る。draftは公開されていないso対象外。closedは既にclosed。
-- 検証済み（ロールバック付き実弾）：closed化・トリガー例外なし・応募が job_not_open で拒否・行は残る。
-- 削除17テーブル・匿名化・冪等な(c)は 20260807144755 から不変（jobs closed化を(a)末尾に追加）。

create or replace function public.process_withdrawal(p_auth_id uuid)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_caller uuid := auth.uid();
  d jsonb := '{}'::jsonb;
  n int;
begin
  if v_caller is not null and not exists (select 1 from public.app_admins a where a.auth_id = v_caller) then
    return json_build_object('ok', false, 'reason', 'not_admin');
  end if;
  if exists (select 1 from public.app_admins a where a.auth_id = p_auth_id) then
    return json_build_object('ok', false, 'reason', 'target_is_admin');
  end if;
  if not exists (select 1 from auth.users where id = p_auth_id) then
    return json_build_object('ok', false, 'reason', 'user_not_found');
  end if;

  -- (a) 本人の届出情報・行動の好み＝行ごと削除（対象はコメントの列挙と1対1・汎用化しない）
  delete from public.worker_profiles      where auth_id  = p_auth_id; get diagnostics n = row_count; d := d || jsonb_build_object('worker_profiles', n);
  delete from public.employer_profiles    where auth_id  = p_auth_id; get diagnostics n = row_count; d := d || jsonb_build_object('employer_profiles', n);
  delete from public.consignment_profiles where auth_id  = p_auth_id; get diagnostics n = row_count; d := d || jsonb_build_object('consignment_profiles', n);
  delete from public.account_holders      where auth_id  = p_auth_id; get diagnostics n = row_count; d := d || jsonb_build_object('account_holders', n);
  delete from public.emergency_contacts   where auth_id  = p_auth_id; get diagnostics n = row_count; d := d || jsonb_build_object('emergency_contacts', n);
  delete from public.push_subscriptions   where auth_id  = p_auth_id; get diagnostics n = row_count; d := d || jsonb_build_object('push_subscriptions', n);
  delete from public.saved_jobs           where worker_id = p_auth_id; get diagnostics n = row_count; d := d || jsonb_build_object('saved_jobs', n);
  delete from public.repeat_roster        where farmer_id = p_auth_id or worker_id = p_auth_id; get diagnostics n = row_count; d := d || jsonb_build_object('repeat_roster', n);
  delete from public.pending_applications where worker_id = p_auth_id; get diagnostics n = row_count; d := d || jsonb_build_object('pending_applications', n);
  delete from public.chat_reads           where reader_id = p_auth_id; get diagnostics n = row_count; d := d || jsonb_build_object('chat_reads', n);
  delete from public.notifications        where farmer_id = p_auth_id; get diagnostics n = row_count; d := d || jsonb_build_object('notifications', n);
  delete from public.page_events          where auth_id  = p_auth_id; get diagnostics n = row_count; d := d || jsonb_build_object('page_events', n);
  delete from public.auth_logs            where farmer_id = p_auth_id; get diagnostics n = row_count; d := d || jsonb_build_object('auth_logs', n);
  delete from public.farmers              where auth_id  = p_auth_id; get diagnostics n = row_count; d := d || jsonb_build_object('farmers', n);
  delete from public.records              where farmer_id = p_auth_id; get diagnostics n = row_count; d := d || jsonb_build_object('records', n);
  delete from public.user_onboarding_survey where auth_id = p_auth_id; get diagnostics n = row_count; d := d || jsonb_build_object('user_onboarding_survey', n);
  delete from public.feedback             where reporter_id = p_auth_id; get diagnostics n = row_count; d := d || jsonb_build_object('feedback', n);

  -- 退会農家の公開中/審査中の求人を掲載終了に（2026-08-07 X4）：行は消さず応募受付だけ止める。
  -- draftは公開されていないso対象外。過去求人の証跡（応募・はたらいた記録）は残す。
  update public.jobs set status = 'closed' where farmer_id = p_auth_id and status in ('open','pending');
  get diagnostics n = row_count; d := d || jsonb_build_object('jobs_closed', n);

  -- (b) メールの削除＝匿名化（行は残す・FKと証跡は無傷）
  update auth.users set
    email = 'withdrawn+' || p_auth_id || '@withdrawn.invalid',
    encrypted_password = '',
    raw_user_meta_data = '{}'::jsonb,
    phone = null,
    email_change = '',
    email_change_token_new = '',
    confirmation_token = '',
    recovery_token = '',
    banned_until = 'infinity'
  where id = p_auth_id;
  delete from auth.identities      where user_id = p_auth_id;
  delete from auth.sessions        where user_id = p_auth_id;
  delete from auth.one_time_tokens where user_id = p_auth_id;
  delete from auth.mfa_factors     where user_id = p_auth_id;

  -- (c) 退会処理の記録（冪等・2026-08-07 W4修正）：申請行があれば processed_at を刻む／無ければ1行作る。
  -- 二重実行しても行は増えない（旧版は update 0行→insert で増殖していた）
  if exists (select 1 from public.withdrawal_requests where auth_id = p_auth_id) then
    update public.withdrawal_requests set processed_at = coalesce(processed_at, now())
     where auth_id = p_auth_id;
  else
    insert into public.withdrawal_requests (auth_id, requested_at, processed_at)
    values (p_auth_id, now(), now());
  end if;

  return json_build_object('ok', true, 'deleted', d,
    'note', 'アイコン画像（avatars/' || p_auth_id || '/）はストレージAPIから手動で削除すること（SQL削除はプラットフォームで禁止）。');
end $function$;
