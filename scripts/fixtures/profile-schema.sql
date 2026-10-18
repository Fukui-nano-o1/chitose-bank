-- Read-only catalog snapshot: 2026-10-18. Local tests only; no user records.
create role anon; create role authenticated; create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth,public to anon,authenticated;
create table public.app_admins(auth_id uuid primary key);
create table public.test_mail_outbox(subject text, body text);
create function public.send_admin_email(text,text) returns void language sql as $$insert into public.test_mail_outbox values ($1,$2)$$;
create function public.profile_text_ng(text) returns text language sql immutable as $$select case when $1 like '%[blocked]%' then 'blocked' else null end$$;
create table public.worker_profiles (
  "auth_id" uuid primary key,
  "nickname" text,
  "pr" text,
  "avatar_url" text,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now(),
  "residence_city" text,
  "transport" text,
  "farm_experience" text,
  "experienced_tasks" jsonb,
  "physical_level" text,
  "pr_qa" jsonb,
  "interests" jsonb,
  "languages" jsonb,
  "pr_hidden_original" text,
  "pr_pending" text,
  "pr_qa_pending" jsonb,
  "pr_submitted_at" timestamp with time zone,
  "pr_revision_targets" jsonb,
  "self_declared" jsonb not null default '[]'::jsonb,
  "experience_entries" jsonb not null default '[]'::jsonb,
  "work_mood" text,
  "learning_pref" text,
  "work_pattern" text
);
alter table public.worker_profiles enable row level security;
grant select,insert,update on public.worker_profiles to authenticated;
create policy own on public.worker_profiles to authenticated using (auth_id=auth.uid()) with check (auth_id=auth.uid());
create table public.employer_profiles (
  "auth_id" uuid primary key,
  "nickname" text,
  "pr" text,
  "avatar_url" text,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now(),
  "has_transport" boolean not null default false,
  "has_parking" boolean not null default false,
  "has_commute_allowance" boolean not null default false,
  "has_bonus" boolean not null default false,
  "employer_pays_supplies" boolean not null default false,
  "accessory_ok" boolean not null default false,
  "parking_capacity" integer,
  "commute_allowance_detail" text,
  "transport_area" text,
  "intro_path" text,
  "intro_joy" text,
  "intro_crops" text,
  "intro_atmosphere" text,
  "intro_message" text,
  "owner_comment" text,
  "staff_count" integer,
  "commitment" text,
  "unique_point" text,
  "always_do" text,
  "break_style" text,
  "interaction_style" text,
  "supplies_cap" text not null default ''::text,
  "place_zip" text not null default ''::text,
  "place_prefecture" text not null default ''::text,
  "place_city" text not null default ''::text,
  "place_town" text not null default ''::text,
  "place_address" text not null default ''::text,
  "texts_pending" jsonb not null default '{}'::jsonb,
  "texts_submitted_at" timestamp with time zone,
  "texts_revision_requested_at" timestamp with time zone,
  "insurance_items" jsonb not null default '[]'::jsonb,
  "insurance_notes" jsonb not null default '{}'::jsonb,
  "recruiter_name" text,
  "recruiter_address" text,
  "recruiter_contact" text,
  "recruiter_zip" text,
  "recruiter_prefecture" text,
  "recruiter_city" text,
  "recruiter_address_detail" text,
  "recruiter_name_kana" text,
  "smoking_policy" text,
  "smoking_area" text,
  "teaching_style" text,
  "chat_style" text,
  "question_style" text,
  "has_raise" boolean not null default false,
  "has_severance_pay" boolean not null default false,
  "raise_detail" text,
  "bonus_detail" text,
  "severance_detail" text,
  "consultation_contact" text,
  "labor_insurance_status" text
);
alter table public.employer_profiles enable row level security;
grant select,insert,update on public.employer_profiles to authenticated;
create policy own on public.employer_profiles to authenticated using (auth_id=auth.uid()) with check (auth_id=auth.uid());
create table public.consignment_profiles (
  "auth_id" uuid primary key,
  "nickname" text,
  "pr" text,
  "avatar_url" text,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now(),
  "has_transport" boolean not null default false,
  "has_parking" boolean not null default false,
  "has_commute_allowance" boolean not null default false,
  "has_bonus" boolean not null default false,
  "employer_pays_supplies" boolean not null default false,
  "accessory_ok" boolean not null default false,
  "parking_capacity" integer,
  "commute_allowance_detail" text,
  "transport_area" text,
  "intro_path" text,
  "intro_joy" text,
  "intro_crops" text,
  "intro_atmosphere" text,
  "intro_message" text,
  "owner_comment" text,
  "staff_count" integer,
  "commitment" text,
  "unique_point" text,
  "always_do" text,
  "break_style" text,
  "interaction_style" text,
  "supplies_cap" text not null default ''::text,
  "place_zip" text not null default ''::text,
  "place_prefecture" text not null default ''::text,
  "place_city" text not null default ''::text,
  "place_town" text not null default ''::text,
  "place_address" text not null default ''::text,
  "texts_pending" jsonb not null default '{}'::jsonb,
  "texts_submitted_at" timestamp with time zone,
  "texts_revision_requested_at" timestamp with time zone,
  "insurance_items" jsonb not null default '[]'::jsonb,
  "insurance_notes" jsonb not null default '{}'::jsonb,
  "recruiter_name" text,
  "recruiter_address" text,
  "recruiter_contact" text,
  "consignor_name" text not null default ''::text,
  "consignor_trade_name" text not null default ''::text,
  "consignor_corp_no" text not null default ''::text,
  "consignor_invoice_no" text not null default ''::text,
  "consignor_rep_name" text not null default ''::text,
  "consignor_address" text not null default ''::text,
  "consignor_phone" text not null default ''::text,
  "consignor_email" text not null default ''::text,
  "consignor_emergency" text not null default ''::text,
  "consignor_billing" text not null default ''::text,
  "consignor_zip" text not null default ''::text,
  "consignor_pref" text not null default ''::text,
  "consignor_city" text not null default ''::text,
  "consignor_addr" text not null default ''::text,
  "consignor_bank" text not null default ''::text,
  "consignor_bank_branch" text not null default ''::text,
  "consignor_account_type" text not null default ''::text,
  "consignor_account_no" text not null default ''::text,
  "consignor_account_name" text not null default ''::text,
  "consignor_type" text not null default ''::text,
  "consignor_data" jsonb not null default '{}'::jsonb,
  "recruiter_zip" text,
  "recruiter_prefecture" text,
  "recruiter_city" text,
  "recruiter_address_detail" text,
  "consignment_data_consent" boolean not null default false,
  "consignment_data_consent_at" timestamp with time zone,
  "consignment_data_consent_version" text not null default ''::text,
  "consignment_data_consent_user_id" uuid,
  "consignment_terms_consent" boolean not null default false,
  "consignment_terms_consent_at" timestamp with time zone,
  "consignment_terms_consent_version" text not null default ''::text,
  "consignment_terms_consent_user_id" uuid,
  "recruiter_name_kana" text,
  "smoking_policy" text,
  "smoking_area" text,
  "has_raise" boolean not null default false,
  "has_severance_pay" boolean not null default false,
  "raise_detail" text,
  "bonus_detail" text,
  "severance_detail" text,
  "consultation_contact" text,
  "labor_insurance_status" text
);
alter table public.consignment_profiles enable row level security;
grant select,insert,update on public.consignment_profiles to authenticated;
create policy own on public.consignment_profiles to authenticated using (false) with check (false);
create table public.emergency_contacts (
  "auth_id" uuid primary key,
  "name" text not null default ''::text,
  "relation" text not null default ''::text,
  "phone" text not null default ''::text,
  "updated_at" timestamp with time zone not null default now(),
  "confirmed_at" timestamp with time zone
);
alter table public.emergency_contacts enable row level security;
grant select,insert,update on public.emergency_contacts to authenticated;
create policy own on public.emergency_contacts to authenticated using (auth_id=auth.uid()) with check (auth_id=auth.uid());
CREATE OR REPLACE FUNCTION public.ep_z_publish_texts()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  tp jsonb; v_folded boolean := false; v_ng text;
  j_new jsonb; j_old jsonb; v_col text; v_label text;
begin
  tp := coalesce(new.texts_pending, '{}'::jsonb);
  if tp <> '{}'::jsonb then
    new.owner_comment            := coalesce(tp->>'owner_comment', new.owner_comment);
    new.intro_path               := coalesce(tp->>'intro_path', new.intro_path);
    new.intro_joy                := coalesce(tp->>'intro_joy', new.intro_joy);
    new.intro_crops              := coalesce(tp->>'intro_crops', new.intro_crops);
    new.intro_atmosphere         := coalesce(tp->>'intro_atmosphere', new.intro_atmosphere);
    new.intro_message            := coalesce(tp->>'intro_message', new.intro_message);
    new.unique_point             := coalesce(tp->>'unique_point', new.unique_point);
    new.always_do                := coalesce(tp->>'always_do', new.always_do);
    new.break_style              := coalesce(tp->>'break_style', new.break_style);
    new.transport_area           := coalesce(tp->>'transport_area', new.transport_area);
    new.commute_allowance_detail := coalesce(tp->>'commute_allowance_detail', new.commute_allowance_detail);
    new.supplies_cap             := coalesce(tp->>'supplies_cap', new.supplies_cap);
    new.raise_detail             := coalesce(tp->>'raise_detail', new.raise_detail);
    new.bonus_detail             := coalesce(tp->>'bonus_detail', new.bonus_detail);
    new.severance_detail         := coalesce(tp->>'severance_detail', new.severance_detail);
    new.texts_pending := '{}'::jsonb;
    new.texts_submitted_at := null;
    new.texts_revision_requested_at := null;
    v_folded := true;
  end if;

  j_new := to_jsonb(new);
  j_old := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  for v_col, v_label in
    select * from (values
      ('owner_comment','代表より'), ('intro_path','就農するまで'), ('intro_joy','いま楽しいこと'),
      ('intro_crops','どんな作物を、どんな想いで'), ('intro_atmosphere','職場の雰囲気'),
      ('intro_message','初めての人へのメッセージ'), ('unique_point','畑・農園のユニークなところ'),
      ('always_do','いつもしていること'), ('break_style','休憩とお茶'), ('transport_area','送迎エリア'),
      ('commute_allowance_detail','通勤手当の内容'), ('supplies_cap','持ち物の上限設定'),
      ('raise_detail','昇給の内容'), ('bonus_detail','賞与の内容'), ('severance_detail','退職手当の内容'), ('pr','農園紹介')
    ) t(col, label)
  loop
    if (j_new->>v_col) is distinct from (j_old->>v_col) then
      v_ng := public.profile_text_ng(j_new->>v_col);
      if v_ng is not null then raise exception '%：%', v_label, v_ng; end if;
    end if;
  end loop;

  if v_folded and not exists (select 1 from public.app_admins a where a.auth_id = new.auth_id) then
    begin
      perform public.send_admin_email(
        '[公開・事後確認] 農家プロフィールの自由記述が公開されました：' || coalesce(nullif(new.nickname,''),'（名前未設定）'),
        '農家（雇い手）の自由記述が公開されました（保存＝即公開・2026-08-14承認プロセス廃止）。' || E'\n' ||
        '電話番号・メール・URLは保存時に自動拒否済み。' || E'\n\n' ||
        '公開された内容：' || tp::text || E'\n\n' ||
        '公開後の確認：個人の特定・不適切な表現があれば、管理画面アカウント面の運営DMで修正を依頼するか、直接対処してください。');
    exception when others then null;
    end;
  end if;
  return new;
end; $function$
;
create trigger trg_ep_z_publish_texts before insert or update on public.employer_profiles for each row execute function public.ep_z_publish_texts();
CREATE OR REPLACE FUNCTION public.wp_review_dedupe()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_pend_qa jsonb; v_appr_qa jsonb;
begin
  -- 1. 空白のみの審査依頼は無い
  if new.pr_pending is not null and btrim(new.pr_pending) = '' then
    new.pr_pending := null;
  end if;

  -- 2. 承認済み本文と同一なら審査に入れない
  if new.pr_pending is not null
     and btrim(new.pr_pending) = btrim(coalesce(new.pr, '')) then
    new.pr_pending := null;
  end if;

  -- 3. Q&A：正規化した (質問, 回答) の集合が承認済みと同一なら審査に入れない
  if new.pr_qa_pending is not null then
    select coalesce(jsonb_agg(x order by x), '[]'::jsonb) into v_pend_qa
      from (select distinct jsonb_build_array(
                     coalesce(e->>'q', e->>'question', ''),
                     btrim(coalesce(e->>'a', e->>'answer', ''))) as x
              from jsonb_array_elements(new.pr_qa_pending) e) s;
    select coalesce(jsonb_agg(x order by x), '[]'::jsonb) into v_appr_qa
      from (select distinct jsonb_build_array(
                     coalesce(e->>'q', e->>'question', ''),
                     btrim(coalesce(e->>'a', e->>'answer', ''))) as x
              from jsonb_array_elements(coalesce(new.pr_qa, '[]'::jsonb)) e) s;
    if v_pend_qa = v_appr_qa then
      new.pr_qa_pending := null;
    end if;
  end if;

  -- 4. 審査に出すものが無ければ、申請時刻と修正依頼の印も残さない
  if new.pr_pending is null and new.pr_qa_pending is null then
    new.pr_submitted_at := null;
    new.pr_revision_targets := null;
  end if;

  -- 5. 中身の変わらない再提出で申請時刻を進めない（48時間の自動公開が後ろにずれない）
  --    new.pr_submitted_at is not null が必須：修正依頼は pending を残したまま申請時刻を
  --    null にして審査の列から外す＝その null 化を打ち消さない
  if tg_op = 'UPDATE'
     and old.pr_submitted_at is not null
     and new.pr_submitted_at is not null
     and (new.pr_pending is not null or new.pr_qa_pending is not null)
     and coalesce(btrim(new.pr_pending), '') = coalesce(btrim(old.pr_pending), '')
     and coalesce(new.pr_qa_pending, '[]'::jsonb) = coalesce(old.pr_qa_pending, '[]'::jsonb) then
    new.pr_submitted_at := old.pr_submitted_at;
  end if;

  return new;
end; $function$
;
create trigger trg_wp_review_dedupe before insert or update on public.worker_profiles for each row execute function public.wp_review_dedupe();
CREATE OR REPLACE FUNCTION public.wp_z_publish_texts()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_folded boolean := false; v_ng text; v_e jsonb; v_qa_text text;
begin
  if new.pr_pending is not null then
    new.pr := nullif(btrim(new.pr_pending), '');
    new.pr_pending := null;
    v_folded := true;
  end if;
  if new.pr_qa_pending is not null then
    new.pr_qa := new.pr_qa_pending;
    new.pr_qa_pending := null;
    v_folded := true;
  end if;
  if v_folded then
    new.pr_submitted_at := null;
    new.pr_revision_targets := null;
  end if;

  if (tg_op = 'INSERT' and new.pr is not null)
     or (tg_op = 'UPDATE' and new.pr is distinct from old.pr) then
    v_ng := public.profile_text_ng(new.pr);
    if v_ng is not null then raise exception '自己紹介：%', v_ng; end if;
  end if;
  if (tg_op = 'INSERT' and new.pr_qa is not null)
     or (tg_op = 'UPDATE' and new.pr_qa is distinct from old.pr_qa) then
    for v_e in select value from jsonb_array_elements(coalesce(new.pr_qa, '[]'::jsonb))
    loop
      v_ng := public.profile_text_ng(coalesce(v_e->>'q', v_e->>'question'));
      if v_ng is not null then raise exception 'Q&Aの質問：%', v_ng; end if;
      v_ng := public.profile_text_ng(coalesce(v_e->>'a', v_e->>'answer'));
      if v_ng is not null then raise exception 'Q&Aの回答：%', v_ng; end if;
    end loop;
  end if;

  if v_folded and not exists (select 1 from public.app_admins a where a.auth_id = new.auth_id) then
    begin
      select string_agg('Q：' || coalesce(e->>'q', e->>'question','？') || E'\n' ||
                        'A：' || coalesce(e->>'a', e->>'answer','（未回答）'), E'\n\n')
        into v_qa_text
        from jsonb_array_elements(coalesce(new.pr_qa, '[]'::jsonb)) e;
      perform public.send_admin_email(
        '[公開・事後確認] 自己紹介が公開されました：' || coalesce(nullif(new.nickname,''),'（名前未設定）'),
        '働き手の自由記述が公開されました（保存＝即公開・2026-08-14承認プロセス廃止）。' || E'\n' ||
        '電話番号・メール・URLは保存時に自動拒否済み。' || E'\n\n' ||
        '■ 自己紹介：' || E'\n' || coalesce(new.pr, '（なし）') || E'\n\n' ||
        '■ Q&A：' || E'\n' || coalesce(v_qa_text, '（なし）') || E'\n\n' ||
        '公開後の確認：個人の特定・不適切な表現があれば、管理画面アカウント面の運営DMで修正を依頼するか、直接対処してください。');
    exception when others then null;
    end;
  end if;
  return new;
end; $function$
;
create trigger trg_wp_z_publish_texts before insert or update on public.worker_profiles for each row execute function public.wp_z_publish_texts();

