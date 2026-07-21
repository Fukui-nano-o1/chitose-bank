-- 審査メールのHTML化：項目ごとに法的リスク三色のボックスで表示する。
-- 赤=法に直結（報酬/勤務時間/危険情報） 橙=要解釈（自由記述/写真） 基準色=事実情報

-- send_admin_email に html 引数を追加（既存2引数呼び出しはデフォルトで互換維持）
drop function if exists public.send_admin_email(text, text);
create or replace function public.send_admin_email(p_subject text, p_body text, p_html text default null)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_key text;
  v_email text;
  v_payload jsonb;
begin
  begin
    select decrypted_secret into v_key
      from vault.decrypted_secrets where name = 'RESEND_API_KEY' limit 1;
  exception when others then v_key := null;
  end;
  if v_key is null or v_key = '' then return; end if;

  for v_email in
    select u.email from public.app_admins a
    join auth.users u on u.id = a.auth_id
    where u.email is not null
  loop
    begin
      v_payload := jsonb_build_object(
        'from','chitose-bank <noreply@chitose-bank.com>',
        'to', jsonb_build_array(v_email),
        'subject', p_subject, 'text', p_body);
      if p_html is not null then
        v_payload := v_payload || jsonb_build_object('html', p_html);
      end if;
      perform net.http_post(
        url     := 'https://api.resend.com/emails',
        headers := jsonb_build_object('Authorization','Bearer '||v_key,'Content-Type','application/json'),
        body    := v_payload,
        timeout_milliseconds := 3000
      );
    exception when others then null;
    end;
  end loop;
end;
$$;

-- 三色ボックスの部品
create or replace function public.review_box(p_level text, p_label text, p_value text)
returns text
language sql
immutable
as $$
  select '<div style="margin:8px 0;padding:10px 14px;border-radius:8px;'
    || case p_level
         when 'red'    then 'background:#FEF2F2;border-left:4px solid #DC2626;'
         when 'orange' then 'background:#FFF7ED;border-left:4px solid #EA580C;'
         else               'background:#F7F7F7;border-left:4px solid #D1D5DB;'
       end
    || '"><div style="font-size:11px;color:#717171;margin-bottom:2px;">'
    || case p_level when 'red' then '🔴 ' when 'orange' then '🟠 ' else '' end
    || p_label || '</div>'
    || '<div style="font-size:14px;color:#222;white-space:pre-wrap;">'
    || coalesce(nullif(p_value,''), 'ー')
    || '</div></div>';
$$;

-- 審査メール本体：HTML三色トリアージ版
create or replace function public.trg_notify_job_pending()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_text text;
  v_html text;
  v_danger_p text;
  v_danger_t text;
begin
  if new.status = 'pending'
     and (tg_op = 'INSERT' or old.status is distinct from 'pending') then

    perform public.notify_admins(
      'job_pending',
      '求人が承認待ちです：#' || new.job_number || '　' ||
      coalesce(new.crop, '') || ' ' || coalesce(new.task, '')
    );

    v_danger_p := coalesce(nullif(new.danger_places::text,'[]'), '');
    v_danger_t := coalesce(nullif(new.danger_tasks::text,'[]'), '');

    -- テキスト版（フォールバック・従来形式）
    v_text :=
      '求人 #' || new.job_number || ' が審査待ちです。' || E'\n' ||
      '作物/作業：' || coalesce(new.crop,'ー') || ' / ' || coalesce(new.task,'ー') || E'\n' ||
      '報酬：' || coalesce(new.pay_type,'ー') || ' 時給:' || coalesce(nullif(new.hourly_wage,''),'ー') ||
      ' 日給:' || coalesce(nullif(new.daily_wage,''),'ー') || E'\n' ||
      '審査：https://chitose-bank.com/#/admin';

    -- HTML版（三色トリアージ）
    v_html :=
      '<div style="font-family:sans-serif;max-width:640px;margin:0 auto;">'
      || '<h2 style="font-size:18px;color:#222;">求人 #' || new.job_number || ' の審査</h2>'
      || '<p style="font-size:12px;color:#717171;">🔴 法的リスク直結（必ず確認）　🟠 要解釈（本文を読む）　⚪ 事実情報</p>'

      -- 🔴 法に直結
      || public.review_box('red', '報酬（最低賃金法・的確表示）',
           coalesce(new.pay_type,'ー') || '　時給: ' || coalesce(nullif(new.hourly_wage,''),'ー')
           || '　日給: ' || coalesce(nullif(new.daily_wage,''),'ー'))
      || public.review_box('red', '勤務時間・休憩（労基法：6h超45分・8h超60分）',
           coalesce(new.work_time,'ー') || '　休憩: ' || coalesce(new.break_time,'ー'))
      || public.review_box('red', '危険な場所（未記載のまま事故＝場の責任）',
           case when v_danger_p = '' then '⚠️ 未記載' else v_danger_p end)
      || public.review_box('red', '危険な作業',
           case when v_danger_t = '' then '⚠️ 未記載' else v_danger_t end)
      || public.review_box('red', '注意事項（安全配慮の記載）', new.cautions)

      -- 🟠 要解釈
      || public.review_box('orange', '作業の説明（虚偽・誇大・連絡先直書き・チャット外誘導の混入を確認）', new.notes)
      || public.review_box('orange', '必要経験（年齢・性別等の差別条件の混入を確認）', new.job_exp)
      || public.review_box('orange', '持ち物（費用負担の偏りを確認）', new.belongings)
      || public.review_box('orange', '写真（肖像権・個人特定の写り込みはプレビューで目視）',
           coalesce(jsonb_array_length(new.photos),0) || '枚')

      -- ⚪ 事実情報
      || public.review_box('base', '作物・作業',
           coalesce(new.crop,'ー') || ' / ' || coalesce(new.task,'ー'))
      || public.review_box('base', '場所（公開は町域まで・番地は非公開）',
           coalesce(new.prefecture,'') || coalesce(new.city,'') || coalesce(new.town,'')
           || '　番地: ' || coalesce(new.address,'ー') || '　〒' || coalesce(new.zip,'ー'))
      || public.review_box('base', '日程・採用人数',
           coalesce(new.date_label,'ー') || '（' || coalesce(new.date_start::text,'ー') || '〜'
           || coalesce(new.date_end::text,'ー') || '）　' || coalesce(new.headcount::text,'ー') || '人')
      || public.review_box('base', '最寄り駅・座標',
           coalesce(new.nearest_station,'ー') || '（' || coalesce(new.commute_time,'ー') || '）　'
           || coalesce(new.geocoded_from,'座標なし・地図非表示'))

      || '<div style="margin-top:16px;">'
      || '<a href="https://chitose-bank.com/#/admin" style="display:inline-block;background:#00A86B;color:#fff;'
      || 'padding:12px 28px;border-radius:10px;text-decoration:none;font-size:14px;font-weight:bold;">'
      || '管理タブで審査する（期限：2日以内）</a></div>'
      || '</div>';

    begin
      perform public.send_admin_email(
        '[審査] 求人 #' || new.job_number || '　' || coalesce(new.crop,'') || ' ' || coalesce(new.task,''),
        v_text, v_html
      );
    exception when others then null;
    end;
  end if;
  return new;
end;
$$;