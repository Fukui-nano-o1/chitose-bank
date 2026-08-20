-- 最終日の評価を3問×3択＋タグに再設計（2026-08-20たきと裁定「日次は事故ログ。最終日は評価。
-- プロフィールはその両方から自動生成」「対称設計にしすぎない」「公開自由記述レビューは当面いらない」）。
-- 農家→働き手＝①仕事は完了したか ②またこの人と働きたいか ③特記事項（タグ選択）
-- 働き手→農家＝①求人と実際は一致していたか ②報酬は約束どおりか ③またこの農家の仕事をしたいか
--
-- ★真実は新しい text/jsonb 列に持ち、既存の boolean 列は互換の影として導出する
--   （want_again は repeat_roster・trg_instant_approve・worker_trust_info・badges の材料＝壊さない）。
--   はい→true／いいえ→false／どちらともいえない→null（中立は否定ではない）。
alter table public.reviews add column if not exists want_again_choice text;
alter table public.reviews add column if not exists work_outcome text;
alter table public.reviews add column if not exists traits jsonb;
alter table public.reviews add column if not exists match_level text;
alter table public.reviews add column if not exists pay_status text;
alter table public.reviews drop constraint if exists reviews_want_again_choice_check;
alter table public.reviews add constraint reviews_want_again_choice_check
  check (want_again_choice is null or want_again_choice in ('yes','neutral','no'));
alter table public.reviews drop constraint if exists reviews_work_outcome_check;
alter table public.reviews add constraint reviews_work_outcome_check
  check (work_outcome is null or work_outcome in ('completed','partial','not_completed'));
alter table public.reviews drop constraint if exists reviews_match_level_check;
alter table public.reviews add constraint reviews_match_level_check
  check (match_level is null or match_level in ('matched','partly','differed'));
alter table public.reviews drop constraint if exists reviews_pay_status_check;
alter table public.reviews add constraint reviews_pay_status_check
  check (pay_status is null or pay_status in ('paid','unpaid','other'));

comment on column public.reviews.want_again_choice is '3択の真実（yes/neutral/no）。boolean want_again は互換の影（yes→true・no→false・neutral→null）';
comment on column public.reviews.work_outcome is '農家→働き手：仕事は完了したか（completed/partial/not_completed）。completed_work boolean は影';
comment on column public.reviews.traits is '農家→働き手の特記タグ（配列）。careful/fast/attentive/safe＝肯定（公開）、work_issue/comm_issue＝否定（記録のみ・非公開）';
comment on column public.reviews.match_level is '働き手→農家：求人と実際の一致（matched/partly/differed）。as_described boolean は影（matched→true）';
comment on column public.reviews.pay_status is '働き手→農家：報酬は約束どおりか（paid/unpaid/other）。paid_as_posted boolean は影（paid→true）';

-- 未払いの報告は運営が即知るべき事実（賃金トラブル）＝通知トリガーではなくRPC/insert側でなく、
-- ここでは扱わない（当面は評価データとして蓄積し、運営はレビュー面で見る）。

-- 農家の最終評価RPC（新設・旧 submit_farmer_review はそのまま残す＝古いJSを掴んだ端末の互換用。
-- 名前を分けたのはオーバーロードの曖昧解決（PostgRESTの300）を踏まないため）。
create or replace function public.submit_farmer_final_review(
  p_application_id uuid,
  p_work_outcome text,
  p_want_again_choice text,
  p_traits jsonb default '[]'::jsonb,
  p_favorite boolean default false)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v json; v_farmer uuid; v_worker uuid;
begin
  if p_work_outcome not in ('completed','partial','not_completed')
     or p_want_again_choice not in ('yes','neutral','no') then
    return json_build_object('ok', false, 'reason', 'bad_input');
  end if;
  select farmer_id, worker_id into v_farmer, v_worker
    from public.applications where id = p_application_id;
  if v_farmer is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_farmer <> auth.uid() then return json_build_object('ok', false, 'reason', 'not_yours'); end if;

  -- 完了処理（評価送信は出勤前提＝欠勤は別の道 complete_work(false)。メール失敗は内側で握って続行）
  v := public.complete_work(p_application_id, true);
  if not coalesce((v->>'ok')::boolean, false) then return v; end if;

  insert into public.reviews (application_id, reviewer_id, reviewee_id, direction,
                              work_outcome, want_again_choice, traits,
                              want_again, completed_work)
  values (p_application_id, v_farmer, v_worker, 'farmer_to_worker',
          p_work_outcome, p_want_again_choice,
          coalesce(p_traits, '[]'::jsonb),
          case p_want_again_choice when 'yes' then true when 'no' then false else null end,
          (p_work_outcome = 'completed'));

  if p_want_again_choice = 'yes' and p_favorite then
    insert into public.repeat_roster (farmer_id, worker_id, source_application_id, notify)
    values (v_farmer, v_worker, p_application_id, true)
    on conflict (farmer_id, worker_id) do nothing;
  end if;

  return json_build_object('ok', true, 'favorited', (p_want_again_choice = 'yes' and p_favorite));
end;
$function$;

revoke all on function public.submit_farmer_final_review(uuid, text, text, jsonb, boolean) from public, anon;
grant execute on function public.submit_farmer_final_review(uuid, text, text, jsonb, boolean) to authenticated;

-- 公開バッジ：肯定タグ4種を追加（否定タグ work_issue/comm_issue は集計にも出さない＝第8条2）。
-- 3択の肯定は既存キーで数える（work_outcome=completed→completed_work、match_level=matched→as_described、
-- pay_status=paid→paid_as_posted の影を挿入時に立てるため、関数の列挙は据え置きで足りる）。
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
       where c.comment_status = 'approved'
         and nullif(btrim(coalesce(c.public_comment,'')),'') is not null
    ), '[]'::json),
    count(*)
  into v_badges, v_comments, v_total
  from pub;

  return json_build_object('ok', true, 'badges', v_badges, 'comments', v_comments, 'total', coalesce(v_total,0));
end;
$function$;
