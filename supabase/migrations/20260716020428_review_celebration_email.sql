-- 評価の祝賀メール：ポジ評価（また呼びたい/また働きたい=true）を受けた側へ。
-- 相手が未評価なら「あなたも送ると見られる」で相互評価を回収する。双方向対応。
create or replace function public.trg_review_celebration()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text; v_counterpart_done boolean; v_body text; v_role_line text;
begin
  if not coalesce(new.want_again, false) then return new; end if;  -- ポジのみ祝う

  v_name := public.resolve_actor_name(new.reviewer_id);

  select exists (
    select 1 from public.reviews r
     where r.application_id = new.application_id
       and r.reviewer_id = new.reviewee_id
  ) into v_counterpart_done;

  v_role_line := case new.direction
    when 'farmer_to_worker' then '「🌟また呼びたい」の評価です。あなたのプロフィールの実績になります。'
    else '「🌟また働きたい」の評価です。あなたの農園の信頼になります。' end;

  if v_counterpart_done then
    v_body := 'おめでとうございます！' || v_name || 'さんからの評価を受け取りました。' || E'\n' ||
      v_role_line || E'\n\n' ||
      '開いてみましょう：https://chitose-bank.com/#/profile';
  else
    v_body := 'おめでとうございます！' || v_name || 'さんからの評価が届いています。' || E'\n' ||
      v_role_line || E'\n\n' ||
      'あなたも評価を送ると、お互いの評価が見られるようになります（完了から3日以内）。' || E'\n' ||
      '評価を送る：https://chitose-bank.com/#/profile';
  end if;

  insert into public.notifications (farmer_id, type, message)
  values (new.reviewee_id, 'review_received',
          '🌟 ' || v_name || 'さんからの評価を受け取りました');
  begin
    perform public.send_user_email(new.reviewee_id,
      '[chitose-bank] 🌟おめでとうございます！' || v_name || 'さんからの評価が届きました',
      v_body);
  exception when others then null; end;
  return new;
end; $$;
drop trigger if exists review_celebration on public.reviews;
create trigger review_celebration after insert on public.reviews
  for each row execute function public.trg_review_celebration();