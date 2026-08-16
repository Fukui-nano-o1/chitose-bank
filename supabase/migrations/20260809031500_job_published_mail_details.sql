-- 掲載完了メールの充実（2026-08-09たきと指示「掲載したならメールを送信しろ」）。
-- 従来も open 遷移で1通送っていたが、1行のみ＋「確認が完了し」の旧承認時代の文言だった。
-- 求人の詳細（箇条書き）・掲載時刻(JST)・求人ページリンク・ヘルプとお問い合わせ窓口を載せる。
--
-- ★あわせて既存の穴を修理：トリガー notify_job_published は AFTER UPDATE のみで、
--   即公開の open 直INSERT（運営の自己募集＝handleSaveJob の INSERT）では発火していなかった。
--   AFTER INSERT OR UPDATE に拡張（OLD は INSERT では参照できないため TG_OP で分岐）。
--   一般農家の pending 保存→publish_my_job（UPDATE）経路は従来どおり発火する。
-- ※DBへは apply_migration（関数のみ）→ execute_sql（TG_OP対応＋トリガー再作成）の2段で適用済み。
--   このファイルは最終状態の写経（2026-07-21 二頭運転の交通規則・正本はrepo側）。
create or replace function public.trg_notify_job_published()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_dates text;
  v_holidays int;
  v_place text;
  v_overtime text;
  v_lines text;
begin
  if new.status <> 'open' then return new; end if;
  if tg_op = 'UPDATE' and coalesce(old.status,'') = 'open' then return new; end if;
  insert into public.notifications (farmer_id, type, message)
  values (new.farmer_id, 'job_published', 'あなたの求人 #' || new.job_number || ' が公開されました');
  begin
    v_dates := coalesce(new.date_start::text, '未設定');
    if new.date_end is not null and new.date_end <> new.date_start then
      v_dates := new.date_start::text || ' 〜 ' || new.date_end::text;
    end if;
    v_holidays := case when jsonb_typeof(new.holidays) = 'array' then jsonb_array_length(new.holidays) else 0 end;
    if v_holidays > 0 then v_dates := v_dates || '（休日' || v_holidays || '日）'; end if;
    v_place := coalesce(new.prefecture,'') || coalesce(new.city,'') || coalesce(new.town,'');
    v_overtime := case when new.overtime_policy = 'あり'
      then 'あり' || case when coalesce(btrim(new.overtime_detail),'') <> '' then '（' || btrim(new.overtime_detail) || '）' else '' end
      else coalesce(nullif(btrim(new.overtime_policy),''), '未設定') end;
    v_lines :=
      '・作物・作業：' || trim(coalesce(new.crop,'') || ' ' || coalesce(new.task,'')) || E'\n' ||
      '・場所：' || coalesce(nullif(v_place,''), '未設定') || E'\n' ||
      '・作業日程：' || v_dates || E'\n' ||
      '・勤務時間：' || coalesce(nullif(btrim(new.work_time),''), '未設定') ||
        case when coalesce(btrim(new.break_time),'') <> '' then '（休憩 ' || btrim(new.break_time) || '）' else '' end || E'\n' ||
      '・日給：' || case when coalesce(btrim(new.daily_wage),'') <> '' then btrim(new.daily_wage) || '円' else '未設定' end || E'\n' ||
      '・募集人数：' || coalesce(new.headcount::text, '未設定') || '名' || E'\n' ||
      '・時間外労働：' || v_overtime || E'\n' ||
      '・掲載時刻：' || to_char(now() at time zone 'Asia/Tokyo', 'YYYY年FMMM月FMDD日 HH24:MI') || '（日本時間）';
    perform public.send_user_email(new.farmer_id,
      '[chitose-bank] 掲載完了：求人 #' || new.job_number || '「' || trim(coalesce(new.crop,'') || ' ' || coalesce(new.task,'')) || '」',
      '掲載が完了しました！働き手に公開されています。' || E'\n\n' ||
      '■ ' || public.job_ref(new.job_number,'farmer') || E'\n' ||
      v_lines || E'\n' ||
      public.job_link(new.job_number) || E'\n\n' ||
      '応募が入ると、メールとアプリのお知らせでお伝えします。' || E'\n' ||
      '内容の修正・一時非公開は、お仕事タブの「公開中」からいつでもできます。' || E'\n' ||
      '最終作業日が過ぎると、掲載は自動で終了します。' || E'\n\n' ||
      '困ったときは：' || E'\n' ||
      '・ヘルプ：https://chitose-bank.com/#/help' || E'\n' ||
      '・お問い合わせ：t5fki6643qty@gmail.com');
  exception when others then null; end;
  return new;
end; $function$;

drop trigger if exists notify_job_published on public.jobs;
create trigger notify_job_published
  after insert or update on public.jobs
  for each row execute function public.trg_notify_job_published();
