-- 仮応募→昇格で「来られる日」が欠落するバグを修理（2026-08-06 バグ狩りで発見）。
-- 症状：apply_to_job は期間求人（複数日）に available_dates（来られる日）を必須にし
--   applications.available_dates へ保存する。しかし create_pending_application は日付を受け取らず、
--   promote_my_pending_applications も available_dates を持たずに applications へINSERTしていた。
--   ＝仮応募→昇格すると、正規経路なら dates_required で弾かれる「来られる日なしの期間求人応募」が成立。
--   実測：期間求人で apply_to_job(job,null)=dates_required に対し、create_pending→promote は
--   available_dates=NULL の applied を1件作れた。
-- 対処：来られる日を仮応募の時点で捕捉し、昇格で applications へ引き継ぐ。期間求人の必須を
--   pending 側でも apply_to_job と同じ式で強制する（単一の不変条件にする）。
-- 既存の pending_applications は0件so移行リスクなし。
-- 検証済み（ロールバック付き実弾）：期間・日付なし仮応募=dates_required／期間・日付あり=昇格で引き継ぎ／
--   単日=従来どおりnull／1引数呼び出しもdefaultで通過。フロント（JobSearchMapView）も同値を渡すよう更新。

alter table public.pending_applications add column if not exists available_dates jsonb;

-- 旧1引数版はオーバーロード曖昧化（1引数呼び出しが2関数に一致）を避けるためdrop。
-- 新版は2引数（p_available_dates default null）so、フロントが1引数で呼んでも default で受かる。
drop function if exists public.create_pending_application(integer);

create or replace function public.create_pending_application(p_job integer, p_available_dates jsonb default null)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare v_farmer uuid; v_ds date; v_de date; v_is_period boolean;
begin
  if auth.uid() is null then return json_build_object('ok',false,'reason','not_logged_in'); end if;
  select farmer_id, date_start, date_end into v_farmer, v_ds, v_de
    from public.jobs where job_number = p_job and status='open';
  if v_farmer is null then return json_build_object('ok',false,'reason','not_open'); end if;
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

revoke all on function public.create_pending_application(integer, jsonb) from public;
revoke execute on function public.create_pending_application(integer, jsonb) from anon;
grant execute on function public.create_pending_application(integer, jsonb) to authenticated, service_role;

create or replace function public.promote_my_pending_applications()
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare r record; v_n int := 0;
begin
  if auth.uid() is null then return json_build_object('ok',false,'reason','not_logged_in'); end if;
  if not public.is_worker_profile_ready(auth.uid()) then
    return json_build_object('ok', false, 'reason','not_ready',
      'message','プロフィールの必須項目がまだ残っています');
  end if;
  for r in
    select p.id, p.job_number, p.available_dates,
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
