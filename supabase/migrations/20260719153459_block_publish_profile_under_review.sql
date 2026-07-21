-- プロフィール審査中の農家は求人掲載不能（2026-07-19）
-- 掲載＝statusが'pending'（審査提出）に入る瞬間だけをDBトリガーで拒否。
-- 下書き(draft)の作成・編集・既にpendingの行の内容編集はこれまで通り可能（トリガーは遷移だけを見る）。
-- 管理者(app_admins)は対象外。trg_block_third_party_openと同じ「二重の壁」思想
create or replace function public.block_publish_when_profile_under_review()
returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if new.status = 'pending'
     and (tg_op = 'INSERT' or old.status is distinct from 'pending')
     and not exists (select 1 from public.app_admins a where a.auth_id = new.farmer_id)
     and exists (
       select 1 from public.employer_profiles ep
        where ep.auth_id = new.farmer_id
          and ((ep.texts_pending is not null and ep.texts_pending <> '{}'::jsonb)
               or ep.texts_revision_requested_at is not null)
     )
  then
    raise exception 'PROFILE_UNDER_REVIEW: プロフィール審査中は掲載できません（下書き保存は可能です）';
  end if;
  return new;
end; $function$;

drop trigger if exists trg_block_publish_profile_review on public.jobs;
create trigger trg_block_publish_profile_review
before insert or update on public.jobs
for each row execute function public.block_publish_when_profile_under_review();