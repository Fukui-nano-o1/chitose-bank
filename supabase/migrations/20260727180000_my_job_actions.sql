-- 働き手の「求人アクションとステータス」一覧の供給源（2026-07-27たきと指示）
--
-- 目的：いいね／応募した求人を、掲載が終了・非公開になった後も一覧に出せるようにする。
-- 事情：働き手は jobs を直接読めない（RLS owner select＝farmer_idのみ）。公開ビュー jobs_public は
--       status='open' しか含まないため、応募した求人が閉じられるとカードごと消え、
--       「失効」「完了」の暗幕が出る場面が実際には起きなかった。
--       get_my_calendar_jobs は approved〜working しか返さないので流用できない。
--
-- 返すもの：自分（auth.uid()）が応募 or いいねした求人の「カードに要る分だけ」＋自分の応募行の時刻。
-- 返さないもの：farmer_id・住所/番地・緯度経度など。相手や第三者の情報は一切含めない
--              （データ憲法＝個人識別情報をクライアントに配らない／応募者の情報は当事者のみ）。
-- 自分が出した求人（farmer_id = auth.uid()）は対象外＝働き手の面には自分の求人を出さない。
create or replace function public.my_job_actions()
returns table(
  job_number integer,
  crop text,
  task text,
  photos jsonb,
  date_start date,
  date_end date,
  town text,
  job_status text,
  liked boolean,
  application_id uuid,
  application_status text,
  applied_at timestamptz,
  terms_confirmed_worker_at timestamptz,
  terms_confirmed_farmer_at timestamptz,
  available_dates jsonb,
  agreed_dates jsonb
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    j.job_number, j.crop, j.task, j.photos, j.date_start, j.date_end, j.town, j.status as job_status,
    (s.job_number is not null) as liked,
    a.id as application_id, a.status as application_status, a.created_at as applied_at,
    a.terms_confirmed_worker_at, a.terms_confirmed_farmer_at, a.available_dates, a.agreed_dates
  from public.jobs j
  left join public.saved_jobs   s on s.job_number = j.job_number and s.worker_id = auth.uid()
  left join public.applications a on a.job_number = j.job_number and a.worker_id = auth.uid()
  where auth.uid() is not null
    and j.farmer_id <> auth.uid()
    and (s.job_number is not null or a.id is not null)
  order by j.job_number desc;
$function$;

revoke all on function public.my_job_actions() from public, anon;
grant execute on function public.my_job_actions() to authenticated;
