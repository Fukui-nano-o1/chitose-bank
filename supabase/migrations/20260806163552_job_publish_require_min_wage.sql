-- 掲載時の最低賃金チェックをDBの壁にする（2026-08-06・事故予防の段階2）
--
-- ※このファイルはDB直接適用済み（schema_migrations 20260806163552）の写経＝2026-07-21規則3。
--
-- 【何が問題だったか】最賃チェックはフロント（LandingFlow validateMinWage）だけで、
-- 掲載トリガーは募集主・就業場所・時間外は見るのに賃金を見ていなかった
-- ＝APIを直接叩けば最賃違反の求人が掲載できた。求人は運営の審査を通るが、
-- 人の目は数字の割り算を毎回はしない（トリガー＝二重の壁の思想・trg_block_third_party_openと同型）。
--
-- 【追加する検査（draft→pending/open と 直INSERT の時だけ＝既存の発火条件と同じ）】
--  1. 表記：hourly_wage / daily_wage は数字のみ（text列so「9,000円」等が入るのを塞ぐ）
--  2. どちらか必須（両方空では掲載できない）
--  3. 最低賃金：minimum_wages から都道府県の現在有効な額を引く（無ければ掲載を止める＝安全側）
--  4. 時給：最低賃金以上
--  5. 日給：実働時間で時給換算して最低賃金以上。
--     実働 = job_scheduled_minutes(work_time) − greatest(申告休憩, 法定最低休憩)
--     法定最低休憩＝拘束6時間超45分・8時間超60分（労基法34条）。
--     ★フロントの旧式は法定最低しか見ておらず、申告休憩がそれより長い場合（例：90分）に
--       違反を見逃していた。DBとフロントを同じ式に揃える（フロントは同日改修）。
--
-- 【既存データ】掲載中5件・審査中1件を事前に実測＝全件通る（最低で時給換算1250円 ≥ 1046円）。
-- 既存行は書き換えない（トリガーは遷移時のみ）。pending→open（運営承認）では再検査しない
-- ＝申請時に合格した値をそのまま通す（スナップショット維持の既存方針と同じ）。

create or replace function public.trg_job_publish_snapshot()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ep public.employer_profiles%rowtype;
  v_min int; v_minutes int; v_break int; v_legal int; v_actual int; v_hourly_eq numeric;
begin
  -- draft→pending/open（掲載申請）または pending/open での直INSERT の時だけ発火。
  -- pending→open（運営承認）では再取得しない＝申請時の内容を維持
  if new.status in ('pending','open') and (tg_op = 'INSERT' or coalesce(old.status,'draft') = 'draft') then
    select * into v_ep from public.employer_profiles where auth_id = new.farmer_id;
    if coalesce(btrim(v_ep.recruiter_name),'') = '' or coalesce(btrim(v_ep.recruiter_address),'') = ''
       or coalesce(btrim(v_ep.recruiter_contact),'') = '' then
      raise exception '募集主の氏名（名称）・住所・連絡先の入力が必要です（求人広告の法定表示事項）';
    end if;
    if coalesce(btrim(new.address),'') = '' then
      raise exception '就業場所（番地まで）の入力が必要です（求人広告の法定表示事項）';
    end if;
    -- 時間外労働（2026-08-03）：有無は必須。「あり」なら目安の時間も必須
    if coalesce(btrim(new.overtime_policy),'') = '' then
      raise exception '時間外労働の有無の入力が必要です（労働条件の明示事項）';
    end if;
    if new.overtime_policy = 'あり' and coalesce(btrim(new.overtime_detail),'') = '' then
      raise exception '時間外労働の目安（どれくらいの時間か）の入力が必要です（労働条件の明示事項）';
    end if;

    -- ── 賃金の検査（2026-08-06追加）──
    if coalesce(btrim(new.hourly_wage),'') <> '' and btrim(new.hourly_wage) !~ '^[0-9]+$' then
      raise exception '時給は数字のみで入力してください（例：1100）。円・カンマは付けられません';
    end if;
    if coalesce(btrim(new.daily_wage),'') <> '' and btrim(new.daily_wage) !~ '^[0-9]+$' then
      raise exception '日給は数字のみで入力してください（例：9000）。円・カンマは付けられません';
    end if;
    if coalesce(btrim(new.hourly_wage),'') = '' and coalesce(btrim(new.daily_wage),'') = '' then
      raise exception '報酬（時給または日給）の入力が必要です';
    end if;
    select mw.hourly_wage into v_min
      from public.minimum_wages mw
     where mw.prefecture = new.prefecture
       and mw.effective_from <= (now() at time zone 'Asia/Tokyo')::date
     order by mw.effective_from desc limit 1;
    if v_min is null then
      -- 取得できない時は安全側＝掲載を止める（フロントvalidateMinWageのunknownWageと同じ倒し方）
      raise exception '最低賃金を確認できません（都道府県：%）。運営に連絡してください', coalesce(new.prefecture,'未設定');
    end if;
    if coalesce(btrim(new.hourly_wage),'') <> '' and btrim(new.hourly_wage)::int < v_min then
      raise exception '時給%円は、%の最低賃金（時給%円）を下回っています', btrim(new.hourly_wage), new.prefecture, v_min;
    end if;
    if coalesce(btrim(new.daily_wage),'') <> '' then
      v_minutes := public.job_scheduled_minutes(new.work_time);
      if v_minutes is null then
        raise exception '勤務時間（開始〜終了）を確認できません。日給の最低賃金チェックに必要です';
      end if;
      v_break := coalesce((regexp_match(coalesce(new.break_time,''), '(\d+)'))[1]::int, 0);
      v_legal := case when v_minutes > 480 then 60 when v_minutes > 360 then 45 else 0 end;
      v_actual := v_minutes - greatest(v_break, v_legal);
      if v_actual <= 0 then
        raise exception '実働時間が0以下になります（勤務%・休憩%分）。勤務時間か休憩を見直してください',
          coalesce(new.work_time,'未設定'), greatest(v_break, v_legal);
      end if;
      v_hourly_eq := btrim(new.daily_wage)::numeric * 60 / v_actual;
      if v_hourly_eq < v_min then
        raise exception '日給%円は、実働%分（勤務%・休憩%分）で時給換算すると約%円になり、%の最低賃金（時給%円）を下回っています',
          btrim(new.daily_wage), v_actual, coalesce(new.work_time,'未設定'), greatest(v_break, v_legal),
          floor(v_hourly_eq), new.prefecture, v_min;
      end if;
    end if;
    -- ── 賃金の検査ここまで ──

    new.recruiter_name := v_ep.recruiter_name;
    new.recruiter_address := v_ep.recruiter_address;
    new.recruiter_contact := v_ep.recruiter_contact;
    new.recruiter_name_kana := v_ep.recruiter_name_kana;  -- 2026-08-03追加（カナは任意＝NULL可）
    -- 待遇の確定：プロフィール項目を土台に、求人固有の上書き（new.perks）を重ねて全キー保存。
    -- 以後プロフィールを変えてもこの求人の待遇は変わらない。
    -- 自由記述3項目は承認済みの列値のみ（texts_pending＝審査中の文は入らない・憲法5条）
    new.perks := jsonb_build_object(
      'has_transport', coalesce(v_ep.has_transport, false),
      'transport_area', coalesce(v_ep.transport_area, ''),
      'has_parking', coalesce(v_ep.has_parking, false),
      'parking_capacity', v_ep.parking_capacity,
      'has_commute_allowance', coalesce(v_ep.has_commute_allowance, false),
      'commute_allowance_detail', coalesce(v_ep.commute_allowance_detail, ''),
      'has_bonus', coalesce(v_ep.has_bonus, false),
      'employer_pays_supplies', coalesce(v_ep.employer_pays_supplies, false),
      'supplies_cap', coalesce(v_ep.supplies_cap, ''),
      'accessory_ok', coalesce(v_ep.accessory_ok, false),
      -- 受動喫煙の状況（2026-08-03）：'' は未設定＝表示側で「ー」。
      -- smoking_area は「喫煙場所あり」の時だけ意味を持つ（編集UI側が他の選択では空で保存する）
      'smoking_policy', coalesce(v_ep.smoking_policy, ''),
      'smoking_area', coalesce(v_ep.smoking_area, '')
    ) || coalesce(new.perks, '{}'::jsonb);
    -- 保険の確定：申請時点のプロフィール保険を凍結（空でも {items:[]} を保存＝申請時点で申告なしの記録）
    new.insurance_snapshot := jsonb_build_object(
      'items', coalesce(v_ep.insurance_items, '[]'::jsonb),
      'notes', coalesce(v_ep.insurance_notes, '{}'::jsonb),
      'snapshot_at', now()
    );
    new.profile_snapshot_at := now();
    -- 賃金支払条件の確定（2026-08-02）：現在は全求人固定ポリシー。
    -- フロントから別値が送られても、この3値へ確定する（入力UIは封印中・固定ポリシーの宣言をデータ化）
    new.pay_method := 'cash';
    new.pay_timing := 'same_day_after_work';
    new.wage_closing_rule := 'each_workday';
  end if;
  return new;
end; $function$;
