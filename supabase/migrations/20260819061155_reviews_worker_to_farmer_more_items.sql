-- 仕事の全体的な評価（働き手→農園）の項目を増やす（2026-08-19たきと指示
-- 「完了日は仕事の全体的な評価をする。もっと入力項目を増やせ」）。
-- 既存の3項目（また働きたい／説明のとおり／安全に配慮）に、時間どおり（既存列 on_time を
-- この向きでも使う）＋新しい2項目を足して計6項目にする。
-- ★既存の列を意味の違う向きに転用しない：entrust / followed_instructions / completed_work は
--   農家→働き手の評価語so、農園を評価する項目としては使わない（新しい列を足す）。
alter table public.reviews add column if not exists instructions_clear boolean;
alter table public.reviews add column if not exists paid_as_posted boolean;

comment on column public.reviews.instructions_clear is
  '働き手→農園：仕事の教え方・指示が分かりやすかったか（肯定のみ公開・利用規約第8条2）';
comment on column public.reviews.paid_as_posted is
  '働き手→農園：賃金が求人のとおり支払われたか（肯定のみ公開。いいえは公開されないが記録には残る）';

-- ★列を足したら reviews_public_badges の列挙も同時に直す（jobs_public と同じ型の連動ルール）。
--   直し忘れると、新しい項目は入力できるのに誰にも表示されない。
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
      'safety_care',           count(*) filter (where safety_care is true),
      'instructions_clear',    count(*) filter (where instructions_clear is true),
      'paid_as_posted',        count(*) filter (where paid_as_posted is true)
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
