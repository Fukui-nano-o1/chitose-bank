-- 段A：仮応募でも「絶対に通さない」2つを機構化（2026-08-17 たきと指示
--   「banの働き手は絶対に通すな。求人者本人の応募も通すな。他は仮応募。」）
-- 背景：昇格（promote_my_pending_applications）は applications へ直接INSERTするため apply_to_job を
--   通らない。あちらに後から足した壁（BAN働き手・BAN農家の求人・own_job）が仮応募側に写っておらず、
--   実測で「本応募は拒否されるのに仮応募→昇格は通る」状態だった（求人#1233・2026-08-17）。
-- 方針：入口（預かる時）と出口（昇格する時）の両方で確認する。預けてから求人者の状態は変わりうるので
--   入口だけでは足りない。条件に落ちた仮応募は削除しない＝やり直せる状態を残す（既存の残骸と同じ扱い）。

create or replace function public.create_pending_application(p_job integer, p_available_dates jsonb default null)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_farmer uuid; v_ds date; v_de date; v_is_period boolean;
begin
  if auth.uid() is null then return json_build_object('ok',false,'reason','not_logged_in'); end if;
  -- 停止・追放中の働き手は仮応募も預からない（絶対に通さない・2026-08-17）
  if public.is_account_moderated(auth.uid()) then
    return json_build_object('ok',false,'reason','account_suspended');
  end if;
  select farmer_id, date_start, date_end into v_farmer, v_ds, v_de
    from public.jobs where job_number = p_job and status='open';
  if v_farmer is null then return json_build_object('ok',false,'reason','not_open'); end if;
  -- 求人者が停止・追放中なら募集終了として扱う（apply_to_job と同じ判定・2026-08-16）
  if public.is_account_moderated(v_farmer) then return json_build_object('ok',false,'reason','not_open'); end if;
  -- 自分の求人には応募できない（絶対に通さない・2026-08-17）
  if v_farmer = auth.uid() then return json_build_object('ok',false,'reason','own_job'); end if;
  if exists (select 1 from public.applications
              where job_number = p_job and worker_id = auth.uid()
                and status not in ('rejected','expired')) then
    return json_build_object('ok',false,'reason','already_applied');
  end if;

  -- 期間求人は来られる日が必須（apply_to_job と同一の式・同一の不変条件）
  v_is_period := v_de is not null and v_de <> v_ds;
  if v_is_period then
    if p_available_dates is null
       or not (p_available_dates = '"any"'::jsonb
               or (jsonb_typeof(p_available_dates) = 'array' and jsonb_array_length(p_available_dates) > 0)) then
      return json_build_object('ok', false, 'reason', 'dates_required');
    end if;
  end if;

  insert into public.pending_applications (job_number, worker_id, available_dates)
  values (p_job, auth.uid(), case when v_is_period then p_available_dates else null end)
  on conflict do nothing;
  return json_build_object('ok', true,
    'ready', public.is_worker_profile_ready(auth.uid()));
end; $function$;

create or replace function public.promote_my_pending_applications()
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare r record; v_n int := 0;
begin
  if auth.uid() is null then return json_build_object('ok',false,'reason','not_logged_in'); end if;
  -- 停止・追放中の働き手は昇格させない（絶対に通さない・2026-08-17）
  if public.is_account_moderated(auth.uid()) then
    return json_build_object('ok', false, 'reason','account_suspended',
      'message','アカウントは停止中のため、応募を届けられません');
  end if;
  if not public.is_worker_profile_ready(auth.uid()) then
    return json_build_object('ok', false, 'reason','not_ready',
      'message','プロフィールの必須項目がまだ残っています');
  end if;
  for r in
    select p.id, p.job_number, p.available_dates, j.farmer_id,
           (j.date_end is not null and j.date_end <> j.date_start) as is_period
      from public.pending_applications p
      join public.jobs j on j.job_number = p.job_number
     where p.worker_id = auth.uid() and j.status = 'open'
       and coalesce(j.date_end, j.date_start) >= (now() at time zone 'Asia/Tokyo')::date
  loop
    -- 期間求人で来られる日を持たない仮応募は昇格させない（不変条件を破る応募を作らない）。
    -- 新しい仮応募は create_pending_application が日付を必須化so、これは万一の残骸への保険。
    -- 削除もしない＝働き手がもう一度日付を選んで応募し直せる状態を残す。
    if r.is_period and r.available_dates is null then
      continue;
    end if;
    -- 自分の求人／求人者が停止・追放中：昇格させない（入口でも塞いでいるが、預けてから
    -- 求人者の状態は変わりうるので出口でも確認する。ここも削除はしない）
    if r.farmer_id = auth.uid() or public.is_account_moderated(r.farmer_id) then
      continue;
    end if;
    if not exists (select 1 from public.applications
                    where job_number = r.job_number and worker_id = auth.uid()
                      and status not in ('rejected','expired')) then
      insert into public.applications (job_number, worker_id, farmer_id, status, available_dates)
      select r.job_number, auth.uid(), j.farmer_id, 'applied',
             case when r.is_period then r.available_dates else null end
        from public.jobs j where j.job_number = r.job_number;
      v_n := v_n + 1;
    end if;
    delete from public.pending_applications where id = r.id;
  end loop;
  return json_build_object('ok', true, 'promoted', v_n);
end; $function$;

-- 関数を作り直したので権限を宣言し直す（作成時の default privileges で anon にも付くため・2026-08-06教訓）
revoke all on function public.create_pending_application(integer, jsonb) from public, anon;
revoke all on function public.promote_my_pending_applications() from public, anon;
grant execute on function public.create_pending_application(integer, jsonb) to authenticated, service_role;
grant execute on function public.promote_my_pending_applications() to authenticated, service_role;
