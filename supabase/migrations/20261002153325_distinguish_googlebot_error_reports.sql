-- UAに基づく表示上の区別。本人性の検証・認証判断には使用しない。
-- 管理画面の isGooglebot と同じ境界条件。過去の通知本文は書き換えない。
CREATE OR REPLACE FUNCTION public.app_error_report_to_admin()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_admin uuid; v_msg text; v_sig text; v_mark text; v_device text; v_page text;
  v_bot boolean := coalesce(new.user_agent,'') ~* '(^|[^a-z0-9_-])googlebot(-[a-z]+)?(/|[[:space:];)]|$)';
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
    -- 自動巡回の通知で一般利用者の同型エラーを間引かない。
    if v_bot then v_sig := 'Googlebot|' || v_sig; end if;
    v_mark := '#err:' || left(md5(v_sig), 8);
    if exists (select 1 from public.admin_messages m
                where m.user_id = v_admin and m.from_admin
                  and m.created_at > now() - interval '1 hour'
                  and m.body like '%' || v_mark || '%') then return new; end if;
    v_device := case when v_bot then 'Googlebot（自動巡回）'
                     when new.user_agent is null then '不明'
                     when new.user_agent ~* 'iphone|ipad' then 'iPhone/iPad'
                     when new.user_agent ~* 'android' then 'Android' else 'PC等' end;
    v_page := coalesce(nullif(new.page,''), nullif(regexp_replace(coalesce(new.url,''), '^[^#]*#', ''), ''), '-');
    v_msg := '【エラーの報告】' || to_char(coalesce(new.created_at, now()) at time zone 'Asia/Tokyo', 'MM/DD HH24:MI') || E'\n' ||
             '発生場所：' || coalesce(nullif(new.component,''),'-') || '／' || coalesce(nullif(new.source,''),'-') ||
             case when coalesce(new.error_code,'') <> '' then '／コード ' || new.error_code else '' end || E'\n' ||
             'ページ：' || v_page || '　端末・アクセス元：' || v_device ||
             '　利用者：' || case when v_bot then '自動巡回（Googlebot）' when new.user_id is null then '未ログイン' else 'ログイン中' end || E'\n' ||
             left(coalesce(new.message,'(メッセージなし)'), 300) || E'\n\n' ||
             '詳しくは https://www.chitose-bank.com/#/admin/system' || E'\n' || v_mark;
    insert into public.admin_messages (user_id, from_admin, body) values (v_admin, true, v_msg);
  exception when others then null;  -- 報告は補助機能＝失敗しても本体（エラーの記録）を止めない
  end;
  return new;
end $function$;

revoke all on function public.app_error_report_to_admin() from public, anon, authenticated;
