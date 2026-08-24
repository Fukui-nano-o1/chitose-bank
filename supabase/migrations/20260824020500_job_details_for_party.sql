-- 当事者は掲載が終わった求人の内容も見られるようにする（2026-08-24たきと指示「Aから」）
-- 【何があったか】求人の全体像の出どころは jobs_public だけだが、このビューは status='open'
--   （＋満員で closed）しか返さず、一時非公開・掲載終了・下書きの求人は落ちる。jobs テーブルの
--   RLS は「求人の農家本人だけ」なので、応募した働き手は掲載が終わると中身を一切読めなくなっていた
--   ＝カードのボックスが空／チャットの契約確認カードが出ず採用が進められない／求人ページへの
--   リンクがさがす一覧に落ちる（2026-08-24の調査で10求人・応募13件・いいね5件が該当）。
-- 【直し方】当事者だけに開く窓口を1本足す（job_meeting_place と同じ作法）。
--   ★ビュー jobs_public は触らない＝触るとさがす一覧に非公開求人が混ざる。
-- 【開く相手】その求人の農家本人／その求人に応募した働き手（状態は問わない）／運営。
--   それ以外には返さない。未ログインは EXECUTE 権限で拒否（二重の壁）。
-- 【開く中身】ログイン時の jobs_public と同じ姿。個人を指す列（farmer_id・行id）と運営の内部列
--   （unlisted_reason・revision_requested_at・unlisted_at・draft_step・zip・geocoded_from）は返さない。
--   ★列は to_jsonb(j) で組む＝jobs に列を足しても自動で追従する（jobs_public の列を列挙しない
--     ＝2026-07-22ルールの列ズレ〈42P13〉を新しく作らない）。派生の5つだけ名前をそろえて足す。
-- 【あわせて】求人ページの中の農家プロフィール・信頼情報（job_employer_profile /
--   job_employer_trust_info）も status='open' 限定だったので、当事者にも開いた。開示は広がっていない
--   ＝employer_profiles_public はログイン利用者なら誰でも読める公開の看板で、信頼情報の中身の資格判定は
--   employer_trust_info（本人／応募のある働き手／公開求人のある農家）が従来どおり行う。
--   停止・追放中の農家を返さない守り（2026-08-16）も不変。
-- 【本文のコメントを英語にしている理由】この環境では日本語の一部が化けることがあるため、DBに残る
--   関数の本文は ASCII に寄せ、説明はこの外側のコメント（DBには保存されない）に置いた。
-- 【既存2本の書き換え方】長い日本語の本文を写経せず、pg_get_functiondef の現物の ASCII のアンカー
--   （where j.job_number = p_job_number and j.status = 'open'）を1箇所だけ置換して実行する
--   （置換数を毎回検査し、想定外なら例外で止める＝家の作法）。
-- 【実測（ロールバック付き）】応募した働き手＝#1053（一時非公開）を取得できる・農家本人も取得できる／
--   無関係の利用者＝0件（公開求人 #1233 もこの窓口からは0件＝さがす用の jobs_public が担う）／
--   anon＝EXECUTE拒否／返り値に farmer_id は無く work_address・employer_nickname・hired_count がある。

create or replace function public.is_job_party(p_job_number integer)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  -- party = the job's own farmer / a worker who applied to it (any status) / an admin
  select auth.uid() is not null and (
    exists (select 1 from public.jobs j
             where j.job_number = p_job_number and j.farmer_id = auth.uid())
    or exists (select 1 from public.applications a
                where a.job_number = p_job_number and a.worker_id = auth.uid())
    or exists (select 1 from public.app_admins ad where ad.auth_id = auth.uid())
  );
$$;
revoke all on function public.is_job_party(integer) from public;
revoke all on function public.is_job_party(integer) from anon;
revoke all on function public.is_job_party(integer) from authenticated;

create or replace function public.job_details_for_party(p_job_numbers integer[])
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  -- same shape as a logged-in jobs_public row, built with to_jsonb(j) so new jobs
  -- columns follow automatically. Only the 5 derived fields are spelled out.
  select coalesce(jsonb_agg(x.row_json), '[]'::jsonb)
  from (
    select (to_jsonb(j)
             - 'id' - 'farmer_id' - 'address' - 'zip' - 'draft_step'
             - 'geocoded_from' - 'unlisted_at' - 'unlisted_reason' - 'revision_requested_at')
           || jsonb_build_object(
                'work_address', j.address,
                'has_work_address', (j.address is not null and btrim(j.address) <> ''),
                'employer_nickname', ep.nickname,
                'employer_avatar_url', ep.avatar_url,
                'hired_count', (select count(*) from public.applications a
                                 where a.job_number = j.job_number
                                   and a.terms_confirmed_worker_at is not null
                                   and a.terms_confirmed_farmer_at is not null),
                'masked_fields', '[]'::jsonb) as row_json
      from public.jobs j
      left join public.employer_profiles ep on ep.auth_id = j.farmer_id
     where j.job_number = any (p_job_numbers[1:100])
       -- auth.uid() is checked here as well as inside is_job_party(): fail closed,
       -- and the gate stays visible to the structural audit (audit.sql check 3c).
       and auth.uid() is not null
       and public.is_job_party(j.job_number)
  ) x;
$$;
revoke all on function public.job_details_for_party(integer[]) from public;
revoke all on function public.job_details_for_party(integer[]) from anon;
grant execute on function public.job_details_for_party(integer[]) to authenticated;

do $mig$
declare src text; out text; n int;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'job_employer_profile';
  if src is null then raise exception 'job_employer_profile not found'; end if;
  n := (length(src) - length(replace(src, 'where j.job_number = p_job_number and j.status = ''open''', ''))) / length('where j.job_number = p_job_number and j.status = ''open''');
  if n <> 1 then raise exception 'anchor count in job_employer_profile = %', n; end if;
  out := replace(src,
    'where j.job_number = p_job_number and j.status = ''open''',
    'where j.job_number = p_job_number and (j.status = ''open'' or public.is_job_party(p_job_number))');
  execute out;
end $mig$;

do $mig$
declare src text; out text; n int;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'job_employer_trust_info';
  if src is null then raise exception 'job_employer_trust_info not found'; end if;
  n := (length(src) - length(replace(src, 'where j.job_number = p_job_number and j.status = ''open''', ''))) / length('where j.job_number = p_job_number and j.status = ''open''');
  if n <> 1 then raise exception 'anchor count in job_employer_trust_info = %', n; end if;
  out := replace(src,
    'where j.job_number = p_job_number and j.status = ''open''',
    'where j.job_number = p_job_number and (j.status = ''open'' or public.is_job_party(p_job_number))');
  execute out;
end $mig$;
