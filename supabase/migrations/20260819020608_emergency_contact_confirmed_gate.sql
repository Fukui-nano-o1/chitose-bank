-- 緊急連絡先：自動初期登録は残したまま「本人が確認するまで相手方に開示しない」壁を作る
-- （2026-08-19 たきと裁定D案）。
--
-- 背景：20260819003535 で account_holders への INSERT 時に emergency_contacts を自動生成する
--   トリガー seed_emergency_contact を入れた。行は本人が知らないうちに生まれるため、そのまま
--   採用成立で相手方へ出すと「本人が一度も見ていない連絡先」が相手に渡る。
-- 方針：行の存在（自動登録）と本人の確認（開示の可否）を別の事実として持つ。
--   自動登録 → confirmed_at IS NULL（未確認）→ 相手方に出さない
--   本人が保存 → confirmed_at = now()    → 初めて相手方に出る
-- ★UIを隠すだけでは足りないため、唯一の窓口 contract_emergency_contact（SECURITY DEFINER）で止める。
-- ★トリガーは消さない：守りたいのは「本人が知らないうちに相手へ出ない」ことであって、
--   テーブルに行が存在しないことではない。

alter table public.emergency_contacts
  add column if not exists confirmed_at timestamptz;

comment on column public.emergency_contacts.confirmed_at is
  '本人がこの緊急連絡先を確認して保存した時刻。NULL＝自動初期登録のまま未確認＝採用成立でも相手方に開示しない';

-- 既存行は全件 confirmed_at IS NULL（未確認）から始まる。自動生成か本人保存かを判別できる列が
-- 無いため、推測で確認済みにしない。該当者は一度だけ画面で確認して保存し直す。

create or replace function public.contract_emergency_contact(p_application_id uuid)
returns json
language plpgsql
stable security definer
set search_path to 'public'
as $function$
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
  -- ★本人がまだ内容を確認していない（自動初期登録のまま）＝中身は絶対に返さない
  if v_ec.confirmed_at is null then
    return json_build_object('ok', true, 'empty', true, 'reason', 'not_confirmed',
      'message', '相手の緊急連絡先は、ご本人の確認が済んでいないため表示できません');
  end if;
  return json_build_object('ok', true, 'empty', false,
    'name', nullif(btrim(v_ec.name), ''),
    'relation', nullif(btrim(v_ec.relation), ''),
    'phone', nullif(btrim(v_ec.phone), ''));
end; $function$;
