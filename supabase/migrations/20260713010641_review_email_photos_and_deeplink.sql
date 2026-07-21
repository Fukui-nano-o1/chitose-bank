-- 審査メールに写真を直接埋め込み、審査ボタンを該当求人への深いリンクに変更する。
-- 「コードの条件では防げないバグを目で捕まえる」ための最終目視レイヤー。
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
  v_photos_html text := '';
  v_ph jsonb;
  v_review_url text;
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
    v_review_url := 'https://chitose-bank.com/#/admin/review/' || new.job_number;

    -- 写真サムネイル（最大10枚・キャプション付き・肖像権/個人特定の目視用）
    if new.photos is not null and jsonb_array_length(new.photos) > 0 then
      for v_ph in select * from jsonb_array_elements(new.photos)
      loop
        v_photos_html := v_photos_html
          || '<div style="display:inline-block;margin:4px;vertical-align:top;text-align:center;">'
          || '<img src="' || (v_ph->>'url') || '" width="140" '
          || 'style="width:140px;height:105px;object-fit:cover;border-radius:8px;border:1px solid #EBEBEB;" />'
          || case when coalesce(v_ph->>'caption','') <> ''
               then '<div style="font-size:10px;color:#717171;max-width:140px;">' || (v_ph->>'caption') || '</div>'
               else '' end
          || '</div>';
      end loop;
    else
      v_photos_html := '<span style="color:#717171;font-size:13px;">写真なし</span>';
    end if;

    v_text :=
      '求人 #' || new.job_number || ' が審査待ちです。' || E'\n' ||
      '作物/作業：' || coalesce(new.crop,'ー') || ' / ' || coalesce(new.task,'ー') || E'\n' ||
      '審査：' || v_review_url;

    v_html :=
      '<div style="font-family:sans-serif;max-width:640px;margin:0 auto;">'
      || '<h2 style="font-size:18px;color:#222;">求人 #' || new.job_number || ' の審査</h2>'
      || '<p style="font-size:12px;color:#717171;">🔴 法的リスク直結（必ず確認）　🟠 要解釈（本文を読む）　⚪ 事実情報</p>'
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
      || public.review_box('orange', '作業の説明（虚偽・誇大・連絡先直書き・チャット外誘導の混入を確認）', new.notes)
      || public.review_box('orange', '必要経験（年齢・性別等の差別条件の混入を確認）', new.job_exp)
      || public.review_box('orange', '持ち物（費用負担の偏りを確認）', new.belongings)

      -- 🟠 写真：メール内で直接目視（肖像権・個人特定・番地看板の写り込み）
      || '<div style="margin:8px 0;padding:10px 14px;border-radius:8px;background:#FFF7ED;border-left:4px solid #EA580C;">'
      || '<div style="font-size:11px;color:#717171;margin-bottom:6px;">🟠 写真 '
      || coalesce(jsonb_array_length(new.photos),0) || '枚（人物の写り込み・番地看板・個人特定情報を目視）</div>'
      || v_photos_html
      || '</div>'

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
      || '<a href="' || v_review_url || '" style="display:inline-block;background:#00A86B;color:#fff;'
      || 'padding:12px 28px;border-radius:10px;text-decoration:none;font-size:14px;font-weight:bold;">'
      || 'この求人をプレビューして審査する（期限：2日以内）</a></div>'
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