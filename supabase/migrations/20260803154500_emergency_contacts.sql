-- 緊急連絡先（2026-08-03たきと指示「農家と働き手プロフィールに緊急連絡先ボックスを新設。採用後に開示する」）
--
-- 【設計の根拠】2026-07-30 裁定(B)（契約成立後の氏名開示）と同じ枠組み：
--   ・保管場所は専用テーブル1つ（本人しか読めない）。worker_profiles／employer_profiles には置かない。
--     ★理由：worker_profiles は「wp farmer select via application」で応募があれば農家が全列を読めるため、
--       そこに置くと採用前（応募段階）に見えてしまい「採用後に開示」が守れない。RLSは行単位で列を絞れない。
--   ・唯一の開示窓口は contract_emergency_contact(application_id)＝SECURITY DEFINER・当事者のみ・
--     terms_snapshot（＝双方が確認カードを確認した＝採用成立）が無ければ返さない。
--   ・運営（app_admins）にも開けない：データ最小化。必要になった時点で別途判断する。
-- 【運営ポリシーとの関係】CLAUDE.md「連絡先の表示・交換機能は設けない」は一般公開・当事者間の日常連絡の話。
--   本件は労働安全（作業中の事故時に家族へ連絡する）のための、採用成立後・相手方のみへの限定開示。
--   サイト内チャットの代替にはしない（＝一覧・プロフィール・求人ページには一切出さない）。
-- 【第三者の個人情報】登録されるのは本人以外（家族等）の連絡先so、入力画面で
--   「ご本人に伝えて同意を得たうえでご登録ください」と明示する（フロント側）。

create table if not exists public.emergency_contacts (
  auth_id    uuid primary key references auth.users(id) on delete cascade,
  name       text not null default '',
  relation   text not null default '',
  phone      text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.emergency_contacts enable row level security;

-- self-only（本人のみ読み書き）。他人は行ごと見えない＝直接SELECTでは絶対に漏れない
drop policy if exists "ec own select" on public.emergency_contacts;
create policy "ec own select" on public.emergency_contacts
  for select to authenticated using (auth_id = auth.uid());
drop policy if exists "ec own insert" on public.emergency_contacts;
create policy "ec own insert" on public.emergency_contacts
  for insert to authenticated with check (auth_id = auth.uid());
drop policy if exists "ec own update" on public.emergency_contacts;
create policy "ec own update" on public.emergency_contacts
  for update to authenticated using (auth_id = auth.uid()) with check (auth_id = auth.uid());
drop policy if exists "ec own delete" on public.emergency_contacts;
create policy "ec own delete" on public.emergency_contacts
  for delete to authenticated using (auth_id = auth.uid());

-- 唯一の開示窓口（contract_party_name と同型）：
--   not_found／not_party／not_contracted は中身を返さない。採用成立後のみ相手方の緊急連絡先を返す
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
  return json_build_object('ok', true, 'empty', false,
    'name', nullif(btrim(v_ec.name), ''),
    'relation', nullif(btrim(v_ec.relation), ''),
    'phone', nullif(btrim(v_ec.phone), ''));
end; $function$;

revoke execute on function public.contract_emergency_contact(uuid) from public, anon;
grant execute on function public.contract_emergency_contact(uuid) to authenticated;
