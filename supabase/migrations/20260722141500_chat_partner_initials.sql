-- チャットのアイコン（2026-07-22）：ニックネーム未設定の相手は「？」でなくメール頭文字2文字を出す。
-- プライバシー方針（CLAUDE.md：メールアドレスの表示は運営ポリシーで抑制）に配慮し、
-- メールアドレス本体はクライアントに一切返さず、SECURITY DEFINER内で upper(left(email,2)) だけを算出して返す。
-- 返すのは自分がチャットで繋がっている相手（applications の当事者）に限る＝無関係な他人の頭文字は取得できない。
create or replace function public.my_chat_partner_initials()
 returns json
 language sql
 security definer
 set search_path to 'public'
 stable
as $function$
  select coalesce(json_object_agg(q.partner_id::text, q.initials), '{}'::json)
  from (
    select distinct p.partner_id, upper(left(u.email, 2)) as initials
    from (
      select distinct case when a.worker_id = auth.uid() then a.farmer_id else a.worker_id end as partner_id
      from public.applications a
      where a.worker_id = auth.uid() or a.farmer_id = auth.uid()
    ) p
    join auth.users u on u.id = p.partner_id
    where u.email is not null and length(btrim(u.email)) > 0
  ) q;
$function$;

revoke all on function public.my_chat_partner_initials() from public, anon;
grant execute on function public.my_chat_partner_initials() to authenticated;
