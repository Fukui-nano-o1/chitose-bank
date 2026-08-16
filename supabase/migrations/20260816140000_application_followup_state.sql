-- 応募の「保留」「対応済み」（2026-08-16たきと裁定・未回答督促の4択に合わせて新設）
--
-- 【設計】
-- ・status は変えない＝時刻列の追記だけ（行動記録の憲法・柱1「状態を上書きせず時刻を追記する」）。
--   status を増やすと、帯（app_phase）・FlowBar・失効cron・やること・統計の全部に波及するため。
--   「保留」も「対応済み」も、承認・見送りの判断が済んでいない点は applied のまま＝失効の仕組みも不変。
-- ・意味の別：
--     保留（held_at）      ＝ 認識したが、いま決められない（後で判断する）
--     対応済み（handled_at）＝ サイトの外を含め、この応募への対応は済ませた
--   どちらも「農家が応募を認識した」記録なので、未回答の督促（12〜72時間）は止まる。
--   ただし作業前日の督促（M07）と自動失効は従来どおり働く＝応募者が放置されない仕組みは崩さない。
-- ・押せるのは applied の間だけ（承認・見送りの後は意味を持たない）。取り消し（clear）も可。
-- ・書き込みの窓口はこのRPC1本（applications への直接UPDATEポリシーは2026-08-07に廃止済み）。
--   当事者（求人者本人）ゲート＋BANの壁（trg_a_block_moderated）を通る。

alter table public.applications
  add column if not exists held_at    timestamptz,
  add column if not exists handled_at timestamptz;

comment on column public.applications.held_at    is '求人者が「保留」にした時刻（statusはappliedのまま・未回答督促を止める）';
comment on column public.applications.handled_at is '求人者が「対応済み」にした時刻（statusはappliedのまま・未回答督促を止める）';

create or replace function public.set_application_followup(p_application_id uuid, p_kind text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid; v_farmer uuid; v_status text;
  v_held timestamptz; v_handled timestamptz;
begin
  v_caller := auth.uid();
  if v_caller is null then return json_build_object('ok', false, 'reason', 'not_logged_in'); end if;
  if p_kind not in ('hold','handled','clear') then
    return json_build_object('ok', false, 'reason', 'bad_kind');
  end if;

  select farmer_id, status into v_farmer, v_status
    from public.applications where id = p_application_id;
  if v_farmer is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_farmer <> v_caller then return json_build_object('ok', false, 'reason', 'not_your_application'); end if;
  if v_status <> 'applied' then
    return json_build_object('ok', false, 'reason', 'already_decided', 'status', v_status);
  end if;

  update public.applications
     set held_at    = case p_kind when 'hold'    then now() when 'clear' then null else held_at    end,
         handled_at = case p_kind when 'handled' then now() when 'clear' then null else handled_at end
   where id = p_application_id
  returning held_at, handled_at into v_held, v_handled;

  return json_build_object('ok', true, 'held_at', v_held, 'handled_at', v_handled);
end $$;

revoke all on function public.set_application_followup(uuid, text) from public, anon;
grant execute on function public.set_application_followup(uuid, text) to authenticated;
