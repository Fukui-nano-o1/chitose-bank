-- 利用者→運営のチャット（運営DM）が運営に届いていなかった件の修理
-- （2026-09-04たきと報告「利用者が運営にチャットから連絡してもこちらに送信されない」）
--
-- 実測：メッセージ自体はDBに入っていた（admin_messages・from_admin=false・9/4「にゃん」等）。
-- 届いていなかったのは運営側の受け取り：
--  ① notify_push_on_admin_message は from_admin=true（運営→利用者）しか扱わない＝利用者からの連絡は通知ゼロ
--  ② my_unread_message_counts の dm は「自分宛の from_admin=true」だけ＝運営にはバッジも付かない
--  ③ チャット一覧にも出ない（読む場所は管理タブ→利用者一覧→DMのみ）
-- ＝送信は成功しているのに、運営には「送信されていない」ように見えていた。
--
-- ① 利用者からのDMで運営へお知らせ＋メール。★メール本文にメッセージの中身は載せない
--    （チャットの中身をpg_netのキューに残さない・2026-08-18の作法。名前とリンクだけ）。
--    リンク先 #/chat/admin/{user_id} は運営側の返信ページ（同日フロント実装）。
--    運営本人のスレッド（エラーレポート等・user_id が app_admins）は対象外＝自分に自分を知らせない。
--    notify_admins() は使わない＝内部で件名にメッセージ全文を使うメールを送るため、リンク付きの
--    メールと二重になる。お知らせのINSERTだけ同じ形で行い、メールは自前で1通。
create or replace function public.notify_admin_on_user_dm()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_name text;
begin
  if new.from_admin then return new; end if;
  if exists (select 1 from app_admins a where a.auth_id = new.user_id) then return new; end if;
  v_name := coalesce(nullif(btrim(public.resolve_actor_name(new.user_id)), ''), '利用者');
  insert into public.notifications (farmer_id, type, message)
  select a.auth_id, 'admin_dm_inbound', '運営チャットに ' || v_name || ' さんからメッセージが届きました。'
    from public.app_admins a;
  perform public.send_admin_email(
    '[chitose-bank] 運営チャットに新しいメッセージ（' || v_name || ' さん）',
    v_name || ' さんから運営チャットにメッセージが届きました。' || chr(10) || chr(10) ||
    '確認・返信はこちら：' || chr(10) ||
    'https://chitose-bank.com/#/chat/admin/' || new.user_id::text);
  return new;
exception when others then return new;
end;
$$;

drop trigger if exists trg_notify_admin_on_user_dm on public.admin_messages;
create trigger trg_notify_admin_on_user_dm
  after insert on public.admin_messages
  for each row execute function public.notify_admin_on_user_dm();

-- ② 運営には「利用者からの未読DM」もdmバッジに数える（下部バーのチャットバッジが灯る）。
--    運営アカウント自身のスレッド（user_id が app_admins）は数えない（①と同じ線引き）。
--    それ以外（chat/stat/by_application）は従来どおり一字も変えていない。
create or replace function public.my_unread_message_counts()
returns json
language sql
stable security definer
set search_path to 'public'
as $$
  with mine as (
    select a.id, a.status, a.status_changed_at, a.status_changed_by
      from applications a
     where (a.worker_id = auth.uid() or a.farmer_id = auth.uid())
       and a.status not in ('rejected','expired','canceled')
  ),
  msg as (
    select m.application_id, count(*) as cnt
      from messages m join mine a on a.id = m.application_id
     where m.sender_id <> auth.uid() and m.read_at is null
     group by m.application_id
  ),
  stat as (
    select a.id as application_id, 1 as cnt
      from mine a
     where a.status_changed_at is not null
       and a.status_changed_by is distinct from auth.uid()
       and not exists (select 1 from chat_reads r
                        where r.application_id = a.id and r.reader_id = auth.uid()
                          and r.last_read_at >= a.status_changed_at)
  ),
  merged as (
    select application_id, sum(cnt)::int as cnt
      from (select * from msg union all select * from stat) u
     group by application_id
  )
  select json_build_object(
    'chat', (select coalesce(sum(cnt), 0)::int from merged),
    'dm', (select count(*) from admin_messages am
            where (am.user_id = auth.uid() and am.from_admin and am.read_at is null)
               or (not am.from_admin and am.read_at is null
                   and exists (select 1 from app_admins ad where ad.auth_id = auth.uid())
                   and not exists (select 1 from app_admins ad2 where ad2.auth_id = am.user_id))),
    'by_application', (select coalesce(json_object_agg(application_id, cnt), '{}'::json) from merged)
  );
$$;
