-- 採用人数に達した求人には応募できないようにする（2026-07-27たきと指摘）
--
-- 指摘：見送りの発火条件は「採用人数の上限に達した瞬間」であるべきで、
-- 「開始時刻が来たから」ではない。上限に達した時点で募集は閉じているはずだから。
--
-- 実際に起きていたこと（#1055・募集1名）：
--   14:58:25 たっきーさんを採用（＝この瞬間に満員）
--   14:59:44 たきさんが応募できてしまった（1分後）
-- 応募ボタンはフロントで満員なら隠しているが、手元の一覧が古いと押せてしまう。
-- UIで隠すのでなくDBで拒む（記録の憲法・柱3「機構による拒否」＝二重の壁）。
create or replace function public.trg_block_apply_when_filled()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_headcount int; v_hired int;
begin
  select headcount into v_headcount from public.jobs where job_number = new.job_number;
  if v_headcount is not null and v_headcount > 0 then
    select count(*) into v_hired from public.applications a
     where a.job_number = new.job_number
       and a.terms_confirmed_worker_at is not null
       and a.terms_confirmed_farmer_at is not null;
    if v_hired >= v_headcount then
      raise exception '募集人数に達したため、この求人の募集は終了しました';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists block_apply_when_filled on public.applications;
create trigger block_apply_when_filled
  before insert on public.applications
  for each row execute function public.trg_block_apply_when_filled();
