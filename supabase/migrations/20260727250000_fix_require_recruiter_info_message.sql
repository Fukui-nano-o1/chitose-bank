-- 掲載ゲートの修正（2026-07-27・本番で検証して判明した2点）
--  ① text[] || 無名リテラル は「配列同士の連結」と解釈され malformed array literal で落ちていた。
--     拒否自体は起きていたが理由が伝わらないため、明示キャストにする。
--  ② 公開の実体はUPDATE（掲載ボタン）だが、管理者権限なら status='open' のままINSERTもできるため、
--     トリガーを INSERT にも掛けて入口を両方塞ぐ。
create or replace function public.trg_require_recruiter_info()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_name text; v_addr text; v_contact text; v_missing text[] := array[]::text[];
begin
  if new.status = 'open' and coalesce(old.status, '') <> 'open' then
    select nullif(btrim(ep.recruiter_name), ''), nullif(btrim(ep.recruiter_address), ''), nullif(btrim(ep.recruiter_contact), '')
      into v_name, v_addr, v_contact
      from public.employer_profiles ep where ep.auth_id = new.farmer_id;
    if v_name    is null then v_missing := v_missing || '募集者の氏名または名称'::text; end if;
    if v_addr    is null then v_missing := v_missing || '住所・所在地'::text; end if;
    if v_contact is null then v_missing := v_missing || '連絡先'::text; end if;
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
  before insert or update on public.jobs
  for each row execute function public.trg_require_recruiter_info();
