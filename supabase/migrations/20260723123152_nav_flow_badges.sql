-- 第12弾：下部ナビのフロー化。各段の「宿題バッジ」を1本のRPCで返す（2026-07-23）。
-- あわせて、農家の「求人」タブの差し戻し(draft戻し)⚠表示のため、jobs に revision_requested_at を追加。
--   texts_revision_requested_at（農家プロフィール自由記述の差し戻し）と同じ設計思想。
--   request_job_revision（運営→draftに戻す）で now() を刻み、再提出(pending/open)で自動クリア。

-- 1) jobs.revision_requested_at（差し戻された下書きの目印。農家の新規下書きと区別する）
alter table public.jobs add column if not exists revision_requested_at timestamptz;

-- 2) 差し戻しRPCで revision_requested_at を刻む（他は不変）
create or replace function public.request_job_revision(p_job_number integer, p_reason text)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_farmer uuid; v_status text; v_ref text;
begin
  if not exists (select 1 from public.app_admins a where a.auth_id = auth.uid()) then
    return json_build_object('ok', false, 'reason', 'not_admin');
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    return json_build_object('ok', false, 'reason', 'reason_required');
  end if;
  select farmer_id, status into v_farmer, v_status from public.jobs where job_number = p_job_number;
  if v_farmer is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_status not in ('pending','open') then
    return json_build_object('ok', false, 'reason', 'not_revisable', 'status', v_status);
  end if;
  v_ref := public.job_ref(p_job_number,'farmer');
  update public.jobs set status = 'draft', revision_requested_at = now() where job_number = p_job_number;
  insert into public.notifications (farmer_id, type, message)
  values (v_farmer, 'job_revision_requested',
          'あなたの求人 #' || p_job_number || ' の修正をお願いします：' || p_reason);
  begin
    perform public.send_user_email(v_farmer,
      '[chitose-bank] あなたの求人 #' || p_job_number || ' の修正のお願い',
      '■ ' || v_ref || E'\n\n' ||
      '確認の結果、以下の点の修正をお願いすることになりました。' || E'\n\n' ||
      '■ 修正をお願いする点：' || E'\n' || p_reason || E'\n\n' ||
      '求人は「作成中」に戻しています。修正のうえ、もう一度掲載してください。' || E'\n' ||
      '（内容の正確な表示のためのお願いであり、採否には一切関与しません）' || E'\n\n' ||
      '▶ この求人の修正はこちら：https://chitose-bank.com/#/work/edit/' || p_job_number);
  exception when others then null; end;
  return json_build_object('ok', true);
end; $function$;

-- 3) 再提出(pending/open)で差し戻しフラグを自動クリア（BEFORE UPDATE・独立トリガー）
create or replace function public.trg_clear_job_revision_flag()
 returns trigger
 language plpgsql
as $function$
begin
  if new.status in ('pending','open') and new.revision_requested_at is not null then
    new.revision_requested_at := null;
  end if;
  return new;
end; $function$;
drop trigger if exists clear_job_revision_flag on public.jobs;
create trigger clear_job_revision_flag before update on public.jobs
  for each row execute function public.trg_clear_job_revision_flag();

-- 4) 下部ナビの宿題バッジを1本で返す（数字=待たせている/自分の宿題の件数）。
--   security definer だが全て auth.uid() で自分の分だけを数える。
create or replace function public.my_nav_badges()
 returns json
 language sql
 security definer
 set search_path to 'public'
 stable
as $function$
  select json_build_object(
    -- チャット：未読スレッド数（相手からの未読メッセージがある＝スレッド。相手ごとに1）＋運営DM未読があれば+1。
    --   アプリの未読モデル（messages.read_at）に合わせ、チャット一覧の未読スレッド表示と一致させる。
    'chat_threads', (
      select count(distinct partner) from (
        select case when a.worker_id = auth.uid() then a.farmer_id else a.worker_id end as partner
        from public.messages m join public.applications a on a.id = m.application_id
        where (a.worker_id = auth.uid() or a.farmer_id = auth.uid())
          and a.status in ('applied','approved','meeting','interview','contracted','working','completed','rejected')
          and m.sender_id <> auth.uid() and m.read_at is null
      ) t
    ) + (case when exists (
        select 1 from public.admin_messages am
        where am.user_id = auth.uid() and am.from_admin and am.read_at is null
      ) then 1 else 0 end),
    -- カレンダー：きょうの契約済み仕事（terms_snapshot有り＝契約済み・当日が作業日程内・働き手/農家とも同条件）
    'calendar_today', (
      select count(*) from public.applications a join public.jobs j on j.job_number = a.job_number
      where (a.worker_id = auth.uid() or a.farmer_id = auth.uid())
        and a.terms_snapshot is not null
        and j.date_start is not null
        and (now() at time zone 'Asia/Tokyo')::date >= j.date_start
        and (now() at time zone 'Asia/Tokyo')::date <= coalesce(j.date_end, j.date_start)
    ),
    -- プロフィール：評価の締切内・未実施（完了3日以内で自分の評価が未送信）
    'review_due', (
      select count(*) from public.applications a
      where (a.worker_id = auth.uid() or a.farmer_id = auth.uid())
        and a.status = 'completed'
        and a.work_completed_at is not null
        and a.work_completed_at >= now() - interval '3 days'
        and not exists (select 1 from public.reviews r where r.application_id = a.id and r.reviewer_id = auth.uid())
    ),
    -- 求人（農家）：差し戻し（draft戻し）が1件でもあれば ⚠（件数でなく有無フラグとして使う）
    'job_revision', (
      select count(*) from public.jobs j
      where j.farmer_id = auth.uid() and j.status = 'draft' and j.revision_requested_at is not null
    )
  );
$function$;

revoke all on function public.my_nav_badges() from public, anon;
grant execute on function public.my_nav_badges() to authenticated;
