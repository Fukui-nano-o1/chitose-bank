-- 利用者のエラーログを全て管理者の運営チャットへ（2026-08-28たきと指示
-- 「利用者にエラーログが運営チャットから送信されている。管理者に運営チャットとして送信しろ。
--   利用者のエラーログを全て管理者に送信。利用者に見せるな」）
--
-- 従来＝フロントの AdminErrorChatReporter が【管理者の端末が開いた時だけ】直近7日の未解決を
-- まとめて管理者自身のスレッドへ投函（最大2通・7日1通）。利用者の端末のエラーは、管理者が
-- アプリを開くまで届かず、拾い方も標本抽出だった。
-- 新＝app_errors への INSERT の瞬間に、DBのトリガーが管理者（ADMIN_EMAIL）の運営チャットへ
-- 報告を1通入れる＝誰の端末のエラーでも、管理者の端末が閉じていても届く。
-- ★利用者には見えない：宛先は管理者本人のスレッド1本だけ（admin_messages のRLS＝本人と運営のみ）。
--   他の利用者のスレッドには一切書かない。本文にも個人情報（uuid・メール）は載せない。
-- ★嵐への構え：同じ種類（部品×発生源×文言の署名）は1時間に1通＝チャットとプッシュを埋めない。
--   全件の記録は従来どおり app_errors（システムページ #/admin/system）に残る。
-- ★deploy型（更新直後の古いファイル読み込み）は知らせない（2026-08-16たきと指示・記録には残る）。
create or replace function public.app_error_report_to_admin()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_admin uuid; v_msg text; v_sig text; v_mark text; v_device text; v_page text;
begin
  begin
    if lower(coalesce(new.message,'')) like any (array[
      '%importing a module script failed%','%dynamically imported module%','%loading chunk%','%loading css chunk%'
    ]) then return new; end if;
    select id into v_admin from auth.users where email = 't5fki6643qty@gmail.com' limit 1;
    if v_admin is null then return new; end if;
    -- 種類の署名＝フロント errorSignature（lib/errorCatalog）と同じ規則（uuid→{id}・4桁以上の数字→{n}）
    v_sig := coalesce(new.component,'') || '|' || coalesce(new.source,'') || '|' ||
             regexp_replace(regexp_replace(left(coalesce(new.message,'(none)'),200),
               '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '{id}', 'gi'),
               '[0-9]{4,}', '{n}', 'g');
    v_mark := '#err:' || left(md5(v_sig), 8);
    if exists (select 1 from public.admin_messages m
                where m.user_id = v_admin and m.from_admin
                  and m.created_at > now() - interval '1 hour'
                  and m.body like '%' || v_mark || '%') then return new; end if;
    v_device := case when new.user_agent is null then '不明'
                     when new.user_agent ~* 'iphone|ipad' then 'iPhone/iPad'
                     when new.user_agent ~* 'android' then 'Android' else 'PC等' end;
    v_page := coalesce(nullif(new.page,''), nullif(regexp_replace(coalesce(new.url,''), '^[^#]*#', ''), ''), '-');
    v_msg := '【エラーの報告】' || to_char(coalesce(new.created_at, now()) at time zone 'Asia/Tokyo', 'MM/DD HH24:MI') || E'\n' ||
             '発生場所：' || coalesce(nullif(new.component,''),'-') || '／' || coalesce(nullif(new.source,''),'-') ||
             case when coalesce(new.error_code,'') <> '' then '／コード ' || new.error_code else '' end || E'\n' ||
             'ページ：' || v_page || '　端末：' || v_device ||
             '　利用者：' || case when new.user_id is null then '未ログイン' else 'ログイン中' end || E'\n' ||
             left(coalesce(new.message,'(メッセージなし)'), 300) || E'\n\n' ||
             '詳しくは https://www.chitose-bank.com/#/admin/system' || E'\n' || v_mark;
    insert into public.admin_messages (user_id, from_admin, body) values (v_admin, true, v_msg);
  exception when others then null;  -- 報告は補助機能＝失敗しても本体（エラーの記録）を止めない
  end;
  return new;
end $$;
revoke all on function public.app_error_report_to_admin() from public, anon, authenticated;
drop trigger if exists trg_z_app_error_report on public.app_errors;
create trigger trg_z_app_error_report
  after insert on public.app_errors
  for each row execute function public.app_error_report_to_admin();
