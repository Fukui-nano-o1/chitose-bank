-- 自分が出した求人には「いいね」できない（2026-07-29たきと指示）。
-- UIでボタンを隠すだけでなくDB側でも拒む（二重の壁）。適用時に既存の自分いいねも掃除した。
create or replace function public.trg_saved_jobs_not_own()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from jobs j where j.job_number = new.job_number and j.farmer_id = new.worker_id) then
    raise exception '自分が出した求人にはいいねできません';
  end if;
  return new;
end $$;

drop trigger if exists trg_saved_jobs_not_own on public.saved_jobs;
create trigger trg_saved_jobs_not_own
  before insert on public.saved_jobs
  for each row execute function public.trg_saved_jobs_not_own();

delete from public.saved_jobs s
 using public.jobs j
 where j.job_number = s.job_number and j.farmer_id = s.worker_id;
