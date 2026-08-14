-- 承認プロセスの削除（2026-08-14 たきと指示「プロフィールや求人の掲載にあたっての
-- 申請→承認→掲載（公開）の段階的プロセスから、申請承認を削除する」）
--
-- 廃止する承認は3本：
--   A 求人の掲載      ：掲載する→pending→運営「公開する」→open だったものを、掲載する＝即 open に
--   B 働き手の自由記述：pr_pending→運営承認（48hで自動公開）だったものを、保存＝即公開に
--   C 農家の自由記述  ：texts_pending→運営「承認して公開」だったものを、保存＝即公開に
--
-- 変えないもの（適法性の核＝機構の壁はすべて既存トリガーで維持・公開時にも発火する）：
--   ・最賃・時間外の掲載検査（trg_job_publish_snapshot・20260806163552）
--   ・募集主情報の必須（require_recruiter_info）／掲載時スナップショット凍結
--   ・第三者公開のキルスイッチ（block_third_party_open）＝app_settings.third_party_publish_allowed を
--     'false' に1行UPDATEすれば、一般農家の公開は即・従来の「公開間近（pending）」待ちに戻る
--   ・承認制の応募フロー（農家が応募を承認＝運営は採用に関与しない・職安法対応）
--
-- 新しく足す壁（手動審査の代替）：
--   ・自由記述の自動NG検査＝電話番号・メールアドレス・URLは保存時にDBが拒否
--     （jq_ng_check と同じパターン。連絡先交換禁止ポリシーを機構で守る。変更された文字だけを検査
--       ＝過去に公開済みの文面は編集されるまで対象外so既存ユーザーの保存を止めない）
--   ・運営の見張り（的確表示義務への構え）＝審査依頼メールの代わりに「公開の事後確認」FYIメールを送る
--     （求人・自由記述とも。公開は止めない・読むのは運営だけ）

-- ──────────────────────────────────────────────
-- 0. 自由記述の自動NG検査（共通ヘルパー・純関数）
--    jq_ng_check との違い：空・文字数は見ない（空にする保存を止めないため。長さはUI側の上限が担保）
-- ──────────────────────────────────────────────
create or replace function public.profile_text_ng(p text)
returns text
language plpgsql
immutable
as $$
begin
  if p is null or btrim(p) = '' then return null; end if;
  if p ~ '0\d{1,4}[-‐−ー\s]?\d{1,4}[-‐−ー\s]?\d{3,4}' then
    return '電話番号は記載できません（連絡はサイト内でお願いします）';
  end if;
  if p ~* '[a-z0-9._%+-]+@[a-z0-9.-]+' then
    return 'メールアドレスは記載できません';
  end if;
  if p ~* 'https?://|www\.' then
    return 'URLは記載できません';
  end if;
  return null;
end; $$;

-- ──────────────────────────────────────────────
-- A-1. publish_my_job：本人の draft/pending を open にする唯一の窓口
--      RLSは広げない（一般農家の直接の status='open' 書き込みは従来どおり不可）＝
--      2026-08-07「導出元の列を当事者に直接書かせない」教訓を維持。
--      UPDATE時に既存の掲載トリガー（最賃・時間外・募集主・スナップショット・第三者フラグ）が全発火し、
--      違反は日本語の例外メッセージでこのRPCから返る（フロントはそのままalert表示）
-- ──────────────────────────────────────────────
create or replace function public.publish_my_job(p_job_number integer)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_farmer uuid; v_status text;
begin
  if auth.uid() is null then return json_build_object('ok', false, 'reason', 'not_logged_in'); end if;
  if public.is_account_moderated(auth.uid()) then
    return json_build_object('ok', false, 'reason', 'account_suspended');
  end if;
  select farmer_id, status into v_farmer, v_status from public.jobs where job_number = p_job_number;
  if v_farmer is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_farmer <> auth.uid() then return json_build_object('ok', false, 'reason', 'not_yours'); end if;
  if v_status = 'open' then return json_build_object('ok', true, 'already', true); end if;
  if v_status not in ('draft','pending') then return json_build_object('ok', false, 'reason', 'bad_status'); end if;
  update public.jobs set status = 'open' where job_number = p_job_number;
  return json_build_object('ok', true);
end; $$;

revoke all on function public.publish_my_job(integer) from public;
revoke all on function public.publish_my_job(integer) from anon;
grant execute on function public.publish_my_job(integer) to authenticated;

-- ──────────────────────────────────────────────
-- A-2. 審査依頼メール（notify_job_pending）→ 公開の事後確認FYIメールへ差し替え
--      旧 trg_notify_job_pending の全定義は git履歴・過去の適用記録に残存（審査依頼の文面のため復元不要と判断）。
--      目視項目（報酬・勤務時間・危険箇所・写真＝法的リスク直結）はそのまま引き継ぐ＝見張りの実体は不変。
--      運営者本人（app_admins）の自己募集には送らない（従来の審査対象外と同じ）
-- ──────────────────────────────────────────────
drop trigger if exists notify_job_pending on public.jobs;
drop function if exists public.trg_notify_job_pending();

create or replace function public.trg_notify_job_open_fyi()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_text text; v_html text; v_danger_p text; v_danger_t text;
  v_photos_html text := ''; v_ph jsonb; v_review_url text;
begin
  if new.status = 'open'
     and (tg_op = 'INSERT' or old.status is distinct from 'open')
     and not exists (select 1 from public.app_admins a where a.auth_id = new.farmer_id) then

    perform public.notify_admins(
      'job_open_fyi',
      '求人が公開されました（事後確認）：#' || new.job_number || '　' ||
      coalesce(new.crop, '') || ' ' || coalesce(new.task, '')
    );

    v_danger_p := coalesce(nullif(new.danger_places::text,'[]'), '');
    v_danger_t := coalesce(nullif(new.danger_tasks::text,'[]'), '');
    v_review_url := 'https://chitose-bank.com/#/admin/review/' || new.job_number;

    if new.photos is not null and jsonb_array_length(new.photos) > 0 then
      for v_ph in select value from jsonb_array_elements(new.photos)
      loop
        v_photos_html := v_photos_html
          || '<div style="display:inline-block;margin:4px;vertical-align:top;text-align:center;">'
          || '<img src="' || (v_ph->>'url') || '" width="140" '
          || 'style="width:140px;height:105px;object-fit:cover;border-radius:8px;border:1px solid #EBEBEB;" />'
          || case when coalesce(v_ph->>'caption','') <> ''
               then '<div style="font-size:10px;color:#717171;max-width:140px;">' || (v_ph->>'caption') || '</div>'
               else '' end
          || '</div>';
      end loop;
    else
      v_photos_html := '<span style="color:#717171;font-size:13px;">写真なし</span>';
    end if;

    v_text :=
      '求人 #' || new.job_number || ' が公開されました（掲載＝即公開・事後確認）。' || E'\n' ||
      '作物/作業：' || coalesce(new.crop,'ー') || ' / ' || coalesce(new.task,'ー') || E'\n' ||
      '確認：' || v_review_url;

    v_html :=
      '<div style="font-family:sans-serif;max-width:640px;margin:0 auto;">'
      || '<h2 style="font-size:18px;color:#222;">求人 #' || new.job_number || ' が公開されました（事後確認）</h2>'
      || '<p style="font-size:13px;color:#222;">この求人は掲載と同時に公開されています。以下を確認し、問題があればプレビューから修正のお願い・非公開の対応をしてください。</p>'
      || '<p style="font-size:12px;color:#717171;">🔴 法的リスク直結（必ず確認）　🟠 要解釈（本文を読む）　⚪ 事実情報</p>'
      || public.review_box('red', '報酬（最低賃金法・的確表示）',
           coalesce(new.pay_type,'ー') || '　時給: ' || coalesce(nullif(new.hourly_wage,''),'ー')
           || '　日給: ' || coalesce(nullif(new.daily_wage,''),'ー'))
      || public.review_box('red', '勤務時間・休憩（労基法：6h超45分・8h超60分）',
           coalesce(new.work_time,'ー') || '　休憩: ' || coalesce(new.break_time,'ー'))
      || public.review_box('red', '危険な場所（未記載のまま事故＝場の責任）',
           case when v_danger_p = '' then '⚠️ 未記載' else v_danger_p end)
      || public.review_box('red', '危険な作業',
           case when v_danger_t = '' then '⚠️ 未記載' else v_danger_t end)
      || public.review_box('red', '注意事項（安全配慮の記載）', new.cautions)
      || public.review_box('orange', '作業の説明（虚偽・誇大・連絡先直書き・チャット外誘導の混入を確認）', new.notes)
      || public.review_box('orange', '必要経験（年齢・性別等の差別条件の混入を確認）', new.job_exp)
      || public.review_box('orange', '持ち物（費用負担の偏りを確認）', new.belongings)
      || '<div style="margin:8px 0;padding:10px 14px;border-radius:8px;background:#FFF7ED;border-left:4px solid #EA580C;">'
      || '<div style="font-size:11px;color:#717171;margin-bottom:6px;">🟠 写真 '
      || coalesce(jsonb_array_length(new.photos),0) || '枚（人物の写り込み・番地看板・個人特定情報を目視）</div>'
      || v_photos_html
      || '</div>'
      || public.review_box('base', '作物・作業',
           coalesce(new.crop,'ー') || ' / ' || coalesce(new.task,'ー'))
      || public.review_box('base', '場所（公開は町域まで・番地は非公開）',
           coalesce(new.prefecture,'') || coalesce(new.city,'') || coalesce(new.town,'')
           || '　番地: ' || coalesce(new.address,'ー') || '　〒' || coalesce(new.zip,'ー'))
      || public.review_box('base', '日程・採用人数',
           coalesce(new.date_label,'ー') || '（' || coalesce(new.date_start::text,'ー') || '〜'
           || coalesce(new.date_end::text,'ー') || '）　' || coalesce(new.headcount::text,'ー') || '人')
      || '<div style="margin-top:16px;">'
      || '<a href="' || v_review_url || '" style="display:inline-block;background:#00A86B;color:#fff;'
      || 'padding:12px 28px;border-radius:10px;text-decoration:none;font-size:14px;font-weight:bold;">'
      || 'この求人を確認する（公開中）</a></div>'
      || '</div>';

    begin
      perform public.send_admin_email(
        '[公開・事後確認] 求人 #' || new.job_number || '　' || coalesce(new.crop,'') || ' ' || coalesce(new.task,''),
        v_text, v_html
      );
    exception when others then null;
    end;
  end if;
  return new;
end; $$;

create trigger notify_job_open_fyi
after insert or update on public.jobs
for each row execute function public.trg_notify_job_open_fyi();

-- ──────────────────────────────────────────────
-- A-3. 「プロフィール審査中は掲載不能」の壁を撤去（審査自体が無くなるため存在理由が消える）
--      旧定義は supabase/migrations/20260719153459_block_publish_profile_under_review.sql に残存
-- ──────────────────────────────────────────────
drop trigger if exists trg_block_publish_profile_review on public.jobs;
drop function if exists public.block_publish_when_profile_under_review();

-- ──────────────────────────────────────────────
-- B. 働き手の自由記述＝保存で即公開
--    審査待ち列（pr_pending/pr_qa_pending）に書かれた値を、同じ文の中で公開列へ畳む。
--    どの経路（本人の保存・旧クライアント）から書かれてもDBで受ける＝フロントの書き込みコードは触らない。
--    発火順：trg_wp_review_dedupe（'r'）が名前順で先＝承認済みと同一内容の保存は pending が落ちて
--    ここに届かない（FYIメールも出ない）。本トリガーは 'z' で最後
-- ──────────────────────────────────────────────
create or replace function public.wp_z_publish_texts()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
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
    new.pr_revision_targets := null; -- 修正依頼の赤帯も公開と同時に解消（承認フロー廃止）
  end if;

  -- 自動NG検査：公開される文字が【変わる】時だけ検査（既存の公開済み文面は編集されるまで対象外）
  if (tg_op = 'INSERT' and new.pr is not null)
     or (tg_op = 'UPDATE' and new.pr is distinct from old.pr) then
    v_ng := public.profile_text_ng(new.pr);
    if v_ng is not null then raise exception '自己紹介：%', v_ng; end if;
  end if;
  if (tg_op = 'INSERT' and new.pr_qa is not null)
     or (tg_op = 'UPDATE' and new.pr_qa is distinct from old.pr_qa) then
    for v_e in select value from jsonb_array_elements(coalesce(new.pr_qa, '[]'::jsonb))
    loop
      v_ng := public.profile_text_ng(coalesce(v_e->>'a', v_e->>'answer'));
      if v_ng is not null then raise exception 'Q&Aの回答：%', v_ng; end if;
    end loop;
  end if;

  -- 運営FYI（事後確認・公開は止めない・運営者本人の保存には送らない）
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
end; $$;

drop trigger if exists trg_wp_z_publish_texts on public.worker_profiles;
create trigger trg_wp_z_publish_texts
before insert or update on public.worker_profiles
for each row execute function public.wp_z_publish_texts();

-- 旧・審査依頼メール（承認まで非公開・48hで自動公開の案内）は廃止。
-- 旧定義は git履歴（App分割前）と過去の適用記録に残存
drop trigger if exists notify_worker_profile on public.worker_profiles;
drop function if exists public.trg_notify_worker_profile();

-- ──────────────────────────────────────────────
-- C. 農家（雇い手）の自由記述＝保存で即公開（Bと同型）
--    texts_pending の12キーを approve_employer_texts と同じ対応で公開列へ畳む
-- ──────────────────────────────────────────────
create or replace function public.ep_z_publish_texts()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
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
    new.texts_pending := '{}'::jsonb;
    new.texts_submitted_at := null;
    new.texts_revision_requested_at := null;
    v_folded := true;
  end if;

  -- 自動NG検査：変わった列だけ（pr＝農園紹介の長文も対象。既存文面は編集されるまで対象外）
  j_new := to_jsonb(new);
  j_old := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  for v_col, v_label in
    select * from (values
      ('owner_comment','代表より'), ('intro_path','就農するまで'), ('intro_joy','いま楽しいこと'),
      ('intro_crops','どんな作物を、どんな想いで'), ('intro_atmosphere','職場の雰囲気'),
      ('intro_message','初めての人へのメッセージ'), ('unique_point','畑・農園のユニークなところ'),
      ('always_do','いつもしていること'), ('break_style','休憩とお茶'), ('transport_area','送迎エリア'),
      ('commute_allowance_detail','通勤手当の内容'), ('supplies_cap','持ち物の上限設定'),
      ('pr','農園紹介')
    ) t(col, label)
  loop
    if (j_new->>v_col) is distinct from (j_old->>v_col) then
      v_ng := public.profile_text_ng(j_new->>v_col);
      if v_ng is not null then raise exception '%：%', v_label, v_ng; end if;
    end if;
  end loop;

  -- 運営FYI（事後確認・運営者本人の保存には送らない）
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
end; $$;

drop trigger if exists trg_ep_z_publish_texts on public.employer_profiles;
create trigger trg_ep_z_publish_texts
before insert or update on public.employer_profiles
for each row execute function public.ep_z_publish_texts();

-- ──────────────────────────────────────────────
-- 承認専用RPCの撤去（呼び出し元のAdminTab審査UIも同日撤去。旧定義は各migrationに残存：
--   approve/reject_employer_texts＝20260717130444／request_worker_pr_revision＝20260719143200・20260719144431）
--   ※request_worker_pr_revision は「公開列→pendingへ戻す」型のため、即公開トリガーの下では
--     戻した瞬間に再公開される＝自己矛盾するので残せない。公開後の対処は運営DM＋直接編集で行う
-- ──────────────────────────────────────────────
drop function if exists public.approve_employer_texts(uuid);
drop function if exists public.reject_employer_texts(uuid);
drop function if exists public.request_worker_pr_revision(uuid, text, jsonb);

-- ──────────────────────────────────────────────
-- 48時間の自動公開cron＝役目を終えたので停止・削除
-- 旧定義（復元用）：
--   create or replace function public.auto_publish_profile_texts() returns void
--   language plpgsql security definer set search_path to 'public' as $fn$
--   begin
--     update public.worker_profiles
--        set pr = coalesce(pr_pending, pr), pr_qa = coalesce(pr_qa_pending, pr_qa),
--            pr_pending = null, pr_qa_pending = null, pr_submitted_at = null
--      where pr_submitted_at is not null and pr_submitted_at < now() - interval '48 hours';
--   end; $fn$;
--   select cron.schedule('profile-auto-publish', '30 * * * *', 'select public.auto_publish_profile_texts();');
-- ──────────────────────────────────────────────
do $$
begin
  begin
    perform cron.unschedule('profile-auto-publish');
  exception when others then null; -- 未登録でも migration を止めない
  end;
end $$;
drop function if exists public.auto_publish_profile_texts();
