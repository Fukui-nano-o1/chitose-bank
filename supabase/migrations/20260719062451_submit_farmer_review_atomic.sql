-- 評価送信の原子化（2026-07-19たきと指示：送信ボタンのタップだけがトリガー）。
-- 従来は完了処理→評価INSERT→お気に入りupsertの3回書き込みで、途中失敗すると
-- 「完了だけ残って評価が無い」中途半端な履歴が残り得た。1つのRPC＝1トランザクションに集約し、
-- どこかで失敗したら全部巻き戻る（何も保存されない）ようにする
CREATE OR REPLACE FUNCTION public.submit_farmer_review(
  p_application_id uuid,
  p_want_again boolean,
  p_entrust boolean,
  p_public_comment text,
  p_private_memo text,
  p_favorite boolean
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
                              want_again, entrust, public_comment, private_memo)
  values (p_application_id, v_farmer, v_worker, 'farmer_to_worker',
          p_want_again, p_entrust, nullif(trim(coalesce(p_public_comment,'')),''), nullif(trim(coalesce(p_private_memo,'')),''));

  if p_want_again and p_favorite then
    insert into public.repeat_roster (farmer_id, worker_id, source_application_id, notify)
    values (v_farmer, v_worker, p_application_id, true)
    on conflict (farmer_id, worker_id) do nothing;
  end if;

  return json_build_object('ok', true, 'favorited', (p_want_again and p_favorite));
end;
$$;
REVOKE EXECUTE ON FUNCTION public.submit_farmer_review(uuid, boolean, boolean, text, text, boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.submit_farmer_review(uuid, boolean, boolean, text, text, boolean) TO authenticated;