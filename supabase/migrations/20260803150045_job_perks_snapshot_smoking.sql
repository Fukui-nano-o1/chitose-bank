-- 受動喫煙の状況を求人の待遇スナップショットに含める（2026-08-03たきと指示
-- 「詳細・確認ページどちらにも受動喫煙の有無を明記。アクセサリーOKの下に同じ構造で」）。
-- 就業場所の受動喫煙対策は求人の明示事項なので、待遇と同じく【掲載時点の値を凍結】する
-- （プロフィール現在値のライブ参照にしない＝掲載後にプロフィールを直しても公開済み求人の表示は変わらない）。
-- perks のキー追加のみ。CHECK制約(jobs_publish_snapshot_check)は perks IS NOT NULL しか見ないので影響なし。
-- 既存の pending/open 行はバックフィルしない＝掲載時にこの項目は存在しなかった、という記録を正しく残す
-- （表示側は未設定として「ー」を出す）。
-- ※本migrationはMCP直接適用済み（version 20260803150045）。2026-07-21ルールに従いrepoへ写経
create or replace function public.trg_job_publish_snapshot()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_ep public.employer_profiles%rowtype;
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
