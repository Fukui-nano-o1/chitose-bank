-- Synthetic schema with the pre-fix production RPC captured on 2026-10-23.
create role anon; create role authenticated; create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to anon, authenticated;
create table public.applications(id uuid primary key, worker_id uuid not null, farmer_id uuid not null, terms_snapshot jsonb, started_at timestamptz, work_completed_at timestamptz);
create table public.account_holders(auth_id uuid primary key, full_name text, contact_phone text, agreed_privacy_version text);
create table public.app_settings(key text primary key, value text);
create table public.emergency_contacts(auth_id uuid primary key, name text, relation text, phone text, confirmed_at timestamptz, updated_at timestamptz);
alter table public.emergency_contacts enable row level security;
grant select, insert, update, delete on public.emergency_contacts to authenticated;
create policy own on public.emergency_contacts to authenticated using(auth_id=auth.uid()) with check(auth_id=auth.uid());
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
  v_name := nullif(btrim(v_ec.name), '');
  v_phone := nullif(btrim(v_ec.phone), '');
  -- 本人 の連絡先（新規登録の氏名・電話をそのまま使っている行）は、足りない値を登録情報で補う
  -- （2026-08-24たきと指示「プラポリと利用規約に同意したら新規登録で登録した電話番号を表示させる」）
  if coalesce(btrim(v_ec.relation), '') = '本人' or v_ec.auth_id is null then
    if v_name is null then
      select nullif(btrim(full_name), '') into v_name from public.account_holders where auth_id = v_other;
    end if;
    if v_phone is null then
      select nullif(btrim(contact_phone), '') into v_phone from public.account_holders where auth_id = v_other;
    end if;
  end if;
  if v_name is null and v_phone is null then
    return json_build_object('ok', true, 'empty', true,
      'message', '相手の緊急連絡先は登録されていません');
  end if;
  if v_ec.confirmed_at is null and coalesce(btrim(v_ec.relation), '') <> '本人' then
    return json_build_object('ok', true, 'empty', true, 'reason', 'not_confirmed',
      'message', '相手の緊急連絡先は、ご本人の確認が済んでいないため表示できません');
  end if;
  return json_build_object('ok', true, 'empty', false,
    'name', v_name,
    'relation', nullif(btrim(v_ec.relation), ''),
    'phone', v_phone);
end; $function$;
revoke all on function public.contract_emergency_contact(uuid) from public, anon;
grant execute on function public.contract_emergency_contact(uuid) to authenticated;
