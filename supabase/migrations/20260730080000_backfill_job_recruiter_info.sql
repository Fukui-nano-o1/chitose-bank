-- 募集主の法定表示（第14弾）：掲載時に jobs へ転写する仕組み（trg_job_recruiter_info）は導入済みだが、
-- それ以前に掲載された求人は控えが空のままだった＝求人ページで「未設定」と出てしまう。
-- 原本（employer_profiles）から埋め戻す。空でない既存値は上書きしない
update public.jobs j
   set recruiter_name    = coalesce(nullif(btrim(j.recruiter_name),''), nullif(btrim(ep.recruiter_name),'')),
       recruiter_address = coalesce(nullif(btrim(j.recruiter_address),''), nullif(btrim(ep.recruiter_address),'')),
       recruiter_contact = coalesce(nullif(btrim(j.recruiter_contact),''), nullif(btrim(ep.recruiter_contact),''))
  from public.employer_profiles ep
 where ep.auth_id = j.farmer_id
   and j.status in ('open','pending')
   and (coalesce(btrim(j.recruiter_name),'') = ''
     or coalesce(btrim(j.recruiter_address),'') = ''
     or coalesce(btrim(j.recruiter_contact),'') = '');
