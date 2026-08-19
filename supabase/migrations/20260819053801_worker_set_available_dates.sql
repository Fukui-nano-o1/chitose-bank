-- 働き手が「来られる日」を申告し直す窓口（2026-08-19たきと承認）
--
-- 経緯：農家がチャットで【日程案】を送り、働き手が日付のタブをタップして承認する形にした。
-- その承認をカレンダーに映すために、働き手が自分の available_dates を更新できる唯一の窓口を作る。
--
-- ★設計の一線（この関数を直す時も守ること）：
--  1. 書くのは available_dates（働き手自身の申告）だけ。agreed_dates（＝働く日の確定）は
--     農家の set_agreed_dates が唯一の窓口で、そちらは触らない（段階の意味を壊さない）
--  2. 採用前だけ（terms_confirmed_farmer_at is null）。採用＝契約の凍結後は、変更は
--     農家の「働く日を決める」に回す（凍結した契約の裏で働く日が動かない）
--  3. 求人の期間内・休日でない日だけ（農家が提案しうる日の集合）。任意の日付は入れさせない
--  4. 通知・メールは出さない＝この操作は必ずチャットの【日程の承認】メッセージと一緒に行われ、
--     そのメッセージが相手への連絡と証跡（改変不可）を兼ねる。二重に知らせない
--
-- applications に UPDATE ポリシーは1枚も無い（SELECT 2枚だけ）＝書き込みは SECURITY DEFINER の
-- 窓口経由に限る、という現行の形をそのまま守る。

create or replace function public.set_my_available_dates(p_application_id uuid, p_dates jsonb)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_worker uuid; v_job int; v_status text; v_hired timestamptz;
        v_ds date; v_de date; v_bad int; v_hol int;
begin
  if auth.uid() is null then return json_build_object('ok',false,'reason','not_logged_in'); end if;

  select a.worker_id, a.job_number, a.status, a.terms_confirmed_farmer_at
    into v_worker, v_job, v_status, v_hired
    from public.applications a where a.id = p_application_id;
  if v_worker is null then return json_build_object('ok',false,'reason','not_found'); end if;
  -- 本人（働き手）だけ。農家・第三者は入れない
  if v_worker <> auth.uid() then return json_build_object('ok',false,'reason','not_yours'); end if;
  -- 承認〜採用前のあいだだけ（チャットが開いていて、まだ契約が凍結されていない区間）
  if v_status not in ('approved','meeting','interview') then
    return json_build_object('ok',false,'reason','bad_status');
  end if;
  if v_hired is not null then return json_build_object('ok',false,'reason','already_hired'); end if;

  if p_dates is null or jsonb_typeof(p_dates) <> 'array' or jsonb_array_length(p_dates) = 0 then
    return json_build_object('ok',false,'reason','empty');
  end if;

  select j.date_start, coalesce(j.date_end, j.date_start) into v_ds, v_de
    from public.jobs j where j.job_number = v_job;
  if v_ds is null then return json_build_object('ok',false,'reason','no_period'); end if;

  -- 求人の期間内か
  select count(*) into v_bad from jsonb_array_elements_text(p_dates) d
   where d::date < v_ds or d::date > v_de;
  if v_bad > 0 then
    return json_build_object('ok',false,'reason','out_of_range','message','求人の期間外の日が含まれています');
  end if;

  -- 休日でないか（農家が休みに設定した日は提案されない＝承認もできない）
  select count(*) into v_hol
    from jsonb_array_elements_text(p_dates) d
   where d in (select h from public.jobs j,
                 lateral jsonb_array_elements_text(
                   case when jsonb_typeof(j.holidays)='array' then j.holidays else '[]'::jsonb end) h
                where j.job_number = v_job);
  if v_hol > 0 then
    return json_build_object('ok',false,'reason','holiday','message','休日の日が含まれています');
  end if;

  update public.applications
     set available_dates = (select jsonb_agg(distinct d order by d) from jsonb_array_elements_text(p_dates) d)
   where id = p_application_id;

  return json_build_object('ok', true);
end; $function$;

-- ログイン後専用（2026-08-06の教訓：revoke は from public と from anon の両方に撃つ）
revoke all on function public.set_my_available_dates(uuid, jsonb) from public, anon;
grant execute on function public.set_my_available_dates(uuid, jsonb) to authenticated;
