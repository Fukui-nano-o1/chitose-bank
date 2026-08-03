-- 入力項目を空にするなら審査は必要ない（2026-08-03たきと指示）。
-- 審査（運営ゲート・憲法5条）が守っているのは「新しく公開される文字」。空にする＝公開される文字が
-- 無くなるだけなので、審査の対象にしない。フロント（EmployerProfileEdit／LandingFlowの待遇編集／
-- WorkerProfileEdit）は空欄を texts_pending に積まず公開列を直接空にするよう修正済み。本migrationはDB側の整合。

-- ① 掲載ブロックの条件を「中身のある pending」だけに。
--    空だけの pending（例：通勤手当のチェックを外しただけ）で求人が掲載できなくなっていた。
--    修正依頼中（texts_revision_requested_at）のブロックは従来どおり維持する。
create or replace function public.block_publish_when_profile_under_review()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.status in ('pending','open')
     and (tg_op = 'INSERT' or old.status is distinct from new.status)
     and not exists (select 1 from public.app_admins a where a.auth_id = new.farmer_id)
  then
    if public.is_account_moderated(new.farmer_id) then
      raise exception 'ACCOUNT_MODERATED: このアカウントは停止中のため掲載できません';
    end if;
    if new.status = 'pending'
       and exists (select 1 from public.employer_profiles ep
                    where ep.auth_id = new.farmer_id
                      and (exists (select 1 from jsonb_each_text(coalesce(ep.texts_pending, '{}'::jsonb)) t
                                    where btrim(t.value) <> '')
                           or ep.texts_revision_requested_at is not null))
    then
      raise exception 'PROFILE_UNDER_REVIEW: プロフィール審査中は掲載できません（下書き保存は可能です）';
    end if;
  end if;
  return new;
end; $function$;

-- ② 既に積まれてしまった「空だけの申請」を本人の意思どおり反映して片付ける。
--    公開列を空にし（本人が消したのだから消えるのが正）、pending から空のキーを取り除く。
--    中身のある pending は触らない（審査の対象は残す）。
update public.employer_profiles ep set
  owner_comment            = case when (ep.texts_pending ? 'owner_comment')            and btrim(coalesce(ep.texts_pending->>'owner_comment',''))            = '' then '' else ep.owner_comment end,
  intro_path               = case when (ep.texts_pending ? 'intro_path')               and btrim(coalesce(ep.texts_pending->>'intro_path',''))               = '' then '' else ep.intro_path end,
  intro_joy                = case when (ep.texts_pending ? 'intro_joy')                and btrim(coalesce(ep.texts_pending->>'intro_joy',''))                = '' then '' else ep.intro_joy end,
  intro_crops              = case when (ep.texts_pending ? 'intro_crops')              and btrim(coalesce(ep.texts_pending->>'intro_crops',''))              = '' then '' else ep.intro_crops end,
  intro_atmosphere         = case when (ep.texts_pending ? 'intro_atmosphere')         and btrim(coalesce(ep.texts_pending->>'intro_atmosphere',''))         = '' then '' else ep.intro_atmosphere end,
  intro_message            = case when (ep.texts_pending ? 'intro_message')            and btrim(coalesce(ep.texts_pending->>'intro_message',''))            = '' then '' else ep.intro_message end,
  unique_point             = case when (ep.texts_pending ? 'unique_point')             and btrim(coalesce(ep.texts_pending->>'unique_point',''))             = '' then '' else ep.unique_point end,
  always_do                = case when (ep.texts_pending ? 'always_do')                and btrim(coalesce(ep.texts_pending->>'always_do',''))                = '' then '' else ep.always_do end,
  break_style              = case when (ep.texts_pending ? 'break_style')              and btrim(coalesce(ep.texts_pending->>'break_style',''))              = '' then '' else ep.break_style end,
  transport_area           = case when (ep.texts_pending ? 'transport_area')           and btrim(coalesce(ep.texts_pending->>'transport_area',''))           = '' then '' else ep.transport_area end,
  commute_allowance_detail = case when (ep.texts_pending ? 'commute_allowance_detail') and btrim(coalesce(ep.texts_pending->>'commute_allowance_detail','')) = '' then '' else ep.commute_allowance_detail end,
  supplies_cap             = case when (ep.texts_pending ? 'supplies_cap')             and btrim(coalesce(ep.texts_pending->>'supplies_cap',''))             = '' then '' else ep.supplies_cap end,
  texts_pending = coalesce((select jsonb_object_agg(t.key, t.value)
                              from jsonb_each_text(ep.texts_pending) t
                             where btrim(t.value) <> ''), '{}'::jsonb),
  texts_submitted_at = case when exists (select 1 from jsonb_each_text(ep.texts_pending) t where btrim(t.value) <> '')
                            then ep.texts_submitted_at else null end
where ep.texts_pending is not null
  and ep.texts_pending <> '{}'::jsonb
  and exists (select 1 from jsonb_each_text(ep.texts_pending) t where btrim(t.value) = '');

-- ③ 働き手側：本文を空にしただけの申請（pr_pending が空文字）も同様に反映して片付ける。
update public.worker_profiles wp set
  pr = '',
  pr_pending = null,
  pr_submitted_at = case when wp.pr_qa_pending is not null then wp.pr_submitted_at else null end
where wp.pr_pending is not null and btrim(wp.pr_pending) = '';
