-- 管理メールの日本語化：列名→日本語ラベル・値→日本語・雑音列の除去・Q&AのQ/A表示

-- 列名の日本語辞書
create or replace function public.jp_col(p_col text)
returns text language sql immutable as $$
  select coalesce((select v from (values
    ('crop','作物'),('task','作業'),('status','状態'),('hourly_wage','時給'),
    ('date_start','開始日'),('date_end','終了日'),('work_time','時間帯'),('town','町名'),
    ('address','住所'),('meeting_place','集合場所'),('items','持ち物'),('cautions','注意事項'),
    ('pay_method','支払方法'),('headcount','採用人数'),('full_pay_guarantee','満額保証'),
    ('beginner_ok','はじめてOK'),('instant_approve_repeat','リピート即決'),('job_number','求人番号'),
    ('nickname','ニックネーム'),('pr','自己紹介'),('pr_pending','自己紹介（確認待ち）'),
    ('pr_qa','Q&A'),('pr_qa_pending','Q&A（確認待ち）'),('avatar_url','写真'),
    ('residence_city','活動地域'),('transport','移動手段'),('farm_experience','経験'),
    ('experienced_tasks','経験のある作業'),('physical_level','希望する作業の強さ'),
    ('interests','趣味'),('languages','やり取りできる言語'),
    ('farm_name','農園名'),('owner_comment','代表メッセージ'),('unique_point','ユニークなところ'),
    ('always_do','いつもしていること'),('break_style','休憩とお茶'),('interaction_style','関わり方'),
    ('intro_path','就農のきっかけ'),('staff_count','スタッフ数'),
    ('want_again','また呼びたい/働きたい'),('entrust','安心して任せられた'),
    ('as_described','説明のとおり'),('safety_care','安全に配慮'),
    ('public_comment','公開コメント'),('direction','評価の方向'),
    ('started_at','開始打刻'),('farmer_confirmed_start_at','開始確認（農家）'),
    ('work_completed_at','完了日時'),('worker_confirmed_end_at','終了確認（働き手）'),
    ('attended','出勤'),('decided_at','判断日時'),('insurance_prepared_at','保険準備'),
    ('terms_confirmed_worker_at','条件確認（働き手）'),('terms_confirmed_farmer_at','条件確認（農家）'),
    ('body','本文'),('kind','種別'),('reason','理由')
  ) as t(k,v) where t.k = p_col), p_col);
$$;

-- 値の日本語化（null/空/真偽/状態語/長文の丸め）
create or replace function public.jp_val(p jsonb)
returns text language plpgsql immutable as $$
declare v text;
begin
  if p is null or p = 'null'::jsonb then return '（未設定）'; end if;
  if p = 'true'::jsonb then return 'はい'; end if;
  if p = 'false'::jsonb then return 'いいえ'; end if;
  v := p #>> '{}';
  if v = '' then return '（空欄）'; end if;
  v := case v
    when 'open' then '公開中' when 'draft' then '作成中' when 'pending' then '審査待ち'
    when 'applied' then '応募中' when 'approved' then '承認済み' when 'completed' then '完了'
    when 'rejected' then '見送り' when 'expired' then '失効'
    when 'farmer_to_worker' then '農家→働き手' when 'worker_to_farmer' then '働き手→農家'
    when 'late' then '遅れる連絡' when 'absent_notice' then '欠勤の連絡'
    when 'cancel' then '中止の連絡' when 'postpone' then '延期の連絡'
    when 'dispute_no_show' then '欠勤記録への異議'
    when 'together' then '一緒に作業する' when 'explain_then_leave' then '最初に説明して任せる'
    when 'on_call' then '必要な時だけ声かけ'
    else v end;
  if length(v) > 80 then v := left(v, 80) || '…'; end if;
  return v;
end; $$;

-- firehose本体：差分を「・ラベル：旧 → 新」の日本語行に
create or replace function public.trg_firehose()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_on boolean; v_body text; v_total bigint; v_lines text;
  v_redact text[]; v_noise text[] := array['id','updated_at','created_at','auth_id',
    'farmer_id','worker_id','reviewer_id','reviewee_id','application_id',
    'insurance_first_mailed_at','insurance_last_mailed_on','completion_remind_count',
    'pr_hidden_original','pr_submitted_at','lat','lng'];
  v_op text; v_table_jp text; v_actor text;
begin
  select value = 'true' into v_on from public.app_settings where key = 'event_firehose';
  if not coalesce(v_on, false) then return coalesce(new, old); end if;
  if auth.uid() is not null and exists
     (select 1 from public.app_admins a where a.auth_id = auth.uid()) then
    return coalesce(new, old);
  end if;

  v_redact := case tg_table_name
    when 'messages' then array['body']
    when 'reviews' then array['private_memo']
    when 'account_holders' then array['full_name','postal_code','address','birth_date',
      'contact_email','contact_phone','company_name','company_number']
    else array[]::text[] end;
  v_redact := v_redact || v_noise;

  v_op := case tg_op when 'INSERT' then '追加' when 'UPDATE' then '編集' else '削除' end;
  v_table_jp := case tg_table_name
    when 'jobs' then '求人' when 'applications' then '応募' when 'worker_profiles' then '働き手プロ'
    when 'employer_profiles' then '雇い手プロ' when 'saved_jobs' then 'いいね'
    when 'reviews' then '評価' when 'messages' then 'チャット'
    when 'account_holders' then '本人確認情報' else tg_table_name end;
  v_actor := case when auth.uid() is null then '運営/システム'
                  else public.resolve_actor_name(auth.uid()) end;

  if tg_op = 'UPDATE' then
    select string_agg('・' || public.jp_col(n.key) || '：' ||
             public.jp_val(o.value) || ' → ' || public.jp_val(n.value), E'\n')
      into v_lines
      from jsonb_each(to_jsonb(new)) n
      join jsonb_each(to_jsonb(old)) o on o.key = n.key
     where n.value is distinct from o.value
       and not (n.key = any(v_redact));
    if v_lines is null then return new; end if;  -- 実質変更なし
    v_body := '変わったところ：' || E'\n' || v_lines;
  else
    select string_agg('・' || public.jp_col(key) || '：' || public.jp_val(value), E'\n')
      into v_lines
      from jsonb_each(to_jsonb(coalesce(new, old)))
     where not (key = any(v_redact))
       and value is not null and value <> 'null'::jsonb and value #>> '{}' <> '';
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

-- 目視メール：Q&AをQ/A形式で表示（生JSON廃止）
create or replace function public.trg_notify_worker_profile()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_qa text;
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
    select string_agg('Q：' || coalesce(e->>'q', e->>'question','？') || E'\n' ||
                      'A：' || coalesce(e->>'a', e->>'answer','（未回答）'), E'\n\n')
      into v_qa
      from jsonb_array_elements(coalesce(new.pr_qa_pending,'[]'::jsonb)) e;
  exception when others then v_qa := null;
  end;

  begin
    perform public.send_admin_email(
      '[目視・要承認] 自己紹介の申請：' || coalesce(nullif(new.nickname,''),'（名前未設定）'),
      '自由記述が申請されました（承認まで非公開・48時間で自動公開）。' || E'\n\n' ||
      '■ 自己紹介：' || E'\n' || coalesce(new.pr_pending, '（変更なし）') || E'\n\n' ||
      '■ Q&A：' || E'\n' || coalesce(v_qa, '（変更なし）') || E'\n\n' ||
      '見るのは：連絡先の直書き・個人の特定・不適切な表現、の3つだけ。' || E'\n' ||
      '問題なければ管理画面のアカウントタブで「承認して公開」。');
  exception when others then null; end;
  return new;
end; $$;