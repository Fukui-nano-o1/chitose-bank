-- 修正のお願いの強制力を復元（2026-08-14 バグ狩り③S2で発見・修理）
--
-- 【穴】承認プロセス削除（20260814073038）で、運営の「修正のお願い」（request_job_revision＝
--   公開中の求人を draft に戻し修正を依頼する事後モデレーション）を、農家that無修正のまま
--   publish_my_job で即・再公開でき、trg_clear_job_revision_flag が open 遷移でフラグまで自動で
--   消していた（実弾S2で確認）。旧フローでは再掲載＝pending→運営承認だったためこの自動クリアは
--   運営の手の中で発火していた＝即公開化で農家の手に渡った、という削除の副作用。
--
-- 【修理＝対象求人だけ従来の承認制に落とす】
--   1. publish_my_job：revision_requested_at が立っている求人は open でなく pending（公開間近）へ。
--      運営にアプリ内お知らせ＋メール（審査プレビューへのリンク）を送り、運営that確認して開く
--      （AdminJobPreview「公開する」＝admin RLS の既存の救済経路をそのまま使う）。
--      返り値 {ok:true, pending:true} ＝フロントは「公開の準備が整いしだい」の祝祭に分岐。
--   2. trg_clear_job_revision_flag：フラグを消すのは【open遷移だけ】に変更（従来は pending でも消えた）。
--      pending の間フラグthat残る＝運営thatプレビューで「修正のお願い中の再提出」だと分かる。
--      運営that開いた瞬間（pending→open）にフラグthat消える＝解決の記録は従来どおり。
--   通常の求人（フラグ無し）の掲載＝即公開は一切変わらない。一時非公開→再掲載（unlisted='unpublished'）も不変。

create or replace function public.publish_my_job(p_job_number integer)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_farmer uuid; v_status text; v_rev timestamptz;
begin
  if auth.uid() is null then return json_build_object('ok', false, 'reason', 'not_logged_in'); end if;
  if public.is_account_moderated(auth.uid()) then
    return json_build_object('ok', false, 'reason', 'account_suspended');
  end if;
  select farmer_id, status, revision_requested_at into v_farmer, v_status, v_rev
    from public.jobs where job_number = p_job_number;
  if v_farmer is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_farmer <> auth.uid() then return json_build_object('ok', false, 'reason', 'not_yours'); end if;
  if v_status = 'open' then return json_build_object('ok', true, 'already', true); end if;
  if v_status not in ('draft','pending') then return json_build_object('ok', false, 'reason', 'bad_status'); end if;

  -- 修正のお願い中＝運営の確認を経て公開（この求人だけ従来の承認制）
  if v_rev is not null then
    update public.jobs set status = 'pending' where job_number = p_job_number;
    begin
      perform public.notify_admins(
        'job_revision_resubmitted',
        '修正のお願い中の求人が再掲載されました（要確認）：#' || p_job_number);
      perform public.send_admin_email(
        '[要確認] 修正のお願い中の求人 #' || p_job_number || ' が再掲載されました',
        '修正のお願い（' || to_char(v_rev at time zone 'Asia/Tokyo', 'MM/DD HH24:MI') || '）中の求人that再掲載されました。' || E'\n' ||
        '内容を確認し、問題がなければ公開してください（公開でフラグは自動で消えます）。' || E'\n\n' ||
        '確認：https://chitose-bank.com/#/admin/review/' || p_job_number);
    exception when others then null; end;
    return json_build_object('ok', true, 'pending', true, 'reason', 'revision_requested');
  end if;

  update public.jobs set status = 'open' where job_number = p_job_number;
  return json_build_object('ok', true);
end; $$;

revoke all on function public.publish_my_job(integer) from public;
revoke all on function public.publish_my_job(integer) from anon;
grant execute on function public.publish_my_job(integer) to authenticated;

-- フラグの自動クリアは open 遷移だけに（pending では残す＝運営thatが文脈を見える）
create or replace function public.trg_clear_job_revision_flag()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'open' and new.revision_requested_at is not null then
    new.revision_requested_at := null;
  end if;
  return new;
end; $$;
