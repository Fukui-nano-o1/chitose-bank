-- 実績づくり期間の限定公開化：求人の閲覧をログイン済みユーザーのみに制限する。
-- UIの差し替えだけではAPI直叩きで読めるため、DB側で閉じる。
-- 一般公開を解禁する日は、grant select on public.jobs_public to anon; の1行で戻る。
revoke select on public.jobs_public from anon;

select to_jsonb(t) as row from (
  select
    (select string_agg(grantee||':'||privilege_type, ' / ' order by grantee)
       from information_schema.role_table_grants
      where table_schema='public' and table_name='jobs_public'
        and grantee in ('anon','authenticated')) as grants_now
) t;