-- 評価の公開（利用規約 第8条どおり）。2026-08-07 たきと承認。
-- 選択項目は肯定のみ即公開（審査不要）／コメントは審査（approved）を通ったものだけ公開。
-- 公開ゲート＝完了3日経過 OR 相手方向の評価も存在（第8条3）。read時計算・published_atは使わない。
-- 前提：捏造穴のトリガー（trg_reviews_party_consistency）・段階ゲート（trg_reviews_phase_gate）は既設。

-- ① コメントの審査状態（default pending＝提出時は非公開・審査待ち）
alter table public.reviews add column if not exists comment_status text not null default 'pending';
do $$ begin
  if not exists (select 1 from pg_constraint where conname='reviews_comment_status_check') then
    alter table public.reviews add constraint reviews_comment_status_check
      check (comment_status in ('pending','approved','rejected'));
  end if;
end $$;

-- ② 公開バッジRPC：被評価者(p_user_id)のpublishedな評価から、trueの選択項目の件数と
--    approved&publishedのコメントを返す。評価者個人は返さない（推薦・選別回避）。
create or replace function public.reviews_public_badges(p_user_id uuid, p_direction text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_entitled boolean;
  v_badges json; v_comments json; v_total int;
begin
  if auth.uid() is null or p_user_id is null
     or p_direction not in ('farmer_to_worker','worker_to_farmer') then
    return json_build_object('ok', false, 'reason', 'not_entitled');
  end if;

  -- 閲覧資格は既存の信頼情報RPCと同一（範囲を勝手に広げない）
  if p_direction = 'farmer_to_worker' then
    -- 被評価者は働き手。本人／その働き手から応募を受けた農家
    v_entitled := (auth.uid() = p_user_id) or exists (
      select 1 from public.applications a
       where a.worker_id = p_user_id and a.farmer_id = auth.uid());
  else
    -- 被評価者は農家。本人／その農家へ応募した働き手／公開求人のある農家は誰でも（求人詳細で見せるため）
    v_entitled := (auth.uid() = p_user_id) or exists (
      select 1 from public.applications a
       where a.farmer_id = p_user_id and a.worker_id = auth.uid())
      or exists (select 1 from public.jobs j where j.farmer_id = p_user_id and j.status = 'open');
  end if;
  if not v_entitled then
    return json_build_object('ok', false, 'reason', 'not_entitled');
  end if;

  -- publishedな受領評価だけを対象にする共通述語（第8条3）
  with pub as (
    select r.*
      from public.reviews r
      join public.applications a on a.id = r.application_id
     where r.reviewee_id = p_user_id
       and r.direction = p_direction
       and (
         (a.work_completed_at is not null and a.work_completed_at <= now() - interval '3 days')
         or exists (select 1 from public.reviews r2
                     where r2.application_id = r.application_id
                       and r2.reviewer_id = r.reviewee_id)  -- 相手方向の評価も存在＝双方揃った
       )
  )
  select
    json_build_object(
      'want_again',            count(*) filter (where want_again is true),
      'entrust',               count(*) filter (where entrust is true),
      'on_time',               count(*) filter (where on_time is true),
      'as_described',          count(*) filter (where as_described is true),
      'followed_instructions', count(*) filter (where followed_instructions is true),
      'completed_work',        count(*) filter (where completed_work is true),
      'safety_care',           count(*) filter (where safety_care is true)
    ),
    coalesce((
      select json_agg(json_build_object(
               'comment', c.public_comment,
               'date', to_char(c.created_at at time zone 'Asia/Tokyo','YYYY/MM/DD'))
             order by c.created_at desc)
        from pub c
       where c.comment_status = 'approved'
         and nullif(btrim(coalesce(c.public_comment,'')),'') is not null
    ), '[]'::json),
    count(*)
  into v_badges, v_comments, v_total
  from pub;

  return json_build_object('ok', true, 'badges', v_badges, 'comments', v_comments, 'total', coalesce(v_total,0));
end;
$function$;

revoke all on function public.reviews_public_badges(uuid, text) from public, anon;
grant execute on function public.reviews_public_badges(uuid, text) to authenticated;

-- ③ 運営のコメント審査（app_admins限定・読み取り／承認・却下）
create or replace function public.admin_pending_review_comments()
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v json;
begin
  if not exists (select 1 from public.app_admins a where a.auth_id = auth.uid()) then
    return json_build_object('ok', false, 'reason', 'not_admin');
  end if;
  -- 良性判定に必要なのは本文だけ。当事者名は返さない（運営の主観・関与を最小化）
  select coalesce(json_agg(json_build_object(
           'id', r.id, 'comment', r.public_comment, 'direction', r.direction,
           'created_at', to_char(r.created_at at time zone 'Asia/Tokyo','YYYY/MM/DD HH24:MI'))
         order by r.created_at asc), '[]'::json)
    into v
    from public.reviews r
   where r.comment_status = 'pending'
     and nullif(btrim(coalesce(r.public_comment,'')),'') is not null;
  return json_build_object('ok', true, 'items', v);
end;
$function$;
revoke all on function public.admin_pending_review_comments() from public, anon, authenticated;
grant execute on function public.admin_pending_review_comments() to authenticated;

create or replace function public.moderate_review_comment(p_review_id uuid, p_approve boolean)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not exists (select 1 from public.app_admins a where a.auth_id = auth.uid()) then
    return json_build_object('ok', false, 'reason', 'not_admin');
  end if;
  update public.reviews
     set comment_status = case when p_approve then 'approved' else 'rejected' end
   where id = p_review_id and comment_status = 'pending';
  if not found then return json_build_object('ok', false, 'reason', 'not_pending'); end if;
  return json_build_object('ok', true, 'status', case when p_approve then 'approved' else 'rejected' end);
end;
$function$;
revoke all on function public.moderate_review_comment(uuid, boolean) from public, anon, authenticated;
grant execute on function public.moderate_review_comment(uuid, boolean) to authenticated;
