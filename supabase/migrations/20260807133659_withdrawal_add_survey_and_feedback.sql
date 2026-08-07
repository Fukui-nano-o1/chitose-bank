-- 退会処理の取りこぼし修理・段②③（2026-08-07・退会要素の洗い出しの続き）
--
-- 段②：user_onboarding_survey（きっかけアンケート・auth_id）＝本人の行動データ・相手方なし
--       ＝行ごと削除（設計台帳v1(a)の思想どおり）。
-- 段③：feedback（自由記述・reporter_id）＝本人の書いたもの。reporter_id が NOT NULL so
--       匿名化（null化）はスキーマ変更なしには不可＝行ごと削除にする（本人の記述は本人のものso退会で消す）。
--       ※運営の改善材料としての価値はあるthat、個人の自由記述を退会後も本人紐づきで残す方が重い。
-- 段①（consignment_profiles）は 20260807133000 で適用済み。本migrationはその版に②③を足す。
-- 検証済み（ロールバック付き実弾）：合成ユーザー→退会→survey=0・feedback=0。

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

  -- (c) 退会処理の記録（申請行があれば processed_at を刻む・無ければ申請兼処理として1行作る）
  update public.withdrawal_requests set processed_at = now()
   where auth_id = p_auth_id and processed_at is null;
  get diagnostics n = row_count;
  if n = 0 then
    insert into public.withdrawal_requests (auth_id, requested_at, processed_at)
    values (p_auth_id, now(), now());
  end if;

  return json_build_object('ok', true, 'deleted', d,
    'note', 'アイコン画像（avatars/' || p_auth_id || '/）はストレージAPIから手動で削除すること（SQL削除はプラットフォームで禁止）。');
end $function$;
