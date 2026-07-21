-- 公開のお知らせ（穴の修理）：求人がopenになった瞬間、農家へ通知＋メール。
-- 既存のtrg_notify_roster（同じopen遷移で働き手へ通知）とは独立のトリガー。
create or replace function public.trg_notify_job_published()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status <> 'open' or coalesce(old.status,'') = 'open' then return new; end if;
  insert into public.notifications (farmer_id, type, message)
  values (new.farmer_id, 'job_published',
          '求人 #' || new.job_number || ' が公開されました。応募が入るとメールでお知らせします');
  begin
    perform public.send_user_email(new.farmer_id,
      '[chitose-bank] 求人 #' || new.job_number || ' が公開されました',
      'ご掲載の求人 #' || new.job_number ||
        '（' || coalesce(new.crop,'') || ' ' || coalesce(new.task,'') || '）の確認が完了し、公開されました。' || E'\n\n' ||
      '応募が入ると、メールでお知らせします。' || E'\n' ||
      '求人の内容はいつでも確認できます：' || E'\n' ||
      'https://chitose-bank.com/#/work/job/' || new.job_number);
  exception when others then null; end;
  return new;
end; $$;
drop trigger if exists notify_job_published on public.jobs;
create trigger notify_job_published after update on public.jobs
  for each row execute function public.trg_notify_job_published();