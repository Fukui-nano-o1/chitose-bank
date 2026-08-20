-- ①未払い申告→運営へ即時通知（2026-08-20たきと裁定）。
--   賃金の支払は労基法24条の中心的義務（賃金支払の5原則）に触れる事象＝単なる低評価ではない。
--   募集情報等提供事業者には苦情の適切・迅速な処理体制が求められる（厚労省・業務運営要領）。
--   ★運営は裁判官ごっこをしない：「未払い確定」ではなく【未払い申告】として扱う。即BANしない。
--   ★確認前は非公開＝農家プロフィールに「未払いN件」は出さない（虚偽申告・行き違い・支払確認前がある）。
--   流れ：未払いを選択 → incident発行＋スナップショット凍結 → 運営に即時通知 → 運営確認 →
--         必要なら双方へ事実確認 → resolved / unresolved。
create table if not exists public.pay_incidents (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id),
  reporter_id uuid not null,
  farmer_id uuid not null,
  worker_id uuid not null,
  job_number integer,
  status text not null default 'reported'
    check (status in ('reported','checking','resolved','unresolved')),
  -- 申告の瞬間の証拠一式：求人・契約（applications行＝terms_snapshot込み）・日次の記録・最終回答。
  -- あとから求人が編集・削除されても、申告時点の姿で話し合いができる（行動記録の憲法・柱1と同思想）
  snapshot jsonb not null,
  admin_note text,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
comment on table public.pay_incidents is
  '未払いの申告（働き手の最終評価 pay_status=unpaid から自動起票）。申告であって確定ではない。
   運営が確認して resolved/unresolved を決める。確認前は非公開（プロフィールにも出さない）。';

alter table public.pay_incidents enable row level security;
-- 運営＝全操作（確認・状態変更）。申告者＝自分の申告の閲覧のみ。農家には直接見せない
-- （事実確認は運営が双方に行う＝当事者間の直接対決の場にしない）。INSERTはトリガー（definer）のみ
drop policy if exists "pay incidents admin all" on public.pay_incidents;
create policy "pay incidents admin all" on public.pay_incidents
  for all using (exists (select 1 from public.app_admins a where a.auth_id = auth.uid()))
  with check (exists (select 1 from public.app_admins a where a.auth_id = auth.uid()));
drop policy if exists "pay incidents reporter select" on public.pay_incidents;
create policy "pay incidents reporter select" on public.pay_incidents
  for select using (reporter_id = auth.uid());

-- 起票はトリガーで＝どの書き込み経路（直接insert・将来のRPC）でも漏れない（機構の壁の作法）
create or replace function public.trg_pay_incident_on_unpaid()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_snap jsonb; v_job int; v_farmer uuid; v_worker uuid;
begin
  if new.direction <> 'worker_to_farmer' or new.pay_status is distinct from 'unpaid' then
    return new;
  end if;
  select a.job_number, a.farmer_id, a.worker_id,
         jsonb_build_object(
           'application', to_jsonb(a),
           'job', (select to_jsonb(j) from public.jobs j where j.job_number = a.job_number),
           'day_records', (select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at), '[]'::jsonb)
                             from public.attendance_events e where e.application_id = a.id),
           'final_review', jsonb_build_object(
             'match_level', new.match_level, 'pay_status', new.pay_status,
             'want_again_choice', new.want_again_choice, 'created_at', new.created_at)
         )
    into v_job, v_farmer, v_worker, v_snap
    from public.applications a where a.id = new.application_id;
  if v_farmer is null then return new; end if;

  insert into public.pay_incidents (application_id, reporter_id, farmer_id, worker_id, job_number, snapshot)
  values (new.application_id, new.reviewer_id, v_farmer, v_worker, v_job, v_snap);

  -- 運営への即時通知（アプリ内＋メール。メール失敗で評価の保存は落とさない）
  perform public.notify_admins('pay_incident',
    '💰未払いの申告：求人 #' || coalesce(v_job::text,'?') || '（申告＝確定ではない。事実確認を）');
  begin
    perform public.send_admin_email(
      '[chitose-bank] 💰未払いの申告：求人 #' || coalesce(v_job::text,'?'),
      '働き手の最終評価で「報酬は約束どおり支払われましたか」に【未払い】の回答がありました。' || E'\n' ||
      'これは申告であって、未払いの確定ではありません。' || E'\n\n' ||
      '・求人・契約・日次の記録・最終回答は申告時点の姿で凍結保存されています' || E'\n' ||
      '・必要に応じて双方へ事実確認をしてください（賃金は労基法24条の中心的義務）' || E'\n\n' ||
      '確認：https://chitose-bank.com/#/admin/reports');
  exception when others then null; end;
  return new;
end; $function$;

drop trigger if exists pay_incident_on_unpaid on public.reviews;
create trigger pay_incident_on_unpaid
  after insert on public.reviews
  for each row execute function public.trg_pay_incident_on_unpaid();

-- ②求人票との一致＝雇い手プロフィールに出す（2026-08-20たきと裁定）。
--   ★集計元を間違えない：日次の plan_mismatch は「1つの仕事で複数の差異」が起きる＝分母に使わない。
--   集計は最終評価の match_level を【1契約1票】で数える。日次は最終評価の根拠と運営分析用。
--   ★公開判定は badges と同じ（双方の評価が揃うか完了3日・規約第8条3）。
--   ★％では出さない：母数を消さない（8/10件 一致）。5件未満の表示ゲートはフロント側
--   （FarmerTrustCard＝MVPの設計値・1〜2件の偶然で印象を決めないための最低ゲート）。
create or replace function public.employer_trust_info(p_farmer_id uuid)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_ok boolean;
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
  v_matched int; v_partly int; v_differed int;
begin
  -- 停止・追放中の農家の信頼情報は本人以外に返さない（2026-08-16）
  if public.is_account_moderated(p_farmer_id)
     and (auth.uid() is null or auth.uid() <> p_farmer_id) then
    return json_build_object('ok', false);
  end if;
  v_ok := auth.uid() = p_farmer_id
    or exists (select 1 from public.applications a
                where a.farmer_id = p_farmer_id and a.worker_id = auth.uid())
    or exists (select 1 from public.jobs j
                where j.farmer_id = p_farmer_id and j.status = 'open');  -- 公開求人の農家は誰でも閲覧可
  if not v_ok then return json_build_object('ok', false); end if;

  -- 求人内容との一致（1契約1票・publishedのみ＝双方揃うか完了3日・第8条3）
  select count(*) filter (where r.match_level = 'matched'),
         count(*) filter (where r.match_level = 'partly'),
         count(*) filter (where r.match_level = 'differed')
    into v_matched, v_partly, v_differed
    from public.reviews r
    join public.applications a on a.id = r.application_id
   where r.reviewee_id = p_farmer_id
     and r.direction = 'worker_to_farmer'
     and r.match_level is not null
     and ((a.work_completed_at is not null and a.work_completed_at <= now() - interval '3 days')
          or exists (select 1 from public.reviews r2
                      where r2.application_id = r.application_id
                        and r2.reviewer_id = r.reviewee_id));

  return (select json_build_object('ok', true,
    'member_since', to_char(u.created_at at time zone 'Asia/Tokyo','YYYY年MM月'),
    'id_checked', exists(select 1 from public.account_holders ah where ah.auth_id = p_farmer_id),
    'entity_type', (select ah.entity_type from public.account_holders ah where ah.auth_id = p_farmer_id),
    'completed_hires', (select count(*) from public.applications a
                          join public.jobs j on j.job_number = a.job_number
                         where a.farmer_id = p_farmer_id and a.status = 'completed'
                           and a.attended is true
                           and not (j.status = 'open'
                                    and (coalesce(j.date_end, j.date_start) is null
                                         or coalesce(j.date_end, j.date_start) >= v_today))),
    'open_jobs', (select count(*) from public.jobs j
                   where j.farmer_id = p_farmer_id and j.status = 'open'
                     and (coalesce(j.date_end, j.date_start) is null
                          or coalesce(j.date_end, j.date_start) >= v_today)),
    'ended_jobs', (select count(*) from public.jobs j
                    where j.farmer_id = p_farmer_id and j.status = 'open'
                      and coalesce(j.date_end, j.date_start) < v_today),
    'active_applied', (select count(*) from public.applications a
                         join public.jobs j on j.job_number = a.job_number
                        where a.farmer_id = p_farmer_id
                          and a.status in ('applied','approved','working','completed')
                          and j.status = 'open'
                          and (coalesce(j.date_end, j.date_start) is null
                               or coalesce(j.date_end, j.date_start) >= v_today)),
    'active_approved', (select count(*) from public.applications a
                          join public.jobs j on j.job_number = a.job_number
                         where a.farmer_id = p_farmer_id
                           and a.status in ('approved','working','completed')
                           and j.status = 'open'
                           and (coalesce(j.date_end, j.date_start) is null
                                or coalesce(j.date_end, j.date_start) >= v_today)),
    'active_hired', (select count(*) from public.applications a
                       join public.jobs j on j.job_number = a.job_number
                      where a.farmer_id = p_farmer_id
                        and a.terms_confirmed_worker_at is not null
                        and a.terms_confirmed_farmer_at is not null
                        and j.status = 'open'
                        and (coalesce(j.date_end, j.date_start) is null
                             or coalesce(j.date_end, j.date_start) >= v_today)),
    'want_again_workers', (select count(*) from public.reviews r
                            where r.reviewee_id = p_farmer_id
                              and r.direction = 'worker_to_farmer' and r.want_again = true),
    'match_total', (v_matched + v_partly + v_differed),
    'match_matched', v_matched,
    'match_partly', v_partly,
    'match_differed', v_differed,
    'avg_response_hours', (select round(avg(extract(epoch from (decided_at - created_at))/3600)::numeric, 1)
                            from public.applications a
                           where a.farmer_id = p_farmer_id and a.decided_at is not null),
    'avg_approval_hours', (select round(avg(extract(epoch from (decided_at - created_at))/3600)::numeric, 1)
                            from public.applications a
                           where a.farmer_id = p_farmer_id and a.decided_at is not null and a.status <> 'rejected'))
    from auth.users u where u.id = p_farmer_id);
end; $function$;
