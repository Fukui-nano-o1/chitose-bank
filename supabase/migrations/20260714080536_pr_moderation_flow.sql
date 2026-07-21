-- 自由記述の公開フロー（2026-07-14確定）：
-- 選択式＝即時公開／自由記述（pr・pr_qa）＝運営確認後に公開・最大48時間で自動公開。
-- 思想：確認で短縮（数分で見れば数分で公開）・放置しても48時間で流れる（運営がボトルネックにならない保険）
alter table public.worker_profiles
  add column if not exists pr_pending text,          -- 確認待ちの自由記述（pr本体は公開版のみ保持）
  add column if not exists pr_qa_pending jsonb,      -- 確認待ちのQ&A
  add column if not exists pr_submitted_at timestamptz;  -- 申請時刻（48時間の起点）

-- 運営の承認RPC：pending → 公開版へ昇格
create or replace function public.approve_profile_text(p_auth_id uuid)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.app_admins a where a.auth_id = auth.uid()) then
    return json_build_object('ok', false, 'reason', 'not_admin');
  end if;
  update public.worker_profiles
     set pr = coalesce(pr_pending, pr),
         pr_qa = coalesce(pr_qa_pending, pr_qa),
         pr_pending = null, pr_qa_pending = null, pr_submitted_at = null
   where auth_id = p_auth_id;
  insert into public.notifications (farmer_id, type, message)
  values (p_auth_id, 'profile_approved', '自己紹介が公開されました');
  return json_build_object('ok', true);
end; $$;
grant execute on function public.approve_profile_text(uuid) to authenticated;

-- 48時間で自動公開（毎時cronに相乗り可能な独立関数・毎時0分実行）
create or replace function public.auto_publish_profile_texts()
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.worker_profiles
     set pr = coalesce(pr_pending, pr),
         pr_qa = coalesce(pr_qa_pending, pr_qa),
         pr_pending = null, pr_qa_pending = null, pr_submitted_at = null
   where pr_submitted_at is not null
     and pr_submitted_at < now() - interval '48 hours';
end; $$;
select cron.schedule('profile-auto-publish', '30 * * * *', $$ select public.auto_publish_profile_texts(); $$);

-- 目視トリガーを pending 対応に更新（申請の瞬間に全文が君のメールへ・承認導線つき）
create or replace function public.trg_notify_worker_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
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