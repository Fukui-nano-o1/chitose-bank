-- 未読バッジの数え方を1つにする（2026-08-19・たきと報告「未読がないのに通知が①来ている」）
--
-- 起きていたこと：下部ナビ「チャット」の①と、チャット一覧の未読が別々の関数で数えられており、
-- 対象の応募の集合が食い違っていた。
--   my_nav_badges.chat_threads      … status <> 'completed' の応募（＝除外リスト方式）
--   my_unread_message_counts        … status in (…9種) の応募（＝許可リスト方式）
-- 2026-08-16に応募の取り消しを論理削除（status='canceled'）にした時、許可リスト側だけが
-- 更新されず、canceled の応募は「一覧では未読ゼロ・ナビでは①」になった。
-- 実データ：#1255（canceled・相手からの未読2件）→ nav=1 / list=0。
-- しかも canceled はチャット一覧の既定で非表示（CHAT_HIDABLE）ので、開いて消すこともできなかった。
--
-- 直し方：
--  1. 数える対象を「終端で一覧から隠れる3つ（見送り・失効・取り消し）を除く」に統一する。
--     ＝チャット一覧の既定の見え方と一致する（隠れているスレッドの未読で①を出さない）。
--     許可リスト（足し忘れが起きる）をやめ、除外リスト（新しい段階があっても自動で入る）にする。
--  2. my_nav_badges は自前で数えず my_unread_message_counts を呼ぶ＝【数え方は1箇所】。
--     以後、対象を変える時は my_unread_message_counts だけを直せばよい。
--
-- ★記録は消していない：read_at も messages も不変。変えたのは「数える対象」だけ。

-- 1) 未読の唯一のソース。STABLE（読み取りのみ）＝my_nav_badges から呼べるようにする
create or replace function public.my_unread_message_counts()
returns json
language sql
stable
security definer
set search_path to 'public'
as $function$
  with mine as (
    -- 見送り・失効・取り消しは数えない（チャット一覧の既定で非表示＝開いて消せないため）。
    -- 完了は一覧に出るので数える。新しい段階が増えても自動で対象に入る（除外リスト方式）
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
            where am.user_id = auth.uid() and am.from_admin and am.read_at is null),
    'by_application', (select coalesce(json_object_agg(application_id, cnt), '{}'::json) from merged)
  );
$function$;

-- 2) 下部ナビのバッジ。chat_threads は上の関数から導く（自前で数えない）
create or replace function public.my_nav_badges()
returns json
language sql
stable
security definer
set search_path to 'public'
as $function$
  with u as (select public.my_unread_message_counts() as j)
  select json_build_object(
    -- 未読があるスレッドの数＝チャット一覧の赤バッジと同じ材料。
    -- 運営DM（dm）も「チャット」タブの中にある（浮遊ボタン）ので1スレッドとして数える
    'chat_threads', (
      (select count(*) from json_object_keys((select j from u) -> 'by_application'))
      + case when coalesce(((select j from u) ->> 'dm')::int, 0) > 0 then 1 else 0 end
    ),
    'calendar_today', (
      select count(*) from public.applications a
      join public.jobs j on j.job_number = a.job_number
      where (a.worker_id = auth.uid() or a.farmer_id = auth.uid())
        and a.status in ('contracted','working')
        and (now() at time zone 'Asia/Tokyo')::date between j.date_start and coalesce(j.date_end, j.date_start)
    ),
    'todo', (select count(*) from public.my_todo_items()),
    'applicants_pending', (
      select count(*) from public.applications a
      where a.farmer_id = auth.uid() and a.status = 'applied'
    ),
    'review_due', (
      select count(*) from public.applications a
      where (a.worker_id = auth.uid() or a.farmer_id = auth.uid())
        and a.status = 'completed'
        and a.work_completed_at is not null
        and a.work_completed_at >= now() - interval '3 days'
        and not exists (select 1 from public.reviews r
                         where r.application_id = a.id and r.reviewer_id = auth.uid())
    ),
    'job_revision', (
      select count(*) from public.jobs j
      where j.farmer_id = auth.uid() and j.status = 'draft' and j.revision_requested_at is not null
        and coalesce(j.date_end, j.date_start) >= (now() at time zone 'Asia/Tokyo')::date
    )
  )
  from u;
$function$;

-- 権限は作り直しで既定に戻る（PUBLIC自動付与）ので、両方とも明示的に張り直す（2026-08-06の教訓：
-- revoke は from public と from anon の両方に撃つ）。どちらもログイン後専用
revoke all on function public.my_unread_message_counts() from public, anon;
revoke all on function public.my_nav_badges() from public, anon;
grant execute on function public.my_unread_message_counts() to authenticated, service_role;
grant execute on function public.my_nav_badges() to authenticated, service_role;
