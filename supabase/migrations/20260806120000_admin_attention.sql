-- 運営の気づきボックス（2026-08-06たきと指示「通知ボックスを設置。管理者権限者のみ」）
-- ■読み取り専用：ここからは1行も書き換えない（対処済みにする等の更新は将来の別RPC）
-- ■権限：app_admins に居る人だけ。auth.uid() is null を【先に】弾く
--   （2026-07-29 worker_trust_info・2026-08-03 worker_want_again_count と同じフェイルオープンの穴を作らない）
-- ■2レーンに分ける（性質が逆so混ぜない）：
--   fix   ＝運営が手を動かすまで消えない（不具合・通報・退会依頼）
--   stall ＝当事者が動けば自動で消える（取引の滞留）。状態を持たず記録から導出する
-- ■運営の主観は入れない：点数・おすすめ度・優先度の重みづけは作らない。並びは経過時間だけ
--   （2026-07-16「推薦・選別の禁止」「運営の主観を混ぜない」の規律をそのまま持ち込む）
create or replace function public.admin_attention()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
  v_fix json; v_stall json;
begin
  if v_uid is null then return json_build_object('ok', false, 'reason', 'not_logged_in'); end if;
  if not exists (select 1 from public.app_admins a where a.auth_id = v_uid) then
    return json_build_object('ok', false, 'reason', 'not_admin');
  end if;

  -- ── レーン①：直すこと ─────────────────────────────
  -- 同じ原因は束ねる（部品×文言）＝297行を297行のまま並べない。新しい順に上位8件だけ返す
  select json_build_object(
    'errors', coalesce((
      select json_agg(x order by x.latest desc) from (
        select coalesce(nullif(btrim(e.component), ''), '(不明)') as component,
               left(coalesce(nullif(btrim(e.message), ''), '(メッセージなし)'), 160) as message,
               count(*)::int as cnt,
               max(e.created_at) as latest,
               (array_agg(e.page order by e.created_at desc))[1] as page
          from public.app_errors e
         where e.status = 'open'
         group by 1, 2
         order by max(e.created_at) desc
         limit 8
      ) x), '[]'::json),
    'error_total', (select count(*)::int from public.app_errors where status = 'open'),
    'reports_message', (select count(*)::int from public.message_reports where status = 'open'),
    'reports_job',     (select count(*)::int from public.job_reports     where status = 'open'),
    'reports_profile', (select count(*)::int from public.profile_reports where status = 'open'),
    'withdrawals',     (select count(*)::int from public.withdrawal_requests where processed_at is null),
    'feedback_7d',     (select count(*)::int from public.feedback where created_at >= now() - interval '7 days')
  ) into v_fix;

  -- ── レーン②：動いていないこと ─────────────────────
  -- 件数と「いちばん古いものが何日前か」だけ。誰が悪いかは書かない（事実の提示に留める）
  with applied as (
    select count(*)::int n, max(v_today - created_at::date) d from public.applications where status = 'applied'
  ), pend as (
    select count(*)::int n, max(v_today - created_at::date) d from public.jobs where status = 'pending'
  ), rev as (
    select count(*)::int n, max(v_today - revision_requested_at::date) d
      from public.jobs where status = 'draft' and revision_requested_at is not null
  ), q as (
    select count(*)::int n, max(v_today - created_at::date) d
      from public.job_questions where coalesce(answer, '') = '' and hidden = false
  ), corr as (
    select count(*)::int n, max(v_today - created_at::date) d
      from public.attendance_corrections where status = 'pending'
  ), st as (
    select count(*)::int n from public.applications
     where started_at is not null and farmer_confirmed_start_at is null
       and status in ('approved','meeting','interview','contracted','working')
  ), comp as (
    select count(*)::int n from public.applications a join public.jobs j on j.job_number = a.job_number
     where a.status in ('approved','meeting','interview','contracted','working')
       and a.work_completed_at is null
       and coalesce(j.date_end, j.date_start) < v_today
  ), emg as (
    select count(*)::int n from public.attendance_events where created_at >= now() - interval '7 days'
  )
  select json_build_object(
    'applied',      json_build_object('n', applied.n, 'days', applied.d),
    'pending_jobs', json_build_object('n', pend.n,    'days', pend.d),
    'revision',     json_build_object('n', rev.n,     'days', rev.d),
    'questions',    json_build_object('n', q.n,       'days', q.d),
    'corrections',  json_build_object('n', corr.n,    'days', corr.d),
    'start_unconfirmed', json_build_object('n', st.n,   'days', null),
    'complete_missing',  json_build_object('n', comp.n, 'days', null),
    'emergency_7d',      json_build_object('n', emg.n,  'days', null)
  ) into v_stall
  from applied, pend, rev, q, corr, st, comp, emg;

  return json_build_object('ok', true, 'fix', v_fix, 'stall', v_stall);
end;
$$;

revoke all on function public.admin_attention() from public, anon, authenticated;
grant execute on function public.admin_attention() to authenticated;

comment on function public.admin_attention() is
  '運営の気づきボックス（2026-08-06）：不具合・通報など「運営が直すこと」と、取引の滞留など「当事者が動けば消えること」を2レーンで返す。読み取り専用・app_adminsのみ。';
