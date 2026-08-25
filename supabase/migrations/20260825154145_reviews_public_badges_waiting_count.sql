-- 受け取った評価に「待っている件数」を足す（2026-08-25たきと報告
-- 「ねっこ農園さんからコメントしてくれているはずだが、まだ評価はありませんと出る」）。
-- 実際は評価もコメントも残っていて公開状態だが、規約第8条4の公開ゲート
-- （双方の評価が揃うか、完了から3日）で伏せられていた＝画面が理由を言わないので「消えた」に見えた。
-- ★中身・誰が書いたかは返さない。返すのは【何件が公開待ちか】の数だけ＝ゲートは一切ゆるめない。
--   Airbnbの「相手のレビューは、あなたが書くか期間が過ぎると公開されます」と同じ知らせ方。
create or replace function public.reviews_public_badges(p_user_id uuid, p_direction text)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_entitled boolean;
  v_badges json; v_comments json; v_total int; v_waiting int;
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

  -- 公開待ち＝届いているが、まだゲートを越えていない評価の【件数だけ】
  select count(*) - coalesce(v_total,0)
    into v_waiting
    from public.reviews r
   where r.reviewee_id = p_user_id and r.direction = p_direction;

  return json_build_object('ok', true, 'badges', v_badges, 'comments', v_comments,
                           'total', coalesce(v_total,0), 'waiting', greatest(coalesce(v_waiting,0), 0));
end;
$function$;
