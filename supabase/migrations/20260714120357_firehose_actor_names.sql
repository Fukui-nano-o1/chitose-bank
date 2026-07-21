-- firehoseの実行者を人間の名前に（ニックネーム→本人確認氏名→メール→UUID末尾）
create or replace function public.resolve_actor_name(p_auth_id uuid)
returns text language sql security definer set search_path = public as $$
  select coalesce(
    (select nullif(nickname,'') from public.worker_profiles where auth_id = p_auth_id),
    (select nullif(full_name,'') from public.account_holders where auth_id = p_auth_id),
    (select email from auth.users where id = p_auth_id),
    '不明（' || right(p_auth_id::text, 6) || '）'
  );
$$;

create or replace function public.trg_firehose()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_on boolean; v_row jsonb; v_diff jsonb; v_body text; v_total bigint;
  v_redact text[]; v_op text; v_table_jp text; v_actor text;
begin
  select value = 'true' into v_on from public.app_settings where key = 'event_firehose';
  if not coalesce(v_on, false) then return coalesce(new, old); end if;

  v_redact := case tg_table_name
    when 'messages' then array['body']
    when 'reviews' then array['private_memo']
    when 'account_holders' then array['full_name','postal_code','address','birth_date',
      'contact_email','contact_phone','company_name','company_number']
    when 'worker_profiles' then array['pr_hidden_original']
    else array[]::text[] end;

  v_op := case tg_op when 'INSERT' then '追加' when 'UPDATE' then '編集' else '削除' end;
  v_table_jp := case tg_table_name
    when 'jobs' then '求人' when 'applications' then '応募' when 'worker_profiles' then '働き手プロ'
    when 'employer_profiles' then '雇い手プロ' when 'saved_jobs' then 'いいね'
    when 'reviews' then '評価' when 'messages' then 'チャット'
    when 'account_holders' then '本人確認情報' else tg_table_name end;

  v_actor := case when auth.uid() is null then '運営/システム'
                  else public.resolve_actor_name(auth.uid()) end;

  if tg_op = 'UPDATE' then
    select jsonb_object_agg(n.key, jsonb_build_object('旧', o.value, '新', n.value))
      into v_diff
      from jsonb_each(to_jsonb(new)) n
      join jsonb_each(to_jsonb(old)) o on o.key = n.key
     where n.value is distinct from o.value
       and not (n.key = any(v_redact));
    if v_diff is null or v_diff = '{}'::jsonb then return new; end if;
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
      '[記録] ' || v_table_jp || '・' || v_op || '　by ' || v_actor,
      '■ 対象：' || v_table_jp || '（' || tg_table_name || '）' || E'\n' ||
      '■ 操作：' || v_op || '　■ 実行者：' || v_actor || E'\n' ||
      '■ 現在の総数：' || v_total || '行' || E'\n' ||
      '■ 時刻：' || to_char(now() at time zone 'Asia/Tokyo','MM/DD HH24:MI:SS') || E'\n\n' ||
      v_body || E'\n\n' ||
      '（停止する時：event_firehose を false に・1行）');
  exception when others then null; end;

  return coalesce(new, old);
end; $$;

-- 操作開始メールも同じ解決関数で名前表示に
create or replace function public.trg_session_start()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text; v_recent int;
begin
  if exists (select 1 from public.app_admins a where a.auth_id = new.auth_id) then
    return new;
  end if;
  select count(*) into v_recent from public.page_events
   where auth_id = new.auth_id and id <> new.id
     and ts > now() - interval '30 minutes';
  if v_recent = 0 then
    v_name := public.resolve_actor_name(new.auth_id);
    begin
      perform public.send_admin_email(
        '[操作開始] ' || v_name || ' → ' || new.page_hash,
        v_name || ' がサイトの操作を始めました。' || E'\n' ||
        '最初のページ：' || new.page_hash || E'\n' ||
        '時刻：' || to_char(now() at time zone 'Asia/Tokyo','MM/DD HH24:MI:SS') || E'\n\n' ||
        '（離脱後30分で軌跡の総括が届きます）');
    exception when others then null; end;
  end if;
  return new;
end; $$;