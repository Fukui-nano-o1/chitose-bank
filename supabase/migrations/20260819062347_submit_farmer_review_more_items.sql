-- 仕事の全体的な評価（農家→働き手）の項目を増やす（2026-08-19たきと指示「同じように農家→働き手の
-- 評価を設計しろ」）。働き手→農園を6項目にしたのと対にする。
-- ★列は追加しない：農家→働き手の6項目（want_again / entrust / on_time / as_described /
--   followed_instructions / completed_work）は reviews に既にあり、reviews_public_badges も
--   ReceivedReviews.BADGE_DEFS.farmer_to_worker も最初から6つ全部を列挙している。
--   これまで画面が want_again と entrust の2つしか書いていなかっただけ＝受け皿は既に揃っている。
-- 引数を足すので CREATE OR REPLACE では置き換えられない（別の関数になり呼び出しが曖昧になる）。
-- 旧6引数版を落としてから作り直す。★新しい4つは default null なので、古いJSを掴んだ端末からの
-- 6引数（名前付き）の呼び出しもそのまま通る＝入れ替えの前後で評価が落ちない。
drop function if exists public.submit_farmer_review(uuid, boolean, boolean, text, text, boolean);

create or replace function public.submit_farmer_review(
  p_application_id uuid,
  p_want_again boolean,
  p_entrust boolean,
  p_public_comment text,
  p_private_memo text,
  p_favorite boolean,
  p_on_time boolean default null,
  p_as_described boolean default null,
  p_followed_instructions boolean default null,
  p_completed_work boolean default null)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v json; v_farmer uuid; v_worker uuid;
begin
  select farmer_id, worker_id into v_farmer, v_worker
    from public.applications where id = p_application_id;
  if v_farmer is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_farmer <> auth.uid() then return json_build_object('ok', false, 'reason', 'not_yours'); end if;

  -- 完了処理（評価送信は出勤前提。メール失敗はcomplete_work内で握って続行）
  v := public.complete_work(p_application_id, true);
  if not coalesce((v->>'ok')::boolean, false) then return v; end if;

  insert into public.reviews (application_id, reviewer_id, reviewee_id, direction,
                              want_again, entrust, on_time, as_described,
                              followed_instructions, completed_work,
                              public_comment, private_memo)
  values (p_application_id, v_farmer, v_worker, 'farmer_to_worker',
          p_want_again, p_entrust, p_on_time, p_as_described,
          p_followed_instructions, p_completed_work,
          nullif(trim(coalesce(p_public_comment,'')),''), nullif(trim(coalesce(p_private_memo,'')),''));

  if p_want_again and p_favorite then
    insert into public.repeat_roster (farmer_id, worker_id, source_application_id, notify)
    values (v_farmer, v_worker, p_application_id, true)
    on conflict (farmer_id, worker_id) do nothing;
  end if;

  return json_build_object('ok', true, 'favorited', (p_want_again and p_favorite));
end;
$function$;

revoke all on function public.submit_farmer_review(uuid, boolean, boolean, text, text, boolean, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.submit_farmer_review(uuid, boolean, boolean, text, text, boolean, boolean, boolean, boolean, boolean) to authenticated;
