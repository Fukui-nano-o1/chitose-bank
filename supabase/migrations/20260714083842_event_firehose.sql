-- 全イベント実況配信（firehose）：優先度の実測用。app_settings 'event_firehose' で1行ON/OFF。
-- プライバシー保護：メッセージ本文・非公開メモ・本人確認の値は除外（メタ情報のみ）。
insert into public.app_settings (key, value) values ('event_firehose','true')
on conflict (key) do nothing;

create or replace function public.trg_firehose()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_on boolean; v_row jsonb; v_diff jsonb; v_body text; v_total bigint;
  v_redact text[]; v_op text; v_table_jp text; v_actor text;
begin
  select value = 'true' into v_on from public.app_settings where key = 'event_firehose';
  if not coalesce(v_on, false) then return coalesce(new, old); end if;

  -- テーブル別の秘匿列（ヘルプ第5章の約束を守る）
  v_redact := case tg_table_name
    when 'messages' then array['body']
    when 'reviews' then array['private_memo']
    when 'account_holders' then array['last_name','first_name','last_kana','first_kana',
      'birth_date','postal_code','prefecture','city','address_line','building','phone']
    when 'worker_profiles' then array['pr_hidden_original']
    else array[]::text[] end;

  v_op := case tg_op when 'INSERT' then '追加' when 'UPDATE' then '編集' else '削除' end;
  v_table_jp := case tg_table_name
    when 'jobs' then '求人' when 'applications' then '応募' when 'worker_profiles' then '働き手プロ'
    when 'employer_profiles' then '雇い手プロ' when 'saved_jobs' then 'いいね'
    when 'reviews' then '評価' when 'messages' then 'チャット'
    when 'account_holders' then '本人確認情報' else tg_table_name end;
  v_actor := coalesce(auth.uid()::text, '運営/システム');

  if tg_op = 'UPDATE' then
    select jsonb_object_agg(n.key, jsonb_build_object('旧', o.value, '新', n.value))
      into v_diff
      from jsonb_each(to_jsonb(new)) n
      join jsonb_each(to_jsonb(old)) o on o.key = n.key
     where n.value is distinct from o.value
       and not (n.key = any(v_redact));
    if v_diff is null or v_diff = '{}'::jsonb then return new; end if;  -- 実質変更なし or 秘匿列のみ
    v_body := '変更内容（旧→新）：' || E'\n' || jsonb_pretty(v_diff);
  else
    v_row := to_jsonb(coalesce(new, old));
    select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_row
      from jsonb_each(v_row) where not (key = any(v_redact));
    v_body := '内容：' || E'\n' || jsonb_pretty(v_row);
    if array_length(v_redact,1) is not null then
      v_body := v_body || E'\n（秘匿列は非表示：当事者のみ/運営はDBで確認）';
    end if;
  end if;

  execute format('select count(*) from %I.%I', tg_table_schema, tg_table_name) into v_total;

  begin
    perform public.send_admin_email(
      '[記録] ' || v_table_jp || '・' || v_op,
      '■ 対象：' || v_table_jp || '（' || tg_table_name || '）' || E'\n' ||
      '■ 操作：' || v_op || '　■ 実行者：' || v_actor || E'\n' ||
      '■ 現在の総数：' || v_total || '行' || E'\n' ||
      '■ 時刻：' || to_char(now() at time zone 'Asia/Tokyo','MM/DD HH24:MI:SS') || E'\n\n' ||
      v_body || E'\n\n' ||
      '（停止する時：event_firehose を false に・1行）');
  exception when others then null; end;

  return coalesce(new, old);
end; $$;

-- 対象テーブルに装着（応募INSERTは既存の応募メールと重複するためUPDATE/DELETEのみ）
drop trigger if exists firehose on public.jobs;
create trigger firehose after insert or update or delete on public.jobs
  for each row execute function public.trg_firehose();
drop trigger if exists firehose on public.applications;
create trigger firehose after update or delete on public.applications
  for each row execute function public.trg_firehose();
drop trigger if exists firehose on public.worker_profiles;
create trigger firehose after insert or update or delete on public.worker_profiles
  for each row execute function public.trg_firehose();
drop trigger if exists firehose on public.employer_profiles;
create trigger firehose after insert or update or delete on public.employer_profiles
  for each row execute function public.trg_firehose();
drop trigger if exists firehose on public.saved_jobs;
create trigger firehose after insert or delete on public.saved_jobs
  for each row execute function public.trg_firehose();
drop trigger if exists firehose on public.reviews;
create trigger firehose after insert or update on public.reviews
  for each row execute function public.trg_firehose();
drop trigger if exists firehose on public.messages;
create trigger firehose after insert on public.messages
  for each row execute function public.trg_firehose();
drop trigger if exists firehose on public.account_holders;
create trigger firehose after insert or update or delete on public.account_holders
  for each row execute function public.trg_firehose();