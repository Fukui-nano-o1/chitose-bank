-- 既存の農家に募集者情報を挿入（2026-07-27たきと指示「既に登録している方もここに挿入」）
-- 本人が新規登録①で入力した内容（account_holders）から、未入力の欄だけを埋める。
-- 入っている値は上書きしない。法令上、募集広告に明示が必要な項目のため。
with src as (
  select ah.auth_id,
         nullif(btrim(coalesce(nullif(btrim(ah.company_name),''), ah.full_name)),'') as nm,
         nullif(btrim(concat_ws(' ', case when btrim(coalesce(ah.postal_code,''))<>'' then '〒'||btrim(ah.postal_code) end, nullif(btrim(ah.address),''))),'') as ad,
         nullif(btrim(coalesce(nullif(btrim(ah.contact_phone),''), ah.contact_email)),'') as ct
  from public.account_holders ah
)
update public.employer_profiles ep
   set recruiter_name    = coalesce(nullif(btrim(ep.recruiter_name),''),    src.nm),
       recruiter_address = coalesce(nullif(btrim(ep.recruiter_address),''), src.ad),
       recruiter_contact = coalesce(nullif(btrim(ep.recruiter_contact),''), src.ct),
       updated_at = now()
  from src
 where src.auth_id = ep.auth_id
   and (nullif(btrim(ep.recruiter_name),'') is null
     or nullif(btrim(ep.recruiter_address),'') is null
     or nullif(btrim(ep.recruiter_contact),'') is null);
