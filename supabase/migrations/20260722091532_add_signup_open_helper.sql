-- 新規登録の開放フラグ（app_settings.signup_open）を未ログイン(anon)からも読めるようにする最小ヘルパー。
-- app_settings本体はanonにRLSで閉じているため、この1真偽値だけをSECURITY DEFINERで公開する。
-- false（既定）＝招待制のまま。運営がsignup_openを'true'にした時のみtrueを返す。
create or replace function public.signup_open()
 returns boolean
 language sql
 security definer
 set search_path to 'public'
 stable
as $function$
  select coalesce((select value = 'true' from public.app_settings where key = 'signup_open'), false);
$function$;

revoke all on function public.signup_open() from public;
grant execute on function public.signup_open() to anon, authenticated;
