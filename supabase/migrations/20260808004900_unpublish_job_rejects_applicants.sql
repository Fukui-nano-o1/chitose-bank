-- 一時非公開＝応募中の人を見送りにする（2026-08-08たきと指示
-- 「一時非公開になった求人に応募している人は見送りにする」）
-- ・対象＝まだ採用が確定していない応募のみ：app_phase in ('applied','interview')
--   （applied＝応募中／interview＝承認済み・面接中。DB側の状態条件はapp_phaseを使う・2026-08-07規則）
-- ・採用済み（contracted）・作業中・完了・見送り・失効は触らない＝契約はterms_snapshotで凍結済みで、
--   掲載の取り下げと無関係に生きる（記録は消さない・行動記録の憲法）
-- ・記録と通知は満員見送り（confirm_terms・2026-07-27）と同じ作法：status='rejected'＋decided_at刻印＋
--   チャットへの自動投函＋アプリ内通知＋メール。「選考の結果ではない」ことを明記（働き手の不利益に読ませない）
create or replace function public.unpublish_job(p_job_number integer)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_count int;
  v_ref text;
  v_closed uuid[] := '{}';
  r record;
begin
  if auth.uid() is null then
    return json_build_object('ok', false, 'reason', 'not_signed_in');
  end if;
  update public.jobs
     set status = 'draft',
         unlisted_at = now(),
         unlisted_reason = 'unpublished'
   where job_number = p_job_number
     and farmer_id = auth.uid()
     and status = 'open';
  get diagnostics v_count = row_count;
  if v_count = 0 then
    return json_build_object('ok', false, 'reason', 'not_found_or_not_open');
  end if;

  v_ref := public.job_ref(p_job_number, 'worker');
  for r in
    select a.id, a.worker_id from public.applications a
     where a.job_number = p_job_number
       and public.app_phase(a) in ('applied','interview')
  loop
    update public.applications
       set status = 'rejected', decided_at = coalesce(decided_at, now())
     where id = r.id;
    v_closed := v_closed || r.id;
    begin
      insert into public.messages (application_id, sender_id, body)
      values (r.id, auth.uid(),
        'この求人は、いったん掲載を取り下げたため募集を終了しました。' ||
        'ご応募いただいたのに、お力になれずすみません。またの機会によろしくお願いします。');
    exception when others then null; end;
    begin
      insert into public.notifications (farmer_id, type, message)
      values (r.worker_id, 'application_declined',
              '求人 #' || p_job_number || '：掲載が取り下げられたため募集を終了しました。今回はご縁がありませんでした');
    exception when others then null; end;
    begin
      perform public.send_user_email(r.worker_id,
        '[chitose-bank] 募集終了のお知らせ：求人 #' || p_job_number,
        '■ ' || v_ref || E'\n\n' ||
        'この求人は、募集主が掲載を取り下げたため募集を終了しました。' || E'\n' ||
        '今回はご縁がありませんでした。ご応募いただき、ありがとうございました。' || E'\n\n' ||
        '※ 選考の結果ではなく、掲載の取り下げによる終了です。' || E'\n\n' ||
        '他の求人を見る：https://chitose-bank.com/#/search');
    exception when others then null; end;
  end loop;

  return json_build_object('ok', true, 'closed', coalesce(array_length(v_closed, 1), 0));
end;
$function$;
