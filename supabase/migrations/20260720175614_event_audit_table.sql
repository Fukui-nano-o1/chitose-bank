-- 監査台帳：全変更（管理者含む）をDB内に無音記録。メール実況は従来どおり非管理者のみ。
create table if not exists public.event_audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,                      -- auth.uid()（null=システム/cron）
  table_name text not null,
  op text not null,                -- INSERT/UPDATE/DELETE
  row_pk text,                     -- 対象行のid（取れる場合）
  diff jsonb                       -- 変更差分（秘匿列除去済み）
);
alter table public.event_audit enable row level security;
create policy "audit admin read" on public.event_audit
  for select to authenticated
  using (exists (select 1 from public.app_admins a where a.auth_id = auth.uid()));
-- 書き込みポリシーは作らない＝トリガー（definer）のみが書ける。更新・削除の経路なし

create or replace function public.trg_firehose()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_on boolean; v_body text; v_total bigint; v_lines text; v_diff jsonb;
  v_redact text[]; v_noise text[] := array['id','updated_at','created_at','auth_id',
    'farmer_id','worker_id','reviewer_id','reviewee_id','application_id',
    'insurance_first_mailed_at','insurance_last_mailed_on','completion_remind_count',
    'pr_hidden_original','pr_submitted_at','lat','lng'];
  v_op text; v_table_jp text; v_actor text; v_is_admin boolean; v_pk text;
begin
  v_redact := case tg_table_name
    when 'messages' then array['body']
    when 'reviews' then array['private_memo']
    when 'account_holders' then array['full_name','postal_code','address','birth_date',
      'contact_email','contact_phone','company_name','company_number']
    else array[]::text[] end;
  v_redact := v_redact || v_noise;

  if tg_op = 'UPDATE' then
    select jsonb_object_agg(n.key, jsonb_build_object('old', o.value, 'new', n.value))
      into v_diff
      from jsonb_each(to_jsonb(new)) n
      join jsonb_each(to_jsonb(old)) o on o.key = n.key
     where n.value is distinct from o.value and not (n.key = any(v_redact));
    if v_diff is null or v_diff = '{}'::jsonb then return new; end if;
  else
    select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_diff
      from jsonb_each(to_jsonb(coalesce(new, old)))
     where not (key = any(v_redact))
       and value is not null and value <> 'null'::jsonb and value #>> '{}' <> '';
  end if;

  begin v_pk := (to_jsonb(coalesce(new, old)) ->> 'id');
  exception when others then v_pk := null; end;

  -- ★監査台帳：管理者含む全操作を無音で記録（メールの手前・除外なし）
  begin
    insert into public.event_audit (actor, table_name, op, row_pk, diff)
    values (auth.uid(), tg_table_name, tg_op, v_pk, v_diff);
  exception when others then null; end;

  -- 以下、メール実況（従来どおり：firehose ON かつ 非管理者のみ）
  select value = 'true' into v_on from public.app_settings where key = 'event_firehose';
  if not coalesce(v_on, false) then return coalesce(new, old); end if;
  v_is_admin := auth.uid() is not null and exists
     (select 1 from public.app_admins a where a.auth_id = auth.uid());
  if v_is_admin then return coalesce(new, old); end if;

  v_op := case tg_op when 'INSERT' then '追加' when 'UPDATE' then '編集' else '削除' end;
  v_table_jp := case tg_table_name
    when 'jobs' then '求人' when 'applications' then '応募' when 'worker_profiles' then '働き手プロ'
    when 'employer_profiles' then '雇い手プロ' when 'saved_jobs' then 'いいね'
    when 'reviews' then '評価' when 'messages' then 'チャット'
    when 'account_holders' then '本人確認情報' else tg_table_name end;
  v_actor := case when auth.uid() is null then '運営/システム'
                  else public.resolve_actor_name(auth.uid()) end;

  if tg_op = 'UPDATE' then
    select string_agg('・' || public.jp_col(key) || '：' ||
             public.jp_val(value->'old') || ' → ' || public.jp_val(value->'new'), E'\n')
      into v_lines from jsonb_each(v_diff);
    v_body := '変わったところ：' || E'\n' || coalesce(v_lines,'');
  else
    select string_agg('・' || public.jp_col(key) || '：' || public.jp_val(value), E'\n')
      into v_lines from jsonb_each(v_diff);
    v_body := case tg_op when 'INSERT' then '内容：' else '削除された内容：' end
              || E'\n' || coalesce(v_lines, '（表示できる項目なし）');
    if tg_table_name in ('messages','account_holders') then
      v_body := v_body || E'\n（本文・個人情報の値は表示しません）';
    end if;
  end if;

  execute format('select count(*) from %I.%I', tg_table_schema, tg_table_name) into v_total;
  begin
    perform public.send_admin_email(
      '[記録] ' || v_table_jp || 'の' || v_op || '　by ' || v_actor,
      v_actor || ' さんが ' || v_table_jp || ' を' || v_op || 'しました' ||
      '（' || to_char(now() at time zone 'Asia/Tokyo','MM/DD HH24:MI') || '・現在' || v_total || '件）' || E'\n\n' ||
      v_body);
  exception when others then null; end;

  return coalesce(new, old);
end; $$;