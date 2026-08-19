-- 緊急連絡先の開示ゲートを統合する（2026-08-19・二頭運転の衝突の復旧）。
--
-- 経緯：20260819020715（別セッション）＝相手が最新プラポリに同意済みかで塞ぐ「同意ゲート」。
--       20260819021055（本セッション）＝本人が内容を確認して保存したかで塞ぐ「確認ゲート」。
--       後者が前者を上書きし、同意ゲートが消えていた。両者は排他ではなく補完関係so統合する。
--       （PrivacyReconsent.jsx が App.jsx に配線済み＝版が古い人には同意するまで閉じられない
--         画面が出るため、同意ゲートで開かなくなる利用者は次回ログインで自力で解消できる）
--
-- 開示の条件（すべて満たしたときだけ氏名・続柄・電話を返す）：
--   1) 当事者であること            → 他は not_party
--   2) 採用が成立していること       → 他は not_contracted
--   3) 相手が最新プラポリに同意済み → 他は not_consented
--   4) 相手が内容を確認して保存済み → 他は not_confirmed（自動初期登録のままは出さない）
create or replace function public.contract_emergency_contact(p_application_id uuid)
returns json
language plpgsql
stable security definer
set search_path to 'public'
as $fn$
declare
  v_w uuid; v_f uuid; v_snap jsonb; v_other uuid;
  v_ec public.emergency_contacts%rowtype;
  v_cur text; v_agreed text;
begin
  select worker_id, farmer_id, terms_snapshot into v_w, v_f, v_snap
    from public.applications where id = p_application_id;
  if v_w is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if auth.uid() is null then return json_build_object('ok', false, 'reason', 'not_party'); end if;
  if auth.uid() not in (v_w, v_f) then return json_build_object('ok', false, 'reason', 'not_party'); end if;
  if v_snap is null then
    return json_build_object('ok', false, 'reason', 'not_contracted',
      'message', '採用が決まると、お互いの緊急連絡先が表示されます');
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
  if v_ec.auth_id is null
     or (coalesce(btrim(v_ec.name),'') = '' and coalesce(btrim(v_ec.phone),'') = '') then
    return json_build_object('ok', true, 'empty', true,
      'message', '相手の緊急連絡先は登録されていません');
  end if;
  if v_ec.confirmed_at is null then
    return json_build_object('ok', true, 'empty', true, 'reason', 'not_confirmed',
      'message', '相手の緊急連絡先は、ご本人の確認が済んでいないため表示できません');
  end if;
  return json_build_object('ok', true, 'empty', false,
    'name', nullif(btrim(v_ec.name), ''),
    'relation', nullif(btrim(v_ec.relation), ''),
    'phone', nullif(btrim(v_ec.phone), ''));
end; $fn$;
