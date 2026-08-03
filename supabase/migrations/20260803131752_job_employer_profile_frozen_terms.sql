-- 農園紹介カードのライブ参照を根治（2026-08-03たきと指摘「待遇を変更したとき過去の求人も変わってはいけない」）
-- 発見した穴：job_employer_profile は求人単位のRPC（p_job_number）なのに、契約に関わる項目を
-- employer_profiles の【現在値】から返していた。求人詳細の農園紹介カードは保険チップと募集者3項目を
-- ここから描くため、プロフィールを直すと過去の公開求人の表示まで変わっていた。
-- （待遇バッジ・保険タブは既に jobs.perks / jobs.insurance_snapshot の凍結値を見ており無事＝同一ページ内で食い違っていた）
-- 方針：この求人の掲載時に凍結された値（jobs側）を返す。人柄・紹介文・アイコン等の表示情報は現在値のまま
-- （凍結対象ではなく、常に最新の自己紹介を見せるのが正しい）。

-- ① フリガナも他の募集者情報と同じく掲載時に凍結する（氏名だけ凍結でカナが現在値だと食い違うため）
alter table public.jobs add column if not exists recruiter_name_kana text;

-- ② 掲載時スナップショットにカナの転写を1行追加（他の挙動は不変）
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
    -- 待遇の確定：プロフィール10項目を土台に、求人固有の上書き（new.perks）を重ねて全キー保存。
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
      'accessory_ok', coalesce(v_ep.accessory_ok, false)
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

-- ③ 既存の掲載済み求人へカナをバックフィル（カナ列の新設前に掲載された求人＝凍結値が無いため、
--    現時点のプロフィール値を初回の凍結値として据える。以後は変わらない）
update public.jobs j
   set recruiter_name_kana = ep.recruiter_name_kana
  from public.employer_profiles ep
 where ep.auth_id = j.farmer_id
   and j.status in ('open','pending')
   and j.recruiter_name_kana is null;

-- ④ RPCを凍結値へ切り替え（返り値の型・列順・件数は不変＝呼び出し側の改修不要）
create or replace function public.job_employer_profile(p_job_number integer)
 returns table(nickname text, pr text, avatar_url text, has_transport boolean, transport_area text, has_parking boolean, parking_capacity integer, has_commute_allowance boolean, commute_allowance_detail text, has_bonus boolean, employer_pays_supplies boolean, supplies_cap text, accessory_ok boolean, intro_path text, intro_joy text, intro_crops text, intro_atmosphere text, intro_message text, owner_comment text, unique_point text, always_do text, break_style text, interaction_style text, insurance_items jsonb, insurance_notes jsonb, recruiter_name text, recruiter_address text, recruiter_contact text, recruiter_name_kana text)
 language sql
 security definer
 set search_path to 'public'
as $function$
  select
         -- 表示情報（凍結対象外・常に最新でよい）：名前・紹介文・アイコン・人柄
         ep.nickname, ep.pr, ep.avatar_url,
         -- 待遇10項目は掲載時に凍結した jobs.perks から返す（この求人の広告内容そのもの）
         coalesce((j.perks->>'has_transport')::boolean, false),
         coalesce(j.perks->>'transport_area', ''),
         coalesce((j.perks->>'has_parking')::boolean, false),
         (j.perks->>'parking_capacity')::integer,
         coalesce((j.perks->>'has_commute_allowance')::boolean, false),
         coalesce(j.perks->>'commute_allowance_detail', ''),
         coalesce((j.perks->>'has_bonus')::boolean, false),
         coalesce((j.perks->>'employer_pays_supplies')::boolean, false),
         coalesce(j.perks->>'supplies_cap', ''),
         coalesce((j.perks->>'accessory_ok')::boolean, false),
         -- 農園紹介の文章・人柄（凍結対象外）
         ep.intro_path, ep.intro_joy, ep.intro_crops,
         ep.intro_atmosphere, ep.intro_message, ep.owner_comment,
         ep.unique_point, ep.always_do, ep.break_style, ep.interaction_style,
         -- 保険は掲載時に凍結した insurance_snapshot から（現在値への代用は禁止・2026-08-02）
         coalesce(j.insurance_snapshot->'items', '[]'::jsonb),
         coalesce(j.insurance_snapshot->'notes', '{}'::jsonb),
         -- 募集者の法定3項目＋カナも掲載時の凍結値（anonには従来どおりNULL）
         case when coalesce(auth.role(),'anon')='anon' then null::text else j.recruiter_name end,
         case when coalesce(auth.role(),'anon')='anon' then null::text else j.recruiter_address end,
         case when coalesce(auth.role(),'anon')='anon' then null::text else j.recruiter_contact end,
         case when coalesce(auth.role(),'anon')='anon' then null::text else j.recruiter_name_kana end
  from jobs j
  join employer_profiles ep on ep.auth_id = j.farmer_id
  where j.job_number = p_job_number and j.status = 'open';
$function$;
