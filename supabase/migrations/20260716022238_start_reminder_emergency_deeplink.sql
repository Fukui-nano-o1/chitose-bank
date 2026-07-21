-- 開始1時間前メールを緊急連絡ディープリンク対応に刷新
-- （リンク着地＝該当応募の緊急連絡モーダルが自動展開・探させない）
create or replace function public.send_job_start_reminders()
returns void language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_start_min int;
  v_now_min int;
  v_link text;
begin
  v_now_min := (extract(hour from now() at time zone 'Asia/Tokyo')::int) * 60
             + (extract(minute from now() at time zone 'Asia/Tokyo')::int);

  for r in
    select j.job_number, j.crop, j.task, j.work_time, j.town, j.farmer_id,
           a.id as app_id, a.worker_id
      from public.jobs j
      join public.applications a on a.job_number = j.job_number
     where j.status = 'open'
       and a.status in ('approved','meeting','interview','contracted','working')
       and (j.date_start = (now() at time zone 'Asia/Tokyo')::date
            or (j.date_end is not null
                and (now() at time zone 'Asia/Tokyo')::date between j.date_start and j.date_end))
       and j.work_time ~ '^\d{1,2}:\d{2}'
  loop
    v_start_min := split_part(split_part(r.work_time,'〜',1),':',1)::int * 60
                 + split_part(split_part(r.work_time,'〜',1),':',2)::int;

    if v_start_min - v_now_min between 60 and 119 then
      v_link := 'https://chitose-bank.com/#/emergency/' || r.app_id;

      perform public.send_user_email(
        r.worker_id,
        '[chitose-bank] まもなく作業開始：求人 #' || r.job_number || '（' || r.work_time || '）',
        '本日の作業「' || coalesce(r.crop,'') || ' ' || coalesce(r.task,'') || '」（' || r.work_time || '・'
          || coalesce(r.town,'') || '）が約1時間後に始まります。' || E'\n\n' ||
        '遅れそう・行けない・体調がすぐれない——そんな時は、下のリンクから' || E'\n' ||
        'そのまま緊急連絡を送れます（農家さんに即時に届きます）：' || E'\n' ||
        v_link || E'\n\n' ||
        '・持ち物と集合場所を、もう一度ご確認ください。' || E'\n' ||
        '・熱中症にご注意ください。水分を持って出かけましょう。'
      );

      perform public.send_user_email(
        r.farmer_id,
        '[chitose-bank] まもなく作業開始：求人 #' || r.job_number || '（' || r.work_time || '）',
        '本日の作業「' || coalesce(r.crop,'') || ' ' || coalesce(r.task,'') || '」（' || r.work_time || '）が約1時間後に始まります。' || E'\n\n' ||
        '中止・延期などの緊急連絡は、下のリンクからそのまま送れます' || E'\n' ||
        '（働き手に即時に届きます）：' || E'\n' ||
        v_link || E'\n\n' ||
        '・作業内容・安全の説明の準備をお願いします。'
      );
    end if;
  end loop;
end; $$;