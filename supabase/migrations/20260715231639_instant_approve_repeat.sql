-- リピート即決：農家が事前同意した求人では、自分が過去に「また呼びたい」と評価した働き手の
-- 応募を自動承認する。採否の主体は農家（事前の宣言）・システムは執行のみ。
alter table public.jobs add column if not exists instant_approve_repeat boolean not null default false;

create or replace function public.trg_instant_approve()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_instant boolean; v_want boolean;
begin
  if new.status <> 'applied' then return new; end if;
  select instant_approve_repeat into v_instant
    from public.jobs where job_number = new.job_number;
  if not coalesce(v_instant, false) then return new; end if;

  -- この農家が、この働き手を過去に「また呼びたい」と評価しているか
  select exists (
    select 1 from public.reviews r
     where r.reviewer_id = new.farmer_id
       and r.reviewee_id = new.worker_id
       and r.direction = 'farmer_to_worker'
       and r.want_again = true
  ) into v_want;
  if not v_want then return new; end if;

  update public.applications
     set status = 'approved', decided_at = now()
   where id = new.id;

  -- 双方へ通知（働き手には即決の喜び・農家には執行の報告）
  insert into public.notifications (farmer_id, type, message) values
    (new.worker_id, 'application_approved',
     '🌟即決で承認されました：求人 #' || new.job_number || '　以前の評価により自動承認されています'),
    (new.farmer_id, 'application_approved',
     '🌟リピート即決：以前「また呼びたい」と評価した方の応募を自動承認しました（求人 #' || new.job_number || '）');
  begin
    perform public.send_user_email(new.worker_id,
      '[chitose-bank] 🌟即決で承認されました：求人 #' || new.job_number,
      '求人 #' || new.job_number || ' への応募が、即決で承認されました。' || E'\n' ||
      'この求人者から以前「また呼びたい」の評価を受けているため、選考なしで確定しています。' || E'\n\n' ||
      'チャットで日程を確認しましょう：https://chitose-bank.com/#/profile/worker/approved');
    perform public.send_user_email(new.farmer_id,
      '[chitose-bank] 🌟リピート即決のお知らせ：求人 #' || new.job_number,
      'あなたが以前「また呼びたい」と評価した方から応募があり、' || E'\n' ||
      '求人の設定に基づいて自動承認しました。' || E'\n\n' ||
      '応募者の確認：https://chitose-bank.com/#/profile/employer/applicants');
  exception when others then null; end;
  return new;
end; $$;
drop trigger if exists instant_approve on public.applications;
create trigger instant_approve after insert on public.applications
  for each row execute function public.trg_instant_approve();