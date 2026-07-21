-- 行動計測：ページ遷移の軌跡・滞在時間・迷いの検出。
-- 対象は管理者以外。入力内容は収集しない（ヘルプ第5章の約束・チャット秘匿の維持）。
create table if not exists public.page_events (
  id bigint generated always as identity primary key,
  auth_id uuid not null,
  page_hash text not null,
  ts timestamptz not null default now(),
  summarized boolean not null default false
);
create index if not exists idx_page_events_open on public.page_events (auth_id, ts) where not summarized;
alter table public.page_events enable row level security;
create policy "pe insert own" on public.page_events
  for insert to authenticated with check (auth_id = auth.uid());
create policy "pe select admin" on public.page_events
  for select to authenticated
  using (exists (select 1 from public.app_admins a where a.auth_id = auth.uid()));

-- 操作開始の即時メール（30分ぶりの最初のイベント＝セッション開始とみなす・管理者は除外）
create or replace function public.trg_session_start()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_email text; v_recent int;
begin
  if exists (select 1 from public.app_admins a where a.auth_id = new.auth_id) then
    return new;
  end if;
  select count(*) into v_recent from public.page_events
   where auth_id = new.auth_id and id <> new.id
     and ts > now() - interval '30 minutes';
  if v_recent = 0 then
    select email into v_email from auth.users where id = new.auth_id;
    begin
      perform public.send_admin_email(
        '[操作開始] ' || coalesce(v_email,'?') || ' → ' || new.page_hash,
        coalesce(v_email,'?') || ' がサイトの操作を始めました。' || E'\n' ||
        '最初のページ：' || new.page_hash || E'\n' ||
        '時刻：' || to_char(now() at time zone 'Asia/Tokyo','MM/DD HH24:MI:SS') || E'\n\n' ||
        '（離脱後30分で軌跡の総括が届きます）');
    exception when others then null; end;
  end if;
  return new;
end; $$;
drop trigger if exists session_start on public.page_events;
create trigger session_start after insert on public.page_events
  for each row execute function public.trg_session_start();

-- セッション総括（15分ごと・最終イベントから30分無操作＝離脱とみなす）
create or replace function public.summarize_sessions()
returns void language plpgsql security definer set search_path = public as $$
declare
  r record; v_email text; v_traj text; v_stats text;
  v_start timestamptz; v_end timestamptz; v_pages int;
begin
  for r in
    select auth_id from public.page_events
     where not summarized
       and not exists (select 1 from public.app_admins a where a.auth_id = page_events.auth_id)
     group by auth_id
    having max(ts) < now() - interval '30 minutes'
  loop
    select min(ts), max(ts), count(*) into v_start, v_end, v_pages
      from public.page_events where auth_id = r.auth_id and not summarized;

    -- 軌跡（順番どおり・各ページの滞在秒＝次イベントとの差）
    select string_agg(
             to_char(ts at time zone 'Asia/Tokyo','HH24:MI:SS') || '　' || page_hash ||
             coalesce('　（' || extract(epoch from (lead(ts) over (order by ts) - ts))::int || '秒）','　（離脱）'),
             E'\n' order by ts)
      into v_traj
      from public.page_events where auth_id = r.auth_id and not summarized;

    -- 迷いの指紋：同一ページへの再訪回数（2回以上のみ）
    select coalesce(string_agg('・' || page_hash || '：' || cnt || '回', E'\n' order by cnt desc), 'なし')
      into v_stats
      from (select page_hash, count(*) as cnt
              from public.page_events
             where auth_id = r.auth_id and not summarized
             group by page_hash having count(*) >= 2) t;

    select email into v_email from auth.users where id = r.auth_id;
    begin
      perform public.send_admin_email(
        '[軌跡] ' || coalesce(v_email,'?') || '　' || v_pages || 'ページ・' ||
          (extract(epoch from (v_end - v_start))/60)::int || '分',
        '■ 利用者：' || coalesce(v_email,'?') || E'\n' ||
        '■ 滞在：' || to_char(v_start at time zone 'Asia/Tokyo','HH24:MI') || '〜' ||
          to_char(v_end at time zone 'Asia/Tokyo','HH24:MI') ||
          '（' || (extract(epoch from (v_end - v_start))/60)::int || '分・' || v_pages || 'ページ）' || E'\n' ||
        '■ 最初のページ：' || (select page_hash from public.page_events
             where auth_id = r.auth_id and not summarized order by ts limit 1) || E'\n' ||
        '■ 最後のページ（＝離脱点）：' || (select page_hash from public.page_events
             where auth_id = r.auth_id and not summarized order by ts desc limit 1) || E'\n\n' ||
        '■ 再訪ページ（迷いの候補）：' || E'\n' || v_stats || E'\n\n' ||
        '■ 軌跡：' || E'\n' || v_traj);
    exception when others then null; end;

    update public.page_events set summarized = true
     where auth_id = r.auth_id and not summarized;
  end loop;
end; $$;
select cron.schedule('session-summary', '*/15 * * * *', $$ select public.summarize_sessions(); $$);