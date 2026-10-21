-- 求人掲載フローを「位置番号」から不変step IDへ段階移行する土台。
-- draft_step は旧クライアント互換のため残す。新実装は draft_step_id を主にする。
alter table public.jobs add column if not exists draft_step_id text;
update public.jobs set draft_step_id = case draft_step
  when 1 then 'crop' when 2 then 'task' when 3 then 'workplace' when 4 then 'schedule'
  when 5 then 'terms' when 6 then 'details_intro' when 7 then 'photos' when 8 then 'description'
  when 9 then 'work_video' when 10 then 'danger' when 11 then 'wishes' when 12 then 'review'
  else draft_step_id end
where draft_step_id is null;
alter table public.jobs drop constraint if exists jobs_draft_step_id_check;
alter table public.jobs add constraint jobs_draft_step_id_check check (
 draft_step_id is null or draft_step_id in ('crop','task','workplace','schedule','terms','details_intro','photos','description','work_video','danger','wishes','review','complete')
);
