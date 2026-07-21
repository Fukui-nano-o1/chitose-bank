-- 審査メールの増強：管理画面を開かなくてもメール1通で目視審査が完結する情報量にする。
-- 空欄は「ー」で明示（未記載の可視化＝審査観点「危険情報の未記載」を検出しやすくする）。

create or replace function public.trg_notify_job_pending()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_body text;
begin
  if new.status = 'pending'
     and (tg_op = 'INSERT' or old.status is distinct from 'pending') then

    perform public.notify_admins(
      'job_pending',
      '求人が承認待ちです：#' || new.job_number || '　' ||
      coalesce(new.crop, '') || ' ' || coalesce(new.task, '')
    );

    v_body :=
      '求人 #' || new.job_number || ' が審査待ちです。' || E'\n\n' ||
      '■ 作物・作業：' || coalesce(new.crop,'ー') || ' / ' || coalesce(new.task,'ー') || E'\n' ||
      '■ 場所：' || coalesce(new.prefecture,'ー') || coalesce(new.city,'') || coalesce(new.town,'') ||
        '（番地：' || coalesce(new.address,'ー') || '／〒' || coalesce(new.zip,'ー') || '）' || E'\n' ||
      '■ ジオコーディング：' || coalesce(new.geocoded_from,'ー（座標なし・地図非表示）') || E'\n' ||
      '■ 日程：' || coalesce(new.date_label,'ー') ||
        '（' || coalesce(new.date_start::text,'ー') || ' 〜 ' || coalesce(new.date_end::text,'ー') || '）' || E'\n' ||
      '■ 採用人数：' || coalesce(new.headcount::text,'ー') || '人' || E'\n' ||
      '■ 報酬：' || coalesce(new.pay_type,'ー') ||
        '　時給:' || coalesce(nullif(new.hourly_wage,''),'ー') ||
        '　日給:' || coalesce(nullif(new.daily_wage,''),'ー') || E'\n' ||
      '■ 勤務時間：' || coalesce(new.work_time,'ー') || '（休憩:' || coalesce(new.break_time,'ー') || '）' || E'\n' ||
      '■ 最寄り駅：' || coalesce(new.nearest_station,'ー') || '（移動:' || coalesce(new.commute_time,'ー') || '）' || E'\n' ||
      '■ 必要経験：' || coalesce(new.job_exp,'ー') || E'\n' ||
      '■ 作業の説明：' || E'\n' || coalesce(nullif(new.notes,''),'ー') || E'\n\n' ||
      '■ 持ち物：' || coalesce(nullif(new.belongings,''),'ー') || E'\n' ||
      '■ 注意事項：' || E'\n' || coalesce(nullif(new.cautions,''),'ー') || E'\n\n' ||
      '■ 危険な場所：' || coalesce(nullif(new.danger_places::text,'[]'),'ー') || E'\n' ||
      '■ 危険な作業：' || coalesce(nullif(new.danger_tasks::text,'[]'),'ー') || E'\n' ||
      '■ 写真：' || coalesce(jsonb_array_length(new.photos),0) || '枚' || E'\n\n' ||
      '審査（公開/差し戻し）は管理タブから：https://chitose-bank.com/#/admin' || E'\n' ||
      '（審査期限の目安：提出から2日以内）';

    begin
      perform public.send_admin_email(
        '[審査] 求人 #' || new.job_number || '　' || coalesce(new.crop,'') || ' ' || coalesce(new.task,''),
        v_body
      );
    exception when others then null;
    end;
  end if;
  return new;
end;
$$;

-- 応募メールの増強：農家が誰からの応募かをメールだけで把握できるようにする
-- （連絡先は含めない＝チャットへ誘導。プロフィールはRLSで農家に開示済みの範囲のみ）
create or replace function public.trg_notify_application()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nickname text;
  v_pr text;
  v_crop text;
  v_task text;
begin
  perform public.notify_admins('new_application', '応募が入りました：求人 #' || new.job_number);

  select wp.nickname, wp.pr into v_nickname, v_pr
    from public.worker_profiles wp where wp.auth_id = new.worker_id;
  select j.crop, j.task into v_crop, v_task
    from public.jobs j where j.job_number = new.job_number;

  begin
    perform public.send_user_email(
      new.farmer_id,
      '[chitose-bank] 応募が入りました：求人 #' || new.job_number,
      'あなたの求人 #' || new.job_number ||
        '（' || coalesce(v_crop,'') || ' ' || coalesce(v_task,'') || '）に応募が入りました。' || E'\n\n' ||
      '■ 応募者：' || coalesce(nullif(v_nickname,''),'（名前未設定）') || E'\n' ||
      '■ 自己紹介：' || E'\n' || coalesce(nullif(v_pr,''),'ー') || E'\n\n' ||
      'ログインして「あなたの求人 → 応募者」から承認/見送りができます。' || E'\n' ||
      '承認すると、チャットで日程を打ち合わせられます。' || E'\n\n' ||
      'https://chitose-bank.com'
    );
  exception when others then null;
  end;

  return new;
end;
$$;

-- ⑤「2日以内」の督促を機械に持たせる：24時間超のpendingがあれば毎朝メール
create or replace function public.send_review_reminder()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
  v_lines text;
begin
  select count(*), coalesce(string_agg(
           '・#' || job_number || '　' || coalesce(crop,'') || ' ' || coalesce(task,'') ||
           '（提出から' || extract(hour from now() - created_at)::int / 24 || '日' ||
           (extract(hour from now() - created_at)::int % 24) || '時間）',
           E'\n' order by created_at), '')
    into v_count, v_lines
    from public.jobs
   where status = 'pending' and created_at < now() - interval '24 hours';

  if v_count > 0 then
    perform public.send_admin_email(
      '[督促] 審査待ちの求人が ' || v_count || ' 件あります',
      '24時間を超えて審査待ちの求人：' || E'\n' || v_lines || E'\n\n' ||
      '審査期限は提出から2日以内です。管理タブから審査してください：' || E'\n' ||
      'https://chitose-bank.com/#/admin'
    );
  end if;
end;
$$;

select cron.schedule('review-reminder', '0 22 * * *', $$ select public.send_review_reminder(); $$);
-- 22:00 UTC = 朝7:00 JST。朝一番のメールで督促する