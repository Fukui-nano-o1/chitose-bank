-- チャットの実況メール（[記録] チャットの追加　by ○○）を止める（2026-08-17たきと指示）
--
-- 【指示】「誰が送信したか運営にメール通知される。必要ない。ただし、内容の保全はする」
--
-- 【何を止めるか】trg_firehose が messages への INSERT で運営に送っていた実況メールだけ。
--   件名は '[記録] チャットの追加　by ○○'。本文はもともと伏せてあった（body は伏せ字リストに入っており
--   「（本文・個人情報の値は表示しません）」と出る）が、それでも「誰が送ったか」は運営に飛んでいた。
--
-- 【何を止めないか＝保全は不変】
--   ・監査台帳 event_audit への記録は、この関数の中でメールより手前に無条件で入る。
--     トリガー自体を外すとその記録も消えるため、外さずに「メールだけ出さない」形にする。
--   ・messages の凍結（trg_messages_history_lock_upd/del）＝本文・送信者・時刻の改変と削除の拒否は一切触らない
--     （チャット履歴の保全・2026-07-19 絶対遵守）。
--   ・当事者への新着メール（M20）とプッシュ通知も従来どおり。止めたのは運営宛の実況だけ。
--
-- 【他のテーブルは従来どおり】求人・応募・プロフィール等の実況メールは残る（app_settings の
--   event_firehose='false' にすれば全部止まる。1行・デプロイ不要）。今回はチャットだけを外した。

create or replace function public.trg_firehose()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  -- ★チャットは実況メールを出さない（2026-08-17たきと指示）。
  --   記録は上の監査台帳に残る＝保全は不変。当事者へのM20・プッシュも別経路で従来どおり
  if tg_table_name = 'messages' then return coalesce(new, old); end if;

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
end; $function$;
