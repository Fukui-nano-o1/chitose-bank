-- 働き手の「はたらき方の希望」質問セット（2026-08-14たきと承認・AskUserQuestionで裁定）。
-- 許可リストへの追加3項目（判断理由＝いずれも労働条件の希望／業務上の意思疎通・雇い手側の関わり方4問と対）：
--   作業中の雰囲気（おしゃべり歓迎／ほどよく会話／黙々と集中）
--   教わり方の希望（やって見せてほしい／口頭での説明がいい／やりながら覚えたい）
--   希望する働き方（単発で働きたい／気に入った農園に続けて通いたい／季節ごとに働きたい）
-- すべて選択式・任意＝身体属性・年代等の禁止項目に非該当。値は physical_level と同じくラベル文字列で保存。
-- 「希望する作業の強さ」の選択肢ラベルも柔らかめに差し替え（既存の保存値は書き換えない＝表示はそのまま）。
alter table public.worker_profiles
  add column if not exists work_mood text,
  add column if not exists learning_pref text,
  add column if not exists work_pattern text;

-- 農家向け窓口RPCへ3キー追加（台帳安全列＝公開許可項目。土台は現行本番定義・2026-08-06教訓）
CREATE OR REPLACE FUNCTION public.worker_profile_for_farmer(p_worker_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v json; v_priv boolean; v_entitled boolean; v_pending boolean;
begin
  if auth.uid() is null or p_worker_id is null then return null; end if;
  -- 特権＝本人 or 運営（審査中でも見える・全安全列）。農家＝応募を受けた関係のみ・審査中は伏せる
  v_priv := (auth.uid() = p_worker_id) or exists (select 1 from public.app_admins a where a.auth_id = auth.uid());
  v_entitled := v_priv or ( not public.is_account_moderated(p_worker_id)
                            and exists (select 1 from public.applications a
                                         where a.worker_id = p_worker_id and a.farmer_id = auth.uid()) );
  if not v_entitled then return null; end if;
  -- 審査中（未承認の自己紹介がある）は農家に見せない＝本文は返さず under_review のみ（2026-07-19の非表示ゲートを維持）
  if not v_priv then
    select (nullif(btrim(coalesce(pr_pending,'')),'') is not null
            or (pr_qa_pending is not null and jsonb_typeof(pr_qa_pending)='array'
                and jsonb_array_length(pr_qa_pending) > 0))
      into v_pending from public.worker_profiles where auth_id = p_worker_id;
    if coalesce(v_pending,false) then return json_build_object('under_review', true); end if;
  end if;
  select json_build_object(
    'auth_id', wp.auth_id, 'nickname', wp.nickname, 'pr', wp.pr, 'avatar_url', wp.avatar_url,
    'created_at', wp.created_at, 'residence_city', wp.residence_city, 'transport', wp.transport,
    'farm_experience', wp.farm_experience, 'experienced_tasks', wp.experienced_tasks,
    'physical_level', wp.physical_level, 'pr_qa', wp.pr_qa, 'interests', wp.interests,
    'languages', wp.languages, 'self_declared', wp.self_declared, 'experience_entries', wp.experience_entries,
    'work_mood', wp.work_mood, 'learning_pref', wp.learning_pref, 'work_pattern', wp.work_pattern
  ) into v from public.worker_profiles wp where wp.auth_id = p_worker_id;
  return v;  -- pr_pending / pr_qa_pending / pr_hidden_original / pr_revision_targets は含めない
end; $function$;
