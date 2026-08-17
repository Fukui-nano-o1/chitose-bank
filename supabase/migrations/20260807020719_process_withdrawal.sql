-- 退会処理（プラポリ第3条①「退会の申し出から30日以内に削除」の実行機構）
-- 2026-08-07 保存・削除の設計台帳v1の①をたきと承認（「可及的速やかに」）を受けて実装。
--
-- 【設計の要点（FK実測に基づく）】
-- ・auth.users の行削除は不可能：jobs.farmer_id / notifications.farmer_id 等が NO ACTION で参照
--   ＝求人を出した農家では DELETE が必ず失敗する。さらに行削除だと account_moderation（BAN記録）や
--   withdrawal_requests（退会処理の記録）が CASCADE で消える＝記録保全に反する。
--   → メールの削除は【匿名化】で行う：email を withdrawn+{uuid}@withdrawn.invalid に書き換え、
--     auth.identities / sessions / one_time_tokens / mfa_factors を削除、
--     banned_until='infinity' で再ログインを封鎖。uuid の行は残る＝全FK・全証跡が無傷。
-- ・行ごと削除＝本人の届出情報と行動の好み（証跡ではないもの）：
--   account_holders / worker_profiles / employer_profiles / emergency_contacts / push_subscriptions /
--   saved_jobs / repeat_roster / pending_applications / chat_reads / notifications / page_events /
--   auth_logs / farmers / records
-- ・残すもの（証跡・台帳で3年保存を約束）＝ applications / messages / reviews / jobs / time_corrections /
--   job_questions / event_audit / feedback / account_moderation。
--   匿名化は「表示名の参照先（プロフィール）が消える」ことで達成される（台帳①の約束どおり）。
-- ・ストレージ：storage.objects への SQL DELETE はプラットフォームで禁止so、アイコン（avatars/{uid}）の
--   削除はストレージAPIから手動＝返り値 note で毎回案内。job-photos/{uid} は求人の証跡so消さない。
-- ・ゲート：実行は運営（app_admins）のみ。対象が app_admins なら拒否（運営アカウントの誤爆防止）。
-- ・30日以内の期限管理は運営タスク（申請メール→本関数の実行）。processed_at が実行の記録。

create or replace function public.process_withdrawal(p_auth_id uuid)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
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

  delete from public.worker_profiles    where auth_id  = p_auth_id; get diagnostics n = row_count; d := d || jsonb_build_object('worker_profiles', n);
  delete from public.employer_profiles  where auth_id  = p_auth_id; get diagnostics n = row_count; d := d || jsonb_build_object('employer_profiles', n);
  delete from public.account_holders    where auth_id  = p_auth_id; get diagnostics n = row_count; d := d || jsonb_build_object('account_holders', n);
  delete from public.emergency_contacts where auth_id  = p_auth_id; get diagnostics n = row_count; d := d || jsonb_build_object('emergency_contacts', n);
  delete from public.push_subscriptions where auth_id  = p_auth_id; get diagnostics n = row_count; d := d || jsonb_build_object('push_subscriptions', n);
  delete from public.saved_jobs         where worker_id = p_auth_id; get diagnostics n = row_count; d := d || jsonb_build_object('saved_jobs', n);
  delete from public.repeat_roster      where farmer_id = p_auth_id or worker_id = p_auth_id; get diagnostics n = row_count; d := d || jsonb_build_object('repeat_roster', n);
  delete from public.pending_applications where worker_id = p_auth_id; get diagnostics n = row_count; d := d || jsonb_build_object('pending_applications', n);
  delete from public.chat_reads         where reader_id = p_auth_id; get diagnostics n = row_count; d := d || jsonb_build_object('chat_reads', n);
  delete from public.notifications      where farmer_id = p_auth_id; get diagnostics n = row_count; d := d || jsonb_build_object('notifications', n);
  delete from public.page_events        where auth_id  = p_auth_id; get diagnostics n = row_count; d := d || jsonb_build_object('page_events', n);
  delete from public.auth_logs          where farmer_id = p_auth_id; get diagnostics n = row_count; d := d || jsonb_build_object('auth_logs', n);
  delete from public.farmers            where auth_id  = p_auth_id; get diagnostics n = row_count; d := d || jsonb_build_object('farmers', n);
  delete from public.records            where farmer_id = p_auth_id; get diagnostics n = row_count; d := d || jsonb_build_object('records', n);

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

  update public.withdrawal_requests set processed_at = now()
   where auth_id = p_auth_id and processed_at is null;
  get diagnostics n = row_count;
  if n = 0 then
    insert into public.withdrawal_requests (auth_id, requested_at, processed_at)
    values (p_auth_id, now(), now());
  end if;

  return json_build_object('ok', true, 'deleted', d,
    'note', 'アイコン画像（avatars/' || p_auth_id || '/）はストレージAPIから手動で削除すること（SQL削除はプラットフォームで禁止）。');
end $$;

revoke all on function public.process_withdrawal(uuid) from public, anon;
grant execute on function public.process_withdrawal(uuid) to authenticated;  -- 内部で app_admins ゲート
