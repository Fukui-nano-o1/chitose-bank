-- Require explicit confirmation for every emergency contact, including self contacts.
-- Only disclose the saved contact fields; clearing them must not restore account data.
-- Existing party, contract, privacy-consent and work-window checks are unchanged.
begin;
CREATE OR REPLACE FUNCTION public.contract_emergency_contact(p_application_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_w uuid; v_f uuid; v_snap jsonb; v_other uuid;
  v_started timestamptz; v_completed timestamptz;
  v_ec public.emergency_contacts%rowtype;
  v_cur text; v_agreed text; v_name text; v_phone text;
begin
  select worker_id, farmer_id, terms_snapshot, started_at, work_completed_at
    into v_w, v_f, v_snap, v_started, v_completed
    from public.applications where id = p_application_id;
  if v_w is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if auth.uid() is null then return json_build_object('ok', false, 'reason', 'not_party'); end if;
  if auth.uid() not in (v_w, v_f) then return json_build_object('ok', false, 'reason', 'not_party'); end if;
  if v_snap is null then
    return json_build_object('ok', false, 'reason', 'not_contracted',
      'message', '採用が決まると、お互いの緊急連絡先が表示されます');
  end if;

  -- 仕事の開始から終了までの間だけ表示する（2026-08-25たきと指示「緊急連絡先ボタンは仕事の
  -- 開始から終了まで。それ以外はいかなる理由でも見せない」）。開始＝started_at（自動開始）、
  -- 終了＝work_completed_at（完了の記録）。どちらかが分からない時は見せない側に倒す。
  if v_started is null or v_completed is not null then
    return json_build_object('ok', false, 'reason', 'not_working',
      'message', '緊急連絡先は、仕事の開始から終了までの間だけ表示されます');
  end if;

  v_other := case when auth.uid() = v_f then v_w else v_f end;

  select value into v_cur from public.app_settings where key = 'privacy_version';
  select agreed_privacy_version into v_agreed
    from public.account_holders where auth_id = v_other;
  if v_cur is null or v_agreed is null or v_agreed <> v_cur then
    return json_build_object('ok', false, 'reason', 'not_consented',
      'message', '相手の方がプライバシーポリシーの改訂に同意すると表示されます');
  end if;

  select * into v_ec from public.emergency_contacts where auth_id = v_other;
  -- 「本人」を含め、内容を確認して保存した行だけを開示する。
  -- 自動初期登録・未登録の連絡先は、登録情報で補わない。
  if v_ec.confirmed_at is null then
    return json_build_object('ok', true, 'empty', true, 'reason', 'not_confirmed',
      'message', '相手の緊急連絡先は、ご本人の確認が済んでいないため表示できません');
  end if;
  v_name := nullif(btrim(v_ec.name), '');
  v_phone := nullif(btrim(v_ec.phone), '');
  if v_name is null and v_phone is null then
    return json_build_object('ok', true, 'empty', true,
      'message', '相手の緊急連絡先は登録されていません');
  end if;
  return json_build_object('ok', true, 'empty', false,
    'name', v_name,
    'relation', nullif(btrim(v_ec.relation), ''),
    'phone', v_phone);
end; $function$;
revoke all on function public.contract_emergency_contact(uuid) from public, anon;
grant execute on function public.contract_emergency_contact(uuid) to authenticated;
comment on function public.contract_emergency_contact(uuid) is
  '契約当事者に、作業開始から終了までの間だけ、現行プライバシーポリシーに同意し内容を確認・保存した相手の緊急連絡先を返す。本人の連絡先も confirmed_at 必須。';
commit;
