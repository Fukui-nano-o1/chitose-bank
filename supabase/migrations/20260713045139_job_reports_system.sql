-- 求人の通報（苦情処理体制の実装・職安法上の義務対応）
create table if not exists public.job_reports (
  id uuid primary key default gen_random_uuid(),
  job_number int not null,
  reporter_id uuid not null,
  target_field text not null,   -- 対象項目：報酬/勤務時間・休憩/危険情報/作業の説明/写真/場所・日程/その他
  issue_type text not null,     -- 問題の種類：虚偽・誇大の疑い/最低賃金違反/差別的条件/連絡先の直書き・外部誘導/危険情報の欠落/個人情報・肖像権/不快・不適切な表現/その他
  detail text,                  -- 自由記述（任意）
  status text not null default 'open',   -- open / resolved
  created_at timestamptz not null default now()
);

alter table public.job_reports enable row level security;

-- 本人は自分の通報をINSERTできる（ログイン必須）
create policy "report insert own" on public.job_reports
  for insert to authenticated
  with check (reporter_id = auth.uid());

-- 閲覧は管理者のみ（通報者の匿名性を農家から守る）
create policy "report select admin" on public.job_reports
  for select to authenticated
  using (exists (select 1 from public.app_admins a where a.auth_id = auth.uid()));

-- 通報→管理者へ即時メール＋アプリ内通知
create or replace function public.trg_notify_job_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_crop text; v_task text; v_status text;
begin
  select crop, task, status into v_crop, v_task, v_status
    from public.jobs where job_number = new.job_number;

  perform public.notify_admins('job_report',
    '求人に通報：#' || new.job_number || '　【' || new.target_field || '】' || new.issue_type);

  begin
    perform public.send_admin_email(
      '[通報] 求人 #' || new.job_number || '　【' || new.target_field || '】' || new.issue_type,
      '求人への通報が届きました。' || E'\n\n' ||
      '■ 求人：#' || new.job_number || '（' || coalesce(v_crop,'') || ' ' || coalesce(v_task,'')
        || '・現在 ' || coalesce(v_status,'?') || '）' || E'\n' ||
      '■ 対象項目：' || new.target_field || E'\n' ||
      '■ 問題の種類：' || new.issue_type || E'\n' ||
      '■ 詳細：' || E'\n' || coalesce(nullif(new.detail,''),'（記載なし）') || E'\n\n' ||
      '確認：https://chitose-bank.com/#/admin/review/' || new.job_number || E'\n' ||
      '（苦情への対応は遅滞なく。対応後は job_reports.status を resolved に）'
    );
  exception when others then null;
  end;

  return new;
end;
$$;

drop trigger if exists notify_job_report on public.job_reports;
create trigger notify_job_report
  after insert on public.job_reports
  for each row execute function public.trg_notify_job_report();

-- 差し戻しRPCを拡張：公開中(open)の求人も取り下げられるように（通報対応の実力行使）
create or replace function public.request_job_revision(p_job_number int, p_reason text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_farmer uuid; v_status text; v_crop text; v_task text;
begin
  if not exists (select 1 from public.app_admins a where a.auth_id = auth.uid()) then
    return json_build_object('ok', false, 'reason', 'not_admin');
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    return json_build_object('ok', false, 'reason', 'reason_required');
  end if;

  select farmer_id, status, crop, task into v_farmer, v_status, v_crop, v_task
    from public.jobs where job_number = p_job_number;

  if v_farmer is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_status not in ('pending','open') then
    return json_build_object('ok', false, 'reason', 'not_revisable', 'status', v_status);
  end if;

  update public.jobs set status = 'draft' where job_number = p_job_number;

  insert into public.notifications (farmer_id, type, message)
  values (v_farmer, 'job_revision_requested',
          '求人 #' || p_job_number || ' の修正をお願いします：' || p_reason);

  begin
    perform public.send_user_email(
      v_farmer,
      '[chitose-bank] 求人 #' || p_job_number || ' の修正のお願い',
      'ご掲載の求人 #' || p_job_number ||
        '（' || coalesce(v_crop,'') || ' ' || coalesce(v_task,'') || '）について、' || E'\n' ||
      '確認の結果、以下の点の修正をお願いすることになりました。' || E'\n\n' ||
      '■ 修正をお願いする点：' || E'\n' || p_reason || E'\n\n' ||
      '求人は「作成中」に戻しています。修正のうえ、もう一度掲載してください。' || E'\n' ||
      '（内容の正確な表示のためのお願いであり、採否には一切関与しません）' || E'\n\n' ||
      'https://chitose-bank.com/#/profile/employer'
    );
  exception when others then null;
  end;

  return json_build_object('ok', true);
end;
$$;