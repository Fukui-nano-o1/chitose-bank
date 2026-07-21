-- 管理者の一覧。ハードコードせずテーブルで持つ（配列駆動）。
-- 管理者を追加するときは、この表に1行入れるだけでよい。
create table if not exists public.app_admins (
  auth_id uuid primary key references auth.users(id) on delete cascade,
  label text,
  created_at timestamptz not null default now()
);

alter table public.app_admins enable row level security;
-- 読み書きポリシーは作らない。管理者一覧はアプリから見えない・変更できない。
-- 追加はSupabaseダッシュボード（service_role）からのみ行う。

insert into public.app_admins (auth_id, label)
values ('af6377a6-57e4-46b3-ae3e-eebe7bfda27e', 'たきと（運営）')
on conflict (auth_id) do nothing;

-- 管理者全員に通知を配る共通関数（機能集約：通知の作り方はここ1箇所だけ）
create or replace function public.notify_admins(p_type text, p_message text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (farmer_id, type, message)
  select a.auth_id, p_type, p_message
    from public.app_admins a;
end;
$$;

-- ① 新規登録（account_holders に行が入った）
create or replace function public.trg_notify_new_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.notify_admins(
    'new_account',
    '新規登録：' || coalesce(new.full_name, '（氏名なし）') ||
    '（' || coalesce(new.entity_type, '?') || '）'
  );
  return new;
end;
$$;

drop trigger if exists notify_new_account on public.account_holders;
create trigger notify_new_account
  after insert on public.account_holders
  for each row execute function public.trg_notify_new_account();

-- ② 求人が承認待ち（pending に「なった」瞬間だけ。更新のたびに鳴らさない）
create or replace function public.trg_notify_job_pending()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'pending'
     and (tg_op = 'INSERT' or old.status is distinct from 'pending') then
    perform public.notify_admins(
      'job_pending',
      '求人が承認待ちです：#' || new.job_number || '　' ||
      coalesce(new.crop, '') || ' ' || coalesce(new.task, '')
    );
  end if;
  return new;
end;
$$;

drop trigger if exists notify_job_pending on public.jobs;
create trigger notify_job_pending
  after insert or update of status on public.jobs
  for each row execute function public.trg_notify_job_pending();

-- ③ 応募が入った
create or replace function public.trg_notify_application()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.notify_admins(
    'new_application',
    '応募が入りました：求人 #' || new.job_number
  );
  return new;
end;
$$;

drop trigger if exists notify_application on public.applications;
create trigger notify_application
  after insert on public.applications
  for each row execute function public.trg_notify_application();