-- Resend枠の保全：管理者自身の操作は実況しない（[記録]・[目視]から除外）。
-- [操作開始]・[軌跡]は既に管理者除外済み。他人の動きの観測機能は無傷。

-- 1) firehose：実行者が管理者なら送信しない
create or replace function public.trg_firehose()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_on boolean; v_row jsonb; v_diff jsonb; v_body text; v_total bigint;
  v_redact text[]; v_op text; v_table_jp text; v_actor text;
begin
  select value = 'true' into v_on from public.app_settings where key = 'event_firehose';
  if not coalesce(v_on, false) then return coalesce(new, old); end if;

  -- 管理者自身の操作は実況しない（Resend枠の保全・2026-07-17）
  if auth.uid() is not null and exists
     (select 1 from public.app_admins a where a.auth_id = auth.uid()) then
    return coalesce(new, old);
  end if;

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

-- 2) [目視・要承認]：管理者自身のプロフィール申請は通知しない
create or replace function public.trg_notify_worker_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.app_admins a where a.auth_id = new.auth_id) then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and coalesce(old.pr_pending,'') = coalesce(new.pr_pending,'')
     and coalesce(old.pr_qa_pending,'[]'::jsonb) = coalesce(new.pr_qa_pending,'[]'::jsonb)
     and coalesce(old.nickname,'') = coalesce(new.nickname,'') then
    return new;
  end if;
  if new.pr_pending is null and new.pr_qa_pending is null and tg_op = 'UPDATE' then
    return new;
  end if;
  begin
    perform public.send_admin_email(
      '[目視・要承認] 自己紹介の申請：' || coalesce(nullif(new.nickname,''),'（名前未設定）'),
      '自由記述が申請されました（承認まで非公開・48時間で自動公開）。' || E'\n\n' ||
      '■ 自己紹介：' || E'\n' || coalesce(new.pr_pending, '（変更なし）') || E'\n\n' ||
      '■ Q&A：' || E'\n' || coalesce(new.pr_qa_pending::text, '（変更なし）') || E'\n\n' ||
      '目視観点：連絡先直書き・個人特定・不適切表現のみ。質と熱意は審査しない。' || E'\n' ||
      '問題なければ承認（approve_profile_text）、問題があれば差し戻し（request_profile_revision）。'
    );
  exception when others then null; end;
  return new;
end; $$;