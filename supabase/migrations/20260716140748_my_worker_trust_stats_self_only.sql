-- 働き手トップボックス裏面用の自己閲覧専用スタッツ（2026-07-16）
-- 登録日・本人確認日に加え、農家評価「また呼びたい」由来のリピート率を返す。
-- ★法務注意：リピート率は第三者（農家）評価の集計値。求職者公開項目の絶対禁止
--（主観的評価・スコアリングの公開）に抵触するため、本人以外へ返してはならない。
-- そのため worker_trust_info を拡張せず、auth.uid() 本人限定の別関数として実装する。
create or replace function public.my_worker_trust_stats()
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_joined timestamptz;
  v_verified timestamptz;
  v_reviewed int;
  v_want int;
begin
  if auth.uid() is null then
    return json_build_object('ok', false, 'reason', 'not_signed_in');
  end if;

  select created_at into v_joined from auth.users where id = auth.uid();
  select created_at into v_verified from public.account_holders where auth_id = auth.uid();

  select count(*), count(*) filter (where want_again)
    into v_reviewed, v_want
    from public.reviews
   where reviewee_id = auth.uid()
     and direction = 'farmer_to_worker'
     and want_again is not null;

  return json_build_object(
    'ok', true,
    'joined_at', v_joined,
    'verified_at', v_verified,
    'reviewed_count', coalesce(v_reviewed, 0),
    'want_again_count', coalesce(v_want, 0)
  );
end;
$$;

revoke all on function public.my_worker_trust_stats() from public;
revoke all on function public.my_worker_trust_stats() from anon;
grant execute on function public.my_worker_trust_stats() to authenticated;