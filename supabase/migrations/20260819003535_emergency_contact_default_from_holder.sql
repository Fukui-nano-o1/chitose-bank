-- 緊急連絡先：必須をやめ、新規登録の内容を初期値として自動で入れる
-- （2026-08-19 たきと指示「緊急連絡先必須を解除。代わりに、新規登録で入力した氏名と電話番号を
--  デフォルトに。任意で変更できるようにする」）。
--
-- 考え方：入力を求めない代わりに、全員が初期値を持っている状態をDB側で作る。
--   本人の情報を本人の緊急連絡先（関係＝本人）に写すだけなので、第三者の同意は要らない。
--   家族等に変えるのは従来どおり本人の任意（EmergencyContactBox に同意の注意書きあり）。
-- 開示の範囲は不変：採用が成立した相手方のみ（contract_emergency_contact）・self-only RLS。

-- 1) 応募の必須条件から緊急連絡先を外す（4項目→3項目）。
--    フロントの写しは lib/workerReady.js と WorkerProfileEdit のガイド＝変える時は3つとも直す。
create or replace function public.is_worker_profile_ready(p_uid uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from public.worker_profiles w
     where w.auth_id = p_uid
       and coalesce(btrim(w.nickname),'') <> ''
       and coalesce(btrim(w.residence_city),'') <> ''
       and (coalesce(btrim(w.pr),'') <> '' or coalesce(btrim(w.pr_pending),'') <> '')
  );
$function$;

-- 2) 新規登録（account_holders の作成）と同時に、氏名・電話・関係「本人」で1行作る。
--    ★INSERT のときだけ発火する。登録情報をあとから変えても上書きしない
--      （本人が家族等に変更した緊急連絡先を、住所変更などの保存で消さないため）。
--    ★すでに行がある人には何もしない（where not exists）。
create or replace function public.seed_emergency_contact_from_holder()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.emergency_contacts (auth_id, name, relation, phone, updated_at)
  select new.auth_id,
         coalesce(btrim(new.full_name), ''),
         '本人',
         coalesce(btrim(new.contact_phone), ''),
         now()
   where not exists (
     select 1 from public.emergency_contacts e where e.auth_id = new.auth_id
   );
  return null;
end;
$function$;

revoke all on function public.seed_emergency_contact_from_holder() from public, anon, authenticated;

drop trigger if exists seed_emergency_contact on public.account_holders;
create trigger seed_emergency_contact
  after insert on public.account_holders
  for each row execute function public.seed_emergency_contact_from_holder();

-- 3) すでに登録している人にも同じ初期値を入れる（自分で登録している人には触らない）。
insert into public.emergency_contacts (auth_id, name, relation, phone, updated_at)
select h.auth_id, coalesce(btrim(h.full_name), ''), '本人', coalesce(btrim(h.contact_phone), ''), now()
  from public.account_holders h
 where not exists (select 1 from public.emergency_contacts e where e.auth_id = h.auth_id);
