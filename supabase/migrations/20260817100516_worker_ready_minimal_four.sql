-- 段B：応募に必要なプロフィールの条件を必要最低限の4項目にする（2026-08-17 たきと指示
--   「プロフィール設定条件は必要最低限。①ニックネーム②緊急連絡先③居住地④自己紹介のみだ。」）
-- 旧条件：ニックネーム／居住地／移動手段／農作業の経験／本人確認の氏名(account_holders)
-- 新条件：ニックネーム／緊急連絡先／居住地／自己紹介
--   ・外れる＝移動手段・農作業の経験（プロフィールの充実であって応募の必要条件ではない）
--   ・入る  ＝緊急連絡先（労働安全・義務化。たきと裁定2026-08-17）／自己紹介（相手が判断する材料）
-- ★本人確認の登録（account_holders）は「プロフィールの条件」から外すが、応募の前提としては残す
--   （たきと裁定「外してはいけない」）。ここが 18歳未満の登録拒否（enforce_min_age）と
--   規約・プラポリの同意版数を記録する唯一の場所so、迂回した応募が農家に届いてはいけない。
--   → 4項目の関数とは別に「登録が済んでいるか」を account_holders の存在で確認する（下の promote）。
-- ★自己紹介は pr（公開済み）または pr_pending（審査待ち）のどちらかがあれば満たす＝
--   運営の確認を応募の関所にしない（2026-07-30の原則・承認プロセス廃止後も不変）。
-- ★緊急連絡先は別テーブル emergency_contacts（self-only RLS）。SECURITY DEFINER so参照できる。
--   氏名・電話のどちらかが入っていれば登録済みとみなす（EmergencyContactBox の保存単位と同じ）。
-- ★フロントの写しは lib/workerReady.js と WorkerProfileEdit の「この4つで応募できます」ガイド。
--   条件を変える時は3つとも直す（食い違うと「埋めたのに応募が届かない」が起きる）。

create or replace function public.is_worker_profile_ready(p_uid uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from public.worker_profiles w
     where w.auth_id = p_uid
       and coalesce(btrim(w.nickname),'') <> ''
       and coalesce(btrim(w.residence_city),'') <> ''
       and (coalesce(btrim(w.pr),'') <> '' or coalesce(btrim(w.pr_pending),'') <> '')
  ) and exists (
    select 1 from public.emergency_contacts e
     where e.auth_id = p_uid
       and (coalesce(btrim(e.name),'') <> '' or coalesce(btrim(e.phone),'') <> '')
  );
$function$;

-- 昇格の前提に「本人情報の登録が済んでいる」を明示的に置く（たきと裁定①）。
-- フロントの応募ボタンは未登録なら #/account へ送るが、UIの導線だけでは担保にならない。
create or replace function public.promote_my_pending_applications()
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare r record; v_n int := 0;
begin
  if auth.uid() is null then return json_build_object('ok',false,'reason','not_logged_in'); end if;
  -- 停止・追放中の働き手は昇格させない（絶対に通さない・2026-08-17 段A）
  if public.is_account_moderated(auth.uid()) then
    return json_build_object('ok', false, 'reason','account_suspended',
      'message','アカウントは停止中のため、応募を届けられません');
  end if;
  -- 本人情報の登録（18歳確認・規約同意の記録）が無いまま農家に応募を届けない（段B・たきと裁定①）
  if not exists (select 1 from public.account_holders h where h.auth_id = auth.uid()) then
    return json_build_object('ok', false, 'reason','not_registered',
      'message','ご本人の情報の登録がまだ済んでいません');
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
revoke all on function public.is_worker_profile_ready(uuid) from public, anon;
revoke all on function public.promote_my_pending_applications() from public, anon;
grant execute on function public.is_worker_profile_ready(uuid) to authenticated, service_role;
grant execute on function public.promote_my_pending_applications() to authenticated, service_role;
