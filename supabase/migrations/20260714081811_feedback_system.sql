-- 画面フィードバック（改善レーダー）：全画面からワンタップ・現在ページを自動記録
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null,
  page_hash text not null,            -- タップ時の location.hash（集計の主キー）
  category text not null check (category in
    ('confusing','broken','typo','suggestion','other')),
  body text,
  viewport int,                        -- 画面幅（スマホ/PC切り分け用）
  created_at timestamptz not null default now()
);
alter table public.feedback enable row level security;
create policy "fb insert own" on public.feedback
  for insert to authenticated with check (reporter_id = auth.uid());
create policy "fb select admin" on public.feedback
  for select to authenticated
  using (exists (select 1 from public.app_admins a where a.auth_id = auth.uid()));

-- 即時メール（現規模なら全件・ページ名入り件名で受信箱がそのまま改善キューになる）
create or replace function public.trg_notify_feedback()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_label text;
begin
  v_label := case new.category when 'confusing' then '分かりにくい'
    when 'broken' then '動かない' when 'typo' then '誤字・表示' 
    when 'suggestion' then '提案' else 'その他' end;
  begin
    perform public.send_admin_email(
      '[改善FB] ' || v_label || '：' || new.page_hash,
      'ページ：' || new.page_hash || '（幅' || coalesce(new.viewport::text,'?') || 'px）' || E'\n' ||
      '種類：' || v_label || E'\n' ||
      '内容：' || E'\n' || coalesce(new.body,'（記載なし）'));
  exception when others then null; end;
  return new;
end; $$;
drop trigger if exists notify_feedback on public.feedback;
create trigger notify_feedback after insert on public.feedback
  for each row execute function public.trg_notify_feedback();

-- 日次総括にフィードバック集計を追加（ページ別・24時間）
create or replace function public.feedback_daily_summary()
returns text language sql security definer set search_path = public as $$
  select coalesce(string_agg('・' || page_hash || '：' || cnt || '件', E'\n' order by cnt desc), 'なし')
    from (select page_hash, count(*) as cnt from public.feedback
           where created_at >= now() - interval '24 hours'
           group by page_hash limit 10) t;
$$;