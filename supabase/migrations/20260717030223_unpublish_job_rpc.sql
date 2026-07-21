-- 一時非公開（2026-07-16）：公開中(open)の自分の求人をdraftへ戻す。記載ミスに気づいた時の編集用。
-- 法務整理：規制対象は「掲載（→open）」であり、非公開化は制約なし。再掲載は掲載する→pending→運営承認の
-- 通常ゲートを必ず通る（trg_block_third_party_openもそのまま効く）
create or replace function public.unpublish_job(p_job_number integer)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_count int;
begin
  if auth.uid() is null then
    return json_build_object('ok', false, 'reason', 'not_signed_in');
  end if;
  update public.jobs
     set status = 'draft'
   where job_number = p_job_number
     and farmer_id = auth.uid()
     and status = 'open';
  get diagnostics v_count = row_count;
  if v_count = 0 then
    return json_build_object('ok', false, 'reason', 'not_found_or_not_open');
  end if;
  return json_build_object('ok', true);
end;
$$;

revoke all on function public.unpublish_job(integer) from public;
revoke all on function public.unpublish_job(integer) from anon;
grant execute on function public.unpublish_job(integer) to authenticated;

-- 再掲載時に新着（opened_at）を刻み直す：opened_at is null条件を外し、→open遷移のたびに更新
create or replace function public.set_job_opened_at()
returns trigger language plpgsql as $$
begin
  if new.status = 'open' and (tg_op = 'INSERT' or old.status is distinct from 'open') then
    new.opened_at := now();
  end if;
  return new;
end; $$;