-- 評価コメントの審査（承認して初めて公開）を廃止し、即時公開にする（2026-08-23たきと指示
-- 「審査のフローは削除したはず。即時公開だ」）。2026-08-14に求人・自由記述の承認を廃止した時、
-- この1本だけが承認制のまま残っていた＝取り残しの解消。
-- 家の作法（2026-08-14）に揃える＝【即時公開＋公開後に運営が確認し、必要なら非表示】。
-- ★取り下げの道は残す：誹謗中傷への対処手段を無くさない（規約第8条／通報の受け皿）。
-- 現状の注記：公開自由記述の入力は2026-08-20の裁定で撤去済み＝新しいコメントは入ってこない。
--   ここで扱うのは、それ以前に入力された分（本番に1件）と、将来また入力を設ける場合の既定。

-- ① 既定を「公開」に（承認待ちという状態を作らない）
alter table public.reviews alter column comment_status set default 'approved';

-- ② 承認待ちで止まっていた分を公開に（運営が非表示にした rejected はそのまま）
update public.reviews set comment_status = 'approved' where comment_status = 'pending';

-- ③ 公開判定：「承認済みだけ出す」→「運営が非表示にしたものだけ落とす」
--    （公開のゲート＝双方の評価が揃うか完了から3日、は不変＝規約第8条4）
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
    v_entitled := (auth.uid() = p_user_id) or exists (
      select 1 from public.applications a
       where a.worker_id = p_user_id and a.farmer_id = auth.uid());
  else
    v_entitled := (auth.uid() = p_user_id) or exists (
      select 1 from public.applications a
       where a.farmer_id = p_user_id and a.worker_id = auth.uid())
      or exists (select 1 from public.jobs j where j.farmer_id = p_user_id and j.status = 'open');
  end if;
  if not v_entitled then
    return json_build_object('ok', false, 'reason', 'not_entitled');
  end if;

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
                       and r2.reviewer_id = r.reviewee_id)
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
      'safety_care',           count(*) filter (where safety_care is true),
      'instructions_clear',    count(*) filter (where instructions_clear is true),
      'paid_as_posted',        count(*) filter (where paid_as_posted is true),
      'trait_careful',         count(*) filter (where traits ? 'careful'),
      'trait_fast',            count(*) filter (where traits ? 'fast'),
      'trait_attentive',       count(*) filter (where traits ? 'attentive'),
      'trait_safe',            count(*) filter (where traits ? 'safe')
    ),
    coalesce((
      select json_agg(json_build_object(
               'comment', c.public_comment,
               'date', to_char(c.created_at at time zone 'Asia/Tokyo','YYYY/MM/DD'))
             order by c.created_at desc)
        from pub c
       where c.comment_status is distinct from 'rejected'
         and nullif(btrim(coalesce(c.public_comment,'')),'') is not null
    ), '[]'::json),
    count(*)
  into v_badges, v_comments, v_total
  from pub;

  return json_build_object('ok', true, 'badges', v_badges, 'comments', v_comments, 'total', coalesce(v_total,0));
end;
$function$;

-- ④ 運営の一覧：承認待ちキュー → 公開後の確認（コメントのある評価を新しい順に・状態つき）
drop function if exists public.admin_pending_review_comments();
create or replace function public.admin_review_comments()
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
  -- 判断に必要なのは本文だけ。当事者名は返さない（運営の主観・関与を最小化・2026-08-07の作法）
  select coalesce(json_agg(json_build_object(
           'id', r.id, 'comment', r.public_comment, 'direction', r.direction,
           'status', r.comment_status,
           'created_at', to_char(r.created_at at time zone 'Asia/Tokyo','YYYY/MM/DD HH24:MI'))
         order by r.created_at desc), '[]'::json)
    into v
    from public.reviews r
   where nullif(btrim(coalesce(r.public_comment,'')),'') is not null;
  return json_build_object('ok', true, 'items', v);
end;
$function$;

revoke all on function public.admin_review_comments() from public, anon;
grant execute on function public.admin_review_comments() to authenticated;

-- ⑤ 非表示／公開に戻す：公開後でも操作できるように「承認待ちのみ」の縛りを外す
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
  -- 即時公開になったので、承認ではなく「非表示にする／公開に戻す」の操作になった
  update public.reviews
     set comment_status = case when p_approve then 'approved' else 'rejected' end
   where id = p_review_id
     and nullif(btrim(coalesce(public_comment,'')),'') is not null;
  if not found then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  return json_build_object('ok', true, 'status', case when p_approve then 'approved' else 'rejected' end);
end;
$function$;
