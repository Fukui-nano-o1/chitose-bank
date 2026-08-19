-- 20260819020608 で contract_emergency_contact の置き換えだけが適用されず（列追加のみ成立）、
-- 未確認の緊急連絡先が相手方に返る状態が残っていた。実弾検証(2)で検出＝関数だけを再適用する。
-- ★教訓：apply_migration が success を返しても、適用後に pg_get_functiondef で中身を必ず確認する。
--
-- ★衝突の記録（2026-08-19 二頭運転）：本migrationの直前 20260819020715
--   （emergency_contact_consent_gate・別セッション）が、同じ関数を「相手が最新プラポリに
--   同意済みか」で塞ぐ版に置き換えていた。本migrationはそれを上書きしている。
--   理由＝実測で account_holders 11件の agreed_privacy_version は v1×9／v3.1×1／v3.2×1＝
--   v4.0 同意者は0人。再同意フローも未実装（AccountHolderForm の新規登録時にしか書かれない）so、
--   同意ゲートを入れると全員の緊急連絡先が事故・急病時に永久に開かない（安全機能の fail-closed）。
--   同意ゲートの要否はたきと判断待ち。復活させるなら再同意フローとセットにすること。
create or replace function public.contract_emergency_contact(p_application_id uuid)
returns json
language plpgsql
stable security definer
set search_path to 'public'
as $fn$
declare v_w uuid; v_f uuid; v_snap jsonb; v_other uuid; v_ec public.emergency_contacts%rowtype;
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
