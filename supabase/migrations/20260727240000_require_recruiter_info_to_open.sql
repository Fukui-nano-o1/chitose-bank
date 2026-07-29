-- 募集者情報が空の求人は掲載できない（2026-07-27たきと指示・法令上の明示事項）
-- 労働者の募集広告に必要な明示事項のうち、募集者の氏名/名称・住所/所在地・連絡先が
-- 埋まっていなければ status を 'open' にできないようにする。
-- UIのチェックでなくDBで拒む＝trg_block_third_party_open と同じ「機構による拒否」（記録の憲法・柱3）。
-- 既に公開中の求人には遡って作用しない（次に開き直す時から効く）。
create or replace function public.trg_require_recruiter_info()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_name text; v_addr text; v_contact text; v_missing text[] := '{}';
begin
  if new.status = 'open' and coalesce(old.status, '') <> 'open' then
    select nullif(btrim(ep.recruiter_name), ''), nullif(btrim(ep.recruiter_address), ''), nullif(btrim(ep.recruiter_contact), '')
      into v_name, v_addr, v_contact
      from public.employer_profiles ep where ep.auth_id = new.farmer_id;
    if v_name    is null then v_missing := v_missing || '募集者の氏名または名称'; end if;
    if v_addr    is null then v_missing := v_missing || '住所・所在地'; end if;
    if v_contact is null then v_missing := v_missing || '連絡先'; end if;
    if array_length(v_missing, 1) > 0 then
      raise exception '募集者情報が未入力のため掲載できません（不足：%）。プロフィールの「募集者の情報」を入力してください',
        array_to_string(v_missing, '・');
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists require_recruiter_info on public.jobs;
create trigger require_recruiter_info
  before update on public.jobs
  for each row execute function public.trg_require_recruiter_info();
