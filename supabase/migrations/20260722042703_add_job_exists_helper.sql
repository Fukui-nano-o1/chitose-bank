-- 働き手はRLSで jobs を直接読めない（jobs_public のみ・open限定）。
-- 段階お祝いボックス等で「求人が削除済みか」を判定するための最小ヘルパー。
-- 存在すれば true（status問わず）／削除済みなら false。行の中身は一切返さない＝情報漏洩なし。
create or replace function public.job_exists(p_job_number integer)
 returns boolean
 language sql
 security definer
 set search_path to 'public'
 stable
as $function$
  select exists (select 1 from public.jobs where job_number = p_job_number);
$function$;

revoke all on function public.job_exists(integer) from public;
grant execute on function public.job_exists(integer) to authenticated;
