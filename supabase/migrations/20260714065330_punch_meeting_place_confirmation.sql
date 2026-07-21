-- 今日の主菜3点セット：①ワンタップ打刻 ②集合場所の開示（承認＝知る資格） ③確認カード
-- ＋満額保証型（完了払い）のデフォルト化

-- ① 打刻列（実績台帳の原料：遅刻・欠席・総時間は全部ここから生まれる）
alter table public.applications
  add column if not exists started_at timestamptz,
  add column if not exists work_completed_at timestamptz,
  add column if not exists terms_confirmed_worker_at timestamptz,   -- ③働き手の「相違なし」
  add column if not exists terms_confirmed_farmer_at timestamptz;   -- ③農家の「相違なし」

-- 満額保証型（完了払い）：デフォルトtrue・農家が選択（実働精算は将来実装）
alter table public.jobs
  add column if not exists full_pay_guarantee boolean not null default true;

-- ① 開始打刻RPC（働き手本人・approved系のみ・二重打刻防止）
create or replace function public.punch_start(p_application_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_worker uuid; v_status text; v_started timestamptz;
begin
  select worker_id, status, started_at into v_worker, v_status, v_started
    from public.applications where id = p_application_id;
  if v_worker is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_worker <> auth.uid() then return json_build_object('ok', false, 'reason', 'not_yours'); end if;
  if v_status not in ('approved','meeting','interview','contracted','working') then
    return json_build_object('ok', false, 'reason', 'bad_status', 'status', v_status);
  end if;
  if v_started is not null then
    return json_build_object('ok', true, 'already', true, 'started_at', v_started);
  end if;
  update public.applications set started_at = now(), status = 'working'
   where id = p_application_id;
  return json_build_object('ok', true, 'started_at', now());
end;
$$;
grant execute on function public.punch_start(uuid) to authenticated;

-- ② 集合場所の開示RPC：承認された働き手にだけ、その求人の番地を返す
create or replace function public.job_meeting_place(p_job_number int)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_address text; v_town text; v_city text; v_pref text;
begin
  -- 資格：その求人に approved 以降の応募を持つ働き手、または求人の農家本人
  if not exists (
    select 1 from public.applications a
     where a.job_number = p_job_number
       and (a.worker_id = auth.uid() and a.status in ('approved','meeting','interview','contracted','working','completed'))
  ) and not exists (
    select 1 from public.jobs j
     where j.job_number = p_job_number and j.farmer_id = auth.uid()
  ) then
    return json_build_object('ok', false, 'reason', 'not_entitled');
  end if;

  select prefecture, city, town, address into v_pref, v_city, v_town, v_address
    from public.jobs where job_number = p_job_number;

  return json_build_object('ok', true,
    'full_address', coalesce(v_pref,'') || coalesce(v_city,'') || coalesce(v_town,'') || ' ' || coalesce(v_address,''));
end;
$$;
grant execute on function public.job_meeting_place(int) to authenticated;

-- ③ 確認カードの「相違なし」記録RPC（当事者それぞれが自分の側を1回だけ押せる）
create or replace function public.confirm_terms(p_application_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_worker uuid; v_farmer uuid;
begin
  select worker_id, farmer_id into v_worker, v_farmer
    from public.applications where id = p_application_id;
  if v_worker is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;

  if auth.uid() = v_worker then
    update public.applications set terms_confirmed_worker_at = coalesce(terms_confirmed_worker_at, now())
     where id = p_application_id;
  elsif auth.uid() = v_farmer then
    update public.applications set terms_confirmed_farmer_at = coalesce(terms_confirmed_farmer_at, now())
     where id = p_application_id;
  else
    return json_build_object('ok', false, 'reason', 'not_party');
  end if;

  return (select json_build_object('ok', true,
      'worker_confirmed', terms_confirmed_worker_at is not null,
      'farmer_confirmed', terms_confirmed_farmer_at is not null)
    from public.applications where id = p_application_id);
end;
$$;
grant execute on function public.confirm_terms(uuid) to authenticated;