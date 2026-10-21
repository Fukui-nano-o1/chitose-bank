-- 段C：応募の条件を1本にする（2026-08-17 たきと指示「プロフィール設定条件は必要最低限。①〜④のみ」）
-- 旧：apply_to_job だけが別の条件（ニックネーム＋Q&A回答1件以上）を要求していた。このため
--   ・正規の応募ボタンでは Q&A を求められるのに、仮応募からの昇格は apply_to_job を通らず素通り（不公平）
--   ・4項目を満たしても Q&A が無いと本応募だけ弾かれ、もう一段別のモーダルが出ていた
-- 新：apply_to_job も is_worker_profile_ready（4項目）を見る＝仮応募・昇格・本応募の条件が同一になる。
--   Q&A（質問への回答）は条件から外れる＝プロフィールの充実であって応募の必要条件ではない。
-- ★app_settings.apply_profile_gate は残す（キルスイッチ）。'true'＝4項目を要求／'false'＝要求しない。
--   キーの名前は同じでも、見る中身が「Q&A1件」から「4項目（is_worker_profile_ready）」に変わった。
-- ★本人情報の登録（account_holders）の確認も本応募側に置く（promote と対・たきと裁定①）。
--   18歳確認と規約同意の記録を迂回した応募が農家に届かないための壁を、両方の経路に同じ形で置く。
-- ★返す reason は 'profile_incomplete' のまま（フロントが仮応募へ切り替える合図として使う）。
--   足りない項目の内訳は返さない＝どの項目かは画面側が is_worker_profile_ready と同じ写しで出す。

create or replace function public.apply_to_job(p_job_number integer, p_available_dates jsonb default null)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_worker_id uuid; v_farmer_id uuid; v_status text; v_app_id uuid;
  v_date_start date; v_date_end date; v_is_period boolean; v_avail jsonb;
begin
  v_worker_id := auth.uid();
  if v_worker_id is null then return json_build_object('ok', false, 'reason', 'not_logged_in'); end if;
  if public.is_account_moderated(v_worker_id) then
    return json_build_object('ok', false, 'reason', 'account_suspended');
  end if;

  select farmer_id, status, date_start, date_end into v_farmer_id, v_status, v_date_start, v_date_end from public.jobs where job_number = p_job_number;
  if v_farmer_id is null then return json_build_object('ok', false, 'reason', 'job_not_found'); end if;
  if v_status <> 'open' then return json_build_object('ok', false, 'reason', 'job_not_open'); end if;
  -- 求人者(農家)が停止・追放中なら、その求人は募集終了として扱う（2026-08-16）
  if public.is_account_moderated(v_farmer_id) then return json_build_object('ok', false, 'reason', 'job_not_open'); end if;
  if v_farmer_id = v_worker_id then return json_build_object('ok', false, 'reason', 'own_job'); end if;

  -- 期間求人（date_end有り・単日でない）は「来られる日」の宣言が必須。単日求人は null で従来どおり
  v_is_period := v_date_end is not null and v_date_end <> v_date_start;
  if v_is_period then
    if p_available_dates is null
       or not (p_available_dates = '"any"'::jsonb
               or (jsonb_typeof(p_available_dates) = 'array' and jsonb_array_length(p_available_dates) > 0)) then
      return json_build_object('ok', false, 'reason', 'dates_required');
    end if;
    v_avail := p_available_dates;
  else
    v_avail := null;
  end if;

  -- ★(a) 自由記述の審査待ち（pr_pending）では応募を止めない。未承認の本文は農家に見えない
  --   （worker_profile_for_farmer が under_review を返す）＝公開はしていない。審査を応募の関所にしない。

  -- 本人情報の登録（18歳確認・規約同意の記録）が無いまま応募を届けない（2026-08-17 段B・段C）
  if not exists (select 1 from public.account_holders h where h.auth_id = v_worker_id) then
    return json_build_object('ok', false, 'reason', 'not_registered');
  end if;

  -- ★(b) プロフィールの条件は is_worker_profile_ready（4項目）1本＝仮応募・昇格と同じ物差し（2026-08-17 段C）
  if exists (select 1 from public.app_settings where key = 'apply_profile_gate' and value = 'true') then
    if not public.is_worker_profile_ready(v_worker_id) then
      return json_build_object('ok', false, 'reason', 'profile_incomplete');
    end if;
  end if;

  insert into public.applications (job_number, worker_id, farmer_id, status, available_dates)
  values (p_job_number, v_worker_id, v_farmer_id, 'applied', v_avail)
  on conflict (job_number, worker_id) where status <> 'canceled' do nothing
  returning id into v_app_id;
  if v_app_id is null then return json_build_object('ok', true, 'already', true); end if;

  begin
    insert into public.messages (application_id, sender_id, body)
    values (v_app_id, v_worker_id, 'あなたの求人に応募しました！プロフィールの確認をお願いします。');
    if exists (select 1 from public.applications a where a.id = v_app_id and a.status = 'approved') then
      insert into public.messages (application_id, sender_id, body)
      values (v_app_id, v_farmer_id, '🌟リピート即決の設定により、応募を自動で承認しました（採用ではありません）。チャットで打ち合わせを進めましょう。');
    end if;
  exception when others then null; end;

  return json_build_object('ok', true, 'application_id', v_app_id);
end; $function$;

revoke all on function public.apply_to_job(integer, jsonb) from public, anon;
grant execute on function public.apply_to_job(integer, jsonb) to authenticated, service_role;
