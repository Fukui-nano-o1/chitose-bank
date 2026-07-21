-- 指名リスト（また呼びたいリスト）：評価時の農家のチェックで関係を作成。
-- 農家の新求人が公開された瞬間、リストの働き手へ「選ばれている」通知を自動送信。
create table if not exists public.repeat_roster (
  farmer_id uuid not null,
  worker_id uuid not null,
  notify boolean not null default true,
  source_application_id uuid,
  created_at timestamptz not null default now(),
  primary key (farmer_id, worker_id)
);
alter table public.repeat_roster enable row level security;
create policy "roster farmer manage" on public.repeat_roster
  for all to authenticated
  using (farmer_id = auth.uid()) with check (farmer_id = auth.uid());
create policy "roster worker view" on public.repeat_roster
  for select to authenticated using (worker_id = auth.uid());

-- 求人が公開(open)になった瞬間、リストへ通知
create or replace function public.trg_notify_roster()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record; v_farm text; v_instant text;
begin
  if new.status <> 'open' or coalesce(old.status,'') = 'open' then return new; end if;
  v_farm := public.resolve_actor_name(new.farmer_id);
  v_instant := case when coalesce(new.instant_approve_repeat, false)
    then E'\nこの求人は、応募すると選考なしで即決になります。' else '' end;

  for r in
    select worker_id from public.repeat_roster
     where farmer_id = new.farmer_id and notify = true
       and worker_id <> new.farmer_id
  loop
    insert into public.notifications (farmer_id, type, message)
    values (r.worker_id, 'roster_new_job',
            '🌟あなたを「また呼びたい」と評価した農家さんの新しい求人：#' || new.job_number);
    begin
      perform public.send_user_email(r.worker_id,
        '[chitose-bank] 🌟あなたを「また呼びたい」と評価した農家さんの新しい求人です',
        v_farm || 'さんが、新しい求人を出しました。' || E'\n' ||
        '求人 #' || new.job_number || '（' || coalesce(new.crop,'') || ' ' || coalesce(new.task,'') || '）' ||
        v_instant || E'\n\n' ||
        '今すぐチェック：https://chitose-bank.com/#/work/job/' || new.job_number);
    exception when others then null; end;
  end loop;
  return new;
end; $$;
drop trigger if exists notify_roster on public.jobs;
create trigger notify_roster after update on public.jobs
  for each row execute function public.trg_notify_roster();