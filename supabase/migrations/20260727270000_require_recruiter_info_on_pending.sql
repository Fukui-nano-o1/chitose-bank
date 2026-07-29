-- 掲載申請（status='pending'）にも募集者情報を必須にする（2026-07-27たきと指示）
-- 掲載(open)だけでなく、農家が運営に出す掲載申請の時点で
-- ①氏名・名称 ②住所・所在地 ③連絡先 を揃える（労働者の募集広告の明示事項）。
-- エラーは RECRUITER_INFO_REQUIRED:不足項目 の形にして、画面側が入力ボックスを開けるようにする。
create or replace function public.trg_require_recruiter_info()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_name text; v_addr text; v_contact text; v_missing text[] := array[]::text[];
begin
  if new.status in ('open','pending') and coalesce(old.status, '') is distinct from new.status then
    select nullif(btrim(ep.recruiter_name), ''), nullif(btrim(ep.recruiter_address), ''), nullif(btrim(ep.recruiter_contact), '')
      into v_name, v_addr, v_contact
      from public.employer_profiles ep where ep.auth_id = new.farmer_id;
    if v_name    is null then v_missing := v_missing || '氏名・名称'::text; end if;
    if v_addr    is null then v_missing := v_missing || '住所・所在地'::text; end if;
    if v_contact is null then v_missing := v_missing || '連絡先'::text; end if;
    if array_length(v_missing, 1) > 0 then
      raise exception 'RECRUITER_INFO_REQUIRED:%', array_to_string(v_missing, '・');
    end if;
  end if;
  return new;
end;
$function$;
