-- 保険リマインダー：承認済み応募を持つ農家へ、毎日17:00 JSTに条件判定して送信。
-- 送信回数は最大3回：①承認後最初の17時 ②作業3日前 ③作業前日。
-- 農家が「準備した」をタップ→働き手へ自動通知。運営は掛けない・案内するだけ（場の提供者）。

alter table public.applications
  add column if not exists insurance_prepared_at timestamptz,
  add column if not exists insurance_first_mailed_at timestamptz,
  add column if not exists insurance_last_mailed_on date;

-- 農家の「保険を準備した」宣言RPC → 働き手へ通知＋メール
create or replace function public.confirm_insurance(p_application_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_farmer uuid; v_worker uuid; v_job int;
begin
  select farmer_id, worker_id, job_number into v_farmer, v_worker, v_job
    from public.applications where id = p_application_id;
  if v_farmer is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_farmer <> auth.uid() then return json_build_object('ok', false, 'reason', 'not_yours'); end if;

  update public.applications
     set insurance_prepared_at = coalesce(insurance_prepared_at, now())
   where id = p_application_id;

  insert into public.notifications (farmer_id, type, message)
  values (v_worker, 'insurance_prepared',
          '農家が傷害保険を準備しました：求人 #' || v_job);
  begin
    perform public.send_user_email(v_worker,
      '[chitose-bank] 保険の準備が完了しました：求人 #' || v_job,
      '求人 #' || v_job || ' の農家が、作業中のケガに備える保険を準備しました。' || E'\n' ||
      '安心して当日をお迎えください。' || E'\n\n' || 'https://chitose-bank.com');
  exception when others then null;
  end;

  return json_build_object('ok', true);
end;
$$;
grant execute on function public.confirm_insurance(uuid) to authenticated;

-- 毎日17:00 JST（8:00 UTC）の送信判定
create or replace function public.send_insurance_reminders()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
  v_days int;
  v_should boolean;
begin
  for r in
    select a.id, a.farmer_id, a.job_number,
           a.insurance_first_mailed_at, a.insurance_last_mailed_on,
           j.date_start, j.crop, j.task
      from public.applications a
      join public.jobs j on j.job_number = a.job_number
     where a.status in ('approved','meeting','interview','contracted','working')
       and a.insurance_prepared_at is null
       and j.date_start >= v_today
  loop
    v_days := r.date_start - v_today;
    v_should := (r.insurance_first_mailed_at is null)   -- ①承認後最初の17時
                or v_days = 3                            -- ②3日前
                or v_days = 1;                           -- ③前日
    if v_should and (r.insurance_last_mailed_on is distinct from v_today) then
      begin
        perform public.send_user_email(r.farmer_id,
          '[chitose-bank] 保険のご準備を：求人 #' || r.job_number ||
            '（作業まであと' || v_days || '日）',
          '求人 #' || r.job_number || '（' || coalesce(r.crop,'') || ' ' || coalesce(r.task,'') ||
            '・' || r.date_start || '）の作業日が近づいています。' || E'\n\n' ||
          '作業日までに、働き手のケガに備える保険（1日傷害保険等）のご準備をおすすめします。' || E'\n' ||
          '・多くの商品は【前日まで】の加入が必要です' || E'\n' ||
          '・夏場は【熱中症の補償の有無】を必ずご確認ください' || E'\n\n' ||
          '準備ができたら、応募者のページで「保険を準備した」を押してください。' || E'\n' ||
          '働き手に自動でお知らせが届きます。' || E'\n\n' ||
          'https://chitose-bank.com/#/profile/employer/applicants',
          '<div style="font-family:sans-serif;max-width:560px;margin:0 auto;">'
          || '<h2 style="font-size:16px;color:#222;">保険のご準備を（作業まであと' || v_days || '日）</h2>'
          || '<p style="font-size:14px;color:#222;">求人 #' || r.job_number || '　'
          || coalesce(r.crop,'') || ' ' || coalesce(r.task,'') || '（' || r.date_start || '）</p>'
          || '<div style="font-size:13px;color:#222;padding:12px 16px;background:#FFF7ED;border-left:4px solid #EA580C;border-radius:8px;">'
          || '作業日までに、働き手のケガに備える保険（1日傷害保険等）のご準備をおすすめします。<br/>'
          || '・多くの商品は<b>前日まで</b>の加入が必要です<br/>'
          || '・夏場は<b>熱中症の補償の有無</b>を必ずご確認ください</div>'
          || '<a href="https://chitose-bank.com/#/profile/employer/applicants" '
          || 'style="display:inline-block;margin-top:14px;background:#00A86B;color:#fff;'
          || 'padding:14px 32px;border-radius:10px;text-decoration:none;font-size:14px;font-weight:bold;">'
          || '準備できたら「保険を準備した」を押す</a>'
          || '<p style="font-size:11px;color:#B0B0B0;margin-top:12px;">押すと働き手に自動でお知らせが届きます。<br/>'
          || 'chitose-bankは保険の販売・仲介は行いません。ご準備は農家ご自身でお願いします。</p></div>'
        );
        update public.applications
           set insurance_first_mailed_at = coalesce(insurance_first_mailed_at, now()),
               insurance_last_mailed_on = v_today
         where id = r.id;
      exception when others then null;
      end;
    end if;
  end loop;
end;
$$;

select cron.schedule('insurance-reminder', '0 8 * * *', $$ select public.send_insurance_reminders(); $$);