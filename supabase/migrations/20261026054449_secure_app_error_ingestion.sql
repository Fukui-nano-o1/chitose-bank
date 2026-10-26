-- Client error reports remain available before login. Trusted identity and operator
-- fields are normalized in the database, including requests from older clients.
-- Existing rows keep identity_verified=false; their claimed identities are not backfilled.
alter table public.app_errors
  add column if not exists identity_verified boolean not null default false;
comment on column public.app_errors.identity_verified is
  'True only when the insert trigger derived user_id from the verified request session. Legacy rows remain false. This does not verify the reported error or User-Agent.';

create schema if not exists private;
create or replace function private.normalize_app_error_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  new.user_id := auth.uid();
  new.identity_verified := true;
  new.created_at := statement_timestamp();
  new.status := 'open';
  new.admin_note := null;
  new.resolved_at := null;
  return new;
end;
$function$;
revoke all on function private.normalize_app_error_insert() from public, anon, authenticated;

-- PostgreSQL runs BEFORE triggers alphabetically. Normalize the timestamp before
-- the existing rate limiter so a client cannot backdate records outside its window.
create trigger trg_00_app_errors_trusted_fields
before insert on public.app_errors
for each row execute function private.normalize_app_error_insert();

alter policy anyone_insert_app_errors on public.app_errors
with check (
  user_id is not distinct from auth.uid()
  and identity_verified
  and status = 'open'
  and admin_note is null
  and resolved_at is null
);

-- Retain existing SELECT/UPDATE policies: only the operator can resolve reports.
-- A User-Agent is a claim, never proof of a crawler or of an authenticated user.
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
    v_device := case when v_bot then 'Googlebot申告・未検証'
                     when new.user_agent is null then '不明'
                     when new.user_agent ~* 'iphone|ipad' then 'iPhone/iPad'
                     when new.user_agent ~* 'android' then 'Android' else 'PC等' end;
    v_page := coalesce(nullif(new.page,''), nullif(regexp_replace(coalesce(new.url,''), '^[^#]*#', ''), ''), '-');
    v_msg := '【エラーの報告】' || to_char(coalesce(new.created_at, now()) at time zone 'Asia/Tokyo', 'MM/DD HH24:MI') || E'\n' ||
             '発生場所：' || coalesce(nullif(new.component,''),'-') || '／' || coalesce(nullif(new.source,''),'-') ||
             case when coalesce(new.error_code,'') <> '' then '／コード ' || new.error_code else '' end || E'\n' ||
             'ページ：' || v_page || '　端末・アクセス元：' || v_device ||
             '　利用者：' || case when not new.identity_verified then '確認できません（旧記録）' when new.user_id is null then '未ログイン' else 'ログイン中（認証確認済み）' end || E'\n' ||
             left(coalesce(new.message,'(メッセージなし)'), 300) || E'\n\n' ||
             '詳しくは https://www.chitose-bank.com/#/admin/system' || E'\n' || v_mark;
    insert into public.admin_messages (user_id, from_admin, body) values (v_admin, true, v_msg);
  exception when others then null;  -- 報告は補助機能＝失敗しても本体（エラーの記録）を止めない
  end;
  return new;
end $function$;

revoke all on function public.app_error_report_to_admin() from public, anon, authenticated;
