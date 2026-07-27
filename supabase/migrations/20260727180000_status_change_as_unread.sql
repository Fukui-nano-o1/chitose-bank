-- ステータスの変更を未読として扱う（2026-07-27たきと指示）
-- 従来の未読は「相手のメッセージで read_at が空のもの」だけ。承認・採用・開始・完了・失効などの
-- 状態変化はメッセージを伴わないものが多く（confirm_terms以外は投函しない）、相手が動いても
-- チャットに何の印も立たなかった。
-- 方針：偽のシステムメッセージを作らず、記録（時刻＋実行者）から未読を導く（行動記録の憲法・柱1）。
--  ①applications に status_changed_at / status_changed_by を追加し、トリガーで追記する
--    （cronによる失効は auth.uid() が無いので by は null＝「誰の操作でもない」と記録される）
--  ②未読集計（my_unread_message_counts）で、自分以外が変えた状態変化を、既読時刻（chat_reads）より
--    後なら1件の未読として数える。チャットを開けば chat_reads が更新され自然に消える
alter table public.applications
  add column if not exists status_changed_at timestamptz,
  add column if not exists status_changed_by uuid;

create or replace function public.trg_stamp_status_change()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    new.status_changed_at := now();
    new.status_changed_by := auth.uid(); -- cron等の自動処理はnull（＝当事者の操作ではない）
  end if;
  return new;
end $$;

drop trigger if exists trg_applications_stamp_status_change on public.applications;
create trigger trg_applications_stamp_status_change
  before update of status on public.applications
  for each row execute function public.trg_stamp_status_change();

-- 未読集計：メッセージの未読 ＋ 自分以外が起こした未読の状態変化（1件）
-- 表示対象の状態は チャット一覧（CHAT_LIST_STATUSES）と揃える＝completed・expired も含む
create or replace function public.my_unread_message_counts()
returns json language sql security definer set search_path to 'public' as $function$
  with mine as (
    select a.id, a.status, a.status_changed_at, a.status_changed_by
      from applications a
     where (a.worker_id = auth.uid() or a.farmer_id = auth.uid())
       and a.status in ('applied','approved','meeting','interview','contracted','working','rejected','completed','expired')
  ),
  msg as (
    select m.application_id, count(*) as cnt
      from messages m join mine a on a.id = m.application_id
     where m.sender_id <> auth.uid() and m.read_at is null
     group by m.application_id
  ),
  stat as ( -- 自分以外（相手 or 自動処理）が変えた状態で、まだチャットを開いていないもの
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
            where am.user_id = auth.uid() and am.from_admin and am.read_at is null),
    'by_application', (select coalesce(json_object_agg(application_id, cnt), '{}'::json) from merged)
  );
$function$;
