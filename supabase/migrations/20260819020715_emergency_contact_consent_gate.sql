-- 緊急連絡先の第三者開示に、本人の同意版のゲートを足す（2026-08-19たきと指示）
--
-- 背景（同日の実弾確認）：contract_emergency_contact は当事者性と terms_snapshot だけを見ており、
-- 緊急連絡先の【本人】がプライバシーポリシーの現行版に同意していなくても、相手方に氏名と電話を返していた。
-- 個人情報保護法27条1項（本人の同意なき第三者提供の禁止）に触れるため、ここで塞ぐ。
--
-- 設計：
-- ・ゲートの対象は【開示されるデータの本人】＝相手方(v_other)。請求する側の同意版は見ない。
-- ・現行版は app_settings.privacy_version の1行に持つ。版を上げる時はこの1行を UPDATE すればよい
--   （デプロイ不要。third_party_publish_allowed と同じ作法）。
--   ★フロントの lib/utils.js PRIVACY_VERSION と必ず同じ文字列にすること。ズレると全員が未同意扱いになる。
-- ・設定行が無い場合は開示しない（フェイルクローズ）。2026-07-29のフェイルオープンと同じ穴を作らない。

insert into public.app_settings (key, value, updated_at)
values ('privacy_version', 'v4.0-2026-08', now())
on conflict (key) do update set value = excluded.value, updated_at = now();

create or replace function public.contract_emergency_contact(p_application_id uuid)
returns json
language plpgsql
stable security definer
set search_path to 'public'
as $function$
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

  -- 本人が現行のプライバシーポリシーに同意しているときだけ第三者へ返す
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
  return json_build_object('ok', true, 'empty', false,
    'name', nullif(btrim(v_ec.name), ''),
    'relation', nullif(btrim(v_ec.relation), ''),
    'phone', nullif(btrim(v_ec.phone), ''));
end; $function$;
